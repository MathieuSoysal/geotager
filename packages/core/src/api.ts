/**
 * The package's public facade.
 *
 * Everything below speaks the repository's vocabulary: `lirePosition`,
 * `ecrirePosition`, `sonder`. This module speaks the npm ecosystem's, and that
 * is deliberate: a published package is read by people, and by agents, who will
 * never open `conteneurs.ts`. The names here are the ones you can guess without
 * documentation (`readGps`, `setGps`, `stripGps`), and `lng` rather than `lon`,
 * because that is what web maps write.
 *
 * Two principles govern this boundary:
 *
 *   1. Bytes in, bytes out, never a path. Nothing here opens a file. This
 *      module behaves identically in Node, in a browser, in a Worker and in an
 *      edge function, because it has no idea where its bytes came from.
 *   2. Throw rather than return a doubtful file. The engine only produces a
 *      file once it has proved, on the produced bytes, that the operation took
 *      place and that nothing else moved. Without that proof the original is
 *      returned intact, which at function level means throwing. A caller who
 *      would rather decide has `applyGps`, which returns the refusal instead.
 */

import { appliquer, lire, sonder } from './moteur.ts';
import { type Motif, capacitesDe } from './capacites.ts';
import { readAltitude, parseTiff } from './tiff.ts';
import { conteneurDe } from './conteneurs.ts';
import { GeotagError } from './erreurs.ts';
import type { Format, PhotoRead, WriteResult } from './types.ts';

// Input

/**
 * The bytes of a file, in any of the usual shapes.
 *
 * `Buffer`, what `fs.readFile` returns, is a `Uint8Array` and so needs no
 * special mention. `ArrayBufferView` covers windowed views, whose offset is
 * respected rather than ignored.
 */
export type ImageInput = Uint8Array | ArrayBuffer | ArrayBufferView;

/** A location, as the rest of the web writes it. */
export interface GpsCoordinates {
  lat: number;
  lng: number;
  /** Metres, positive above sea level. Absent if the file carries none. */
  alt?: number;
}

/** A location to write. `lon` is accepted as a synonym for `lng`. */
export interface GpsInput {
  lat: number;
  lng?: number;
  lon?: number;
  alt?: number;
}

export interface WriteOptions {
  /**
   * Precision of the gesture that picked the location, in metres.
   *
   * Recorded in `GPSHPositioningError`. Only set it if it was measured: an
   * invented number in this field is worse than its absence.
   */
  accuracyMetres?: number;
}

function octets(input: ImageInput): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new GeotagError(
    'ENTREE_INVALIDE',
    'Expected image bytes: a Uint8Array, Buffer, ArrayBuffer or ArrayBufferView.',
  );
}

/** The longitude, whichever name it was passed under. */
function longitudeDe(gps: GpsInput): number {
  const v = gps.lng ?? gps.lon;
  if (typeof v !== 'number') {
    throw new GeotagError('ENTREE_INVALIDE', 'Missing longitude: pass either `lng` or `lon`.');
  }
  return v;
}

function valider(lat: number, lng: number, alt?: number): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new GeotagError('ENTREE_INVALIDE', 'Latitude and longitude must be finite numbers.');
  }
  if (Math.abs(lat) > 90) {
    throw new GeotagError('ENTREE_INVALIDE', `Latitude out of range: ${lat} (expected -90..90).`);
  }
  if (Math.abs(lng) > 180) {
    throw new GeotagError('ENTREE_INVALIDE', `Longitude out of range: ${lng} (expected -180..180).`);
  }
  if (alt !== undefined && !Number.isFinite(alt)) {
    throw new GeotagError('ENTREE_INVALIDE', 'Altitude must be a finite number of metres.');
  }
  /*
   * The point (0, 0), refused on input rather than at the end of verification.
   *
   * Our reader rejects this pair by name: it is the trace of software that
   * purged the coordinates without removing the entries, and announcing the
   * Gulf of Guinea for a file with no location is the one lie this tool cannot
   * afford. Writing it would produce a file the tool itself would call
   * locationless, and the refusal did happen, twelve steps later, under a "the
   * location read back does not match" that blames the encoder instead of
   * naming the real reason.
   *
   * Refusing it here costs one comparison and yields a usable message. The test
   * is exact equality: 0.00001° is a place off Ghana, and whoever writes it
   * knows what they are doing.
   */
  if (lat === 0 && lng === 0) {
    throw new GeotagError(
      'ENTREE_INVALIDE',
      'Refusing to write exactly 0, 0: this tool reads that pair as "no location" — ' +
        'it is what software leaves behind after wiping coordinates without removing the ' +
        'fields — so the file would come back reporting no location at all. ' +
        'Use stripGps() to remove a location, or pass real coordinates.',
    );
  }
}

// Reading

/**
 * The location recorded in a file, or `null`.
 *
 * Synchronous, and answered by our engine alone. `null` is a real answer and
 * the only honest one when the file carries nothing: this package never
 * invents a fallback location. Two cases return `null` where a naive reader
 * would announce a position: a zero denominator, which a Galaxy S10 writes
 * without a fix, and latitude and longitude both exactly zero, left behind by
 * software that purged the coordinates without removing the entries. The Gulf
 * of Guinea is nobody's location.
 *
 * For files whose block our engine cannot locate, `readMetadata` additionally
 * consults a second reader, and sometimes finds a location where this returns
 * `null`.
 */
export function readGps(input: ImageInput): GpsCoordinates | null {
  const bytes = octets(input);
  const sonde = sonder(bytes);
  if (!sonde.position) return null;

  const out: GpsCoordinates = { lat: sonde.position.lat, lng: sonde.position.lon };
  for (const bloc of sonde.blocs) {
    const alt = readAltitude(bloc.vue);
    if (alt !== null) {
      out.alt = alt;
      break;
    }
  }
  return out;
}

/** Everything the file says about itself, second reader included. */
export interface Metadata {
  /** Format recognised from the leading bytes alone, never from the extension. */
  format: Format;
  size: number;
  gps: GpsCoordinates | null;
  takenAt: string | null;
  camera: string | null;
  /**
   * What the tool can do with this file, not with its format.
   *
   * The distinction is the whole value of the field: on an iPhone photo
   * `replaceLocation` is true and `addLocation` false, because replacing a
   * location already written does not change the file length and creating one
   * does.
   */
  can: {
    read: boolean;
    /** Replace a location that is already there. */
    replaceLocation: boolean;
    /** Create one where there is none. */
    addLocation: boolean;
    removeLocation: boolean;
    removeAllMetadata: boolean;
  };
  /** Why the tool can or cannot act. A stable key, not a sentence. */
  reason: Motif;
  details: Array<{ key: string; value: string }>;
}

/** Reads everything a file says about itself. */
export async function readMetadata(input: ImageInput): Promise<Metadata> {
  const bytes = octets(input);
  const brut: PhotoRead = await lire('', '', bytes);
  const sonde = sonder(bytes);

  const gps: GpsCoordinates | null = brut.position
    ? { lat: brut.position.lat, lng: brut.position.lon }
    : null;
  if (gps && brut.altitude !== null) gps.alt = brut.altitude;

  return {
    format: brut.format,
    size: brut.size,
    gps,
    takenAt: brut.takenAt,
    camera: brut.camera,
    can: {
      read: sonde.capacites.lire,
      replaceLocation: sonde.capacites.corriger,
      addLocation: sonde.capacites.ajouter,
      removeLocation: sonde.capacites.effacer,
      removeAllMetadata: sonde.capacites.effacerTout,
    },
    reason: brut.motif,
    details: brut.details.map((d) => ({ key: d.cle, value: d.value })),
  };
}

/** The format of a file, recognised from its leading bytes alone. */
export function detectFormat(input: ImageInput): Format {
  return sonder(octets(input)).format;
}

/**
 * What the tool can do with this file, using the same probe that will write.
 *
 * Worth asking before acting when processing a batch: it says, file by file,
 * what will succeed. It is the same function the engine uses, so the
 * announcement and the behaviour cannot diverge.
 */
export function inspect(input: ImageInput): {
  format: Format;
  reason: Motif;
  hasGps: boolean;
  can: Metadata['can'];
} {
  const sonde = sonder(octets(input));
  return {
    format: sonde.format,
    reason: sonde.motif,
    hasGps: sonde.position !== null,
    can: {
      read: sonde.capacites.lire,
      replaceLocation: sonde.capacites.corriger,
      addLocation: sonde.capacites.ajouter,
      removeLocation: sonde.capacites.effacer,
      removeAllMetadata: sonde.capacites.effacerTout,
    },
  };
}

// Writing

/** The detailed result of an operation, refusals included. */
export type ApplyResult =
  | {
      ok: true;
      bytes: Uint8Array;
      /** `P1`: no byte moved. `P2`: the file grew at the end of the block. */
      route: 'P1' | 'P2';
      /** The location read back from the produced file, never the requested one. */
      verified: GpsCoordinates | null;
      /** Distance between the requested and the read-back location, in metres. */
      driftMetres: number;
      sameLength: boolean;
    }
  | { ok: false; code: string; message: string; reason?: Motif };

/** The requested operation, in the facade's vocabulary. */
export type Operation =
  | { kind: 'set'; lat: number; lng: number; alt?: number; accuracyMetres?: number }
  | { kind: 'strip' }
  | { kind: 'stripAll' };

/**
 * Applies an operation and returns the refusal instead of throwing it.
 *
 * This is the route to take for a batch: a refused file does not interrupt the
 * others, and the refusal code is usable (`FORMAT_NON_MODIFIABLE`,
 * `COPIE_DU_LIEU_SUBSISTE`, `AJOUT_IMPOSSIBLE`). `setGps` and `stripGps` are
 * this function plus a `throw`.
 */
export async function applyGps(input: ImageInput, operation: Operation): Promise<ApplyResult> {
  const bytes = octets(input);

  let interne;
  if (operation.kind === 'set') {
    valider(operation.lat, operation.lng, operation.alt);
    interne = {
      kind: 'set' as const,
      position: { lat: operation.lat, lon: operation.lng },
      accuracyMetres: operation.accuracyMetres,
      altitudeMetres: operation.alt,
    };
  } else {
    interne = { kind: operation.kind === 'strip' ? ('erase' as const) : ('eraseAll' as const) };
  }

  const r: WriteResult = await appliquer('', '', bytes, interne);
  if (!r.ok) return { ok: false, code: r.code, message: r.message, reason: r.motif };

  const verified: GpsCoordinates | null = r.verified
    ? { lat: r.verified.lat, lng: r.verified.lon }
    : null;
  if (verified) {
    const alt = altitudeDe(r.bytes);
    if (alt !== null) verified.alt = alt;
  }
  return {
    ok: true,
    bytes: r.bytes,
    route: r.route,
    verified,
    driftMetres: r.driftMetres,
    sameLength: r.sameLength,
  };
}

function altitudeDe(bytes: Uint8Array): number | null {
  try {
    const c = conteneurDe(bytes);
    if (!c) return null;
    for (const e of c.localiser(bytes)) {
      try {
        const v = readAltitude(parseTiff(e.tiff));
        if (v !== null) return v;
      } catch {
        /* unreadable block */
      }
    }
  } catch {
    /* unreadable structure */
  }
  return null;
}

function lever(r: Extract<ApplyResult, { ok: false }>): never {
  throw new GeotagError(r.code, r.message, r.reason);
}

/**
 * Writes a location and returns the bytes of the produced file.
 *
 * The original is never modified: new bytes come out. The produced file is
 * identical to the input everywhere outside the location itself, checked byte
 * by byte before returning, and any discrepancy throws. A MakerNote, an ICC
 * profile and a thumbnail therefore cross the operation intact.
 *
 * `alt` is only written if passed, and throws if the file cannot carry it,
 * rather than returning a file where it is silently missing.
 */
export async function setGps(
  input: ImageInput,
  gps: GpsInput,
  options: WriteOptions = {},
): Promise<Uint8Array> {
  const r = await applyGps(input, {
    kind: 'set',
    lat: gps.lat,
    lng: longitudeDe(gps),
    alt: gps.alt,
    accuracyMetres: options.accuracyMetres,
  });
  return r.ok ? r.bytes : lever(r);
}

/**
 * Removes the location and nothing else: date, device and settings remain.
 *
 * The removal covers every place the file stores it, not just the main one: a
 * HEIC carries a second attached to its thumbnail, a video carries several at
 * once. When a copy survives in a form the engine cannot remove, it throws
 * rather than return a file that would look clean.
 */
export async function stripGps(input: ImageInput): Promise<Uint8Array> {
  const r = await applyGps(input, { kind: 'strip' });
  return r.ok ? r.bytes : lever(r);
}

/**
 * Removes all information, not just the location, without re-encoding the
 * image: the pixels come out bit for bit.
 *
 * Not every format allows it; `inspect().can.removeAllMetadata` says so before
 * you try.
 */
export async function stripAllMetadata(input: ImageInput): Promise<Uint8Array> {
  const r = await applyGps(input, { kind: 'stripAll' });
  return r.ok ? r.bytes : lever(r);
}

/** What the tool can do with a format, regardless of the file received. */
export function formatCapabilities(format: Format) {
  const c = capacitesDe(format);
  return {
    read: c.lire,
    replaceLocation: c.corriger,
    addLocation: c.ajouter,
    removeLocation: c.effacer,
    removeAllMetadata: c.effacerTout,
  };
}
