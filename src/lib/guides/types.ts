/**
 * The guide contract: one shape, two fillings.
 *
 * Same discipline as `i18n/types.ts`: this file describes what an entry must
 * carry, and `astro check` fails the build when a language forgets one. An
 * English guide with no French twin would not merely be a missing page: both
 * pages declare their `hreflang` reciprocally, and the build check requires
 * every indexable page to announce every language.
 *
 * What lives here and what does not. Here: what the structure needs, the
 * address, the title, the description, the one-line summary. Those four are
 * read by the contents page, the sitemap, the cross-links and the `<head>`;
 * writing them twice would give them two chances to contradict each other. The
 * prose stays in the page that carries it: it is prose, not labels, and cutting
 * it into keys would make it unreadable to write and to review.
 */

/**
 * A guide's identity, stable across languages.
 *
 * This is what pairs the English and French versions, never the address, which
 * differs on purpose: a French reader searches for "supprimer la
 * géolocalisation d'une photo", not "remove-photo-location". A shared address
 * would be the wrong address in one of the two languages.
 */
export type IdGuide =
  | 'modifier'
  | 'verifier'
  | 'supprimer'
  | 'ajouter'
  | 'iphone'
  | 'reseaux';

/** Display order, shared by both languages. */
export const ORDRE_GUIDES: IdGuide[] = [
  'modifier',
  'verifier',
  'supprimer',
  'ajouter',
  'iphone',
  'reseaux',
];

export interface FicheGuide {
  /**
   * The address segment, in the page's language, without a slash.
   *
   * It is written once and not rewritten: a published address that changes
   * becomes a dead address for everyone who shared it, and this site has no way
   * to redirect one page to another, since the host serves only static files
   * and a single redirect rule, which belongs to incoming shares.
   */
  segment: string;

  /**
   * The body of the `<title>`. The shell appends " — Geotager".
   *
   * The build check caps the rendered title at 60 characters including the
   * suffix, leaving 49 here. The cap is not decorative: past it, an engine cuts
   * the sentence and picks the cut itself.
   */
  titre: string;

  /**
   * The visible title, which is not necessarily the tab title.
   *
   * The `<title>` addresses a results page, where it competes with nine other
   * lines; the `<h1>` addresses someone who has already arrived and wants to
   * know they are in the right place. Conflating them forces a sentence that
   * does both jobs badly.
   */
  h1: string;

  /** The meta description. Capped at 155 characters by the build check. */
  description: string;

  /**
   * One line, two at most, for the contents page and the cross-links.
   *
   * It lives here rather than in the page because it is read outside the page:
   * copying it into every guide that points here would mean committing to fix
   * five copies the day the sentence changes.
   */
  resume: string;
}

/** The page that gathers the guides. */
export interface SommaireGuides {
  /** Address segment of the contents page, under the language root. */
  segment: string;
  titre: string;
  h1: string;
  description: string;
}

export interface Guides {
  sommaire: SommaireGuides;
  fiches: Record<IdGuide, FicheGuide>;
}
