/**
 * Language selection, and nothing else.
 *
 * English is the default and is served at the root. French has its own path.
 * The document's `lang` attribute, written at build time and so never guessed
 * at runtime, tells the interface which words to use.
 */
import type { Dictionnaire, Langue } from './types.ts';
import { en } from './en.ts';
import { fr } from './fr.ts';

export type { Dictionnaire, Langue, CodeErreur } from './types.ts';
export { en, fr };

export const DICOS: Record<Langue, Dictionnaire> = { en, fr };

/** The default language, the one served at the root. */
export const LANGUE_PAR_DEFAUT: Langue = 'en';

/** Every language served, for the sitemap and the reciprocal links. */
export const LANGUES: Langue[] = ['en', 'fr'];

/**
 * The dictionary for the current page.
 *
 * The document's `lang` attribute is read rather than the browser language: the
 * page has already been chosen, and changing the words under someone who just
 * clicked "Français" would be the opposite of a service.
 */
export function dicoDuDocument(): Dictionnaire {
  const lang = document.documentElement.lang as Langue;
  return DICOS[lang] ?? DICOS[LANGUE_PAR_DEFAUT];
}
