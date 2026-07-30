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
import { type Capacites, type Motif, capacitesDe } from '../lib/exif/capacites.ts';
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
 * The options passed to `exifr`, and why they need a cast.
 *
 * `exifr` accepts `ifd0: true`, as its own README documents, yet its
 * `index.d.ts` declares `ifd0?: FormatOptions` where the eleven neighbouring
 * blocks accept `FormatOptions | boolean`. The author's comment on that line,
 * "cannot be disabled", explains the oversight: the boolean was excluded with
 * `false` in mind, which excludes `true` too. The declaration contradicts the
 * library's documentation, not our call.
 *
 * So the type is corrected without touching the value passed. Replacing `true`
 * with `{}` would silence the checker by changing what we ask the metadata
 * reader for, and this file is not where behaviour is modified to please a type.
 *
 * The double cast is the narrowest tool available: `exifr` does not export its
 * `Options` interface, so it cannot be augmented or fixed field by field from
 * here. The cast is concentrated on these two constants rather than spread over
 * the call sites, so if the library fixes its declaration there are two lines
 * to delete and the checker will say which.
 */
type OptionsExifr = NonNullable<Parameters<typeof exifr.parse>[1]>;

/** Full read: location, date, device, and the details displayed. */
const OPTIONS_COMPLETES = {
  tiff: true,
  exif: true,
  gps: true,
  ifd0: true,
  translateValues: true,
  reviveValues: true,
} as unknown as OptionsExifr;

/** Simple opening question: can the second reader read this file? */
const OPTIONS_OUVERTURE = { tiff: true, ifd0: true } as unknown as OptionsExifr;

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
}

function sonder(bytes: Uint8Array): Sonde {
  const format = detecterFormat(bytes);
  const statiques = capacitesDe(format);
  const vide = { format, conteneur: null, blocs: [], position: null };

  if (format === 'inconnu') {
    return { ...vide, capacites: statiques, motif: 'inconnu' };
  }
  if (format === 'video') {
    return { ...vide, capacites: statiques, motif: 'video' };
  }

  const conteneur = conteneurDe(bytes);
  // A format the table gives as read-only, or for which no container is
  // written yet, stops here: the sentence says so without jargon.
  if (!conteneur || !(statiques.corriger || statiques.ajouter || statiques.effacer)) {
    const motif: Motif = format === 'gif' ? 'sans-lieu-possible' : 'lecture-seule';
    return { ...vide, capacites: { ...statiques, corriger: false, ajouter: false, effacer: false },
      motif };
  }

  let blocs: BlocLu[] = [];
  try {
    blocs = lireBlocs(conteneur, bytes);
  } catch {
    // A file whose structure is unreadable is not modifiable; it stays
    // readable by other means, through the other reader.
    return { ...vide, conteneur, capacites: { ...statiques, corriger: false, ajouter: false, effacer: false },
      motif: 'rangement-inconnu' };
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

  return { format, conteneur, blocs, position, capacites, motif };
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
  const details: Array<{ cle: string; value: string }> = [];

  try {
    const tags = (await exifr.parse(buffer, OPTIONS_COMPLETES)) as
      | Record<string, unknown>
      | undefined;

    if (tags) {
      if (!position && typeof tags.latitude === 'number' && typeof tags.longitude === 'number') {
        position = { lat: tags.latitude, lon: tags.longitude };
      }
      if (typeof tags.GPSAltitude === 'number') altitude = tags.GPSAltitude;
      takenAt = texteDate(tags.DateTimeOriginal ?? tags.CreateDate ?? tags.ModifyDate);
      const make = typeof tags.Make === 'string' ? tags.Make.trim() : '';
      const model = typeof tags.Model === 'string' ? tags.Model.trim() : '';
      camera = [make, model].filter(Boolean).join(' ') || null;

      // Keys, not labels: the interface translates them into its language.
      const interessants = [
        'Orientation', 'ExposureTime', 'FNumber', 'ISO', 'FocalLength',
        'LensModel', 'Software', 'Artist', 'Copyright',
      ];
      for (const cle of interessants) {
        const v = tags[cle];
        if (v !== undefined && v !== null && String(v).trim()) {
          details.push({ cle, value: String(v) });
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
    motif: sonde.motif,
    position,
    altitude,
    takenAt,
    camera,
    details,
  };
}

/**
 * Post-write verification, non-negotiable, in three stages.
 *
 * Reading back with our own code is structurally blind to the most dangerous
 * class of bug: an encoder and a decoder that are symmetrically wrong pass with
 * a discrepancy of exactly zero. A second reader, written by somebody else, is
 * therefore required.
 *
 * Except that second reader does not know every format (it ignores WebP) and
 * refuses some files for reasons unrelated to us. Hence three stages:
 *
 *   A. our own read-back, starting from the produced bytes and relocating the
 *      block from scratch: had the structure been damaged, nothing would be
 *      found;
 *   B. the second reader on the extracted block. A location block is a valid
 *      TIFF file on its own, and the second reader accepts it as is. That is
 *      exactly the layer where a byte-order bug lives, so it is the stage that
 *      counts. It is required on every format;
 *   C. the second reader on the whole file, under a symmetry rule: if it could
 *      open the input, it must be able to open the output and agree. If it
 *      could not open the input, its silence on the output proves nothing and
 *      is not a failure.
 *
 * That rule is exact by construction on the formats where we touch neither the
 * header, nor the item location table, nor any length: the second reader's
 * ability to handle the file is invariant under our operation there.
 */

/** What the second reader finds in a file, or in a bare block. */
async function gpsParExifr(octets: Uint8Array): Promise<LatLon | null> {
  try {
    const t = (await exifr.gps(octets.slice().buffer)) as
      | { latitude: number; longitude: number }
      | undefined;
    if (t && Number.isFinite(t.latitude) && Number.isFinite(t.longitude)) {
      return { lat: t.latitude, lon: t.longitude };
    }
  } catch {
    /* the second reader cannot open this file */
  }
  return null;
}

/** True if the second reader can open this file, location or not. */
async function exifrSaitOuvrir(octets: Uint8Array): Promise<boolean> {
  try {
    const t = await exifr.parse(octets.slice().buffer, OPTIONS_OUVERTURE);
    return t != null;
  } catch {
    return false;
  }
}

/** The file's first location block, as found again afterwards. */
function blocNu(octets: Uint8Array): Uint8Array | null {
  try {
    const c = conteneurDe(octets);
    if (!c) return null;
    const e = c.localiser(octets)[0];
    return e ? e.tiff : null;
  } catch {
    return null;
  }
}

const accord = (a: LatLon | null, b: LatLon | null): boolean =>
  (a === null && b === null) || (a !== null && b !== null && distanceMetres(a, b) < 1);

async function verifier(
  original: Uint8Array,
  produit: Uint8Array,
  attendu: LatLon | null,
): Promise<{ verified: LatLon | null; drift: number; croise: boolean; croiseComplet: boolean }> {
  // A: our read-back, structure relocated from the first byte.
  const parNous = (() => {
    try {
      const c = conteneurDe(produit);
      return c ? lirePosition(c, produit) : null;
    } catch {
      return null;
    }
  })();

  // B: the second reader on the extracted block. Required everywhere.
  const bloc = blocNu(produit);
  const parBloc = bloc ? await gpsParExifr(bloc) : null;
  const croiseBloc = bloc === null ? parNous === null : accord(parNous, parBloc);

  // C: the second reader on the whole file, subject to symmetry.
  const temoin = await exifrSaitOuvrir(original);
  const parFichier = temoin ? await gpsParExifr(produit) : null;
  const croiseFichier = !temoin || accord(parNous, parFichier);

  const croise = croiseBloc && croiseFichier;

  if (attendu === null) {
    return { verified: parNous, drift: parNous === null ? 0 : Infinity, croise, croiseComplet: temoin };
  }
  if (!parNous) return { verified: null, drift: Infinity, croise, croiseComplet: temoin };
  return { verified: parNous, drift: distanceMetres(parNous, attendu), croise, croiseComplet: temoin };
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

  const echec = (code: string, message: string, motif?: Motif): WriteResult => ({
    ok: false,
    id,
    name,
    code,
    message,
    motif,
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

  // The refusal reuses the reason already announced before the action: what
  // the user read and what they get cannot contradict, whatever language they
  // read it in.
  if (!permise || !conteneur) {
    return echec('FORMAT_NON_MODIFIABLE', 'Opération non permise sur ce fichier.', sonde.motif);
  }

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

    const { verified, drift, croise } = await verifier(bytes, produit.bytes, attendu);

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
