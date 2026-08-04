/**
 * @geotager/core — lire, écrire et retirer le lieu d'une photo ou d'une vidéo,
 * à l'octet près, dans Node comme dans un navigateur.
 *
 * Importer ce module ENREGISTRE les conteneurs : c'est l'effet de bord du
 * `import './formats.ts'` que `moteur.ts` porte, et c'est voulu. La façade
 * publique ne peut pas fonctionner sans, et exiger de l'appelant un second
 * import à côté du premier serait un piège — celui où le paquet marche en
 * développement, où quelque chose d'autre a déjà chargé les formats, et rend
 * « format inconnu » une fois isolé.
 *
 * Les sous-chemins existent pour l'inverse. `@geotager/core/coords` et
 * `@geotager/core/capabilities` sont PURS : les importer n'entraîne pas le
 * moteur binaire. C'est ce qui permet à l'application web de se servir des
 * helpers de coordonnées dans son fil principal sans embarquer les quelque
 * quatre mille lignes de chirurgie de conteneurs, qui vivent dans son worker.
 */

export {
  readGps,
  readMetadata,
  setGps,
  stripGps,
  stripAllMetadata,
  applyGps,
  inspect,
  detectFormat,
  formatCapabilities,
} from './api.ts';

export type {
  ApplyResult,
  GpsCoordinates,
  GpsInput,
  ImageInput,
  Metadata,
  Operation,
  WriteOptions,
} from './api.ts';

/**
 * `GeotagError` est ce que lève la façade. `ExifError` est ce que lève le
 * moteur, et il traverse encore `lire` : le worker doit pouvoir le reconnaître.
 */
export { GeotagError, ExifError } from './erreurs.ts';

export {
  parseCoordinates,
  formatDecimal,
  formatDms,
  distanceMetres,
} from './coords.ts';

export type { Format } from './types.ts';
export type { Motif } from './capacites.ts';

/**
 * Les entrailles, pour qui en a besoin.
 *
 * `sonder` et `appliquer` sont ce que le worker de l'application appelle. Ils
 * ne sont pas cachés — ce dépôt est public et le moteur est son objet — mais
 * ils parlent la langue du dépôt, pas celle de l'écosystème : leurs noms et
 * leurs formes peuvent bouger là où ceux de la façade ne bougeront pas.
 */
export { sonder, lire, appliquer } from './moteur.ts';
export type { Sonde } from './moteur.ts';
export type {
  LatLon,
  Operation as EngineOperation,
  PhotoRead,
  WriteResult,
  ToWorker,
  FromWorker,
} from './types.ts';
