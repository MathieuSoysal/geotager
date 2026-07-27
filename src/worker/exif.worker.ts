/// <reference lib="webworker" />
/**
 * Metadata worker.
 *
 * All the binary work lives here: the main thread only passes bytes and
 * receives results. No network request is made from this file, and none ever
 * will be, which is checkable in the public repository.
 */
import exifr from 'exifr';
import '../lib/exif/formats.ts';
import {
  type BlocLu,
  type Conteneur,
  type Ecriture,
  conteneurDe,
  detecterFormat,
  ecrirePosition,
  effacerPosition,
  lireBlocs,
  lirePosition,
  memesOctetsHorsPlages,
  toutEffacer,
} from '../lib/exif/conteneurs.ts';
import { type Capacites, type Motif, capacitesDe, phraseDe } from '../lib/exif/capacites.ts';
import { ecrirePositionSurPlace } from '../lib/exif/tiff.ts';
import { ExifError } from '../lib/exif/erreurs.ts';
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

/**
 * One probe, and only one.
 *
 * `capsOf` used to be called twice with different knowledge: once at read time,
 * once at apply time. Nothing structurally prevented the announcement and the
 * behaviour from diverging, that is, from announcing a write the engine would
 * then refuse. Both now go through here.
 *
 * The interface announces the route before the action. A write we cannot
 * deliver is never promised.
 */
interface Sonde {
  format: Format;
  conteneur: Conteneur | null;
  blocs: BlocLu[];
  position: LatLon | null;
  capacites: Capacites;
  motif: Motif;
  phrase: string;
}

function sonder(bytes: Uint8Array): Sonde {
  const format = detecterFormat(bytes);
  const statiques = capacitesDe(format);
  const vide = { format, conteneur: null, blocs: [], position: null };

  if (format === 'inconnu') {
    return { ...vide, capacites: statiques, motif: 'inconnu', phrase: phraseDe('inconnu') };
  }
  if (format === 'video') {
    return { ...vide, capacites: statiques, motif: 'video', phrase: phraseDe('video') };
  }

  const conteneur = conteneurDe(bytes);
  // A format the table gives as read-only, or for which no container is
  // written yet, stops here: the sentence says so without jargon.
  if (!conteneur || !(statiques.corriger || statiques.ajouter || statiques.effacer)) {
    const motif: Motif = format === 'gif' ? 'sans-lieu-possible' : 'lecture-seule';
    return { ...vide, capacites: { ...statiques, corriger: false, ajouter: false, effacer: false },
      motif, phrase: phraseDe(motif) };
  }

  let blocs: BlocLu[] = [];
  try {
    blocs = lireBlocs(conteneur, bytes);
  } catch {
    // A file whose structure is unreadable is not modifiable; it stays
    // readable by other means, through the other reader.
    return { ...vide, conteneur, capacites: { ...statiques, corriger: false, ajouter: false, effacer: false },
      motif: 'rangement-inconnu', phrase: phraseDe('rangement-inconnu') };
  }

  const position = blocs.find((b) => b.position)?.position ?? null;
  const principal = blocs[0] ?? null;

  // "Correct" requires either that the fields already exist in the right
  // shape, making it a constant-length write, or that the format tolerates
  // growing. On an iPhone photo only the first route exists.
  const surPlace =
    principal !== null &&
    position !== null &&
    ecrirePositionSurPlace(principal.vue, position.lat, position.lon) !== null;

  // A copy of the location elsewhere in the file closes erasing: removing it
  // from the main block would hand back a file the user believes is clean.
  const copieAilleurs = conteneur.copieDuLieuAilleurs?.(bytes) ?? false;

  // Some formats do not settle it at format level: an extended WebP tolerates
  // growing, the simple form does not, and it is the same format.
  const peutGrandir =
    statiques.ajouter && Boolean(conteneur.reconstruire) && (conteneur.accepteAjout?.(bytes) ?? true);

  const capacites: Capacites = {
    lire: statiques.lire,
    corriger: statiques.corriger && (surPlace || peutGrandir) && !copieAilleurs,
    ajouter: peutGrandir && !copieAilleurs,
    effacer: statiques.effacer && !copieAilleurs,
    effacerTout: statiques.effacerTout && !copieAilleurs,
  };

  let motif: Motif;
  if (copieAilleurs) {
    motif = 'copie-ailleurs';
  } else if (position !== null) {
    motif = capacites.corriger ? 'ok' : 'forme-inhabituelle';
  } else if (capacites.ajouter) {
    motif = 'ok';
  } else if (blocs.length === 0 && !statiques.ajouter) {
    motif = 'sans-emplacement';
  } else if (statiques.ajouter) {
    // The format could grow, but not this variant.
    motif = 'sans-lieu-possible';
  } else {
    motif = 'sans-lieu';
  }

  return { format, conteneur, blocs, position, capacites, motif, phrase: phraseDe(motif) };
}

/**
 * Projects the capabilities onto the contract the interface consumes.
 *
 * "Modify" means two things depending on the file: replace a location already
 * there, or create one. The interface has a single input field, and it is only
 * active if the operation the user will actually trigger is within reach on
 * this file.
 */
function projeter(s: Sonde): PhotoRead['can'] {
  return {
    read: s.capacites.lire,
    write: s.position ? s.capacites.corriger : s.capacites.ajouter,
    erase: s.capacites.effacer,
    eraseAll: s.capacites.effacerTout,
  };
}

function texteDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.valueOf())) return v.toISOString();
  if (typeof v === 'string' && v.trim()) return v;
  return null;
}

async function lire(id: string, name: string, buffer: ArrayBuffer): Promise<PhotoRead> {
  const bytes = new Uint8Array(buffer);
  const sonde = sonder(bytes);
  const format = sonde.format;

  // Our engine is what will write, so it is what must say what it sees.
  let position: LatLon | null = sonde.position;
  let altitude: number | null = null;
  let takenAt: string | null = null;
  let camera: string | null = null;
  const details: Array<{ label: string; value: string }> = [];

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
    can: projeter(sonde),
    routeReason: sonde.phrase,
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
      const c = conteneurDe(bytes);
      return c ? lirePosition(c, bytes) : null;
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
  // The received bytes are re-probed rather than trusting the previous read,
  // so announcement and behaviour read the same source.
  const sonde = sonder(bytes);

  const echec = (code: string, message: string): WriteResult => ({
    ok: false,
    id,
    name,
    code,
    message,
  });

  const { capacites, conteneur } = sonde;
  const permise =
    operation.kind === 'set'
      ? sonde.position
        ? capacites.corriger
        : capacites.ajouter
      : operation.kind === 'erase'
        ? capacites.effacer
        : capacites.effacerTout;

  // The refusal repeats the sentence already announced before the action: what
  // the user read and what they get cannot contradict.
  if (!permise || !conteneur) return echec('FORMAT_NON_MODIFIABLE', sonde.phrase);

  try {
    let produit: Ecriture;
    let attendu: LatLon | null = null;

    if (operation.kind === 'set') {
      produit = ecrirePosition(
        conteneur,
        bytes,
        operation.position.lat,
        operation.position.lon,
        operation.accuracyMetres,
      );
      attendu = operation.position;
    } else if (operation.kind === 'erase') {
      produit = effacerPosition(conteneur, bytes);
    } else {
      produit = toutEffacer(conteneur, bytes);
    }

    // "Byte-exact" is not a figure of speech. Comparing sizes proves nothing:
    // a bug that zeroes 200 KB of MakerNote passes it without a word. The
    // produced file is required to be identical to the original everywhere
    // outside the ranges the engine itself declared.
    if (!memesOctetsHorsPlages(bytes, produit.bytes, produit.changed)) {
      return echec(
        'OCTETS_HORS_PLAGE',
        "Le fichier produit diffère de l'original ailleurs qu'à l'endroit de la position. Nous préférons vous rendre l'original intact.",
      );
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
      sameLength: produit.bytes.length === bytes.length,
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
