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
  carteErreur: $('carte-erreur'),
  cartePlus: $<HTMLButtonElement>('carte-plus'),
  carteMoins: $<HTMLButtonElement>('carte-moins'),
  resultat: $('resultat'),
  resultatCoords: $('resultat-coords'),
  resultatDetail: $('resultat-detail'),
  telecharger: $<HTMLButtonElement>('telecharger'),
  partagerSortie: $<HTMLButtonElement>('partager-sortie'),
  effacer: $<HTMLButtonElement>('effacer'),
  effacerTout: $<HTMLButtonElement>('effacer-tout'),
  autres: $<HTMLDetailsElement>('autres'),
  autresListe: $('autres-liste'),
  alerteFormat: $('alerte-format'),
  avisVide: $('avis-vide'),
  lot: $('lot'),
  lotResume: $('lot-resume'),
  lotListe: $('lot-liste'),
  coordsErreur: $('coords-erreur'),
  maj: $('maj'),
  majTexte: $('maj-texte'),
  majRecharger: $<HTMLButtonElement>('maj-recharger'),
  majPlusTard: $<HTMLButtonElement>('maj-plus-tard'),
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

/**
 * Un contrôle inactif, mais ATTEIGNABLE.
 *
 * `disabled` retire l'élément de l'ordre de tabulation et n'annonce rien : qui
 * navigue au clavier passe devant un bouton grisé sans jamais pouvoir s'y poser
 * pour apprendre POURQUOI il l'est. `aria-disabled` le laisse focalisable et
 * annoncé, ce qui est le contraire d'un détail sur « Tout effacer ».
 *
 * En échange, le bouton reste CLIQUABLE : la garde revient au gestionnaire, et
 * elle doit y être la première ligne. Sans elle, un bouton d'apparence grisée
 * agit quand même — et ici l'un d'eux efface tout.
 */
function inactiver(bouton: HTMLButtonElement, inactif: boolean): void {
  bouton.setAttribute('aria-disabled', String(inactif));
}

/** La garde, à placer en tête de chaque gestionnaire. */
const estInactif = (bouton: HTMLButtonElement): boolean =>
  bouton.getAttribute('aria-disabled') === 'true';

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
  inactiver(el.telecharger, true);
  el.picker.value = '';
  el.avisVide.hidden = true;
  proposerPartage([]);
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
  // Un champ texte n'est pas un bouton : `aria-disabled` ne l'empêcherait pas
  // d'être rempli. `readonly` est l'équivalent honnête — focalisable, annoncé
  // en lecture seule, toujours sélectionnable et copiable, mais pas modifiable.
  el.coords.readOnly = !modifiable;
  // Une carte qu'on peut promener mais dont le résultat ne sera jamais inscrit
  // est un piège : on la referme plutôt que de la laisser répondre à vide.
  inactiver(el.carteBascule, !modifiable);
  if (!modifiable) fermerCarte();
  else carte?.marquerOrigine(r.position ?? null);
  inactiver(el.effacer, !r.can.erase);
  inactiver(el.effacerTout, !r.can.eraseAll);

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
  el.carte.classList.remove('sans-carte');
  el.carteErreur.hidden = true;
  el.carteBascule.setAttribute('aria-expanded', 'false');
  el.carteBascule.textContent = T.app.ouvrirCarte;
}

async function ouvrirCarte(): Promise<void> {
  if (carte) {
    fermerCarte();
    return;
  }
  el.carte.hidden = false;
  el.carte.classList.remove('sans-carte');
  el.carteErreur.hidden = true;
  el.carteBascule.setAttribute('aria-expanded', 'true');
  el.carteBascule.textContent = T.app.fermerCarte;

  /*
   * Chargé à la demande : tant que personne n'ouvre la carte, pas un octet du
   * code qui sait parler aux tuiles n'est demandé — et donc aucune tuile.
   *
   * Ce chargement PEUT échouer, et il échoue pour une raison parfaitement
   * ordinaire : le service worker ne précharge délibérément pas ce morceau, si
   * bien qu'il n'est pas là hors ligne. Sans cette prise, le rejet ne va nulle
   * part — on restait avec un panneau ouvert, un bouton qui annonce « Fermer la
   * carte », un cadre vide, et une erreur dans la console que personne ne lit.
   */
  let creerCarte;
  try {
    ({ creerCarte } = await import('./carte.ts'));
  } catch {
    el.carte.classList.add('sans-carte');
    el.carteErreur.hidden = false;
    el.carteErreur.textContent = T.app.carteIndisponible;
    annoncer(T.app.carteIndisponible);
    return;
  }

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
    inactiver(el.telecharger, true);
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
  inactiver(el.telecharger, modifiables === 0);
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

  inactiver(el.telecharger, true);
  inactiver(el.effacer, true);
  inactiver(el.effacerTout, true);

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
  inactiver(el.effacer, false);
  inactiver(el.effacerTout, false);
  inactiver(el.telecharger, false);

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

  /*
   * Le téléchargement reste ce qu'il était : le partage s'ajoute, il ne
   * remplace rien. Ce sont les fichiers PRODUITS qu'on retient — jamais les
   * originaux. Toute la valeur de l'outil tient à cette distinction, et c'est
   * l'endroit du code où la confondre coûterait le plus cher.
   */
  proposerPartage(
    produits.map(
      (p) => new File([p.input as BlobPart], p.name, { type: 'application/octet-stream' }),
    ),
  );

  marquerEtape(3);
  annoncer(
    echecs === 0
      ? T.app.pretsVerifies(produits.length)
      : T.app.pretsAvecEchecs(produits.length, echecs),
  );
}

/* --- partage sortant ------------------------------------------------ */

/** Les fichiers produits par la dernière opération. Jamais les originaux. */
let sorties: File[] = [];

/*
 * `canShare({ files })` et non `'share' in navigator` : le partage de FICHIERS
 * est plus étroit que celui d'un lien, et un navigateur peut très bien avoir le
 * second sans le premier. On interroge donc l'API sur les fichiers réels — leur
 * nombre et leur type comptent — plutôt que sur son existence.
 */
function proposerPartage(fichiers: File[]): void {
  sorties = fichiers;
  const possible =
    fichiers.length > 0 &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: fichiers });
  el.partagerSortie.hidden = !possible;
}

el.partagerSortie.addEventListener('click', () => {
  if (!sorties.length) return;
  /*
   * Appelé DIRECTEMENT dans le gestionnaire, sans `await` avant : le partage
   * exige une activation utilisateur transitoire, et le moindre aller-retour
   * asynchrone la consomme — la feuille de partage ne s'ouvrirait plus.
   *
   * Le refus est la normale, pas une panne : fermer la feuille sans rien
   * choisir rejette la promesse. On l'avale, sinon le contrôle « aucune erreur
   * de console » du test de bout en bout virerait au rouge à chaque hésitation.
   */
  void navigator.share({ files: sorties, title: T.meta.titre }).catch(() => {});
});

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

el.carteBascule.addEventListener('click', () => {
  if (estInactif(el.carteBascule)) return;
  void ouvrirCarte();
});
el.cartePlus.addEventListener('click', () => carte?.zoomer(1));
el.carteMoins.addEventListener('click', () => carte?.zoomer(-1));

el.telecharger.addEventListener('click', () => {
  if (estInactif(el.telecharger) || !cible) return;
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
  if (estInactif(el.effacer)) return;
  void appliquer({ kind: 'erase' }, T.app.suffixeSansLieu);
});

el.effacerTout.addEventListener('click', () => {
  if (estInactif(el.effacerTout)) return;
  void appliquer({ kind: 'eraseAll' }, T.app.suffixeSansInfos);
});

/* --- arrivées depuis le système ------------------------------------ */

/*
 * Deux portes, en plus du sélecteur et du glisser-déposer.
 *
 * « Ouvrir avec » remet directement des poignées de fichier : rien à
 * transporter, rien à garder. Le partage, lui, passe par un `POST` que le
 * service worker intercepte et dont il garde les octets EN MÉMOIRE — voir
 * `scripts/sw-modele.js`. On vient les réclamer ici, par un canal de message
 * dédié pour que la réponse ne puisse pas se confondre avec autre chose.
 */
function reclamerPartage(): void {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) {
    // Le worker a été arrêté entre le partage et l'ouverture : les octets sont
    // perdus. On le dit — l'original n'a pas bougé de la galerie, il suffit de
    // recommencer — plutôt que d'ouvrir une page vide sans explication.
    signalerPartagePerdu();
    return;
  }
  const canal = new MessageChannel();
  let repondu = false;
  canal.port1.onmessage = (e) => {
    repondu = true;
    const fichiers = (e.data as File[]) ?? [];
    if (fichiers.length) void charger(fichiers);
    else signalerPartagePerdu();
  };
  sw.postMessage({ type: 'RECLAMER_PARTAGE' }, [canal.port2]);
  // Un worker qui ne répond pas ne doit pas laisser la page attendre en vain.
  setTimeout(() => {
    if (!repondu) signalerPartagePerdu();
  }, 3_000);
}

function signalerPartagePerdu(): void {
  // Le message va dans l'état VIDE, qui est celui qu'on affiche. L'écrire dans
  // `#alerte-format` le déposerait à l'intérieur de l'état actif, qu'on masque
  // dans la même respiration : visible nulle part, et la page resterait muette.
  el.vide.hidden = false;
  el.actif.hidden = true;
  el.avisVide.hidden = false;
  el.avisVide.textContent = T.app.partagePerdu;
  annoncer(T.app.partagePerdu);
}

/*
 * `?partage=1` est posé par la redirection du service worker. On l'efface de la
 * barre d'adresse aussitôt : rechargée, cette adresse n'a plus rien à réclamer,
 * et laisser le paramètre ferait croire à un partage à chaque rechargement.
 */
if (new URLSearchParams(location.search).has('partage')) {
  history.replaceState(null, '', location.pathname);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reclamerPartage, { once: true });
  } else {
    reclamerPartage();
  }
}

interface FileHandleLike {
  getFile(): Promise<File>;
}
interface LaunchParams {
  files?: FileHandleLike[];
}

const filePeutEtreLancee = window as typeof window & {
  launchQueue?: { setConsumer(f: (p: LaunchParams) => void): void };
};
if (filePeutEtreLancee.launchQueue) {
  filePeutEtreLancee.launchQueue.setConsumer((params) => {
    void (async () => {
      const poignees = params.files ?? [];
      if (!poignees.length) return;
      const fichiers = await Promise.all(poignees.map((h) => h.getFile()));
      void charger(fichiers.filter((f) => f.size > 0));
    })();
  });
}

/* --- service worker ------------------------------------------------ */

/*
 * L'outil tourne entièrement sur la machine de l'utilisateur : la seule raison
 * pour laquelle il cessait de fonctionner sans réseau, c'est que personne ne le
 * gardait. Le service worker précharge la coquille, et la promesse « tout se
 * passe dans votre navigateur » devient vérifiable en coupant la connexion.
 *
 * La mise à jour n'est JAMAIS automatique. Rien n'est persisté ici : quelqu'un
 * peut avoir quarante photos ouvertes et rien d'exporté, et un rechargement
 * imposé détruirait tout. Le nouveau worker attend derrière ; c'est le clic qui
 * le fait passer devant.
 */
function proposerMaj(reg: ServiceWorkerRegistration): void {
  const enTravaux = items.length > 0;
  el.majTexte.textContent = enTravaux ? T.app.majTravaux : T.app.majDispo;
  el.maj.hidden = false;
  el.majRecharger.onclick = () => {
    el.maj.hidden = true;
    // Le worker en attente ne prend la main que sur ce message : voir
    // `scripts/sw-modele.js`, règle 2.
    reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
  };
  el.majPlusTard.onclick = () => {
    el.maj.hidden = true;
  };
}

if ('serviceWorker' in navigator) {
  /*
   * Après le chargement : l'enregistrement met le réseau en concurrence avec ce
   * dont la page a besoin pour s'afficher, et l'outil passe avant son cache.
   *
   * Tout est enveloppé. Une décoration ne doit pas pouvoir emporter l'outil —
   * c'est déjà la règle de `blob.ts` — et un cache encore moins : le test de
   * bout en bout refuse la moindre erreur de console, et un contexte non
   * sécurisé ou un stockage refusé fait lever `register`.
   */
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        if (reg.waiting) proposerMaj(reg);
        reg.addEventListener('updatefound', () => {
          const arrivant = reg.installing;
          if (!arrivant) return;
          arrivant.addEventListener('statechange', () => {
            // `controller` non nul : il y avait déjà un worker, donc c'est bien
            // une mise à jour et non la première installation — pour laquelle
            // il n'y a rien à proposer.
            if (arrivant.state === 'installed' && navigator.serviceWorker.controller) {
              proposerMaj(reg);
            }
          });
        });
      })
      .catch(() => {
        /* Pas de cache, et c'est tout : l'application marche sans. */
      });

    // Un seul rechargement. Sans ce drapeau, deux onglets qui se réclament le
    // contrôle l'un à l'autre bouclent indéfiniment.
    let recharge = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (recharge) return;
      recharge = true;
      location.reload();
    });
  });
}

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
