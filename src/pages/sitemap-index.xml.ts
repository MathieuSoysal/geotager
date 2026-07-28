/**
 * Le plan du site.
 *
 * `robots.txt` l'annonçait depuis le début sans que rien ne le produise : le
 * fichier renvoyait 404. Avec deux langues, il cesse d'être un détail — c'est
 * lui qui dit à un moteur que les deux pages sont deux versions de la même
 * chose, et non un contenu dupliqué.
 *
 * Dérivé de `LANGUES` : ajouter une langue l'ajoute ici sans qu'on y pense.
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
