/**
 * Le plan du site.
 *
 * `robots.txt` l'annonçait depuis le début sans que rien ne le produise : le
 * fichier renvoyait 404. Avec deux langues, il cesse d'être un détail — c'est
 * lui qui dit à un moteur que les deux pages sont deux versions de la même
 * chose, et non un contenu dupliqué. Avec les guides, il en dit autant de
 * quatorze pages de plus.
 *
 * Rien n'y est écrit à la main : les adresses viennent de `LANGUES` et du
 * registre des guides, si bien qu'ajouter une langue ou un guide l'ajoute ici
 * sans qu'on y pense. Le contrôle de build compare de toute façon l'ensemble
 * annoncé à l'ensemble RÉELLEMENT produit — en trop, on demande d'indexer ce
 * qui n'existe pas ; en moins, on cache une page à un moteur sans l'avoir
 * décidé.
 *
 * Sur ce qu'un plan de site vaut ici, pour que personne n'en attende trop : la
 * documentation de Google dit qu'on n'en a pas besoin en dessous d'environ cinq
 * cents pages quand elles sont reliées entre elles, ce qui est exactement notre
 * cas. On le garde parce qu'il ne coûte rien et qu'il est déjà annoncé, pas
 * parce qu'il rapporte quelque chose.
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
 * Les fichiers qui portent RÉELLEMENT le contenu de la page de l'outil.
 *
 * La coquille et le dictionnaire en font partie : une phrase changée dans l'un
 * ou l'autre change la page tout autant qu'un paragraphe de l'article. Les
 * coquilles du `<head>` et du pied de page aussi, depuis qu'elles ont été
 * sorties de `Page.astro` — les oublier ferait dire au plan du site qu'une
 * page n'a pas bougé le jour où son canonique change.
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
  /** Le chemin, depuis la racine du site, terminé par « / ». */
  chemin: string;
  /** Le même document dans chaque langue. */
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

  const urls = pages
    .map((p) => {
      const alternates = LANGUES.map(
        (a) => `    <xhtml:link rel="alternate" hreflang="${a}" href="${racine}${p.jumeaux[a]}"/>`,
      ).join('\n');
      /*
       * `changefreq` et `priority` sont absents pour une raison simple :
       * « Google ignores <priority> and <changefreq> values. » Les écrire
       * laisserait croire à un signal de fraîcheur qui n'existe pas.
       *
       * `lastmod` est la seule des trois qui compte, et seulement s'il est
       * « consistently and verifiably accurate ». Il vient de l'historique ;
       * si personne ne peut répondre, la balise n'est pas écrite.
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
