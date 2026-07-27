/**
 * JPEG container: locate the TIFF block, and put it back.
 *
 * All the EXIF surgery lives in `tiff.ts`. This file knows one thing well:
 * where a JPEG keeps its TIFF block (the APP1 segment whose payload begins
 * with "Exif\0\0") and how to rebuild that segment's header when the block has
 * changed size.
 *
 * Pixels are never re-encoded: the segment walk stops at SOS, and the entropy
 * data is never read.
 */

import { ExifError } from './erreurs.ts';
import {
  parseTiff,
  readPosition,
  deletePositionInTiff,
  writePositionInTiff,
  emptyTiff,
  TAG_GPS_IFD,
} from './tiff.ts';

export interface Segment {
  marker: number;
  /** Start of the 0xFF marker in the file. */
  start: number;
  /** Start of the payload (after marker and length). */
  dataStart: number;
  /** Exclusive end of the payload. */
  dataEnd: number;
}

const EXIF_SIGNATURE = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

// JPEG segments

/**
 * Walks a JPEG's segments up to the start of the compressed data. Stops at SOS
 * (0xDA): beyond it lies the entropy data, which is never touched.
 */
export function parseJpegSegments(bytes: Uint8Array): Segment[] {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new ExifError('PAS_UN_JPEG', "Ce fichier ne commence pas par une signature JPEG.");
  }
  const segments: Segment[] = [];
  let i = 2;
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xff) {
      throw new ExifError('FICHIER_CORROMPU', "La structure du fichier est incohérente.");
    }
    let marker = bytes[i + 1];
    // 0xFF padding bytes are legal between segments.
    while (marker === 0xff && i + 2 < bytes.length) {
      i += 1;
      marker = bytes[i + 1];
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    if (marker === 0xda) break; // début des données compressées
    if (i + 4 > bytes.length) {
      throw new ExifError('FICHIER_TRONQUE', "Le fichier s'arrête au milieu d'un segment.");
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2 || i + 2 + length > bytes.length) {
      throw new ExifError('FICHIER_TRONQUE', "Le fichier s'arrête au milieu d'un segment.");
    }
    segments.push({ marker, start: i, dataStart: i + 4, dataEnd: i + 2 + length });
    i += 2 + length;
  }
  return segments;
}

/** Finds the APP1 segment carrying the EXIF block, if there is one. */
export function findExifSegment(bytes: Uint8Array, segments: Segment[]): Segment | null {
  for (const seg of segments) {
    if (seg.marker !== 0xe1) continue;
    if (seg.dataStart + 6 > bytes.length) continue;
    if (EXIF_SIGNATURE.every((b, k) => bytes[seg.dataStart + k] === b)) return seg;
  }
  return null;
}

// File-level assembly

/** Replaces a JPEG's TIFF block, rebuilding the APP1 segment header. */
function replaceExif(jpeg: Uint8Array, seg: Segment, tiff: Uint8Array): Uint8Array {
  const payload = 6 + tiff.length; // "Exif\0\0" + bloc TIFF
  const segLength = payload + 2;
  if (segLength > 0xffff) {
    throw new ExifError(
      'EXIF_TROP_VOLUMINEUX',
      "Les informations de ce fichier sont déjà à la limite de ce que le format autorise : nous ne pouvons pas y ajouter la position sans risque.",
    );
  }
  const before = jpeg.subarray(0, seg.start);
  const after = jpeg.subarray(seg.dataEnd);
  const out = new Uint8Array(before.length + 4 + payload + after.length);
  out.set(before, 0);
  let p = before.length;
  out[p++] = 0xff;
  out[p++] = 0xe1;
  out[p++] = (segLength >>> 8) & 0xff;
  out[p++] = segLength & 0xff;
  out.set(EXIF_SIGNATURE, p);
  p += 6;
  out.set(tiff, p);
  p += tiff.length;
  out.set(after, p);
  return out;
}

/** Inserts an EXIF APP1 segment into a JPEG that has none. */
function insertExif(jpeg: Uint8Array, tiff: Uint8Array): Uint8Array {
  const payload = 6 + tiff.length;
  const segLength = payload + 2;
  if (segLength > 0xffff) {
    throw new ExifError('EXIF_TROP_VOLUMINEUX', "La position ne tient pas dans ce fichier.");
  }
  // Right after SOI, before everything else: the canonical spot.
  const out = new Uint8Array(jpeg.length + 4 + payload);
  out.set(jpeg.subarray(0, 2), 0);
  let p = 2;
  out[p++] = 0xff;
  out[p++] = 0xe1;
  out[p++] = (segLength >>> 8) & 0xff;
  out[p++] = segLength & 0xff;
  out.set(EXIF_SIGNATURE, p);
  p += 6;
  out.set(tiff, p);
  p += tiff.length;
  out.set(jpeg.subarray(2), p);
  return out;
}

export interface JpegResult {
  bytes: Uint8Array;
  route: 'P1' | 'P2';
  /** True if the output file is exactly the size of the input. */
  sameLength: boolean;
}

/** Removes the GPS location from a JPEG. */
export function deleteGpsFromJpeg(jpeg: Uint8Array): JpegResult {
  const segments = parseJpegSegments(jpeg);
  const seg = findExifSegment(jpeg, segments);
  if (!seg) return { bytes: jpeg, route: 'P1', sameLength: true };
  const tiff = jpeg.subarray(seg.dataStart + 6, seg.dataEnd);
  const view = parseTiff(tiff);
  if (!view.gpsIfd && !view.ifd0.entries.some((x) => x.tag === TAG_GPS_IFD)) {
    return { bytes: jpeg, route: 'P1', sameLength: true };
  }
  const edit = deletePositionInTiff(view);
  // The TIFF block keeps exactly its size, so it can be rewritten in place.
  const out = new Uint8Array(jpeg);
  out.set(edit.bytes, seg.dataStart + 6);
  return { bytes: out, route: 'P1', sameLength: true };
}

/** Writes a GPS location into a JPEG. */
export function writeGpsToJpeg(
  jpeg: Uint8Array,
  lat: number,
  lon: number,
  accuracyMetres?: number,
): JpegResult {
  const segments = parseJpegSegments(jpeg);
  const seg = findExifSegment(jpeg, segments);
  if (!seg) {
    const view = parseTiff(emptyTiff());
    const edit = writePositionInTiff(view, lat, lon, accuracyMetres);
    return { bytes: insertExif(jpeg, edit.bytes), route: 'P2', sameLength: false };
  }
  const tiff = jpeg.subarray(seg.dataStart + 6, seg.dataEnd);
  const view = parseTiff(tiff);
  const edit = writePositionInTiff(view, lat, lon, accuracyMetres);
  if (edit.route === 'P1') {
    const out = new Uint8Array(jpeg);
    out.set(edit.bytes, seg.dataStart + 6);
    return { bytes: out, route: 'P1', sameLength: true };
  }
  return { bytes: replaceExif(jpeg, seg, edit.bytes), route: 'P2', sameLength: false };
}

/**
 * Removes all metadata: every APPn segment and the comment. Image data is left
 * alone.
 */
export function stripAllMetadata(jpeg: Uint8Array): JpegResult {
  const segments = parseJpegSegments(jpeg);
  const drop = segments.filter((s) => (s.marker >= 0xe0 && s.marker <= 0xef) || s.marker === 0xfe);
  if (drop.length === 0) return { bytes: jpeg, route: 'P1', sameLength: true };
  const keep: Array<[number, number]> = [];
  let cursor = 0;
  for (const s of drop) {
    keep.push([cursor, s.start]);
    cursor = s.dataEnd;
  }
  keep.push([cursor, jpeg.length]);
  const total = keep.reduce((n, [a, b]) => n + (b - a), 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const [a, b] of keep) {
    out.set(jpeg.subarray(a, b), p);
    p += b - a;
  }
  return { bytes: out, route: 'P2', sameLength: false };
}

/** Reads a JPEG's location with no external dependency. */
export function readGpsFromJpeg(jpeg: Uint8Array): { lat: number; lon: number } | null {
  const segments = parseJpegSegments(jpeg);
  const seg = findExifSegment(jpeg, segments);
  if (!seg) return null;
  return readPosition(parseTiff(jpeg.subarray(seg.dataStart + 6, seg.dataEnd)));
}
