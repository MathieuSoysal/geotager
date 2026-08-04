/**
 * Les phrases de la ligne de commande.
 *
 * Le moteur rend un CODE ; c'est l'interface qui choisit les mots. C'est déjà
 * la règle du site — `src/lib/i18n/` porte les mêmes clés en deux langues, et
 * le moteur n'y écrit jamais un mot affiché — et la ligne de commande est une
 * troisième interface, pas une exception.
 *
 * Sans cette table, elle rendait les messages du moteur tels quels, c'est-à-dire
 * EN FRANÇAIS, dans un JSON dont toutes les autres clés sont anglaises. Le
 * défaut ne casse rien et ne lève rien : il rend simplement `"message":
 * "Opération non permise sur ce fichier."` à un programme, souvent un modèle,
 * qui va le recopier tel quel à quelqu'un qui ne le lit pas.
 *
 * Le `code`, lui, ne change jamais : c'est lui qu'un appelant doit tester, et
 * la documentation le dit. Cette table ne fait que l'accompagner de mots.
 */

/**
 * Message anglais par code. Repris mot pour mot de `src/lib/i18n/en.ts` là où
 * la phrase existait déjà : la ligne de commande et le site doivent dire la
 * même chose du même refus, sinon c'est le même outil qui se contredit selon la
 * porte par laquelle on entre.
 */
const PHRASES: Record<string, string> = {
  AJOUT_IMPOSSIBLE:
    'This file carries no location, and we cannot yet add one without risking damage.',
  ALTITUDE_IMPOSSIBLE:
    'This format stores its location in a form that carries no altitude. The original is untouched.',
  ALTITUDE_NON_ECRITE:
    'The requested altitude could not be written into this file. The original is untouched.',
  COPIE_DU_LIEU_SUBSISTE:
    'A copy of the location survives in this file, in a form we cannot remove. The original is untouched.',
  ECRASERAIT_ORIGINAL:
    'Refusing to write over an input file. Pass --in-place to overwrite originals, or choose a different --out directory.',
  EFFACEMENT_TOTAL_IMPOSSIBLE:
    'We cannot yet remove all the information from this kind of file.',
  ENTREE_INVALIDE: 'The coordinates given are not usable.',
  ERREUR_INATTENDUE: 'This file could not be processed. The original is untouched.',
  EXIF_CORROMPU: 'The information in this file cannot be read.',
  EXIF_TROP_VOLUMINEUX:
    'This file’s information is already at the limit the format allows: the location cannot be added safely.',
  FICHIER_CORROMPU: 'The structure of this file is inconsistent.',
  FICHIER_TRONQUE: 'The file stops in the middle of a section.',
  FORMAT_NON_MODIFIABLE: 'We can read this file, but not yet change it without risking damage.',
  FORMAT_NON_PRIS_EN_CHARGE:
    'This image uses a variant we cannot open yet. It has not been touched.',
  OCTETS_HORS_PLAGE:
    'Bytes would have changed outside what was announced. The operation is cancelled and the original is untouched.',
  PAS_UN_JPEG: 'This file does not start with a JPEG signature.',
  PLAGES_CHEVAUCHANTES:
    'This file has an unusual structure: changing it could damage other information. We would rather not touch it.',
  RELECTURE_CROISEE_DIVERGENTE:
    'Our two readers disagree about the file we produced. The original is untouched.',
  STRUCTURE_INATTENDUE: 'This file has a structure we cannot change safely. It has not been touched.',
  VERIFICATION_ECHOUEE:
    'Reading back the file we produced did not give the expected result. The original is untouched.',
};

/**
 * La phrase d'un code, ou celle du moteur à défaut.
 *
 * Le repli n'est pas un oubli : un code inconnu de cette table est un code que
 * le moteur a appris à lever depuis, et rendre sa phrase — fût-elle en
 * français — vaut mieux que rendre un message vide ou, pire, une phrase
 * générique qui effacerait ce que le moteur avait de précis à dire.
 */
export function phrase(code: string, secours: string): string {
  return PHRASES[code] ?? secours;
}
