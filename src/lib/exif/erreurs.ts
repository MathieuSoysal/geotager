/**
 * Erreurs du moteur.
 *
 * Le code est destiné au programme, le message à l'utilisateur : il est donc
 * rédigé sans jargon de conteneur, et il dit toujours ce qu'il advient du
 * fichier d'origine. Sur un outil de métadonnées, l'échec silencieux est le
 * pire mode de défaillance — mais un échec incompréhensible n'en est pas loin.
 */
export class ExifError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ExifError';
    this.code = code;
  }
}
