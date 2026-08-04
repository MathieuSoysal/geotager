/**
 * The command line's sentences.
 *
 * The engine returns a code; the interface picks the words. That is already the
 * rule on the site, where `src/lib/i18n/` carries the same keys in two
 * languages and the engine never writes a displayed word, and the command line
 * is a third interface, not an exception.
 *
 * Without this table it returned the engine's messages as they were, in French,
 * inside JSON whose every other key is English. The bug breaks nothing and
 * throws nothing: it simply hands `"message": "Opération non permise sur ce
 * fichier."` to a program, often a model, which will copy it verbatim to
 * somebody who cannot read it.
 *
 * The `code` never changes: that is what a caller should test, and the
 * documentation says so. This table only adds words to it.
 */

/**
 * English message by code. Taken word for word from `src/lib/i18n/en.ts` where
 * the sentence already existed: the command line and the site must say the same
 * thing about the same refusal, or the same tool contradicts itself depending
 * on which door you come in by.
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
 * The sentence for a code, or the engine's own as a fallback.
 *
 * The fallback is not an oversight: a code this table does not know is one the
 * engine has learned to throw since, and returning its sentence, even in
 * French, beats returning an empty message or a generic one that would erase
 * what the engine had precise to say.
 */
export function phrase(code: string, secours: string): string {
  return PHRASES[code] ?? secours;
}
