/** Contrats partagés entre l'interface et le worker. */

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

/** Voie retenue pour agir sur le fichier, décidée à la lecture. */
export type Route = 'P1' | 'P2' | 'lecture-seule';

export interface PhotoRead {
  id: string;
  name: string;
  size: number;
  format: Format;
  /** Ce qu'on saura faire de ce fichier, décidé avant toute action. */
  /**
   * `write` répond à « l'opération que l'utilisateur va déclencher sur CE
   * fichier est-elle à notre portée ? » — donc corriger s'il porte déjà un
   * lieu, ajouter sinon. `eraseAll` est distinct de `erase` : tout retirer
   * n'existe pas sur tous les formats.
   */
  can: { read: boolean; write: boolean; erase: boolean; eraseAll: boolean };
  /** Phrase affichable, sans jargon de conteneur. */
  routeReason: string;
  position: LatLon | null;
  altitude: number | null;
  takenAt: string | null;
  camera: string | null;
  /** Tags lisibles, pour la zone repliée « autres informations ». */
  details: Array<{ label: string; value: string }>;
}

export interface WriteOk {
  ok: true;
  id: string;
  name: string;
  bytes: Uint8Array;
  route: 'P1' | 'P2';
  /** Position réellement relue dans le fichier produit. */
  verified: LatLon | null;
  /** Écart entre la position demandée et celle relue, en mètres. */
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

/* Messages worker ------------------------------------------------- */

export type ToWorker =
  | { type: 'read'; id: string; name: string; buffer: ArrayBuffer }
  | { type: 'apply'; id: string; name: string; buffer: ArrayBuffer; operation: Operation };

export type FromWorker =
  | { type: 'read:ok'; payload: PhotoRead }
  | { type: 'read:fail'; id: string; name: string; code: string; message: string }
  | { type: 'apply:done'; payload: WriteResult };
