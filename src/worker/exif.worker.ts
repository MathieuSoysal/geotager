/// <reference lib="webworker" />
/**
 * Worker de métadonnées.
 *
 * Tout le travail binaire vit ici : le thread principal ne fait que passer des
 * octets et recevoir des résultats. Aucune requête réseau n'est émise depuis ce
 * fichier, et il n'en émettra jamais — c'est vérifiable dans le dépôt public.
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

/* ---------------------------------------------------------------- */

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
 * Ce que l'outil sait faire d'un format donné, et la phrase qui l'annonce.
 *
 * L'interface annonce la voie AVANT l'action. On ne promet jamais une écriture
 * qu'on ne sait pas tenir : mieux vaut dire « nous ne savons pas encore » que
 * produire un fichier que l'utilisateur croira nettoyé.
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

  // Sur JPEG on lit avec notre propre moteur : c'est lui qui écrira, donc c'est
  // lui qui doit dire ce qu'il voit.
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
    // exifr échoue sur les fichiers sans métadonnées : ce n'est pas une erreur.
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
 * Vérification après écriture — non négociable.
 *
 * Le fichier produit est relu et la position comparée à celle demandée. Un
 * écart ou une absence fait échouer l'opération et rend l'original intact :
 * sur un outil de métadonnées, l'échec silencieux est le pire mode de
 * défaillance, parce que l'utilisateur publie en croyant avoir nettoyé.
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

  // Relecture croisée par un moteur indépendant. Deux implémentations
  // symétriquement fausses passeraient une auto-relecture sans écart.
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

    // Tolérance de 1 mètre. Les coordonnées EXIF sont stockées en rationnels
    // degrés/minutes/secondes ; la conversion perd un peu de précision. Au-delà
    // d'un mètre, ce n'est plus de l'arrondi, c'est un défaut d'encodage.
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

/* ---------------------------------------------------------------- */

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
