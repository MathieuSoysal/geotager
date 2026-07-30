/**
 * The sitemap.
 *
 * `robots.txt` announced it from the start with nothing producing it: the file
 * answered 404. With two languages it stops being a detail, since it is what
 * tells an engine the two pages are two versions of the same thing rather than
 * duplicate content.
 *
 * Derived from `LANGUES`: adding a language adds it here without anyone
 * thinking about it.
 *
 * On what a sitemap is worth here, so nobody expects too much: Google's
 * documentation says you do not need one below roughly five hundred pages when
 * they link to each other, which is exactly our case. It is kept because it
 * costs nothing and is already announced, not because it earns anything.
 */
import { execFileSync } from 'node:child_process';
import type { APIRoute } from 'astro';
import { DICOS, LANGUES } from '../lib/i18n/index.ts';
import type { Langue } from '../lib/i18n/types.ts';

/**
 * The files that actually carry a page's content, per language.
 *
 * The shell and the dictionary are part of it: a sentence changed in either
 * changes the page as much as a paragraph of the article.
 */
const SOURCES: Record<Langue, string[]> = {
  en: ['src/pages/index.astro', 'src/components/Page.astro', 'src/lib/i18n/en.ts'],
  fr: ['src/pages/fr/index.astro', 'src/components/Page.astro', 'src/lib/i18n/fr.ts'],
};

/**
 * The date this page last really changed, asked of the history.
 *
 * Google only reads `lastmod` if it is "consistently and verifiably accurate",
 * verifiable for instance by comparing it against the page's last modification.
 * A build timestamp would change on every deployment without a line having
 * moved: a false date, discarded by the engine and misleading to us.
 *
 * So we ask what knows. And if nobody can answer, on a shallow clone or a build
 * image without git, the tag is not written. An absence is honest; an invented
 * date is not.
 *
 * `changefreq` and `priority` are absent for a simpler reason still: "Google
 * ignores <priority> and <changefreq> values." Writing them would suggest a
 * freshness signal that does not exist.
 */
function derniereMaj(chemins: string[]): string | null {
  try {
    const sortie = execFileSync('git', ['log', '-1', '--format=%cs', '--', ...chemins], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(sortie) ? sortie : null;
  } catch {
    return null;
  }
}

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

  const urls = LANGUES.map((l) => {
    const alternates = LANGUES.map(
      (a) =>
        `    <xhtml:link rel="alternate" hreflang="${a}" href="${racine}${DICOS[a].base}"/>`,
    ).join('\n');
    const maj = derniereMaj(SOURCES[l]);
    return `  <url>
    <loc>${racine}${DICOS[l].base}</loc>
${alternates}
    <xhtml:link rel="alternate" hreflang="x-default" href="${racine}${DICOS.en.base}"/>${
      maj ? `\n    <lastmod>${maj}</lastmod>` : ''
    }
  </url>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;

  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
