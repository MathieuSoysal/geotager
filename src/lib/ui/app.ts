/**
 * Interface island.
 *
 * The main thread parses nothing and writes nothing: it passes bytes to the
 * worker and displays what comes back. Everything expensive is on the other
 * side.
 */
import { downloadZip } from 'client-zip';
import {
  parseCoordinates, formatDecimal, formatDms, distanceMetres, formatDistance,
  validerPosition, ZOOM_MIN, ZOOM_MAX,
} from '@geotager/core/coords';
import type { Carte } from './carte.ts';
import type { FromWorker, LatLon, PhotoRead, ToWorker, WriteResult } from '@geotager/core/types';
import { dicoDuDocument, type CodeErreur } from '../i18n/index.ts';
import { typeDeclare } from '@geotager/core/capabilities';

// The words for this page. The document's `lang` attribute was written at
// build time: we do not guess the language, we read it.
const T = dicoDuDocument();

/**
 * The name of the kind of file loaded: "photo", "video", or neither.
 *
 * The tool said "photo" everywhere, including under a badge announcing "Video".
 * The sentences take this name, and choose it here:
 *
 *   - one kind in the batch, its own name;
 *   - two kinds mixed, neither is true, so the neutral name;
 *   - nothing loaded, keep "photo", which is what the served HTML already
 *     carries and what most people come to drop.
 */
function motDuGenre(pluriel = false): string {
  const N = T.app.noms;
  const lus = items.map((i) => i.read?.format).filter(Boolean);
  const videos = lus.filter((f) => f === 'video').length;
  if (lus.length === 0) return pluriel ? N.photos : N.photo;
  if (videos === lus.length) return pluriel ? N.videos : N.video;
  if (videos === 0) return pluriel ? N.photos : N.photo;
  return pluriel ? N.neutres : N.neutre;
}

/**
 * Rewrites the sentences the served HTML already carries.
 *
 * They are rendered at build time with the default word: without JavaScript the
 * page stays correct, and with it, it follows the file actually loaded.
 */
function majMotsDuGenre(): void {
  const nom = motDuGenre();
  el.titreActif.textContent = T.app.titreActif(nom);
  el.changer.textContent = T.app.changer(nom);
  el.coordsLabel.textContent = T.app.ouPrise(nom);
  el.coordsAideFort.textContent = T.app.aideCoordsFort(nom);
  el.carteAvis.textContent = T.app.avisCarte(nom);
  el.partagerSortie.textContent = T.app.partagerSortie(nom);
}

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
  installer: $<HTMLButtonElement>('installer'),
  titreActif: $('titre-actif'),
  coordsLabel: $('coords-label'),
  coordsAideFort: $('coords-aide-fort'),
  carteAvis: $('carte-avis'),
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
/**
 * Zoom requested by `?zoom=` in the address, or null.
 *
 * Consumed the first time the map opens, then reset to null: see `ouvrirCarte`,
 * which explains why it must not survive a close.
 */
let zoomDeLAdresse: number | null = null;
/** This window clicked "Reload" on the update banner. */
let demandeMaj = false;
/**
 * A write is in progress.
 *
 * Now that a batch can grow while writing, since a photo opened from the system
 * joins those already there, the batch rendering goes through `majResultat`,
 * which re-enables "Download". It would re-enable it mid-write, and a second
 * click would start everything again over the first.
 */
let enApplication = false;

/** The batch does not exceed three hundred photos, and the excess is announced. */
const PLAFOND_LOT = 300;

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

/**
 * A control that is inactive but reachable.
 *
 * `disabled` removes the element from the tab order and announces nothing: a
 * keyboard user passes a greyed-out button without ever being able to land on
 * it to learn why. `aria-disabled` leaves it focusable and announced, which is
 * the opposite of a detail on "Erase everything".
 *
 * In exchange the button stays clickable: the guard moves to the handler, and
 * it must be the first line there. Without it a greyed-looking button still
 * acts, and one of them erases everything.
 */
function inactiver(bouton: HTMLButtonElement, inactif: boolean): void {
  bouton.setAttribute('aria-disabled', String(inactif));
}

/** The guard, to be placed at the head of every handler. */
const estInactif = (bouton: HTMLButtonElement): boolean =>
  bouton.getAttribute('aria-disabled') === 'true';

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
  // Before emptying: `motDuGenre` reads `items`, and returns "photo" once empty.
  queueMicrotask(majMotsDuGenre);
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
  // Words first: the title announced below borrows them.
  majMotsDuGenre();
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
  // A text field is not a button: `aria-disabled` would not stop it being
  // filled in. `readonly` is the honest equivalent: focusable, announced as
  // read-only, still selectable and copyable, but not editable.
  el.coords.readOnly = !modifiable;
  // A map you can pan but whose result will never be written is a trap: it is
  // closed rather than left answering into the void.
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
   * The capability sentence is announced, not merely displayed. It is the most
   * important text in the tool ("we cannot work on videos yet", "we can read
   * this location but not change it yet") and it only went to the screen. A
   * screen reader given a video heard "Photo read. No location recorded in this
   * file", which is wrong in spirit if not in letter, while the real reason
   * stayed silent right beside it.
   */
  const etat = r.position
    ? T.app.photoLue(formatDecimal(r.position), motDuGenre())
    : T.app.photoLueSansPosition(motDuGenre());
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
    textes: { origine: T.app.repereOrigine(motDuGenre()) },
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
  //
  // A `?zoom=` received in the address takes precedence over that choice, and
  // only on the first opening, since it is consumed here. Without that, closing
  // and reopening the map would return the user to the link's zoom, undoing
  // what they had just set by hand.
  const zoomVoulu = zoomDeLAdresse ?? (depart ? 13 : 4);
  zoomDeLAdresse = null;
  carte.centrer(depart ?? { lat: 46.6, lon: 2.4 }, zoomVoulu);
  carte.marquerOrigine(origine);
}

function majResultat(): void {
  if (!cible || enApplication) {
    el.resultat.hidden = !cible;
    inactiver(el.telecharger, true);
    el.telecharger.textContent = T.app.telechargerPhotos(items.length, motDuGenre(), motDuGenre(true));
    return;
  }
  el.resultat.hidden = false;
  el.resultatCoords.textContent = formatDecimal(cible);
  const origine = principal?.read?.position;
  el.resultatDetail.textContent = origine
    ? T.app.depuisOrigine(formatDistance(distanceMetres(origine, cible), T.app.virgule))
    : T.app.nouvellePosition(motDuGenre());
  const modifiables = items.filter((i) => i.read?.can.write).length;
  inactiver(el.telecharger, modifiables === 0);
  el.telecharger.textContent = T.app.telechargerPhotos(modifiables, motDuGenre(), motDuGenre(true));
  marquerEtape(3);
}

// Loading

/**
 * What an arrival does with what was already loaded.
 *
 * `remplacer` for gestures made in the page (picker, drag and drop, paste):
 * files have just been named there, and replacing is what you expect.
 * `ajouter` for what arrives from the system, where nobody asked the page for
 * anything: erasing a batch of forty unexported photos because a forty-first is
 * opened would be the loss the update banner already refuses to cause.
 */
type ModeArrivee = 'remplacer' | 'ajouter';

/*
 * Arrivals are serialised, and that is not a comfort measure. Two `charger`
 * calls in flight walked the same `items` array while one emptied it under the
 * other: files skipped, and two reads of the same identifier where the first
 * overwrites the resolver in `enAttente`, so a promise that never settles and
 * an interface frozen on a file name.
 */
let lecture: Promise<void> = Promise.resolve();

function charger(fichiers: File[], mode: ModeArrivee = 'remplacer'): Promise<void> {
  /*
   * The chain must never be left rejected, and the recovery is here rather than
   * at the call sites for that reason. Reading a file's bytes can throw, since a
   * file can be removed from under us mid-read, which is no longer hypothetical
   * now the system hands them to us, and a chain left rejected would never hand
   * control back to any later arrival: the picker, drag and drop and paste
   * would all stop responding, permanently, and without a word.
   */
  lecture = lecture
    .then(() => chargerMaintenant(fichiers, mode))
    .catch(() => signalerArriveeVide(T.app.ouverturePerdue));
  return lecture;
}

async function chargerMaintenant(fichiers: File[], mode: ModeArrivee): Promise<void> {
  const utiles = fichiers.filter((f) => f.size > 0);
  if (!utiles.length) return;

  if (mode === 'remplacer') {
    items.length = 0;
    principal = null;
    cible = null;
    precision = null;
    el.coords.value = '';
  }

  /*
   * The cap no longer discards silently. It used to, and the announcement
   * reported the truncated count: it therefore claimed to have received less
   * than it was given, which is the quietest form of lying.
   */
  const place = Math.max(0, PLAFOND_LOT - items.length);
  const gardes = utiles.slice(0, place);
  const refuses = utiles.length - gardes.length;

  // The read loop works on this arrival, never on the live array: that is what
  // makes adding safe, and what makes serialisation sufficient.
  const arrivants: Item[] = gardes.map((file) => ({ id: `f${++compteur}`, file }));
  items.push(...arrivants);

  const premier = mode === 'remplacer' || !principal;
  if (premier) {
    el.vide.hidden = true;
    el.actif.hidden = false;
    if (gardes.length) el.nom.textContent = gardes[0].name;
    // The focus was on the file picker, inside the state we have just hidden:
    // without this line it falls back to `body`, and tabbing restarts from the
    // top of the document mid-gesture. On an add, by contrast, the focus is
    // where the user put it, perhaps in the coordinate field they are filling
    // in. We leave it alone.
    el.titreActif.focus();
  }
  if (refuses > 0) annoncer(T.app.lotPlafonne(refuses));
  else if (gardes.length) {
    annoncer(premier ? T.app.lecturePlurielle(gardes.length) : T.app.ajoutees(gardes.length));
  }
  // The batch appears on arrival: the names are known, only the states remain
  // to be read. `afficherPrincipal` would re-announce the main photo, which has
  // not changed.
  if (!premier) majListeLot();
  el.lot.hidden = items.length <= 1;

  for (const it of arrivants) {
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
  /*
   * An add does not go back through `afficherPrincipal`: the main photo has not
   * changed, and doing so would re-announce its state ("photo read, 43.60,
   * 1.44") when what just happened is that others were added. Only the batch
   * list and the button label depend on the count.
   */
  if (premier) afficherPrincipal();
  else {
    majListeLot();
    majResultat();
  }
  el.lot.hidden = items.length <= 1;
}

// Applying and downloading

function nomSortie(nom: string, prefixe: string): string {
  const point = nom.lastIndexOf('.');
  return point > 0 ? `${nom.slice(0, point)}${prefixe}${nom.slice(point)}` : `${nom}${prefixe}`;
}

/**
 * The type to declare on the produced file.
 *
 * It came out with no type at all, and sharing announced it as an arbitrary
 * byte stream. This is not a finishing touch: a file placed in a phone's
 * downloads with no type is not indexed as a video. The gallery shows no entry
 * for it, and our own picker, restricted to images and videos, may stop
 * offering it. The file is perfect and the user sees nothing.
 *
 * The engine is asked first, since it recognised the format in the bytes. The
 * `type` the system attaches to the input file is only a fallback: it is
 * precisely the one that is empty or wrong in the cases that concern us, since
 * a file from a messaging folder often arrives without one.
 */
function typeDuProduit(it: Item, nom: string): string {
  return (it.read && typeDeclare(it.read.format, nom)) || it.file.type || '';
}

/** The three write controls, handed back to the user. */
function rendreLesBoutons(): void {
  enApplication = false;
  inactiver(el.effacer, false);
  inactiver(el.effacerTout, false);
  inactiver(el.telecharger, false);
}

/**
 * A write that throws does not leave the tool greyed out.
 *
 * Reading an original's bytes can fail, since a file can be removed from disk
 * while we write, which "Open with" makes possible because the system names
 * them. Without this recovery the loop broke on three inactive buttons and the
 * tool stayed frozen until a reload, besides letting a rejection escape that
 * the end-to-end test treats as fatal.
 */
async function appliquer(
  operation: Extract<ToWorker, { type: 'apply' }>['operation'],
  prefixe: string,
): Promise<void> {
  try {
    await appliquerMaintenant(operation, prefixe);
  } catch {
    rendreLesBoutons();
    el.alerteFormat.hidden = false;
    el.alerteFormat.classList.remove('attention');
    el.alerteFormat.classList.add('grave');
    el.alerteFormat.textContent = T.app.aucunProduit;
    annoncer(T.app.aucunProduitAnnonce);
  }
}

async function appliquerMaintenant(
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

  enApplication = true;
  inactiver(el.telecharger, true);
  inactiver(el.effacer, true);
  inactiver(el.effacerTout, true);

  const statuts = new Map<string, string>();
  let derniereRaison = '';
  const produits: Array<{ id: string; name: string; input: Uint8Array; type: string }> = [];
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
      const nom = nomSortie(it.file.name, prefixe);
      produits.push({ id: it.id, name: nom, input: res.bytes, type: typeDuProduit(it, nom) });
    } else {
      echecs++;
      statuts.set(it.id, messageErreur(res.code, res.message).slice(0, 40));
      // The whole sentence, for the single-file case: it exists, translated,
      // and it was computed and then thrown away. See below.
      derniereRaison = messageErreur(res.code, res.message);
    }
  }

  if (concernes.length > 1) majListeLot(statuts);
  /*
   * Restoring the buttons is unconditional, and that is new.
   *
   * Reading an original's bytes can throw, since a file can be removed from
   * disk while we write, which "Open with" makes possible because the system
   * names them. The loop above then broke on three greyed buttons, and the tool
   * stayed frozen until a reload.
   */
  rendreLesBoutons();

  if (!produits.length) {
    el.alerteFormat.hidden = false;
    el.alerteFormat.classList.remove('attention');
    el.alerteFormat.classList.add('grave');
    /*
     * The reason, not the observation.
     *
     * On a single file, every failure displayed "no file produced", while the
     * exact sentence, translated and specific to each code, was computed just
     * above and then thrown away: `statuts` is only rendered from two files
     * upwards. A bug that took two round trips to diagnose, for want of the
     * tool saying what it already knew.
     *
     * In a batch the observation is still the right sentence: reasons can
     * differ from one file to the next, and the list gives them one by one.
     */
    el.alerteFormat.textContent =
      concernes.length === 1 && derniereRaison ? derniereRaison : T.app.aucunProduit;
    annoncer(T.app.aucunProduitAnnonce);
    return;
  }

  if (produits.length === 1) {
    telechargerBlob(
      new Blob([produits[0].input as BlobPart], { type: produits[0].type }),
      produits[0].name,
    );
  } else {
    const zip = await downloadZip(produits).blob();
    telechargerBlob(zip, T.app.zip);
  }

  /*
   * Downloading stays what it was: sharing is added, it replaces nothing. It is
   * the produced files that are kept, never the originals. All the tool's value
   * rests on that distinction, and this is the place in the code where
   * conflating them would cost the most.
   */
  proposerPartage(
    produits.map((p) => new File([p.input as BlobPart], p.name, { type: p.type })),
  );

  marquerEtape(3);
  annoncer(
    echecs === 0
      ? T.app.pretsVerifies(produits.length)
      : T.app.pretsAvecEchecs(produits.length, echecs),
  );

  await adopterLesProduits(produits);
}

/**
 * The screen shows the file just written, not the one loaded.
 *
 * It showed the second, and nobody had ever checked: after an add it displayed
 * no location at all, and after an erase it still displayed the one just
 * removed. On a tool whose job this is, the second is the worse of the two: you
 * click "remove the location" and the location stays on screen.
 *
 * The element's bytes are replaced, not the display alone. Half of what the
 * screen carries is a capability, the active field, the erase buttons, the
 * reason sentence, and refreshing that without changing the bytes would have it
 * describe the produced file while the buttons acted on the original.
 *
 * The original name is kept: it is what composes the output name, and adopting
 * the suffixed name would stack "-geotagged-geotagged" on the second write.
 */
async function adopterLesProduits(
  produits: Array<{ id: string; name: string; input: Uint8Array; type: string }>,
): Promise<void> {
  for (const p of produits) {
    const it = items.find((x) => x.id === p.id);
    if (!it) continue;
    // `File` copies the bytes: the one going to the download is not the one
    // transferred to the worker, and the buffer cannot be neutered under the
    // browser's feet.
    it.file = new File([p.input as BlobPart], it.file.name, { type: p.type });
    const buffer = await it.file.arrayBuffer();
    const rep = await demander(
      { type: 'read', id: it.id, name: it.file.name, buffer },
      [buffer],
    );
    if (rep.type === 'read:ok') {
      it.read = rep.payload;
      it.erreur = undefined;
    }
  }
  if (principal) afficherPrincipal();
  if (items.length > 1) majListeLot();
}

// Outgoing share

/** The files produced by the last operation. Never the originals. */
let sorties: File[] = [];

/*
 * `canShare({ files })` rather than `'share' in navigator`: sharing files is
 * narrower than sharing a link, and a browser can perfectly well have the
 * second without the first. So the API is asked about the real files, whose
 * number and type matter, rather than about its own existence.
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
   * Called directly in the handler, with no `await` before it: sharing requires
   * transient user activation, and the slightest asynchronous round trip
   * consumes it, after which the share sheet no longer opens.
   *
   * A refusal is the norm, not a failure: closing the sheet without choosing
   * rejects the promise. We swallow it, or the end-to-end "no console error"
   * check would turn red on every hesitation.
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

el.carteBascule.addEventListener('click', () => {
  if (estInactif(el.carteBascule)) return;
  void ouvrirCarte();
});
el.cartePlus.addEventListener('click', () => carte?.zoomer(1));
el.carteMoins.addEventListener('click', () => carte?.zoomer(-1));

el.telecharger.addEventListener('click', () => {
  if (estInactif(el.telecharger) || !cible) return;
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
  if (estInactif(el.effacer)) return;
  void appliquer({ kind: 'erase' }, T.app.suffixeSansLieu);
});

el.effacerTout.addEventListener('click', () => {
  if (estInactif(el.effacerTout)) return;
  void appliquer({ kind: 'eraseAll' }, T.app.suffixeSansInfos);
});

/*
 * The starting state is set before anything can arrive from the system, rather
 * than at the end of the file where it used to be.
 *
 * `setConsumer` calls its consumer immediately if a launch is already waiting,
 * which is the normal case for an "Open with". Set afterwards, `versEtatVide()`
 * reset everything over an arrival in progress: the photo survived only because
 * the first thing the consumer does is await. A fix making that first step
 * synchronous would have erased the batch with nothing to say so.
 */
versEtatVide();

// Location proposed by the address

/*
 * `?lat=&lng=&zoom=`: pre-filling the location from the address.
 *
 * What it is for, and why the format earns it: an assistant that cannot run
 * code can still build a link. It knows the coordinates of a place just named
 * to it, and it can hand them back in a form where all that remains is to drop
 * the photo, the field already filled and the map already centred. Without it,
 * the only route was copying two numbers by hand.
 *
 * What this parameter does not do, which is what makes it acceptable:
 *
 *   - it loads no file, asks for none, and triggers no write. It fills an input
 *     field, exactly as a keystroke would. A link received from anywhere can
 *     therefore do nothing irreversible.
 *   - it does not open the map. Opening it would request tiles from a third
 *     party for somebody who asked for nothing; the map stays loaded on demand.
 *   - it records no precision. `precision` stays null, as for keyboard entry: a
 *     link measures nothing, and writing a number nobody measured into
 *     somebody's file is exactly what the input handler already refuses to do.
 *
 * A malformed value is ignored silently, and without reproach: these addresses
 * are built by programs, get copied wrongly, and are truncated by messaging
 * apps. An error banner on load, for a parameter the user did not type, would
 * blame the wrong person.
 */
function lieuDeLAdresse(): void {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(location.search);
  } catch {
    return;
  }

  /** A parameter as a finite number, or null. Empty is not zero. */
  const nombre = (nom: string): number | null => {
    const brut = params.get(nom);
    if (brut === null) return null;
    const texte = brut.trim();
    // `Number('')` is 0, and so is `Number(' ')`: without this test, `?lat=`
    // would announce the equator.
    if (texte === '') return null;
    const v = Number(texte);
    return Number.isFinite(v) ? v : null;
  };

  const lat = nombre('lat');
  // `lon` is accepted alongside `lng`: both spellings circulate, and refusing
  // one would send the user to an empty page without saying why.
  const lng = nombre('lng') ?? nombre('lon');

  // Both, or neither. A latitude alone does not name a place, and half-filling
  // the field would leave invalid input the user did not enter.
  if (lat === null || lng === null) return;
  // The same validation as everywhere else, finiteness and range, because a
  // latitude of 500 projected onto the map disappears without a word.
  const p = validerPosition({ lat, lon: lng });
  if (!p) return;

  cible = p;
  precision = null;
  el.coords.value = formatDecimal(p);
  majEtatCoords(false);
  majResultat();

  /*
   * The zoom is remembered, not applied: the map does not exist yet, and
   * opening it here would fetch tiles for somebody who asked for nothing.
   * `ouvrirCarte` will consume it if the user opens the map.
   *
   * Out of range it is ignored rather than clamped: a `?zoom=99` comes from a
   * badly built link, and silently correcting it would pass off as intentional
   * a maximum zoom nobody asked for.
   */
  const z = nombre('zoom');
  if (z !== null && Number.isInteger(z) && z >= ZOOM_MIN && z <= ZOOM_MAX) {
    zoomDeLAdresse = z;
  }
}

lieuDeLAdresse();

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

/**
 * Saying an arrival brought nothing, in the visible channel of the current
 * state.
 *
 * `#avis-vide` lives in the empty state, `#alerte-format` in the active one: a
 * sentence dropped into the one being hidden is visible nowhere, and the page
 * stays silent where it believes it is speaking. Sharing had only one answer to
 * that choice, since it only arrives on a page that has just opened. "Open
 * with" has two: it can land on an already-loaded batch, and then the active
 * state is on screen.
 *
 * So the screen is asked, not `principal`. The two resemble each other and do
 * not coincide: `charger` reveals the active state on arrival, while
 * `principal` only exists once the first photo is read. In between, trusting
 * `principal` switched back to the empty state, hiding a batch mid-read, in
 * order to drop a sentence into it.
 */
function signalerArriveeVide(phrase: string): void {
  if (!el.actif.hidden) {
    el.alerteFormat.hidden = false;
    el.alerteFormat.classList.remove('attention');
    el.alerteFormat.classList.add('grave');
    el.alerteFormat.textContent = phrase;
  } else {
    el.vide.hidden = false;
    el.actif.hidden = true;
    el.avisVide.hidden = false;
    el.avisVide.textContent = phrase;
  }
  annoncer(phrase);
}

function signalerPartagePerdu(): void {
  signalerArriveeVide(T.app.partagePerdu);
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

/** A handle that does not answer must not leave the page waiting for nothing. */
const DELAI_OUVERTURE = 10_000;

/** The same handle, but one that returns. Nothing more, and the timer is cleared. */
function avecDelai(p: Promise<File>): Promise<File | null> {
  return new Promise((resoudre) => {
    const minuteur = setTimeout(() => resoudre(null), DELAI_OUVERTURE);
    void p.then(
      (f) => resoudre(f),
      () => resoudre(null),
    ).finally(() => clearTimeout(minuteur));
  });
}

/**
 * Open a file handed over by the system, without the batch depending on it.
 *
 * `allSettled` rather than `all`: a single photo moved since the click took the
 * whole batch down, and the rejection surfaced nowhere. The rest is loaded, and
 * what is missing is said.
 */
async function ouvrir(poignees: FileHandleLike[]): Promise<void> {
  const arrivees = await Promise.all(poignees.map((h) => avecDelai(h.getFile())));
  /*
   * Zero size: the file is not there. Remote storage mounted as a local folder
   * returns 0-byte files until it has fetched them down, and they reached this
   * point only to be discarded without a word.
   */
  const fichiers = arrivees.filter((f): f is File => f !== null && f.size > 0);
  if (!fichiers.length) {
    signalerArriveeVide(T.app.ouverturePerdue);
    return;
  }
  await charger(fichiers, 'ajouter');
  const manquants = poignees.length - fichiers.length;
  if (manquants > 0) annoncer(T.app.ouvertureIncomplete(manquants));
}

if (filePeutEtreLancee.launchQueue) {
  filePeutEtreLancee.launchQueue.setConsumer((params) => {
    // A launch with no file is the ordinary launch: opening the app by its icon
    // also comes through here, and there is nothing to say. An entry without
    // `getFile` is not a file and does not claim to be.
    const poignees = (params.files ?? []).filter((h) => typeof h?.getFile === 'function');
    if (!poignees.length) return;
    /*
     * Everything is wrapped. A rejection escaping here would leave the window
     * on an empty, silent screen, which is the failure this path has just
     * stopped having, and the end-to-end test refuses any console error.
     */
    void ouvrir(poignees).catch(() => signalerArriveeVide(T.app.ouverturePerdue));
  });
}

// Installation

/*
 * Offering installation, and only when it is possible.
 *
 * The app has been installable for two releases (the manifest has everything
 * required and the service worker answers requests) but nothing ever offered
 * it. It could only be installed from the browser menu, which almost nobody
 * opens.
 *
 * The button only appears if the app is not already installed, and that rests
 * on four things rather than one:
 *
 *  1. it is born hidden in the served HTML, so the default state, for
 *     everybody, is absent. An event is needed to reveal it, never the reverse,
 *     so a regression cannot make it appear by accident;
 *  2. only the browser's prompt reveals it, and the browser fires none when the
 *     app is already installed. That is the main lock, and the platform holds
 *     it, not us;
 *  3. `dejaInstallee()` refuses to show it if the page is running inside the
 *     installed window, even if a prompt arrived anyway;
 *  4. `appinstalled` removes it immediately, without waiting for a reload.
 *
 * Nothing is remembered. Dismissing the browser's dialog leaves no trace: this
 * site persists nothing, and making an exception to remember a refusal would
 * cost more than it earns.
 */
interface InviteInstall extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let invite: InviteInstall | null = null;
/** The browser has confirmed the app is installed. See below. */
let installationConfirmee = false;

/** The modes meaning "running in a window of our own, not in a tab". */
const MODES_INSTALLES = ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay'];

/** The app runs in its own window: there is nothing left to install. */
function dejaInstallee(): boolean {
  // All four modes, not just the two requested today: the day
  // `display_override` asks for another, this guard keeps holding without
  // anyone having to think about it.
  if (MODES_INSTALLES.some((m) => matchMedia(`(display-mode: ${m})`).matches)) return true;
  // A packaged Android app opens the site with no display mode saying so: it is
  // recognised by its referrer.
  if (document.referrer.startsWith('android-app://')) return true;
  // iOS does not know `display-mode` and answers through this non-standard
  // property, which the documentation does not mention but which costs nothing.
  // Ignoring it would let the button appear in an app already on the home
  // screen.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function cacherInstallation(): void {
  invite = null;
  el.installer.hidden = true;
}

/*
 * Ask the browser, instead of inferring.
 *
 * The four locks above rest on an inference: no prompt, so probably already
 * installed. That is true, and it is not a check; from an ordinary tab nothing
 * confirms it. This interface answers for real: an empty array means not
 * installed, and that is the only case the inference could get wrong.
 *
 * It does not exist everywhere. Where it is missing we fall back exactly on the
 * previous inference, which was not wrong, hence the silence on failure.
 */
async function verifierInstallation(): Promise<void> {
  const nav = navigator as Navigator & {
    getInstalledRelatedApps?: () => Promise<unknown[]>;
  };
  if (typeof nav.getInstalledRelatedApps !== 'function') return;
  try {
    const posees = await nav.getInstalledRelatedApps();
    if (!posees.length) return;
    installationConfirmee = true;
    // The answer can arrive after the prompt has revealed the button: in that
    // direction too, it must disappear.
    cacherInstallation();
  } catch {
    /* No answer, and that is all: the other locks hold. */
  }
}
void verifierInstallation();

window.addEventListener('beforeinstallprompt', (e) => {
  // Without this the browser additionally puts its own bar at the bottom of the
  // screen: two competing offers for one gesture.
  e.preventDefault();
  if (dejaInstallee() || installationConfirmee) return;
  invite = e as InviteInstall;
  el.installer.hidden = false;
});

el.installer.addEventListener('click', () => {
  const invitee = invite;
  if (!invitee) return;
  /*
   * The prompt is discarded immediately, since it serves once and a second call
   * on the same event replays nothing, but the button stays while the browser's
   * dialog is open. That is the order the documentation keeps: ask, wait for
   * the decision, and only then tidy up. The reverse made the button disappear
   * before we even knew whether the request had succeeded.
   *
   * A refusal is not a failure, the same reasoning as for outgoing shares: we
   * do not insist, and we say nothing. The browser will fire another prompt on
   * the next visit and the button will reappear on its own.
   */
  invite = null;
  void (async () => {
    try {
      await invitee.prompt();
      await invitee.userChoice;
    } catch {
      /* Nothing to add: the button goes either way. */
    } finally {
      el.installer.hidden = true;
    }
  })();
});

window.addEventListener('appinstalled', () => {
  cacherInstallation();
  // The button disappearing is the visual feedback. The announcement is the
  // feedback for whoever is not looking at the screen.
  annoncer(T.app.installee);
});

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
    // This window is the one that asked. Without this flag, one window's click
    // reloaded all the others, since an activating worker claims every client
    // at once, and took their unexported photos with it. Rule 2 forbids a
    // forced reload; it only forbade it for updates, not for neighbours.
    demandeMaj = true;
    // The waiting worker only takes over on this message: see
    // `scripts/sw-modele.js`, rule 2. If it is no longer waiting, another
    // window has already brought it forward, and all that remains is to reload.
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    else location.reload();
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
    // Read before registering: afterwards the controller may already have changed.
    const avant = navigator.serviceWorker.controller;

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

    /*
     * One reload, and never on the first time control is taken.
     *
     * The worker claims its clients as it activates, so the page that just
     * registered it comes under control with no update involved. Reloading
     * there achieved nothing, since the served document is already the right
     * one, and it threw away what the system had just handed over. An "Open
     * with" consumed its files, because `setConsumer` calls its consumer
     * immediately, and then reloaded straight over them. They are handed over
     * once and once only: there is nothing to go back for, and the window
     * stayed empty and silent.
     *
     * Sharing did not lose its bytes, contrary to what one might think: it only
     * happens when a worker is already active, so the page it opens is
     * controlled from birth and this event does not fire there. What the reload
     * took from it was the sentence: "the shared photo did not arrive" had just
     * appeared, and vanished.
     *
     * A non-null `avant` means there was already a worker, so this is a new
     * one. `demandeMaj` means this window is the one that asked. The `recharge`
     * flag was already there: without it, two tabs claiming control from each
     * other loop forever.
     */
    let recharge = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (recharge || !avant || !demandeMaj) return;
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
