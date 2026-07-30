/**
 * The guides, and the addresses they occupy.
 *
 * This module is the only source of guide addresses. The contents page, the
 * sitemap, the cross-links between guides, the reciprocal `hreflang` and the
 * build checks all read from here. An address copied elsewhere would be one
 * more chance for a canonical, an internal link and a sitemap to contradict
 * each other, and a search engine given contradictory signals does not settle
 * in our favour: it ignores them and chooses for itself.
 */
import type { Langue } from '../i18n/types.ts';
import { DICOS, LANGUES } from '../i18n/index.ts';
import type { Guides, IdGuide } from './types.ts';
import { ORDRE_GUIDES } from './types.ts';
import { guidesEn } from './en.ts';
import { guidesFr } from './fr.ts';

export type { FicheGuide, Guides, IdGuide, SommaireGuides } from './types.ts';
export { ORDRE_GUIDES };

export const GUIDES: Record<Langue, Guides> = { en: guidesEn, fr: guidesFr };

/** The contents page address, in one language. Always ends in a slash. */
export function cheminSommaire(langue: Langue): string {
  return `${DICOS[langue].base}${GUIDES[langue].sommaire.segment}/`;
}

/** A guide's address, in one language. Always ends in a slash. */
export function cheminGuide(langue: Langue, id: IdGuide): string {
  return `${cheminSommaire(langue)}${GUIDES[langue].fiches[id].segment}/`;
}

/**
 * The addresses of one page in every language.
 *
 * Each page announces every language, itself included, without which Google
 * ignores the declaration. The sitemap repeats the same list, and the build
 * check compares the two.
 */
export function alternatesGuide(id: IdGuide): Record<Langue, string> {
  return Object.fromEntries(LANGUES.map((l) => [l, cheminGuide(l, id)])) as Record<
    Langue,
    string
  >;
}

export function alternatesSommaire(): Record<Langue, string> {
  return Object.fromEntries(LANGUES.map((l) => [l, cheminSommaire(l)])) as Record<
    Langue,
    string
  >;
}

/**
 * The file carrying a page's prose, derived from its address.
 *
 * The invariant holds because Astro's routing is the file system:
 * `/guides/change-photo-location/` can only come from
 * `src/pages/guides/change-photo-location/index.astro`. The sitemap uses it to
 * ask the history for the date of each page's last real change, the only one
 * Google will read, because it is verifiable.
 */
export function fichierSommaire(langue: Langue): string {
  return `src/pages${cheminSommaire(langue)}index.astro`;
}

export function fichierGuide(langue: Langue, id: IdGuide): string {
  return `src/pages${cheminGuide(langue, id)}index.astro`;
}

/**
 * The files that actually carry a page's content.
 *
 * The shell and the guide dictionary are part of it: a sentence changed in
 * either changes the page as much as a paragraph of the article. This list
 * serves twice, for the sitemap's `lastmod` and for the `dateModified` the page
 * declares, and it must be the same both times: two dates diverging on one
 * document are two contradictory signals, which an engine discards rather than
 * arbitrates.
 */
const COQUILLES = ['src/components/Tete.astro', 'src/components/Pied.astro'];

export function sourcesGuide(langue: Langue, id: IdGuide): string[] {
  return [
    fichierGuide(langue, id),
    'src/components/Guide.astro',
    ...COQUILLES,
    `src/lib/guides/${langue}.ts`,
  ];
}

export function sourcesSommaire(langue: Langue): string[] {
  return [
    fichierSommaire(langue),
    'src/components/Sommaire.astro',
    ...COQUILLES,
    `src/lib/guides/${langue}.ts`,
  ];
}
