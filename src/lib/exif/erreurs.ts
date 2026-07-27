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
