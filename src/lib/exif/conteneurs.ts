/**
 * The contract shared by every file that carries a TIFF block.
 *
 * A JPEG, a HEIC, a PNG and a WebP all carry the same TIFF block, each stored
 * its own way. Once the block is located, `tiff.ts` does exactly the same work.
 * What differs between formats comes down to three questions:
 *
 *   1. where is the block? `localiser`, which returns an array: a HEIC can
 *      carry two blocks, one of them attached to its thumbnail. Cleaning only
 *      one would hand back a file the user believes is clean.
 *   2. who owns the other bytes? `plagesRevendiquees`, without which no zeroing
 *      is defensible.
 *   3. does the format tolerate the block changing length? That is the absence
 *      of `reconstruire`, and nothing else, that closes adding.
 *
 * A container only places bytes; it decides nothing. All the range accounting,
 * and the three refusals that protect the file, live in the facade at the
 * bottom of this module. The ranges it produces are always in file
 * coordinates, which is what makes the byte-exact check usable: input and
 * output are compared outside those ranges.
 */

import { ExifError } from './erreurs.ts';
import type { Format, LatLon } from './types.ts';
import {
  type TiffView,
  type Edit,
  parseTiff,
  readPosition,
  deletePositionInTiff,
  ecrirePositionSurPlace,
  ecrirePositionParAjout,
  emptyTiff,
  TAG_GPS_IFD,
} from './tiff.ts';

export type Plage = [number, number];

export interface Emplacement {
  /** The TIFF block: a view onto the file's bytes, not a copy. */
  tiff: Uint8Array;
  /** Position of the first byte of the TIFF block within the file. */
  debut: number;
  /** Container-specific data, opaque to everything else. */
  interne?: unknown;
}

/** What a container returns once it has had to restructure the file. */
export interface Pose {
  bytes: Uint8Array;
  /** Modified ranges, in file coordinates. */
  changed: Plage[];
}

export interface Conteneur {
  readonly format: Format;
  reconnait(b: Uint8Array): boolean;

  /** Every TIFF block in the file, in the order they appear. */
  localiser(b: Uint8Array): Emplacement[];

  /**
   * Ranges of the file claimed by something other than `vise`. A write that
   * overlaps one does not happen: the original is returned intact.
   */
  plagesRevendiquees(b: Uint8Array, vise: Emplacement): Plage[];

  /**
   * Puts back a block of the same length. No byte moves, so there is nothing
   * to recompute: always defined, on every format.
   */
  reecrireSurPlace(b: Uint8Array, vise: Emplacement, tiff: Uint8Array): Uint8Array;

  /**
   * Puts back a block of a different length, or creates one where there was
   * none.
   *
   * Absent means the format does not tolerate a length change, so adding a
   * location is impossible, and the interface announces that before the action.
   */
  reconstruire?(b: Uint8Array, vise: Emplacement | null, tiff: Uint8Array): Pose;

  /**
   * Ranges the container must itself rewrite to keep the file coherent: a PNG
   * chunk checksum, a RIFF overall size, extended header flags. They lie
   * outside the TIFF block, and without this declaration the byte-exact check
   * would see them as modifications nobody announced.
   */
  plagesDeService?(b: Uint8Array, vise: Emplacement): Plage[];

  /** Removes all information, without re-encoding the image. */
  toutEffacer?(b: Uint8Array): Pose;

  /**
   * Removes the copies of the location stored outside the main block, at
   * constant length. Fails rather than leave one behind.
   */
  purgerCopiesDuLieu?(b: Uint8Array): Pose;

  /**
   * True if the file stores a copy of the location outside the main block, in
   * a form we cannot remove.
   *
   * Erasing the main block and leaving that copy would hand back a file the
   * user believes is clean. The erase is refused rather than produced.
   */
  copieDuLieuAilleurs?(b: Uint8Array): boolean;
}

export interface Ecriture {
  bytes: Uint8Array;
  route: 'P1' | 'P2';
  /** Modified ranges, in file coordinates. */
  changed: Plage[];
  /** True if the requested precision could actually be recorded. */
  precisionEcrite: boolean;
}

// Format detection

const BRANDS_HEIC = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis', 'mif2'];
const BRANDS_AVIF = ['avif', 'avis'];
const BRANDS_VIDEO = ['qt  ', 'mp41', 'mp42', 'isom', 'iso2', 'M4V ', '3gp4', '3gp5'];

/** Recognises a format from its leading bytes alone. */
export function detecterFormat(b: Uint8Array): Format {
  const a = (...codes: number[]) => codes.every((c, i) => b[i] === c);
  if (a(0xff, 0xd8, 0xff)) return 'jpeg';
  if (a(0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (a(0x47, 0x49, 0x46)) return 'gif';
  if (a(0x49, 0x49, 0x2a, 0x00) || a(0x4d, 0x4d, 0x00, 0x2a)) return 'tiff';
  if (b.length > 12 && a(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45) return 'webp';
  if (b.length > 12) {
    const texte = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
    if (texte(4) === 'ftyp') {
      // The major brand is not enough to guess from: a Nokia HEIC announces
      // itself as "mif1" and an AVIF sequence as "avis". Whole strings are
      // compared, so "avis" is not recognised inside something else.
      const marque = texte(8);
      if (BRANDS_AVIF.includes(marque)) return 'avif';
      if (BRANDS_HEIC.includes(marque)) return 'heic';
      if (BRANDS_VIDEO.includes(marque)) return 'video';
    }
  }
  return 'inconnu';
}

const registre: Conteneur[] = [];

/** Registers a container. Called once per format module. */
export function enregistrer(c: Conteneur): void {
  registre.push(c);
}

/** The container able to handle this file, or null. */
export function conteneurDe(b: Uint8Array): Conteneur | null {
  return registre.find((c) => c.reconnait(b)) ?? null;
}

// The byte-exact proof

function fusionner(plages: Plage[]): Plage[] {
  const tri = plages.map((p) => [p[0], p[1]] as Plage).sort((x, y) => x[0] - y[0]);
  const out: Plage[] = [];
  for (const [s, e] of tri) {
    const dernier = out[out.length - 1];
    if (dernier && s <= dernier[1]) dernier[1] = Math.max(dernier[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * True if `apres` is identical to `avant` everywhere outside the declared
 * ranges.
 *
 * This is the engine's central guarantee, and the only one worth anything on a
 * multi-megabyte file: rather than prove the image is still decodable, it
 * proves its bytes have not moved, which is strictly stronger and needs no
 * decoder.
 *
 * Comparing sizes proves nothing: a bug that zeroes 200 KB of MakerNote passes
 * it without a word.
 */
export function memesOctetsHorsPlages(
  avant: Uint8Array,
  apres: Uint8Array,
  plages: Plage[],
): boolean {
  const fusion = fusionner(plages);
  const commun = Math.min(avant.length, apres.length);
  let curseur = 0;
  for (const [s, e] of fusion) {
    const fin = Math.min(s, commun);
    for (let i = curseur; i < fin; i++) if (avant[i] !== apres[i]) return false;
    curseur = Math.max(curseur, e);
    if (curseur >= commun) break;
  }
  for (let i = curseur; i < commun; i++) if (avant[i] !== apres[i]) return false;

  // The file changed length: everything beyond must be covered by a declared
  // range, or bytes appeared or vanished silently.
  const plusLong = Math.max(avant.length, apres.length);
  for (let i = commun; i < plusLong; i++) {
    if (!fusion.some(([s, e]) => i >= s && i < e)) return false;
  }
  return true;
}

function seChevauchent(a: Plage, plages: Plage[]): boolean {
  return plages.some(([s, e]) => a[0] < e && s < a[1]);
}

const CHEVAUCHEMENT = () =>
  new ExifError(
    'PLAGES_CHEVAUCHANTES',
    "Ce fichier a une structure inhabituelle : le modifier risquerait d'abîmer d'autres informations. Nous préférons ne pas y toucher.",
  );

const AJOUT_IMPOSSIBLE = () =>
  new ExifError(
    'AJOUT_IMPOSSIBLE',
    "Ce fichier ne porte pas de lieu, et nous ne savons pas encore lui en ajouter un sans risquer de l'abîmer.",
  );

// Operations, across all containers

export interface BlocLu {
  emplacement: Emplacement;
  vue: TiffView;
  position: LatLon | null;
}

/** Reads every block in a file, skipping the unreadable ones. */
export function lireBlocs(c: Conteneur, b: Uint8Array): BlocLu[] {
  const out: BlocLu[] = [];
  for (const emplacement of c.localiser(b)) {
    try {
      const vue = parseTiff(emplacement.tiff);
      out.push({ emplacement, vue, position: readPosition(vue) });
    } catch {
      // An unreadable block is not a failure to read the file: nothing will be
      // displayed for it, and writing to it will be refused.
    }
  }
  return out;
}

/** The file's location: that of the first block carrying one. */
export function lirePosition(c: Conteneur, b: Uint8Array): LatLon | null {
  for (const bloc of lireBlocs(c, b)) if (bloc.position) return bloc.position;
  return null;
}

/**
 * Applies a change to a block, after proving the targeted range belongs to
 * nobody else.
 *
 * Three refusals, in this order, all before a byte is written: the targeted
 * block overlaps a claimed range; a written range runs outside the block; a
 * written range overlaps a claimed range.
 */
function appliquerAuBloc(
  c: Conteneur,
  b: Uint8Array,
  bloc: BlocLu,
  produire: (vue: TiffView) => Edit,
): { pose: Pose; route: 'P1' | 'P2' } {
  const { emplacement } = bloc;
  const longueur = emplacement.tiff.length;
  const autres = c.plagesRevendiquees(b, emplacement);
  if (seChevauchent([emplacement.debut, emplacement.debut + longueur], autres)) throw CHEVAUCHEMENT();

  const edit = produire(bloc.vue);

  if (edit.bytes.length === longueur) {
    const plages = edit.changed.map(([s, e]) => {
      if (s < 0 || e > longueur || e < s) {
        throw new ExifError(
          'STRUCTURE_INATTENDUE',
          "Ce fichier a une structure que nous ne savons pas modifier sans risque. Il n'a pas été touché.",
        );
      }
      return [emplacement.debut + s, emplacement.debut + e] as Plage;
    });
    for (const p of plages) if (seChevauchent(p, autres)) throw CHEVAUCHEMENT();
    const service = c.plagesDeService?.(b, emplacement) ?? [];
    return {
      pose: {
        bytes: c.reecrireSurPlace(b, emplacement, edit.bytes),
        changed: [...plages, ...service],
      },
      route: edit.route,
    };
  }

  if (!c.reconstruire) throw AJOUT_IMPOSSIBLE();
  return { pose: c.reconstruire(b, emplacement, edit.bytes), route: edit.route };
}

/** Writes a location, choosing whichever route the container allows. */
export function ecrirePosition(
  c: Conteneur,
  b: Uint8Array,
  lat: number,
  lon: number,
  precisionMetres?: number,
): Ecriture {
  const demandee = typeof precisionMetres === 'number' && precisionMetres > 0;
  const blocs = lireBlocs(c, b);
  // Writing targets the main block, the first one. Secondary blocks (a
  // thumbnail, for instance) are cleaned on erase, never filled.
  const bloc = blocs[0];

  if (!bloc) {
    if (!c.reconstruire) throw AJOUT_IMPOSSIBLE();
    const edit = ecrirePositionParAjout(parseTiff(emptyTiff()), lat, lon, precisionMetres);
    const pose = c.reconstruire(b, null, edit.bytes);
    return { ...pose, route: 'P2', precisionEcrite: demandee };
  }

  const { pose, route } = appliquerAuBloc(c, b, bloc, (vue) => {
    const surPlace = ecrirePositionSurPlace(vue, lat, lon, precisionMetres);
    if (surPlace) return surPlace;
    if (!c.reconstruire) throw AJOUT_IMPOSSIBLE();
    return ecrirePositionParAjout(vue, lat, lon, precisionMetres);
  });
  // The P1 route cannot add an entry, so it cannot record a precision the file
  // did not already carry. It will not be announced.
  return { ...pose, route, precisionEcrite: demandee && route === 'P2' };
}

/** Removes the location from every block in the file. */
export function effacerPosition(c: Conteneur, b: Uint8Array): Ecriture {
  let courant = b;
  const changed: Plage[] = [];

  // The file is re-read on each pass: locations are recomputed from the
  // current bytes, never reused from one pass to the next. The bound is a
  // guard rail; if an erase failed to remove the GPS IFD, the loop would spin
  // forever rather than fail.
  for (let tour = 0; tour < 16; tour++) {
    // A GPSInfo pointer leading nowhere counts too: the entry must go from
    // IFD0, or a third-party reader will go and read arbitrary bytes.
    const bloc = lireBlocs(c, courant).find(
      (x) => x.vue.gpsIfd !== null || x.vue.ifd0.entries.some((en) => en.tag === TAG_GPS_IFD),
    );
    if (!bloc) break;
    const { pose } = appliquerAuBloc(c, courant, bloc, (vue) => deletePositionInTiff(vue));
    courant = pose.bytes;
    changed.push(...pose.changed);
  }

  // A second copy of the location, in a descriptive text packet, would survive
  // everything above. Purging it is half the work; checking afterwards is the
  // other half, and that is what turns an incomplete purge into a visible
  // failure rather than a silent leak.
  if (c.purgerCopiesDuLieu) {
    const pose = c.purgerCopiesDuLieu(courant);
    courant = pose.bytes;
    changed.push(...pose.changed);
  }
  if (c.copieDuLieuAilleurs?.(courant)) {
    throw new ExifError(
      'COPIE_DU_LIEU_SUBSISTE',
      "Une copie du lieu subsiste dans ce fichier, sous une forme que nous ne savons pas retirer. Nous préférons vous rendre l'original intact.",
    );
  }

  return { bytes: courant, route: 'P1', changed, precisionEcrite: false };
}

/** Removes all information, if the container knows how. */
export function toutEffacer(c: Conteneur, b: Uint8Array): Ecriture {
  if (!c.toutEffacer) {
    throw new ExifError(
      'EFFACEMENT_TOTAL_IMPOSSIBLE',
      "Nous ne savons pas encore retirer toutes les informations de ce type de fichier.",
    );
  }
  const pose = c.toutEffacer(b);
  return { ...pose, route: 'P2', precisionEcrite: false };
}
