/**
 * The sitemap.
 *
 * `robots.txt` announced it from the start with nothing producing it: the file
 * answered 404. With two languages it stops being a detail, since it is what
 * tells an engine the two pages are two versions of the same thing rather than
 * duplicate content. With the guides it says as much about fourteen more pages.
 *
 * Nothing here is written by hand: the addresses come from `LANGUES` and the
 * guide registry, so adding a language or a guide adds it here without anyone
 * thinking about it. The build check compares the announced set against the set
 * actually produced: too many, and we ask for pages that do not exist to be
 * indexed; too few, and we hide a page from an engine without having decided to.
 *
 * On what a sitemap is worth here, so nobody expects too much: Google's
 * documentation says you do not need one below roughly five hundred pages when
 * they link to each other, which is exactly our case. It is kept because it
 * costs nothing and is already announced, not because it earns anything.
 */
import type { APIRoute } from 'astro';
import { DICOS, LANGUES } from '../lib/i18n/index.ts';
import type { Langue } from '../lib/i18n/types.ts';
import {
  ORDRE_GUIDES,
  alternatesGuide,
  alternatesSommaire,
  cheminGuide,
  cheminSommaire,
  sourcesGuide,
  sourcesSommaire,
} from '../lib/guides/index.ts';
import { derniereMaj } from '../lib/histoire.ts';

/**
 * The files that actually carry the tool page's content.
 *
 * The shell and the dictionary are part of it: a sentence changed in either
 * changes the page as much as a paragraph of the article. So are the `<head>`
 * and footer shells, since they were moved out of `Page.astro`; forgetting them
 * would have the sitemap claim a page had not moved on the day its canonical
 * changed.
 */
const SOURCES_OUTIL: Record<Langue, string[]> = {
  en: ['src/pages/index.astro'],
  fr: ['src/pages/fr/index.astro'],
};
const COQUILLE_OUTIL = [
  'src/components/Page.astro',
  'src/components/Tete.astro',
  'src/components/Pied.astro',
];

interface PagePlan {
  /** The path from the site root, ending in a slash. */
  chemin: string;
  /** The same document in each language. */
  jumeaux: Record<Langue, string>;
  sources: string[];
}

const pages: PagePlan[] = [
  ...LANGUES.map((l) => ({
    chemin: DICOS[l].base,
    jumeaux: Object.fromEntries(LANGUES.map((a) => [a, DICOS[a].base])) as Record<Langue, string>,
    sources: [...SOURCES_OUTIL[l], ...COQUILLE_OUTIL, `src/lib/i18n/${l}.ts`],
  })),
  ...LANGUES.map((l) => ({
    chemin: cheminSommaire(l),
    jumeaux: alternatesSommaire(),
    sources: sourcesSommaire(l),
  })),
  ...LANGUES.flatMap((l) =>
    ORDRE_GUIDES.map((id) => ({
      chemin: cheminGuide(l, id),
      jumeaux: alternatesGuide(id),
      sources: sourcesGuide(l, id),
    })),
  ),
];

export const GET: APIRoute = ({ site }) => {
  /*
   * The address comes from `astro.config.mjs`, and from one place only. It used
   * to be copied here and into the shell: three copies of the same string, so
   * three chances for a canonical, an `og:url` and a sitemap to end up
   * contradicting each other. Contradictory signals are signals an engine
   * ignores.
   *
   * If it is absent we would rather fail the build: a sitemap requires absolute
   * addresses, and producing relative ones would ship a file nothing could
   * follow.
   */
  if (!site) throw new Error('sitemap : « site » manque dans astro.config.mjs');
  const racine = site.origin;

  const urls = pages
    .map((p) => {
      const alternates = LANGUES.map(
        (a) => `    <xhtml:link rel="alternate" hreflang="${a}" href="${racine}${p.jumeaux[a]}"/>`,
      ).join('\n');
      /*
       * `changefreq` and `priority` are absent for a simple reason: "Google
       * ignores <priority> and <changefreq> values." Writing them would suggest
       * a freshness signal that does not exist.
       *
       * `lastmod` is the only one of the three that counts, and only if it is
       * "consistently and verifiably accurate". It comes from the history; if
       * nobody can answer, the tag is not written.
       */
      const maj = derniereMaj(p.sources);
      return `  <url>
    <loc>${racine}${p.chemin}</loc>
${alternates}
    <xhtml:link rel="alternate" hreflang="x-default" href="${racine}${p.jumeaux.en}"/>${
      maj ? `\n    <lastmod>${maj}</lastmod>` : ''
    }
  </url>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;

  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
