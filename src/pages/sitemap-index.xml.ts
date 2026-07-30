/**
 * Le plan du site.
 *
 * `robots.txt` l'annonçait depuis le début sans que rien ne le produise : le
 * fichier renvoyait 404. Avec deux langues, il cesse d'être un détail — c'est
 * lui qui dit à un moteur que les deux pages sont deux versions de la même
 * chose, et non un contenu dupliqué.
 *
 * Dérivé de `LANGUES` : ajouter une langue l'ajoute ici sans qu'on y pense.
 *
 * Sur ce qu'un plan de site vaut ici, pour que personne n'en attende trop : la
 * documentation de Google dit qu'on n'en a pas besoin en dessous d'environ cinq
 * cents pages quand elles sont reliées entre elles, ce qui est exactement notre
 * cas. On le garde parce qu'il ne coûte rien et qu'il est déjà annoncé, pas
 * parce qu'il rapporte quelque chose.
 */
import { execFileSync } from 'node:child_process';
import type { APIRoute } from 'astro';
import { DICOS, LANGUES } from '../lib/i18n/index.ts';
import type { Langue } from '../lib/i18n/types.ts';

/**
 * Les fichiers qui portent RÉELLEMENT le contenu d'une page, par langue.
 *
 * La coquille et le dictionnaire en font partie : une phrase changée dans l'un
 * ou l'autre change la page tout autant qu'un paragraphe de l'article.
 */
const SOURCES: Record<Langue, string[]> = {
  en: ['src/pages/index.astro', 'src/components/Page.astro', 'src/lib/i18n/en.ts'],
  fr: ['src/pages/fr/index.astro', 'src/components/Page.astro', 'src/lib/i18n/fr.ts'],
};

/**
 * La date du dernier changement réel de cette page, demandée à l'historique.
 *
 * Google ne lit `lastmod` que s'il est « consistently and verifiably accurate »
 * — vérifiable, par exemple, en le comparant à la dernière modification de la
 * page. Un horodatage de build changerait à chaque déploiement sans qu'une
 * ligne ait bougé : ce serait une date fausse, écartée par le moteur et
 * trompeuse pour nous.
 *
 * On demande donc à ce qui SAIT. Et si personne ne peut répondre — clone
 * superficiel, image de build sans git — on n'écrit pas la balise. Une absence
 * est honnête ; une date inventée ne l'est pas.
 *
 * `changefreq` et `priority` sont absents pour une raison plus simple encore :
 * « Google ignores `<priority>` and `<changefreq>` values. » Les écrire
 * laisserait croire à un signal de fraîcheur qui n'existe pas.
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
   * L'adresse vient de `astro.config.mjs`, et d'un seul endroit. Elle était
   * recopiée ici et dans la coquille : trois copies de la même chaîne, donc
   * trois occasions qu'un canonique, un `og:url` et un plan de site finissent
   * par se contredire. Des signaux qui se contredisent sont des signaux
   * qu'un moteur ignore.
   *
   * Absente, on préfère faire échouer la build : un plan de site exige des
   * adresses absolues, et en produire de relatives serait livrer un fichier
   * que rien ne saurait suivre.
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
