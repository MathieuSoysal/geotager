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

/**
 * Bytes read one at a time, for what is not human-readable text.
 *
 * A box name is four bytes, and it is an identity rather than a sentence:
 * `©xyz` starts with 0xA9 and only compares correctly character by character.
 * This function exists for that, and nothing else.
 */
export const texte = (b: Uint8Array, o: number, n: number) =>
  String.fromCharCode(...b.subarray(o, o + n));

/**
 * The text of a payload, decoded for reading.
 *
 * One byte per character is right for a box name and wrong for everything
 * else: `°` is two bytes in UTF-8, and reading it that way yields "Â°". The
 * bug was invisible on every test file, all written in ASCII, and it garbled
 * anything a device writes with an accent or a symbol: a device name, an
 * author, and a location written in degrees and minutes.
 *
 * Three encodings, in the order they can be recognised with certainty: a byte
 * order mark announces UTF-16 unambiguously; UTF-8 validates itself, a
 * malformed sequence being rejected rather than guessed; and failing both, one
 * byte per character, which is what older files write.
 */
export function texteLisible(b: Uint8Array, o: number, n: number): string {
  const octets = b.subarray(o, o + n);
  if (n >= 2 && octets[0] === 0xfe && octets[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(octets.subarray(2));
  }
  if (n >= 2 && octets[0] === 0xff && octets[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(octets.subarray(2));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(octets);
  } catch {
    return texte(b, o, n);
  }
}

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
 * The caller must already know this box contains others. This function reads
 * bytes; it cannot tell a leaf from a container, and it will never pretend to.
 * The payload of a `tkhd` or an `stsz` is made of numbers, and numbers read
 * perfectly well as plausible headers, yielding boxes that do not exist.
 * `contientDesBoites` answers that question, and any tree walk must consult it
 * before descending.
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
 * Boxes that contain other boxes.
 *
 * Descending into `mdat`, the images and sound and most of the file's weight,
 * would mean reading pixel bytes as headers: megabytes of boxes that do not
 * exist, on every call. The same holds for every leaf, `tkhd` and `stsz`
 * included, whose payloads are numbers that read all too well as headers.
 *
 * This list is therefore the answer to a single question, and every tree walk
 * must ask it before descending a level. It was private for one release, and
 * the post-write check for videos, which did descend into leaves, rejected
 * every real video as a result.
 */
const CONTENEUSES = new Set([
  'moov', 'trak', 'edts', 'mdia', 'minf', 'dinf', 'stbl', 'mvex', 'moof',
  'traf', 'mfra', 'udta', 'meta', 'ilst', 'stsd', 'gmhd', 'tapt',
]);

/** True if a box of this type holds other boxes rather than data. */
export function contientDesBoites(type: string): boolean {
  return CONTENEUSES.has(type);
}

/** Every box of a given type, at any depth. */

export function toutesLesBoites(b: Uint8Array, type: string, racine?: Boite[]): Boite[] {
  return parType(b, [type], racine).get(type) ?? [];
}

/**
 * Several types in a single descent.
 *
 * Looking for three types meant three full tree walks, on a file already
 * walked several times to probe it. The descent is the expensive part; the
 * type being looked for is not.
 */
export function parType(
  b: Uint8Array,
  types: string[],
  racine?: Boite[],
): Map<string, Boite[]> {
  const out = new Map<string, Boite[]>(types.map((t) => [t, []]));
  const descendre = (niveau: Boite[], profondeur: number) => {
    // Bounded depth: a damaged file can describe nesting that never ends, and
    // the walk must stop before the stack does.
    if (profondeur > 12) return;
    for (const x of niveau) {
      out.get(x.type)?.push(x);
      if (CONTENEUSES.has(x.type)) descendre(enfants(b, x), profondeur + 1);
    }
  };
  descendre(racine ?? boites(b, 0, b.length), 0);
  return out;
}
