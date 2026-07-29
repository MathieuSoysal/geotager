/**
 * Interface island.
 *
 * The main thread parses nothing and writes nothing: it passes bytes to the
 * worker and displays what comes back. Everything expensive is on the other
 * side.
 */
import { downloadZip } from 'client-zip';
import { parseCoordinates, formatDecimal, formatDms, distanceMetres, formatDistance } from '../exif/coords.ts';
import type { Carte } from './carte.ts';
import type { FromWorker, LatLon, PhotoRead, ToWorker, WriteResult } from '../exif/types.ts';
import { dicoDuDocument, type CodeErreur } from '../i18n/index.ts';

// The words for this page. The document's `lang` attribute was written at
// build time: we do not guess the language, we read it.
const T = dicoDuDocument();

/** The sentence for an error, in the page's language. */
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
/** The map exists only once asked for: before that, nothing has been loaded. */
let carte: Carte | null = null;
/** Precision of the gesture that named `cible`, in metres. Null if typed. */
let precision: number | null = null;
/** Stops the field -> map -> field round trip biting its own tail. */
let enSync = false;

// Worker

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

// Announcements

function annoncer(texte: string): void {
  el.annonce.textContent = texte;
}

/**
 * The "input refused" state of the coordinate field.
 *
 * Checked on blur rather than on keystroke: "43." is invalid at the third key,
 * and validating on every character would shout the error while the right
 * answer is being typed. One entry point, called by everything that writes into
 * the field, the map included, so the attribute and the text cannot diverge.
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

// State

function marquerEtape(n: 1 | 2 | 3): void {
  for (const li of Array.from(el.etapes.children) as HTMLElement[]) {
    const e = Number(li.dataset.etape);
    li.classList.toggle('done', e < n);
    li.classList.toggle('on', e === n);
    // The current step rested on nothing but a colour and a weight.
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
 * `deplacerFocus`: on module load this function only sets the initial state, and
 * moving the focus would steal the caret from somebody who asked for nothing.
 * Only the "Change photo" button asks for it, since it is what just made the
 * focused element disappear.
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
  el.avisVide.hidden = true;
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

  // The sentence is always displayed: the interface announces the route before
  // the action, including when everything is possible. It is only alarming when
  // an operation genuinely is unavailable.
  const modifiable = r.can.write;
  const phrase = T.motifs[r.motif];
  el.alerteFormat.hidden = !phrase;
  el.alerteFormat.textContent = phrase;
  el.alerteFormat.classList.toggle('grave', !r.can.read);
  el.alerteFormat.classList.toggle('attention', r.can.read && !(modifiable && r.can.erase));
  el.coords.disabled = !modifiable;
  // A map you can pan but whose result will never be written is a trap: it is
  // closed rather than left answering into the void.
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
   * The capability sentence is announced, not merely displayed. It is the most
   * important text in the tool ("we cannot work on videos yet", "we can read
   * this location but not change it yet") and it only went to the screen. A
   * screen reader given a video heard "Photo read. No location recorded in this
   * file", which is wrong in spirit if not in letter, while the real reason
   * stayed silent right beside it.
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
        // We can remove the location from this file without being able to give
        // it one. Filing it under "read-only" would suggest a refusal.
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

// Map

/*
 * Two rules are enough to prevent the field -> map -> field loop, and neither is
 * a flag anyone can forget to set:
 *
 * 1. Writing `el.coords.value` from script does not emit an `input` event. The
 *    map -> field direction is therefore one-way by specification.
 * 2. `carte.centrer()` never calls `onChoix` back. The field -> map direction is
 *    one-way by contract.
 *
 * If anyone ever adds a `dispatchEvent(new Event('input'))` or a `change`
 * listener, both guarantees fall at once.
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
   * Loaded on demand: while nobody opens the map, not a byte of the code that
   * talks to tiles is requested, and so no tile is either.
   *
   * This load can fail, and it fails for a perfectly ordinary reason: the
   * service worker deliberately does not precache this chunk, so it is not
   * there offline. Without this catch the rejection went nowhere, leaving an
   * open panel, a button saying "Close the map", an empty frame, and a console
   * error nobody reads.
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
  // We do not open at maximum zoom on the photo's position: the first request
  // would then name the doorstep. The neighbourhood is enough to get oriented,
  // and the user zooms in themselves if they want to.
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

// Loading

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
  // The focus was on the file picker, inside the state we have just hidden:
  // without this line it falls back to `body`, and tabbing restarts from the
  // top of the document mid-gesture.
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

// Applying and downloading

function nomSortie(nom: string, prefixe: string): string {
  const point = nom.lastIndexOf('.');
  return point > 0 ? `${nom.slice(0, point)}${prefixe}${nom.slice(point)}` : `${nom}${prefixe}`;
}

async function appliquer(
  operation: Extract<ToWorker, { type: 'apply' }>['operation'],
  prefixe: string,
): Promise<void> {
  // Filter on the operation actually requested, not on writing. Everything used
  // to go through `can.write`: on a photo whose location we can remove but not
  // add, the "Erase" button was active and did nothing at all. A button that
  // does not act is worse than a greyed one, since it suggests the file was
  // processed.
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
   * The announcement region is polite: it queues. Announcing every file of a
   * batch of three hundred means three hundred sentences to listen through
   * before hearing the result. We post milestones: the first, the last, and ten
   * points in between.
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

// Events

el.picker.addEventListener('change', () => {
  if (el.picker.files?.length) void charger(Array.from(el.picker.files));
});

el.changer.addEventListener('click', () => versEtatVide(true));

el.coords.addEventListener('input', () => {
  cible = parseCoordinates(el.coords.value);
  // We clear while typing and never accuse: the reproach belongs to blur,
  // below.
  if (cible || !el.coords.value.trim()) majEtatCoords(false);
  // Typed coordinates have no zoom, and so no precision to declare. Inheriting
  // one from an earlier click would write a number nobody measured into
  // somebody's file.
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
  // `Operation` has carried `accuracyMetres` from the start and the engine
  // writes it into the file; until now it had no honest source to connect it
  // to. The map's zoom is one. Nothing is announced on screen: on the route
  // that moves nothing, the engine cannot add the field and does not pretend to
  // (see `conteneurs.ts`).
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

// Arrivals from the system

/*
 * Two doors, besides the picker and drag and drop.
 *
 * "Open with" hands over file handles directly: nothing to carry, nothing to
 * keep. Sharing goes through a `POST` the service worker intercepts and whose
 * bytes it keeps in memory; see `scripts/sw-modele.js`. We come and claim them
 * here, over a dedicated message channel so the reply cannot be confused with
 * anything else.
 */
function reclamerPartage(): void {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) {
    // The worker was stopped between the share and the opening: the bytes are
    // lost. We say so, since the original has not moved from the gallery and it
    // is enough to start again, rather than open an empty page with no
    // explanation.
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
  // A worker that does not answer must not leave the page waiting for nothing.
  setTimeout(() => {
    if (!repondu) signalerPartagePerdu();
  }, 3_000);
}

function signalerPartagePerdu(): void {
  // The message goes into the empty state, which is the one being shown.
  // Writing it into `#alerte-format` would drop it inside the active state,
  // which we hide in the same breath: visible nowhere, and the page would stay
  // silent.
  el.vide.hidden = false;
  el.actif.hidden = true;
  el.avisVide.hidden = false;
  el.avisVide.textContent = T.app.partagePerdu;
  annoncer(T.app.partagePerdu);
}

/*
 * `?partage=1` is set by the service worker's redirect. It is cleared from the
 * address bar immediately: reloaded, that address has nothing left to claim,
 * and leaving the parameter would suggest a share on every reload.
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

// Service worker

/*
 * The tool runs entirely on the user's machine: the only reason it stopped
 * working offline was that nothing kept it. The service worker precaches the
 * shell, and the promise that everything happens in your browser becomes
 * checkable by cutting the connection.
 *
 * The update is never automatic. Nothing is persisted here: somebody may have
 * forty photos open and nothing exported, and a forced reload would destroy all
 * of it. The new worker waits behind; the click is what brings it forward.
 */
function proposerMaj(reg: ServiceWorkerRegistration): void {
  const enTravaux = items.length > 0;
  el.majTexte.textContent = enTravaux ? T.app.majTravaux : T.app.majDispo;
  el.maj.hidden = false;
  el.majRecharger.onclick = () => {
    el.maj.hidden = true;
    // The waiting worker only takes over on this message: see
    // `scripts/sw-modele.js`, rule 2.
    reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
  };
  el.majPlusTard.onclick = () => {
    el.maj.hidden = true;
  };
}

if ('serviceWorker' in navigator) {
  /*
   * After load: registering puts the network in competition with what the page
   * needs in order to display, and the tool comes before its cache.
   *
   * Everything is wrapped. A decoration must not be able to take the tool down,
   * which is already `blob.ts`'s rule, and a cache even less so: the end-to-end
   * test refuses any console error, and an insecure context or refused storage
   * makes `register` throw.
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
            // Non-null `controller`: there was already a worker, so this is an
            // update and not the first installation, for which there is nothing
            // to offer.
            if (arrivant.state === 'installed' && navigator.serviceWorker.controller) {
              proposerMaj(reg);
            }
          });
        });
      })
      .catch(() => {
        /* No cache, and that is all: the application works without one. */
      });

    // One reload. Without this flag, two tabs claiming control from each other
    // loop forever.
    let recharge = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (recharge) return;
      recharge = true;
      location.reload();
    });
  });
}

// Drag and drop over the whole page.
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
