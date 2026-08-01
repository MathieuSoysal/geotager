/**
 * Box traversal, shared by images and videos.
 *
 * HEIC, AVIF, MOV and MP4 are the same wrapper: a sequence of boxes nested
 * inside one another. What they carry has nothing in common (a photo stores a
 * TIFF block in an item, a video stores a coordinate string in `moov`) but the
 * way down is identical, and it holds enough traps to deserve exactly one
 * implementation.
 *
 * This module therefore knows neither use. It only reads headers and descends;
 * who is looking for what belongs to `isobmff.ts` and `quicktime.ts`.
 */

import { lireEntierBE, readU32 } from './octets.ts';

export interface Boite {
  type: string;
  debut: number;
  /** Header length, payload excluded. */
  entete: number;
  /** Total length, header included. */
  taille: number;
  /**
   * Size exactly as written in the file, before interpretation.
   *
   * The value 0 means "to the end of the file". Once resolved to an effective
   * length that nuance is gone, and it matters for appending: adding a box
   * after one that extends to the end would have it swallowed.
   */
  declaree: number;
}

export const texte = (b: Uint8Array, o: number, n: number) =>
  String.fromCharCode(...b.subarray(o, o + n));

/** First byte of a box payload. */
export const charge = (x: Boite) => x.debut + x.entete;

/** First byte after the box. */
export const finDe = (x: Boite) => x.debut + x.taille;

/**
 * Walks a sequence of boxes.
 *
 * Three header forms exist and all three occur in the wild: a 32-bit size, the
 * value 1 redirecting to a 64-bit size, and the value 0 meaning "to the end of
 * the file", common on large streamed data boxes. A walk that ignores the last
 * two stops early and concludes there is no location.
 */
export function boites(b: Uint8Array, debut: number, fin: number): Boite[] {
  const out: Boite[] = [];
  let o = debut;
  while (o + 8 <= fin) {
    const declaree = readU32(b, o, 'BE');
    let taille = declaree;
    const type = texte(b, o + 4, 4);
    let entete = 8;
    if (taille === 1) {
      if (o + 16 > fin) break;
      taille = lireEntierBE(b, o + 8, 8);
      entete = 16;
    } else if (taille === 0) {
      taille = fin - o;
    }
    if (type === 'uuid') entete += 16;
    if (taille < entete || o + taille > fin) break;
    out.push({ type, debut: o, entete, taille, declaree });
    o += taille;
  }
  return out;
}

/**
 * How many bytes separate a box header from its children.
 *
 * Almost always zero. Three exceptions, all met in real files: `meta` is a
 * FullBox, so four bytes of version and flags come first, and `stsd` and `dref`
 * follow those four with a four-byte count.
 */
function preambule(type: string): number {
  if (type === 'meta') return 4;
  if (type === 'stsd' || type === 'dref') return 8;
  return 0;
}

/**
 * Direct children of a box.
 *
 * `meta` needs care: it is a FullBox, but QuickTime-derived tools write it as
 * an ordinary box (ExifTool's `QuickTime.mov` among them). Rather than guess,
 * both preambles are tried and the one producing a box sequence that exactly
 * fills the parent wins. A read four bytes out of alignment yields absurd
 * sizes and stops short, which is what separates them.
 */
export function enfants(b: Uint8Array, parent: Boite): Boite[] {
  const fin = finDe(parent);
  const candidats = parent.type === 'meta' ? [4, 0] : [preambule(parent.type)];
  let repli: Boite[] = [];
  for (const decalage of candidats) {
    const debut = charge(parent) + decalage;
    if (debut > fin) continue;
    const liste = boites(b, debut, fin);
    if (liste.length && finDe(liste[liste.length - 1]) === fin) return liste;
    if (liste.length > repli.length) repli = liste;
  }
  return repli;
}

/**
 * Follows a path of types, for example `moov/udta`.
 *
 * Returns the first box at each level, since a well-formed file has one `moov`
 * and one `udta`. Returns `null` as soon as a level is missing, rather than
 * searching further: a box found in the wrong place means nothing.
 */
export function chemin(b: Uint8Array, route: string, racine?: Boite[]): Boite | null {
  let niveau = racine ?? boites(b, 0, b.length);
  let trouvee: Boite | null = null;
  for (const cran of route.split('/')) {
    const suivante = niveau.find((x) => x.type === cran);
    if (!suivante) return null;
    trouvee = suivante;
    niveau = enfants(b, suivante);
  }
  return trouvee;
}

/**
 * Every box of a given type, at any depth.
 *
 * The descent only follows boxes that contain boxes. Descending into `mdat`,
 * the images and sound and most of the file's weight, would mean reading pixel
 * bytes as headers: megabytes of boxes that do not exist, on every call.
 */
const CONTENEUSES = new Set([
  'moov', 'trak', 'edts', 'mdia', 'minf', 'dinf', 'stbl', 'mvex', 'moof',
  'traf', 'mfra', 'udta', 'meta', 'ilst', 'stsd', 'gmhd', 'tapt',
]);

export function toutesLesBoites(
  b: Uint8Array,
  type: string,
  racine?: Boite[],
): Boite[] {
  const out: Boite[] = [];
  const descendre = (niveau: Boite[], profondeur: number) => {
    // Bounded depth: a damaged file can describe nesting that never ends, and
    // the walk must stop before the stack does.
    if (profondeur > 12) return;
    for (const x of niveau) {
      if (x.type === type) out.push(x);
      if (CONTENEUSES.has(x.type)) descendre(enfants(b, x), profondeur + 1);
    }
  };
  descendre(racine ?? boites(b, 0, b.length), 0);
  return out;
}
