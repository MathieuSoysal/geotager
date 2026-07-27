/// <reference lib="webworker" />
/**
 * Metadata worker.
 *
 * All the binary work lives here: the main thread only passes bytes and
 * receives results. No network request is made from this file, and none ever
 * will be, which is checkable in the public repository.
 */
import exifr from 'exifr';
import {
  readGpsFromJpeg,
  writeGpsToJpeg,
  deleteGpsFromJpeg,
  stripAllMetadata,
  ExifError,
} from '../lib/exif/jpeg.ts';
import { distanceMetres } from '../lib/exif/coords.ts';
import type {
  Format,
  FromWorker,
  LatLon,
  PhotoRead,
  ToWorker,
  WriteResult,
} from '../lib/exif/types.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function detectFormat(b: Uint8Array): Format {
  const a = (...codes: number[]) => codes.every((c, i) => b[i] === c);
  if (a(0xff, 0xd8, 0xff)) return 'jpeg';
  if (a(0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (a(0x47, 0x49, 0x46)) return 'gif';
  if (a(0x49, 0x49, 0x2a, 0x00) || a(0x4d, 0x4d, 0x00, 0x2a)) return 'tiff';
  if (b.length > 12 && a(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45) return 'webp';
  if (b.length > 12) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    const box = String.fromCharCode(b[4], b[5], b[6], b[7]);
    if (box === 'ftyp') {
      if (/^(heic|heix|hevc|mif1|msf1|heim|heis)/.test(brand)) return 'heic';
      if (/^avif|avis/.test(brand)) return 'avif';
      if (/^(qt|mp4|isom|M4V|3gp)/.test(brand)) return 'video';
    }
  }
  return 'inconnu';
}

/**
 * What the tool can do with a given format, and the sentence announcing it.
 *
 * The interface announces the route before the action. A write we cannot
 * deliver is never promised.
 */
function capsOf(format: Format): { can: PhotoRead['can']; routeReason: string } {
  if (format === 'jpeg') {
    return {
      can: { read: true, write: true, erase: true },
      routeReason: "La position sera écrite dans le fichier, sans retoucher l'image.",
    };
  }
  if (format === 'video') {
    return {
      can: { read: true, write: false, erase: false },
      routeReason:
        "Nous savons lire le lieu d'une vidéo, mais pas encore le retirer de façon sûre — une vidéo le range à plusieurs endroits.",
    };
  }
  if (format === 'inconnu') {
    return {
      can: { read: false, write: false, erase: false },
      routeReason: 'Nous ne reconnaissons pas ce type de fichier.',
    };
  }
  return {
    can: { read: true, write: false, erase: false },
    routeReason:
      "Nous savons lire la position de ce fichier, mais pas encore la modifier sans risquer de l'abîmer.",
  };
}

function texteDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.valueOf())) return v.toISOString();
  if (typeof v === 'string' && v.trim()) return v;
  return null;
}

async function lire(id: string, name: string, buffer: ArrayBuffer): Promise<PhotoRead> {
  const bytes = new Uint8Array(buffer);
  const format = detectFormat(bytes);
  const { can, routeReason } = capsOf(format);

  let position: LatLon | null = null;
  let altitude: number | null = null;
  let takenAt: string | null = null;
  let camera: string | null = null;
  const details: Array<{ label: string; value: string }> = [];

  // On JPEG we read with our own engine: it is the one that will write, so it
  // is the one that must say what it sees.
  if (format === 'jpeg') {
    try {
      position = readGpsFromJpeg(bytes);
    } catch {
      position = null;
    }
  }

  try {
    const tags = (await exifr.parse(buffer, {
      tiff: true,
      exif: true,
      gps: true,
      ifd0: true,
      translateValues: true,
      reviveValues: true,
    })) as Record<string, unknown> | undefined;

    if (tags) {
      if (!position && typeof tags.latitude === 'number' && typeof tags.longitude === 'number') {
        position = { lat: tags.latitude, lon: tags.longitude };
      }
      if (typeof tags.GPSAltitude === 'number') altitude = tags.GPSAltitude;
      takenAt = texteDate(tags.DateTimeOriginal ?? tags.CreateDate ?? tags.ModifyDate);
      const make = typeof tags.Make === 'string' ? tags.Make.trim() : '';
      const model = typeof tags.Model === 'string' ? tags.Model.trim() : '';
      camera = [make, model].filter(Boolean).join(' ') || null;

      const interessants: Array<[string, string]> = [
        ['Orientation', 'Orientation'],
        ['ExposureTime', "Temps de pose"],
        ['FNumber', 'Ouverture'],
        ['ISO', 'Sensibilité'],
        ['FocalLength', 'Focale'],
        ['LensModel', 'Objectif'],
        ['Software', 'Logiciel'],
        ['Artist', 'Auteur'],
        ['Copyright', 'Copyright'],
      ];
      for (const [cle, label] of interessants) {
        const v = tags[cle];
        if (v !== undefined && v !== null && String(v).trim()) {
          details.push({ label, value: String(v) });
        }
      }
    }
  } catch {
    // exifr fails on files with no metadata: that is not an error.
  }

  return {
    id,
    name,
    size: bytes.length,
    format,
    can,
    routeReason,
    position,
    altitude,
    takenAt,
    camera,
    details,
  };
}

/**
 * Post-write verification, non-negotiable.
 *
 * The produced file is read back and the position compared with the one
 * requested. A discrepancy or an absence fails the operation and returns the
 * original intact: on a metadata tool, silent failure is the worst mode,
 * because the user publishes believing they have cleaned.
 */
async function verifier(
  bytes: Uint8Array,
  attendu: LatLon | null,
): Promise<{ verified: LatLon | null; drift: number; croise: boolean }> {
  const parNous = (() => {
    try {
      return readGpsFromJpeg(bytes);
    } catch {
      return null;
    }
  })();

  // Cross-check by an independent engine. Two symmetrically wrong
  // implementations would pass a self-read-back with no discrepancy.
  let parExifr: LatLon | null = null;
  try {
    const t = (await exifr.gps(bytes.slice().buffer)) as
      | { latitude: number; longitude: number }
      | undefined;
    if (t && Number.isFinite(t.latitude)) parExifr = { lat: t.latitude, lon: t.longitude };
  } catch {
    parExifr = null;
  }

  const croise =
    (parNous === null && parExifr === null) ||
    (parNous !== null && parExifr !== null && distanceMetres(parNous, parExifr) < 1);

  if (attendu === null) {
    return { verified: parNous, drift: parNous === null ? 0 : Infinity, croise };
  }
  if (!parNous) return { verified: null, drift: Infinity, croise };
  return { verified: parNous, drift: distanceMetres(parNous, attendu), croise };
}

async function appliquer(
  id: string,
  name: string,
  buffer: ArrayBuffer,
  operation: Extract<ToWorker, { type: 'apply' }>['operation'],
): Promise<WriteResult> {
  const bytes = new Uint8Array(buffer);
  const format = detectFormat(bytes);
  const { can } = capsOf(format);

  const echec = (code: string, message: string): WriteResult => ({
    ok: false,
    id,
    name,
    code,
    message,
  });

  if (format !== 'jpeg' || !can.write) {
    return echec(
      'FORMAT_NON_MODIFIABLE',
      "Ce format n'est pas encore modifiable. Votre fichier n'a pas été touché.",
    );
  }

  try {
    let produit: { bytes: Uint8Array; route: 'P1' | 'P2'; sameLength: boolean };
    let attendu: LatLon | null = null;

    if (operation.kind === 'set') {
      produit = writeGpsToJpeg(
        bytes,
        operation.position.lat,
        operation.position.lon,
        operation.accuracyMetres,
      );
      attendu = operation.position;
    } else if (operation.kind === 'erase') {
      produit = deleteGpsFromJpeg(bytes);
    } else {
      produit = stripAllMetadata(bytes);
    }

    const { verified, drift, croise } = await verifier(produit.bytes, attendu);

    // One metre of tolerance. EXIF coordinates are stored as
    // degrees/minutes/seconds rationals, and the conversion loses a little
    // precision. Beyond a metre it is no longer rounding, it is an encoding bug.
    if (attendu && drift > 1) {
      return echec(
        'VERIFICATION_ECHOUEE',
        "La position relue dans le fichier produit ne correspond pas à celle demandée. Nous préférons vous rendre l'original intact.",
      );
    }
    if (!attendu && verified !== null) {
      return echec(
        'VERIFICATION_ECHOUEE',
        "Une position subsiste dans le fichier produit. Nous préférons vous rendre l'original intact.",
      );
    }
    if (!croise) {
      return echec(
        'RELECTURE_CROISEE_DIVERGENTE',
        "Deux lecteurs indépendants ne lisent pas la même chose dans le fichier produit. Nous préférons vous rendre l'original intact.",
      );
    }

    return {
      ok: true,
      id,
      name,
      bytes: produit.bytes,
      route: produit.route,
      verified,
      driftMetres: attendu ? drift : 0,
      sameLength: produit.sameLength,
    };
  } catch (e) {
    if (e instanceof ExifError) return echec(e.code, e.message);
    return echec('ERREUR_INATTENDUE', "Ce fichier n'a pas pu être traité. Il n'a pas été modifié.");
  }
}

ctx.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  void (async () => {
    if (msg.type === 'read') {
      try {
        const payload = await lire(msg.id, msg.name, msg.buffer);
        post({ type: 'read:ok', payload });
      } catch (e) {
        const err = e instanceof ExifError ? e : null;
        post({
          type: 'read:fail',
          id: msg.id,
          name: msg.name,
          code: err?.code ?? 'ERREUR_INATTENDUE',
          message: err?.message ?? "Ce fichier n'a pas pu être lu.",
        });
      }
      return;
    }
    if (msg.type === 'apply') {
      const payload = await appliquer(msg.id, msg.name, msg.buffer, msg.operation);
      if (payload.ok) {
        post({ type: 'apply:done', payload }, [payload.bytes.buffer]);
      } else {
        post({ type: 'apply:done', payload });
      }
    }
  })();
});

function post(message: FromWorker, transfer: Transferable[] = []): void {
  ctx.postMessage(message, transfer);
}
