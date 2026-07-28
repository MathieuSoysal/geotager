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
import type { Motif } from './capacites.ts';

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
  /**
   * POURQUOI l'outil peut ou ne peut pas agir sur ce fichier — une clé, pas une
   * phrase. Le moteur ne choisit plus les mots : l'interface les prend dans le
   * dictionnaire de sa langue.
   */
  motif: Motif;
  position: LatLon | null;
  altitude: number | null;
  takenAt: string | null;
  camera: string | null;
  /**
   * Informations lisibles, pour la zone repliée. La CLÉ est un identifiant
   * stable, jamais un libellé : c'est l'interface qui le traduit.
   */
  details: Array<{ cle: string; value: string }>;
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
  /** Message du moteur, en clair. Sert de secours et de trace de journal. */
  message: string;
  /**
   * Renseigné quand le refus était DÉJÀ annoncé avant l'action : l'interface
   * réaffiche alors exactement la phrase que l'utilisateur avait lue, dans sa
   * langue. Ce qu'il a lu et ce qu'il obtient ne peuvent pas se contredire.
   */
  motif?: Motif;
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
