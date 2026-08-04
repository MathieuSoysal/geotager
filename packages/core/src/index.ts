/**
 * @geotager/core: read, write and remove the location of a photo or video,
 * byte for byte, in Node and in the browser.
 *
 * Importing this module registers the containers, via the `import
 * './formats.ts'` in `moteur.ts`. That is deliberate: the public facade cannot
 * work without it, and requiring callers to add a second import would only
 * produce a package that works in development, where something else already
 * loaded the formats, and reports "unknown format" once isolated.
 *
 * The subpath exports exist for the opposite reason. `@geotager/core/coords`
 * and `@geotager/core/capabilities` are pure: importing them does not pull in
 * the binary engine. That is what lets the web app use the coordinate helpers
 * on its main thread without shipping the container surgery, which lives in
 * its worker.
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
 * `GeotagError` is what the facade throws. `ExifError` is what the engine
 * throws, and it still surfaces through `lire`, so the worker must recognise it.
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
 * Internals, for callers that need them.
 *
 * `sonder` and `appliquer` are what the app's worker calls. They are not
 * hidden, but they speak the repository's vocabulary rather than the
 * ecosystem's: their names and shapes may change where the facade's will not.
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
