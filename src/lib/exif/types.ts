/** Contracts shared between the interface and the worker. */

export interface LatLon {
  lat: number;
  lon: number;
}

export type Format =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'heic'
  | 'avif'
  | 'tiff'
  | 'gif'
  | 'video'
  | 'inconnu';

/** The route chosen to act on the file, decided at read time. */
export type Route = 'P1' | 'P2' | 'lecture-seule';

export interface PhotoRead {
  id: string;
  name: string;
  size: number;
  format: Format;
  /** What we will be able to do with this file, decided before any action. */
  can: { read: boolean; write: boolean; erase: boolean };
  /** Displayable sentence, without container jargon. */
  routeReason: string;
  position: LatLon | null;
  altitude: number | null;
  takenAt: string | null;
  camera: string | null;
  /** Readable tags, for the collapsed "other information" panel. */
  details: Array<{ label: string; value: string }>;
}

export interface WriteOk {
  ok: true;
  id: string;
  name: string;
  bytes: Uint8Array;
  route: 'P1' | 'P2';
  /** Location actually read back from the produced file. */
  verified: LatLon | null;
  /** Distance between the requested location and the one read back, in metres. */
  driftMetres: number;
  sameLength: boolean;
}

export interface WriteFail {
  ok: false;
  id: string;
  name: string;
  code: string;
  message: string;
}

export type WriteResult = WriteOk | WriteFail;

export type Operation =
  | { kind: 'set'; position: LatLon; accuracyMetres?: number }
  | { kind: 'erase' }
  | { kind: 'eraseAll' };

// Worker messages

export type ToWorker =
  | { type: 'read'; id: string; name: string; buffer: ArrayBuffer }
  | { type: 'apply'; id: string; name: string; buffer: ArrayBuffer; operation: Operation };

export type FromWorker =
  | { type: 'read:ok'; payload: PhotoRead }
  | { type: 'read:fail'; id: string; name: string; code: string; message: string }
  | { type: 'apply:done'; payload: WriteResult };
