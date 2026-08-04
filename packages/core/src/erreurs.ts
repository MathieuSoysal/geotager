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

/**
 * L'erreur que voit qui utilise le paquet, et pas le moteur.
 *
 * Elle porte le même `code` — stable, destiné au programme — plus le `reason`
 * que la sonde avait déjà établi AVANT l'action. Ce second champ est ce qui
 * permet à un appelant de distinguer « ce format ne sait pas faire ça » de
 * « ce fichier-ci ne le permet pas », alors que le code du refus est le même.
 *
 * Une classe distincte plutôt qu'`ExifError` réexportée : `instanceof
 * GeotagError` doit rester vrai à travers les frontières du paquet, et le nom
 * qui s'affiche dans une trace doit être celui de la façade publique.
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
