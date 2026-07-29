/**
 * Îlot d'interface.
 *
 * Le thread principal ne parse rien et n'écrit rien : il passe des octets au
 * worker et affiche ce qui revient. Tout ce qui coûte est de l'autre côté.
 */
import { downloadZip } from 'client-zip';
import { parseCoordinates, formatDecimal, formatDms, distanceMetres, formatDistance } from '../exif/coords.ts';
import type { Carte } from './carte.ts';
import type { FromWorker, LatLon, PhotoRead, ToWorker, WriteResult } from '../exif/types.ts';
import { dicoDuDocument, type CodeErreur } from '../i18n/index.ts';

// Les mots de CETTE page. L'attribut `lang` du document a été écrit au build :
// on ne devine pas la langue, on la lit.
const T = dicoDuDocument();

/** La phrase d'une erreur, dans la langue de la page. */
const messageErreur = (code: string, secours: string): string =>
  T.erreurs[code as CodeErreur] ?? secours;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const el = {
  picker: $<HTMLInputElement>('picker'),
  vide: $('etat-vide'),
  actif: $('etat-actif'),
  etapes: $('etapes'),
  nom: $('nom-fichier'),
  pillFormat: $('pill-format'),
  pillPosition: $('pill-position'),
  changer: $<HTMLButtonElement>('changer'),
  coords: $<HTMLInputElement>('coords'),
  carteBascule: $<HTMLButtonElement>('carte-bascule'),
  carte: $('carte'),
  carteVue: $('carte-vue'),
  cartePlus: $<HTMLButtonElement>('carte-plus'),
  carteMoins: $<HTMLButtonElement>('carte-moins'),
  resultat: $('resultat'),
  resultatCoords: $('resultat-coords'),
  resultatDetail: $('resultat-detail'),
  telecharger: $<HTMLButtonElement>('telecharger'),
  effacer: $<HTMLButtonElement>('effacer'),
  effacerTout: $<HTMLButtonElement>('effacer-tout'),
  autres: $<HTMLDetailsElement>('autres'),
  autresListe: $('autres-liste'),
  alerteFormat: $('alerte-format'),
  lot: $('lot'),
  lotResume: $('lot-resume'),
  lotListe: $('lot-liste'),
  coordsErreur: $('coords-erreur'),
  titreActif: $('titre-actif'),
  annonce: $('annonce'),
};

interface Item {
  id: string;
  file: File;
  read?: PhotoRead;
  erreur?: string;
}

const items: Item[] = [];
let principal: Item | null = null;
let cible: LatLon | null = null;
let compteur = 0;
/** La carte n'existe qu'une fois demandée : avant, rien n'a été chargé. */
let carte: Carte | null = null;
/** Précision du geste qui a désigné `cible`, en mètres. Null si elle a été saisie. */
let precision: number | null = null;
/** Empêche l'aller-retour champ → carte → champ de se mordre la queue. */
let enSync = false;

/* --- worker ------------------------------------------------------- */

let worker: Worker | null = null;
const enAttente = new Map<string, (m: FromWorker) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../../worker/exif.worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    const id = m.type === 'apply:done' ? m.payload.id : m.type === 'read:ok' ? m.payload.id : m.id;
    const resolve = enAttente.get(id);
    if (resolve) {
      enAttente.delete(id);
      resolve(m);
    }
  });
  return worker;
}

function demander(message: ToWorker, transfer: Transferable[]): Promise<FromWorker> {
  return new Promise((resolve) => {
    enAttente.set(message.id, resolve);
    getWorker().postMessage(message, transfer);
  });
}

/* --- annonces ----------------------------------------------------- */

function annoncer(texte: string): void {
  el.annonce.textContent = texte;
}

/**
 * L'état « saisie refusée » du champ de coordonnées.
 *
 * Contrôlé à la PERTE DE FOCUS et non à la frappe : « 43. » est invalide à la
 * troisième touche, et valider à chaque caractère ferait crier l'erreur pendant
 * qu'on écrit la réponse juste. Un seul point d'entrée, appelé par tout ce qui
 * écrit dans le champ — y compris la carte — pour que l'attribut et le texte ne
 * puissent pas diverger.
 */
function majEtatCoords(invalide: boolean): void {
  el.coordsErreur.hidden = !invalide;
  el.coordsErreur.textContent = invalide ? T.app.coordsInvalides : '';
  if (invalide) {
    el.coords.setAttribute('aria-invalid', 'true');
    el.coords.setAttribute('aria-describedby', 'coords-aide coords-erreur');
  } else {
    el.coords.removeAttribute('aria-invalid');
    el.coords.setAttribute('aria-describedby', 'coords-aide');
  }
}

/* --- état --------------------------------------------------------- */

function marquerEtape(n: 1 | 2 | 3): void {
  for (const li of Array.from(el.etapes.children) as HTMLElement[]) {
    const e = Number(li.dataset.etape);
    li.classList.toggle('done', e < n);
    li.classList.toggle('on', e === n);
    // L'etape courante ne tenait qu'a une couleur et a une graisse.
    if (e === n) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
    if (e < n) {
      const no = li.querySelector('.no');
      if (no) no.textContent = '✓';
    } else {
      const no = li.querySelector('.no');
      if (no) no.textContent = String(e);
    }
  }
}

/*
 * `deplacerFocus` : au chargement du module cette fonction pose seulement l'état
 * initial, et déplacer le focus volerait le curseur à quelqu'un qui n'a rien
 * demandé. Seul le bouton « Changer de photo » le réclame — c'est lui qui vient
 * de faire disparaître sous le focus l'élément qui le portait.
 */
function versEtatVide(deplacerFocus = false): void {
  items.length = 0;
  principal = null;
  cible = null;
  precision = null;
  fermerCarte();
  el.vide.hidden = false;
  el.actif.hidden = true;
  el.coords.value = '';
  majEtatCoords(false);
  el.resultat.hidden = true;
  el.telecharger.disabled = true;
  el.picker.value = '';
  marquerEtape(1);
  annoncer(T.app.aucuneChargee);
  if (deplacerFocus) el.picker.focus();
}

function octets(n: number): string {
  const [o, ko, mo] = T.app.octets;
  if (n < 1024) return `${n} ${o}`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} ${ko}`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', T.app.virgule)} ${mo}`;
}

const NOM_FORMAT: Record<string, string> = {
  jpeg: 'JPEG', png: 'PNG', webp: 'WebP', heic: 'HEIC', avif: 'AVIF',
  tiff: 'TIFF', gif: 'GIF', video: T.app.nomVideo, inconnu: T.app.nomInconnu,
};

function afficherPrincipal(): void {
  const it = principal;
  if (!it || !it.read) return;
  const r = it.read;

  el.vide.hidden = true;
  el.actif.hidden = false;
  el.nom.textContent = r.name;
  el.nom.title = r.name;
  el.pillFormat.textContent = `${NOM_FORMAT[r.format] ?? r.format} · ${octets(r.size)}`;

  if (r.position) {
    el.pillPosition.hidden = false;
    el.pillPosition.textContent = `${T.app.actuellement} : ${formatDecimal(r.position)}`;
  } else {
    el.pillPosition.hidden = true;
  }

  // La phrase est toujours affichée : l'interface annonce la voie AVANT
  // l'action, y compris quand tout est possible. Elle n'est alarmante que
  // lorsqu'une opération manque réellement à l'appel.
  const modifiable = r.can.write;
  const phrase = T.motifs[r.motif];
  el.alerteFormat.hidden = !phrase;
  el.alerteFormat.textContent = phrase;
  el.alerteFormat.classList.toggle('grave', !r.can.read);
  el.alerteFormat.classList.toggle('attention', r.can.read && !(modifiable && r.can.erase));
  el.coords.disabled = !modifiable;
  // Une carte qu'on peut promener mais dont le résultat ne sera jamais inscrit
  // est un piège : on la referme plutôt que de la laisser répondre à vide.
  el.carteBascule.disabled = !modifiable;
  if (!modifiable) fermerCarte();
  else carte?.marquerOrigine(r.position ?? null);
  el.effacer.disabled = !r.can.erase;
  el.effacerTout.disabled = !r.can.eraseAll;

  const nomInfo = (cle: string) => T.infos[cle] ?? cle;
  const infos: Array<[string, string]> = [];
  if (r.camera) infos.push([nomInfo('Appareil'), r.camera]);
  if (r.takenAt) infos.push([nomInfo('PriseDeVue'), r.takenAt.replace('T', ' ').replace(/\..*$/, '')]);
  if (r.position) infos.push([nomInfo('Position'), formatDms(r.position)]);
  if (r.altitude !== null) infos.push([nomInfo('Altitude'), `${Math.round(r.altitude)} m`]);
  for (const d of r.details) infos.push([nomInfo(d.cle), d.value]);

  el.autres.hidden = infos.length === 0;
  el.autresListe.replaceChildren(
    ...infos.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );

  marquerEtape(r.position || cible ? 2 : 2);
  majResultat();

  const lot = items.length > 1;
  el.lot.hidden = !lot;
  if (lot) majListeLot();

  /*
   * La phrase de capacité est ANNONCÉE, et pas seulement affichée. C'est le
   * texte le plus important de l'outil — « on ne sait pas encore travailler les
   * vidéos », « on sait lire ce lieu mais pas encore le changer » — et il ne
   * passait que par l'écran. Un lecteur d'écran à qui l'on donnait une vidéo
   * entendait « Photo lue. Aucun lieu enregistré dans ce fichier », ce qui est
   * faux dans l'esprit sinon dans la lettre, pendant que la vraie raison restait
   * muette juste à côté. `phrase` est déjà en portée, plus haut.
   */
  const etat = r.position
    ? T.app.photoLue(formatDecimal(r.position))
    : T.app.photoLueSansPosition;
  annoncer(phrase ? `${etat} ${phrase}` : etat);
}

function majListeLot(statuts: Map<string, string> = new Map()): void {
  const modifiables = items.filter((i) => i.read?.can.write).length;
  el.lotResume.textContent = `${items.length} ${T.app.fichiers} · ${modifiables} ${T.app.modifiables}`;
  el.lotListe.replaceChildren(
    ...items.map((it) => {
      const row = document.createElement('li');
      row.className = 'file-row';
      const nm = document.createElement('bdi');
      nm.className = 'nm';
      nm.textContent = it.file.name;
      const st = document.createElement('span');
      st.className = 'st';
      const statut = statuts.get(it.id);
      if (statut) {
        st.textContent = statut;
        row.classList.add(statut.startsWith('✓') ? 'ok' : 'ko');
      } else if (it.erreur) {
        st.textContent = T.app.illisible;
        row.classList.add('ko');
      } else if (it.read?.can.write) {
        st.textContent = it.read.position ? T.app.positionLue : T.app.sansPosition;
      } else if (it.read?.can.erase) {
        // On sait retirer le lieu de ce fichier sans savoir lui en donner un.
        // Le ranger avec les « lecture seule » ferait croire à un refus.
        st.textContent = T.app.effacementSeul;
      } else {
        st.textContent = T.app.lectureSeule;
        row.classList.add('ko');
      }
      row.append(nm, st);
      return row;
    }),
  );
}

/* --- carte -------------------------------------------------------- */

/*
 * Deux règles suffisent à empêcher la boucle champ → carte → champ, et aucune
 * des deux n'est un drapeau qu'on peut oublier de poser :
 *
 * 1. Écrire `el.coords.value` depuis le script n'émet PAS d'événement `input`.
 *    Le sens carte → champ est donc sans retour, par spécification.
 * 2. `carte.centrer()` ne rappelle jamais `onChoix`. Le sens champ → carte est
 *    sans retour, par contrat.
 *
 * Si quelqu'un ajoute un jour un `dispatchEvent(new Event('input'))` ou un
 * écouteur `change`, les deux garanties tombent en même temps.
 */

function fermerCarte(): void {
  carte?.detruire();
  carte = null;
  el.carte.hidden = true;
  el.carteBascule.setAttribute('aria-expanded', 'false');
  el.carteBascule.textContent = T.app.ouvrirCarte;
}

async function ouvrirCarte(): Promise<void> {
  if (carte) {
    fermerCarte();
    return;
  }
  el.carte.hidden = false;
  el.carteBascule.setAttribute('aria-expanded', 'true');
  el.carteBascule.textContent = T.app.fermerCarte;

  // Chargé à la demande : tant que personne n'ouvre la carte, pas un octet du
  // code qui sait parler aux tuiles n'est demandé — et donc aucune tuile.
  const { creerCarte } = await import('./carte.ts');
  carte = creerCarte(el.carteVue, {
    textes: { origine: T.app.repereOrigine },
    onChoix: (p, m) => {
      cible = p;
      precision = m;
      el.coords.value = formatDecimal(p);
      majEtatCoords(false);
      majResultat();
      annoncer(T.app.positionChoisie(formatDecimal(p)));
    },
  });

  const origine = principal?.read?.position ?? null;
  const depart = cible ?? origine;
  // On n'ouvre pas au zoom maximal sur la position de la photo : la première
  // requête dirait alors le pas de porte. Le quartier suffit à se repérer, et
  // l'utilisateur zoome lui-même s'il le veut.
  carte.centrer(depart ?? { lat: 46.6, lon: 2.4 }, depart ? 13 : 4);
  carte.marquerOrigine(origine);
}

function majResultat(): void {
  if (!cible) {
    el.resultat.hidden = true;
    el.telecharger.disabled = true;
    el.telecharger.textContent = T.app.telechargerPhotos(items.length);
    return;
  }
  el.resultat.hidden = false;
  el.resultatCoords.textContent = formatDecimal(cible);
  const origine = principal?.read?.position;
  el.resultatDetail.textContent = origine
    ? T.app.depuisOrigine(formatDistance(distanceMetres(origine, cible), T.app.virgule))
    : T.app.nouvellePosition;
  const modifiables = items.filter((i) => i.read?.can.write).length;
  el.telecharger.disabled = modifiables === 0;
  el.telecharger.textContent = T.app.telechargerPhotos(modifiables);
  marquerEtape(3);
}

/* --- chargement --------------------------------------------------- */

async function charger(fichiers: File[]): Promise<void> {
  const utiles = fichiers.filter((f) => f.size > 0).slice(0, 300);
  if (!utiles.length) return;

  items.length = 0;
  principal = null;
  cible = null;
  precision = null;
  el.coords.value = '';

  for (const file of utiles) {
    items.push({ id: `f${++compteur}`, file });
  }

  el.vide.hidden = true;
  el.actif.hidden = false;
  el.nom.textContent = utiles[0].name;
  // Le focus était sur le sélecteur de fichier, à l'intérieur de l'état qu'on
  // vient de cacher : sans cette ligne il retombe sur `body`, et la tabulation
  // repart du haut du document au milieu du geste.
  el.titreActif.focus();
  annoncer(T.app.lecturePlurielle(utiles.length));

  for (const it of items) {
    const buffer = await it.file.arrayBuffer();
    const rep = await demander(
      { type: 'read', id: it.id, name: it.file.name, buffer },
      [buffer],
    );
    if (rep.type === 'read:ok') it.read = rep.payload;
    else if (rep.type === 'read:fail') it.erreur = messageErreur(rep.code, rep.message);
    if (!principal && it.read) {
      principal = it;
      afficherPrincipal();
    }
  }
  if (!principal) {
    principal = items[0];
    el.alerteFormat.hidden = false;
    el.alerteFormat.classList.remove('attention');
    el.alerteFormat.classList.add('grave');
    el.alerteFormat.textContent = items[0].erreur ?? T.app.illisibleAlerte;
    annoncer(T.app.illisibleAlerte);
    return;
  }
  afficherPrincipal();
}

/* --- application et téléchargement -------------------------------- */

function nomSortie(nom: string, prefixe: string): string {
  const point = nom.lastIndexOf('.');
  return point > 0 ? `${nom.slice(0, point)}${prefixe}${nom.slice(point)}` : `${nom}${prefixe}`;
}

async function appliquer(
  operation: Extract<ToWorker, { type: 'apply' }>['operation'],
  prefixe: string,
): Promise<void> {
  // Filtrer sur l'opération RÉELLEMENT demandée, et non sur l'écriture.
  // Auparavant tout passait par `can.write` : sur une photo dont on sait
  // retirer le lieu mais pas en ajouter un, le bouton « Effacer » était actif
  // et ne faisait rien du tout. Un bouton qui n'agit pas est pire qu'un bouton
  // grisé — il laisse croire que le fichier a été traité.
  const permise = (r: PhotoRead): boolean =>
    operation.kind === 'erase' ? r.can.erase
      : operation.kind === 'eraseAll' ? r.can.eraseAll
      : r.can.write;
  const concernes = items.filter((i) => i.read && permise(i.read));
  if (!concernes.length) return;

  el.telecharger.disabled = true;
  el.effacer.disabled = true;
  el.effacerTout.disabled = true;

  const statuts = new Map<string, string>();
  const produits: Array<{ name: string; input: Uint8Array }> = [];
  let echecs = 0;

  /*
   * La région d'annonce est « polie » : elle met en file. Annoncer chaque
   * fichier d'un lot de trois cents, c'est trois cents phrases à écouter avant
   * d'entendre le résultat. On jalonne : le premier, le dernier, et dix points
   * entre les deux.
   */
  const pas = Math.max(1, Math.ceil(concernes.length / 10));
  for (const [i, it] of concernes.entries()) {
    if (i === 0 || i === concernes.length - 1 || (i + 1) % pas === 0) {
      annoncer(T.app.traitement(i + 1, concernes.length));
    }
    if (concernes.length > 1) majListeLot(statuts);
    const buffer = await it.file.arrayBuffer();
    const rep = await demander(
      { type: 'apply', id: it.id, name: it.file.name, buffer, operation },
      [buffer],
    );
    if (rep.type !== 'apply:done') continue;
    const res: WriteResult = rep.payload;
    if (res.ok) {
      statuts.set(it.id, `✓ ${res.route === 'P1' ? T.app.sansRienDeplacer : T.app.ecrit}`);
      produits.push({ name: nomSortie(it.file.name, prefixe), input: res.bytes });
    } else {
      echecs++;
      statuts.set(it.id, messageErreur(res.code, res.message).slice(0, 40));
    }
  }

  if (concernes.length > 1) majListeLot(statuts);
  el.effacer.disabled = false;
  el.effacerTout.disabled = false;
  el.telecharger.disabled = false;

  if (!produits.length) {
    el.alerteFormat.hidden = false;
    el.alerteFormat.classList.remove('attention');
    el.alerteFormat.classList.add('grave');
    el.alerteFormat.textContent = T.app.aucunProduit;
    annoncer(T.app.aucunProduitAnnonce);
    return;
  }

  if (produits.length === 1) {
    telechargerBlob(new Blob([produits[0].input as BlobPart]), produits[0].name);
  } else {
    const zip = await downloadZip(produits).blob();
    telechargerBlob(zip, T.app.zip);
  }

  marquerEtape(3);
  annoncer(
    echecs === 0
      ? T.app.pretsVerifies(produits.length)
      : T.app.pretsAvecEchecs(produits.length, echecs),
  );
}

function telechargerBlob(blob: Blob, nom: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/* --- événements --------------------------------------------------- */

el.picker.addEventListener('change', () => {
  if (el.picker.files?.length) void charger(Array.from(el.picker.files));
});

el.changer.addEventListener('click', () => versEtatVide(true));

el.coords.addEventListener('input', () => {
  cible = parseCoordinates(el.coords.value);
  // On efface pendant la frappe, on n'accuse jamais : le reproche est le fait
  // de la perte de focus, ci-dessous.
  if (cible || !el.coords.value.trim()) majEtatCoords(false);
  // Des coordonnées tapées n'ont pas de zoom, donc pas de précision à
  // déclarer. Hériter de celle d'un clic précédent inscrirait dans le fichier
  // de quelqu'un un chiffre que personne n'a mesuré.
  precision = null;
  if (cible) carte?.centrer(cible);
  majResultat();
});

el.coords.addEventListener('blur', () => {
  const saisi = el.coords.value.trim();
  majEtatCoords(saisi !== '' && parseCoordinates(saisi) === null);
});

el.carteBascule.addEventListener('click', () => void ouvrirCarte());
el.cartePlus.addEventListener('click', () => carte?.zoomer(1));
el.carteMoins.addEventListener('click', () => carte?.zoomer(-1));

el.telecharger.addEventListener('click', () => {
  if (!cible) return;
  // `Operation` porte `accuracyMetres` depuis l'origine et le moteur l'inscrit
  // dans le fichier ; il n'avait jusqu'ici aucune source honnête à quoi le
  // relier. Le zoom de la carte en est une. Rien n'est annoncé à l'écran :
  // sur la voie « sans rien déplacer », le moteur ne peut pas ajouter le
  // champ et ne le prétend pas (voir `conteneurs.ts`).
  void appliquer(
    precision === null
      ? { kind: 'set', position: cible }
      : { kind: 'set', position: cible, accuracyMetres: precision },
    T.app.suffixeLieu,
  );
});

el.effacer.addEventListener('click', () => {
  void appliquer({ kind: 'erase' }, T.app.suffixeSansLieu);
});

el.effacerTout.addEventListener('click', () => {
  void appliquer({ kind: 'eraseAll' }, T.app.suffixeSansInfos);
});

// Glisser-déposer sur toute la page.
let profondeur = 0;
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  profondeur++;
  document.body.classList.add('glisse');
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('dragleave', () => {
  profondeur = Math.max(0, profondeur - 1);
  if (profondeur === 0) document.body.classList.remove('glisse');
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  profondeur = 0;
  document.body.classList.remove('glisse');
  const files = Array.from(e.dataTransfer?.files ?? []);
  if (files.length) void charger(files);
});

// Collage.
document.addEventListener('paste', (e) => {
  const cibleSaisie = e.target as HTMLElement | null;
  if (cibleSaisie?.tagName === 'INPUT' || cibleSaisie?.tagName === 'TEXTAREA') return;
  const files = Array.from(e.clipboardData?.files ?? []);
  if (files.length) {
    e.preventDefault();
    void charger(files);
  }
});

versEtatVide();
