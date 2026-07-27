/**
 * Surgery on a TIFF block, without knowing which file carries it.
 *
 * This is the layer that does all the work. A JPEG keeps its TIFF block in an
 * APP1 segment, a HEIC in an item of its `meta` box, a PNG in an `eXIf` chunk,
 * a WebP in an `EXIF` chunk, and a TIFF is that block. Every time, once the
 * block is located, the operations are exactly the same.
 *
 * Only two routes, and neither moves an existing byte:
 *
 *   P1  in-place edit, at constant length. The bytes of the GPS value are
 *       modified where they are. MakerNote, thumbnail, ICC profile, MPF and
 *       Photoshop segments are preserved by construction, not by vigilance.
 *
 *   P2  append, by copying IFD0 to the end of the block. When a GPS IFD has to
 *       be created, nothing is inserted in the middle: a new IFD0 is appended
 *       at the end of the block and the header is pointed at it. Value offsets
 *       being absolute from the start of the block, everything else stays valid
 *       bit for bit, including a MakerNote with absolute offsets, which is
 *       precisely what a conventional rewrite breaks.
 *
 * Every offset handled here is relative to the start of the TIFF block. Turning
 * them into file coordinates is the container's job.
 */

import { ExifError } from './erreurs.ts';
import { type Endian, readU16, readU32, writeU16, writeU32 } from './octets.ts';

export type { Endian };

export interface Entry {
  tag: number;
  type: number;
  count: number;
  /** Absolute position of the 12-byte entry, from the start of the TIFF block. */
  entryOffset: number;
  /** Absolute position of the value if it is out of line, otherwise null. */
  valueOffset: number | null;
  /** Length of the value in bytes. */
  valueLength: number;
}

export interface Ifd {
  offset: number;
  entries: Entry[];
  /** Absolute position of the "next IFD" pointer. */
  nextPointerOffset: number;
  next: number;
}

export interface TiffView {
  /** The TIFF block alone (from "II" / "MM" onwards). */
  bytes: Uint8Array;
  endian: Endian;
  ifd0: Ifd;
  exifIfd: Ifd | null;
  gpsIfd: Ifd | null;
  interopIfd: Ifd | null;
  ifd1: Ifd | null;
}

/** Size in bytes of one component, by TIFF 6.0 type. */
const TYPE_SIZE: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
};

export const TAG_EXIF_IFD = 0x8769;
export const TAG_GPS_IFD = 0x8825;
export const TAG_INTEROP_IFD = 0xa005;
export const TAG_SUB_IFDS = 0x014a;

export const GPS = {
  VersionID: 0x0000,
  LatitudeRef: 0x0001,
  Latitude: 0x0002,
  LongitudeRef: 0x0003,
  Longitude: 0x0004,
  AltitudeRef: 0x0005,
  Altitude: 0x0006,
  HPositioningError: 0x001f,
} as const;

// Reading the structure

function parseIfd(bytes: Uint8Array, offset: number, e: Endian): Ifd {
  if (offset + 2 > bytes.length) {
    throw new ExifError('EXIF_CORROMPU', "Les informations du fichier sont illisibles.");
  }
  const count = readU16(bytes, offset, e);
  const entries: Entry[] = [];
  const end = offset + 2 + count * 12;
  if (end + 4 > bytes.length) {
    throw new ExifError('EXIF_CORROMPU', "Les informations du fichier sont illisibles.");
  }
  for (let k = 0; k < count; k++) {
    const eo = offset + 2 + k * 12;
    const tag = readU16(bytes, eo, e);
    const type = readU16(bytes, eo + 2, e);
    const cnt = readU32(bytes, eo + 4, e);
    const size = TYPE_SIZE[type];
    // An unknown type is not fatal: keep the entry as it is and simply refuse
    // to touch it.
    const valueLength = size ? size * cnt : 0;
    const inline = valueLength <= 4;
    entries.push({
      tag,
      type,
      count: cnt,
      entryOffset: eo,
      valueOffset: inline ? null : readU32(bytes, eo + 8, e),
      valueLength,
    });
  }
  return { offset, entries, nextPointerOffset: end, next: readU32(bytes, end, e) };
}

function subIfd(bytes: Uint8Array, ifd: Ifd, tag: number, e: Endian): Ifd | null {
  const entry = ifd.entries.find((x) => x.tag === tag);
  if (!entry) return null;
  const target = entry.valueOffset ?? readU32(bytes, entry.entryOffset + 8, e);
  if (target === 0 || target >= bytes.length) return null;
  try {
    return parseIfd(bytes, target, e);
  } catch {
    return null;
  }
}

/** Builds a usable view of a TIFF block. */
export function parseTiff(tiff: Uint8Array): TiffView {
  if (tiff.length < 8) {
    throw new ExifError('EXIF_CORROMPU', "Les informations du fichier sont illisibles.");
  }
  let endian: Endian;
  if (tiff[0] === 0x49 && tiff[1] === 0x49) endian = 'LE';
  else if (tiff[0] === 0x4d && tiff[1] === 0x4d) endian = 'BE';
  else throw new ExifError('EXIF_CORROMPU', "Les informations du fichier sont illisibles.");

  if (readU16(tiff, 2, endian) !== 42) {
    throw new ExifError('EXIF_CORROMPU', "Les informations du fichier sont illisibles.");
  }
  const ifd0Offset = readU32(tiff, 4, endian);
  const ifd0 = parseIfd(tiff, ifd0Offset, endian);
  const exifIfd = subIfd(tiff, ifd0, TAG_EXIF_IFD, endian);
  const gpsIfd = subIfd(tiff, ifd0, TAG_GPS_IFD, endian);
  const interopIfd = exifIfd ? subIfd(tiff, exifIfd, TAG_INTEROP_IFD, endian) : null;
  let ifd1: Ifd | null = null;
  if (ifd0.next !== 0 && ifd0.next < tiff.length) {
    try {
      ifd1 = parseIfd(tiff, ifd0.next, endian);
    } catch {
      ifd1 = null;
    }
  }
  return { bytes: tiff, endian, ifd0, exifIfd, gpsIfd, interopIfd, ifd1 };
}

/**
 * Every IFD in a block, including those a plain view does not show.
 *
 * `parseTiff` stops at the second page. A standalone TIFF can have ten, and
 * each has its own out-of-line values and pixel strips. A range map built on
 * the first two pages alone would leave the rest unprotected, which is not a
 * lack of completeness but a safety hole.
 *
 * The walk follows the page chain, the three known sub-IFDs, and the `SubIFDs`
 * tag, which carries an array of offsets rather than one. A set of
 * already-seen offsets prevents looping: two pages are perfectly entitled to
 * name the same sub-IFD.
 */
function toutesLesIfd(bytes: Uint8Array, e: Endian): Ifd[] {
  const vues = new Set<number>();
  const out: Ifd[] = [];
  const file: number[] = [readU32(bytes, 4, e)];
  let entrees = 0;

  while (file.length && out.length < 64 && entrees < 4096) {
    const offset = file.shift()!;
    if (!offset || offset >= bytes.length || vues.has(offset)) continue;
    vues.add(offset);
    let ifd: Ifd;
    try {
      ifd = parseIfd(bytes, offset, e);
    } catch {
      continue;
    }
    out.push(ifd);
    entrees += ifd.entries.length;
    if (ifd.next) file.push(ifd.next);
    for (const en of ifd.entries) {
      if (en.tag === TAG_EXIF_IFD || en.tag === TAG_GPS_IFD || en.tag === TAG_INTEROP_IFD) {
        file.push(en.valueOffset ?? readU32(bytes, en.entryOffset + 8, e));
      } else if (en.tag === TAG_SUB_IFDS) {
        for (const v of valeursEntieres(bytes, e, en)) file.push(v);
      }
    }
  }
  return out;
}

/**
 * Integer components of an entry, whether inline or out of line.
 *
 * `StripOffsets` is as often a SHORT as a LONG. A reader that assumes four
 * bytes claims half the strips and leaves the other half zeroable.
 */
function valeursEntieres(bytes: Uint8Array, e: Endian, entry: Entry): number[] {
  if (entry.type !== 3 && entry.type !== 4) return [];
  const taille = entry.type === 3 ? 2 : 4;
  const base = entry.valueOffset ?? entry.entryOffset + 8;
  const out: number[] = [];
  for (let k = 0; k < entry.count; k++) {
    const o = base + k * taille;
    if (o + taille > bytes.length) return [];
    out.push(taille === 2 ? readU16(bytes, o, e) : readU32(bytes, o, e));
  }
  return out;
}

/** (offset, length) pairs naming data outside the IFDs. */
const PAIRES_DE_DONNEES: Array<[number, number]> = [
  [0x0111, 0x0117], // bandes de pixels
  [0x0144, 0x0145], // tuiles de pixels
  [0x0201, 0x0202], // aperçu ou vignette
];

/**
 * Map of the byte ranges claimed by something other than the GPS IFD.
 *
 * TIFF 6.0 states that "the values to which directory entries point need not be
 * in any particular order in the file": nothing guarantees the GPS IFD's values
 * form a contiguous, exclusive region. Before zeroing anything, the targeted
 * range must be shown to belong to nobody else, or a MakerNote is destroyed in
 * the name of cleaning.
 *
 * When the TIFF block is the whole file, this map and nothing else protects the
 * pixels: they are named only by the strip or tile offsets held in the IFDs.
 */
function claimedRanges(view: TiffView, exclude: Ifd | null): Array<[number, number]> {
  const bytes = view.bytes;
  const e = view.endian;
  const ranges: Array<[number, number]> = [[0, 8]];

  const revendiquer = (o: number, l: number) => {
    if (l <= 0) return;
    if (o < 8 || o + l > bytes.length) {
      // An offset outside the block means our reading of the structure is
      // wrong somewhere. Refuse rather than write on the strength of a partly
      // wrong map.
      throw new ExifError(
        'STRUCTURE_INATTENDUE',
        "Ce fichier a une structure que nous ne savons pas modifier sans risque. Il n'a pas été touché.",
      );
    }
    ranges.push([o, o + l]);
  };

  for (const ifd of toutesLesIfd(bytes, e)) {
    // Compared by offset: the same IFD read again is the same logical object.
    if (exclude && ifd.offset === exclude.offset) continue;
    ranges.push([ifd.offset, ifd.nextPointerOffset + 4]);
    for (const en of ifd.entries) {
      if (en.valueOffset !== null && en.valueLength > 0) {
        revendiquer(en.valueOffset, en.valueLength);
      }
    }
    for (const [tagAdresses, tagLongueurs] of PAIRES_DE_DONNEES) {
      const a = ifd.entries.find((x) => x.tag === tagAdresses);
      const l = ifd.entries.find((x) => x.tag === tagLongueurs);
      if (!a || !l) continue;
      const adresses = valeursEntieres(bytes, e, a);
      const longueurs = valeursEntieres(bytes, e, l);
      if (adresses.length !== longueurs.length || adresses.length === 0) {
        // The length of a strip whose count we do not have is not guessed.
        throw new ExifError(
          'STRUCTURE_INATTENDUE',
          "Ce fichier a une structure que nous ne savons pas modifier sans risque. Il n'a pas été touché.",
        );
      }
      for (let k = 0; k < adresses.length; k++) revendiquer(adresses[k], longueurs[k]);
    }
  }
  return ranges;
}

function overlaps(a: [number, number], ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => a[0] < e && s < a[1]);
}

// Coordinate conversion

/** Decimal degrees to three DMS rationals, seconds to 1/10000. */
export function degreesToDms(value: number): Array<[number, number]> {
  const abs = Math.abs(value);
  const d = Math.floor(abs);
  const minFloat = (abs - d) * 60;
  const m = Math.floor(minFloat);
  const s = Math.round((minFloat - m) * 60 * 10000);
  return [
    [d, 1],
    [m, 1],
    [s, 10000],
  ];
}

function dmsToDegrees(parts: Array<[number, number]>, ref: string): number | null {
  if (parts.length < 3) return null;
  // A zero denominator is not "zero degrees", it is a value we cannot read.
  // Replacing it with zero would announce a position off the Gulf of Guinea for
  // a file carrying none, and a Galaxy S10 writes exactly that when it has had
  // no fix.
  if (parts.some(([, den]) => den === 0)) return null;
  const [d, m, s] = parts.map(([n, den]) => n / den);
  const value = d + m / 60 + s / 3600;
  if (!Number.isFinite(value)) return null;
  return ref === 'S' || ref === 'W' ? -value : value;
}

function readRationals(view: TiffView, entry: Entry): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const base = entry.valueOffset;
  if (base === null) return out;
  for (let k = 0; k < entry.count; k++) {
    out.push([
      readU32(view.bytes, base + k * 8, view.endian),
      readU32(view.bytes, base + k * 8 + 4, view.endian),
    ]);
  }
  return out;
}

function readAscii(view: TiffView, entry: Entry): string {
  const bytes =
    entry.valueOffset === null
      ? view.bytes.subarray(entry.entryOffset + 8, entry.entryOffset + 8 + entry.valueLength)
      : view.bytes.subarray(entry.valueOffset, entry.valueOffset + entry.valueLength);
  return String.fromCharCode(...bytes).replace(/\0.*$/, '');
}

/** Reads the location of a TIFF view, or null if it carries none. */
export function readPosition(view: TiffView): { lat: number; lon: number } | null {
  const gps = view.gpsIfd;
  if (!gps) return null;
  const lat = gps.entries.find((x) => x.tag === GPS.Latitude);
  const latRef = gps.entries.find((x) => x.tag === GPS.LatitudeRef);
  const lon = gps.entries.find((x) => x.tag === GPS.Longitude);
  const lonRef = gps.entries.find((x) => x.tag === GPS.LongitudeRef);
  if (!lat || !lon || lat.type !== 5 || lon.type !== 5) return null;
  const latDeg = dmsToDegrees(readRationals(view, lat), latRef ? readAscii(view, latRef) : 'N');
  const lonDeg = dmsToDegrees(readRationals(view, lon), lonRef ? readAscii(view, lonRef) : 'E');
  if (latDeg === null || lonDeg === null) return null;
  if (Math.abs(latDeg) > 90 || Math.abs(lonDeg) > 180) return null;
  // Latitude and longitude both exactly zero: not a location, but what
  // software leaves behind after purging the coordinates without removing the
  // entries. The point (0, 0) is in open sea; no device writes it for real.
  // Better to announce "no location" than the Gulf of Guinea.
  if (latDeg === 0 && lonDeg === 0) return null;
  return { lat: latDeg, lon: lonDeg };
}

// Result of an operation

export interface Edit {
  bytes: Uint8Array;
  /** The route actually taken. */
  route: 'P1' | 'P2';
  /** Byte ranges modified, for the byte-exact check. */
  changed: Array<[number, number]>;
}

// Removing the location, always P1

/**
 * Removes the location from a TIFF block without moving a single byte.
 *
 * Two operations: zero the GPS IFD and the out-of-line values exclusive to it,
 * then remove the GPSInfo entry from IFD0.
 *
 * Removing an entry is not "decrement the counter": TIFF 6.0 puts the "next
 * IFD" pointer at `offset + 2 + count * 12`. Decrementing the counter alone
 * would have that pointer read twelve bytes earlier, in the middle of the
 * previous entry, and the thumbnail offset would become arbitrary. The
 * following entries must be shifted, the pointer rewritten at its new address
 * with its original value, and the twelve now-dead bytes zeroed.
 */
export function deletePositionInTiff(view: TiffView): Edit {
  const out = new Uint8Array(view.bytes);
  const changed: Array<[number, number]> = [];
  const e = view.endian;

  if (view.gpsIfd) {
    const gps = view.gpsIfd;
    const others = claimedRanges(view, gps);

    const zeroiser = (range: [number, number]) => {
      // An offset outside the block means our reading of the structure is
      // wrong somewhere. Continuing to zero with a partly wrong map is
      // precisely what this machinery exists to prevent: refuse, do not skip.
      if (range[0] < 0 || range[1] > out.length || range[1] < range[0]) {
        throw new ExifError(
          'STRUCTURE_INATTENDUE',
          "Ce fichier a une structure que nous ne savons pas modifier sans risque. Il n'a pas été touché.",
        );
      }
      if (overlaps(range, others)) {
        throw new ExifError(
          'PLAGES_CHEVAUCHANTES',
          "Ce fichier a une structure inhabituelle : effacer la position risquerait d'abîmer d'autres informations. Nous préférons ne pas y toucher.",
        );
      }
      out.fill(0, range[0], range[1]);
      changed.push(range);
    };

    for (const en of gps.entries) {
      if (en.valueOffset === null || en.valueLength === 0) continue;
      zeroiser([en.valueOffset, en.valueOffset + en.valueLength]);
    }

    // The GPS IFD's structure goes through the same check as its values: on a
    // multi-page TIFF two pages may legitimately point at the same IFD, and
    // zeroing it without checking would destroy the second.
    zeroiser([gps.offset, gps.nextPointerOffset + 4]);
  }

  // Remove the GPSInfo entry from IFD0.
  const ifd0 = view.ifd0;
  const idx = ifd0.entries.findIndex((x) => x.tag === TAG_GPS_IFD);
  if (idx >= 0) {
    const first = ifd0.offset + 2;
    const n = ifd0.entries.length;
    const from = first + (idx + 1) * 12;
    const to = first + idx * 12;
    const tailLength = (n - idx - 1) * 12;
    out.copyWithin(to, from, from + tailLength);

    const newNextPointer = first + (n - 1) * 12;
    writeU32(out, newNextPointer, ifd0.next, e);
    out.fill(0, newNextPointer + 4, newNextPointer + 4 + 12);
    writeU16(out, ifd0.offset, n - 1, e);
    changed.push([ifd0.offset, newNextPointer + 4 + 12]);
  }

  return { bytes: out, route: 'P1', changed };
}

// Writing the location

interface GpsField {
  tag: number;
  type: number;
  count: number;
  /** Serialised value, out of line if longer than 4 bytes. */
  data: Uint8Array;
}

function buildGpsFields(lat: number, lon: number, e: Endian, accuracyMetres?: number): GpsField[] {
  const rat = (pairs: Array<[number, number]>) => {
    const b = new Uint8Array(pairs.length * 8);
    pairs.forEach(([n, d], k) => {
      writeU32(b, k * 8, n, e);
      writeU32(b, k * 8 + 4, d, e);
    });
    return b;
  };
  const ascii = (s: string) => {
    const b = new Uint8Array(s.length + 1);
    for (let k = 0; k < s.length; k++) b[k] = s.charCodeAt(k);
    return b;
  };

  const fields: GpsField[] = [
    { tag: GPS.VersionID, type: 1, count: 4, data: new Uint8Array([2, 3, 0, 0]) },
    { tag: GPS.LatitudeRef, type: 2, count: 2, data: ascii(lat >= 0 ? 'N' : 'S') },
    { tag: GPS.Latitude, type: 5, count: 3, data: rat(degreesToDms(lat)) },
    { tag: GPS.LongitudeRef, type: 2, count: 2, data: ascii(lon >= 0 ? 'E' : 'W') },
    { tag: GPS.Longitude, type: 5, count: 3, data: rat(degreesToDms(lon)) },
  ];
  // GPSTimeStamp and GPSDateStamp describe the moment of the satellite fix,
  // not the moment the user clicks. Writing "now" into them would be a lie
  // recorded in the file, so they are left alone.
  if (accuracyMetres && accuracyMetres > 0) {
    fields.push({
      tag: GPS.HPositioningError,
      type: 5,
      count: 1,
      data: rat([[Math.round(accuracyMetres), 1]]),
    });
  }
  return fields.sort((a, b) => a.tag - b.tag); // TIFF 6.0 exige l'ordre croissant
}

/**
 * In-place write (P1): succeeds only if every targeted field already exists in
 * the GPS IFD with the right type and count. That is the only case where
 * nothing else can move, and so the only route open to containers that tolerate
 * no length change.
 *
 * Returns `null` when the in-place write is impossible; it is up to the caller
 * to decide whether the format allows the P2 route.
 */
export function ecrirePositionSurPlace(
  view: TiffView,
  lat: number,
  lon: number,
  accuracyMetres?: number,
): Edit | null {
  const fields = buildGpsFields(lat, lon, view.endian, accuracyMetres);
  const gps = view.gpsIfd;
  if (!gps) return null;
  const plan: Array<{ entry: Entry; field: GpsField }> = [];
  for (const field of fields) {
    if (field.tag === GPS.HPositioningError || field.tag === GPS.VersionID) continue;
    const entry = gps.entries.find((x) => x.tag === field.tag);
    if (!entry) return null;
    if (entry.type !== field.type || entry.count !== field.count) return null;
    if (entry.valueLength !== field.data.length) return null;
    plan.push({ entry, field });
  }
  if (plan.length < 4) return null;

  const out = new Uint8Array(view.bytes);
  const changed: Array<[number, number]> = [];
  for (const { entry, field } of plan) {
    if (entry.valueOffset === null) {
      out.set(field.data, entry.entryOffset + 8);
      changed.push([entry.entryOffset + 8, entry.entryOffset + 8 + field.data.length]);
    } else {
      if (entry.valueOffset + field.data.length > out.length) return null;
      out.set(field.data, entry.valueOffset);
      changed.push([entry.valueOffset, entry.valueOffset + field.data.length]);
    }
  }
  return { bytes: out, route: 'P1', changed };
}

/**
 * Writing by copying IFD0 to the end of the block (P2).
 *
 * Nothing is inserted in the middle of the TIFF block: the new IFD0, the new
 * GPS IFD and its values are appended at the end, then the TIFF header is
 * repointed at the new IFD0. Value offsets are absolute from the start of the
 * block, so everything that existed, MakerNote included, stays valid without
 * being moved. The old IFD0 becomes dead space nothing references.
 *
 * The block grows, so this route is only open to containers where no structure
 * depends on the block's length or on what follows it.
 */
export function ecrirePositionParAjout(
  view: TiffView,
  lat: number,
  lon: number,
  accuracyMetres?: number,
): Edit {
  const fields = buildGpsFields(lat, lon, view.endian, accuracyMetres);
  const e = view.endian;
  const old = view.bytes;
  const base = old.length + (old.length % 2); // alignement pair

  const gpsOutline = fields.filter((f) => f.data.length > 4);

  const oldEntries = view.ifd0.entries;
  const hasGpsEntry = oldEntries.some((x) => x.tag === TAG_GPS_IFD);
  const newIfd0Count = hasGpsEntry ? oldEntries.length : oldEntries.length + 1;

  const ifd0Size = 2 + newIfd0Count * 12 + 4;
  const gpsIfdOffset = base + ifd0Size;
  const gpsIfdSize = 2 + fields.length * 12 + 4;
  let cursor = gpsIfdOffset + gpsIfdSize;
  const outlinePos = new Map<number, number>();
  for (const f of gpsOutline) {
    outlinePos.set(f.tag, cursor);
    cursor += f.data.length + (f.data.length % 2);
  }

  const out = new Uint8Array(cursor);
  out.set(old, 0);

  // New IFD0
  writeU16(out, base, newIfd0Count, e);
  let w = base + 2;
  const sorted = [...oldEntries].sort((a, b) => a.tag - b.tag);
  let wroteGps = false;
  const writeGpsEntry = () => {
    writeU16(out, w, TAG_GPS_IFD, e);
    writeU16(out, w + 2, 4, e);
    writeU32(out, w + 4, 1, e);
    writeU32(out, w + 8, gpsIfdOffset, e);
    w += 12;
    wroteGps = true;
  };
  for (const en of sorted) {
    if (!wroteGps && en.tag > TAG_GPS_IFD) writeGpsEntry();
    if (en.tag === TAG_GPS_IFD) {
      writeGpsEntry();
      continue;
    }
    out.set(old.subarray(en.entryOffset, en.entryOffset + 12), w);
    w += 12;
  }
  if (!wroteGps) writeGpsEntry();
  // The link to the next IFD is only copied if it leads somewhere. A real file
  // can carry a pointer that does not resolve: the one in
  // `sampleWithExifData.png` targets byte 169 of a 171-byte block. While the
  // block ends there no reader follows it; once the block grows, that pointer
  // would suddenly become reachable and lead into arbitrary data. Preserving a
  // link we cannot validate turns a dormant inconsistency into a damaged file.
  writeU32(out, base + 2 + newIfd0Count * 12, view.ifd1 ? view.ifd0.next : 0, e);

  // GPS IFD
  writeU16(out, gpsIfdOffset, fields.length, e);
  let g = gpsIfdOffset + 2;
  for (const f of fields) {
    writeU16(out, g, f.tag, e);
    writeU16(out, g + 2, f.type, e);
    writeU32(out, g + 4, f.count, e);
    if (f.data.length <= 4) {
      out.set(f.data, g + 8);
    } else {
      const pos = outlinePos.get(f.tag)!;
      writeU32(out, g + 8, pos, e);
      out.set(f.data, pos);
    }
    g += 12;
  }
  writeU32(out, gpsIfdOffset + 2 + fields.length * 12, 0, e);

  // Repoint the header
  writeU32(out, 4, base, e);

  return { bytes: out, route: 'P2', changed: [[4, 8], [base, cursor]] };
}

/** Writes a location into a TIFF block, choosing the safest route. */
export function writePositionInTiff(
  view: TiffView,
  lat: number,
  lon: number,
  accuracyMetres?: number,
): Edit {
  return (
    ecrirePositionSurPlace(view, lat, lon, accuracyMetres) ??
    ecrirePositionParAjout(view, lat, lon, accuracyMetres)
  );
}

/** Minimal TIFF block, for a file with no metadata at all. */
export function emptyTiff(endian: Endian = 'LE'): Uint8Array {
  const b = new Uint8Array(8 + 2 + 4);
  if (endian === 'LE') {
    b[0] = 0x49;
    b[1] = 0x49;
  } else {
    b[0] = 0x4d;
    b[1] = 0x4d;
  }
  writeU16(b, 2, 42, endian);
  writeU32(b, 4, 8, endian);
  writeU16(b, 8, 0, endian); // IFD0 vide
  writeU32(b, 10, 0, endian); // pas d'IFD suivant
  return b;
}
