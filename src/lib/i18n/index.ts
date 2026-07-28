/**
 * Choix de la langue, et rien d'autre.
 *
 * L'anglais est la langue par défaut : il est servi à la racine. Le français a
 * son propre chemin. C'est l'attribut `lang` du document — écrit au build, donc
 * jamais deviné à l'exécution — qui dit à l'interface quels mots employer.
 */
import type { Dictionnaire, Langue } from './types.ts';
import { en } from './en.ts';
import { fr } from './fr.ts';

export type { Dictionnaire, Langue, CodeErreur } from './types.ts';
export { en, fr };

export const DICOS: Record<Langue, Dictionnaire> = { en, fr };

/** La langue par défaut, celle servie à la racine. */
export const LANGUE_PAR_DEFAUT: Langue = 'en';

/** Toutes les langues servies, pour le plan du site et les liens réciproques. */
export const LANGUES: Langue[] = ['en', 'fr'];

/**
 * Le dictionnaire de la page en cours.
 *
 * On lit l'attribut `lang` du document plutôt que la langue du navigateur :
 * la page a déjà été choisie, et changer les mots sous les yeux de quelqu'un
 * qui a cliqué sur « Français » serait le contraire d'un service.
 */
export function dicoDuDocument(): Dictionnaire {
  const lang = document.documentElement.lang as Langue;
  return DICOS[lang] ?? DICOS[LANGUE_PAR_DEFAUT];
}
