/**
 * Engine errors.
 *
 * The code is for the program, the message for the user: written without
 * container jargon, and always stating what became of the original file.
 */
export class ExifError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ExifError';
    this.code = code;
  }
}

/**
 * The error seen by callers of the package, as opposed to the engine's own.
 *
 * It carries the same stable `code` plus the `reason` the probe had already
 * established before the operation ran. That second field lets a caller tell
 * "this format cannot do that" from "this particular file will not allow it",
 * even though the refusal code is identical.
 *
 * A distinct class rather than a re-exported `ExifError`, so that `instanceof
 * GeotagError` holds across package boundaries and stack traces name the
 * public facade.
 */
export class GeotagError extends Error {
  code: string;
  reason?: string;
  constructor(code: string, message: string, reason?: string) {
    super(message);
    this.name = 'GeotagError';
    this.code = code;
    this.reason = reason;
  }
}
