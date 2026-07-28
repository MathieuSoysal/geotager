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
 */
import type { APIRoute } from 'astro';
import { DICOS, LANGUES } from '../lib/i18n/index.ts';

const SITE = 'https://geotager.app';

export const GET: APIRoute = () => {
  const urls = LANGUES.map((l) => {
    const alternates = LANGUES.map(
      (a) =>
        `    <xhtml:link rel="alternate" hreflang="${a}" href="${SITE}${DICOS[a].base}"/>`,
    ).join('\n');
    return `  <url>
    <loc>${SITE}${DICOS[l].base}</loc>
${alternates}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${DICOS.en.base}"/>
    <changefreq>monthly</changefreq>
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
