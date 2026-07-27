/**
 * Conteneur JPEG — localiser le bloc TIFF, et le remettre en place.
 *
 * Toute la chirurgie EXIF vit dans `tiff.ts` ; ce fichier ne sait qu'une chose,
 * mais il la sait bien : où un JPEG range son bloc TIFF (le segment APP1 dont
 * la charge utile commence par « Exif\0\0 ») et comment reconstruire l'en-tête
 * de ce segment quand le bloc a changé de taille.
 *
 * On ne réencode jamais les pixels : le parcours des segments s'arrête à SOS,
 * et les données entropiques ne sont jamais lues.
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
  /** Début du marqueur 0xFF dans le fichier. */
  start: number;
  /** Début de la charge utile (après marqueur et longueur). */
  dataStart: number;
  /** Fin exclusive de la charge utile. */
  dataEnd: number;
}

const EXIF_SIGNATURE = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

/* ------------------------------------------------------------------ */
/* Segments JPEG                                                       */
/* ------------------------------------------------------------------ */

/**
 * Parcourt les segments d'un JPEG jusqu'au début des données compressées.
 * S'arrête à SOS (0xDA) : au-delà, ce sont les données entropiques, qu'on ne
 * touche jamais.
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
    // Les 0xFF de bourrage sont légaux entre segments.
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

/** Repère le segment APP1 porteur de l'EXIF, s'il existe. */
export function findExifSegment(bytes: Uint8Array, segments: Segment[]): Segment | null {
  for (const seg of segments) {
    if (seg.marker !== 0xe1) continue;
    if (seg.dataStart + 6 > bytes.length) continue;
    if (EXIF_SIGNATURE.every((b, k) => bytes[seg.dataStart + k] === b)) return seg;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Assemblage au niveau du fichier                                     */
/* ------------------------------------------------------------------ */

/** Remplace le bloc TIFF d'un JPEG, en reconstruisant l'en-tête du segment APP1. */
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

/** Insère un segment APP1 EXIF dans un JPEG qui n'en a aucun. */
function insertExif(jpeg: Uint8Array, tiff: Uint8Array): Uint8Array {
  const payload = 6 + tiff.length;
  const segLength = payload + 2;
  if (segLength > 0xffff) {
    throw new ExifError('EXIF_TROP_VOLUMINEUX', "La position ne tient pas dans ce fichier.");
  }
  // Juste après SOI, avant tout le reste : c'est la place canonique.
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
  /** Vrai si le fichier de sortie a exactement la taille de l'entrée. */
  sameLength: boolean;
}

/** Retire la position GPS d'un JPEG. */
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
  // Le bloc TIFF garde exactement sa taille : on peut réécrire sur place.
  const out = new Uint8Array(jpeg);
  out.set(edit.bytes, seg.dataStart + 6);
  return { bytes: out, route: 'P1', sameLength: true };
}

/** Écrit une position GPS dans un JPEG. */
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
 * Retire l'intégralité des métadonnées : tous les segments APPn et le commentaire.
 * Les données d'image ne sont pas touchées.
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

/** Lit la position d'un JPEG sans dépendance externe. */
export function readGpsFromJpeg(jpeg: Uint8Array): { lat: number; lon: number } | null {
  const segments = parseJpegSegments(jpeg);
  const seg = findExifSegment(jpeg, segments);
  if (!seg) return null;
  return readPosition(parseTiff(jpeg.subarray(seg.dataStart + 6, seg.dataEnd)));
}
