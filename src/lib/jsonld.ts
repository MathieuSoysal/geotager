/**
 * Structured data, written once for the whole site.
 *
 * What it buys, so nobody expects more. From the three nodes below: no rich
 * results. No thumbnail, no stars, nothing visible on a results page. The only
 * gain is that engines, classic and generative alike, can connect three things
 * they would otherwise have to guess: which application this is, which site it
 * belongs to, and who publishes it.
 *
 * It is also why there is no `FAQPage` and no `HowTo` anywhere, not even on the
 * guides, which have exactly that shape. `HowTo` was deprecated in 2023 and
 * question-and-answer results were withdrawn from search. Writing markup for a
 * display that no longer exists is lying to yourself in a file nobody re-reads.
 * `BreadcrumbList`, added by the guides, escapes that objection for a reason
 * you can check at a glance: breadcrumbs still display.
 *
 * Why a module and not an object in the shell: the guides reference the
 * application, the site and the publisher by `@id`, which is the whole point of
 * a graph, and those identifiers used to be written in the tool's shell.
 * Copied, they would eventually diverge, and an `@id` matching nothing links
 * nothing: the graph breaks silently, without a console error.
 */
import type { Dictionnaire } from './i18n/types.ts';
import { DICOS, LANGUES } from './i18n/index.ts';

/** The address of a language's page: the tool, not a guide. */
export const urlOutil = (site: string, T: Dictionnaire) => `${site}${T.base}`;

export const idSite = (site: string) => `${site}/#site`;
export const idEditeur = (site: string) => `${site}/#editeur`;
export const idApplication = (site: string, T: Dictionnaire) =>
  `${urlOutil(site, T)}#application`;

/** The site itself, in all its languages. */
export function noeudSite(site: string) {
  return {
    '@type': 'WebSite',
    '@id': idSite(site),
    name: 'Geotager',
    url: `${site}/`,
    inLanguage: LANGUES.map((l) => DICOS[l].htmlLang),
    publisher: { '@id': idEditeur(site) },
  };
}

/** Who publishes. */
export function noeudEditeur(site: string) {
  return {
    '@type': 'Organization',
    '@id': idEditeur(site),
    name: 'Geotager',
    url: `${site}/`,
    logo: `${site}/icons/icon-512.png`,
    // The repository is the only other address where this project exists under
    // its own name. `sameAs` serves that and nothing else: saying "same entity".
    sameAs: ['https://github.com/MathieuSoysal/geotager'],
  };
}

/** The tool, in one language. */
export function noeudApplication(site: string, T: Dictionnaire) {
  return {
    '@type': 'SoftwareApplication',
    '@id': idApplication(site, T),
    name: 'Geotager',
    url: urlOutil(site, T),
    applicationCategory: 'MultimediaApplication',
    applicationSubCategory: T.meta.sousCategorie,
    operatingSystem: T.meta.systeme,
    inLanguage: T.htmlLang,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    featureList: T.meta.fonctions,
    description: T.meta.description,
    isPartOf: { '@id': idSite(site) },
    publisher: { '@id': idEditeur(site) },
  };
}

/**
 * The breadcrumb, from the site down to the current page.
 *
 * The only markup in this repository that produces anything visible on a
 * results page: Google replaces the address with the named path. It is
 * accompanied by a real breadcrumb in the page, since markup describing absent
 * navigation is false markup, and that is the first thing Google's
 * documentation asks you not to do.
 */
export function noeudFilAriane(site: string, etapes: Array<{ nom: string; chemin: string }>) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: etapes.map((e, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: e.nom,
      item: `${site}${e.chemin}`,
    })),
  };
}
