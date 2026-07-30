/**
 * Les données structurées, écrites une fois pour tout le site.
 *
 * CE QUE CELA RAPPORTE, pour que personne n'en attende autre chose. Des trois
 * nœuds ci-dessous : aucun résultat enrichi. Aucune vignette, aucune étoile,
 * rien de visible dans une page de résultats. Le seul gain est que les moteurs
 * — classiques comme génératifs — sachent relier trois choses qu'ils devaient
 * sinon deviner : quelle est l'application, à quel site elle appartient, et qui
 * la publie.
 *
 * C'est aussi pourquoi il n'y a NI `FAQPage` NI `HowTo` nulle part, pas même
 * sur les guides, qui en ont pourtant exactement la forme. `HowTo` est
 * abandonné depuis 2023, et les questions-réponses ont été retirées de la
 * recherche. Écrire un balisage pour un affichage qui n'existe plus, c'est se
 * mentir dans un fichier que personne ne relit. `BreadcrumbList`, ajouté par
 * les guides, échappe à ce reproche pour une raison qui se vérifie d'un coup
 * d'œil : le fil d'Ariane, lui, s'affiche encore.
 *
 * POURQUOI UN MODULE ET NON UN OBJET DANS LA COQUILLE. Les guides référencent
 * l'application, le site et l'éditeur par leur `@id` — c'est tout l'objet d'un
 * graphe — et ces identifiants s'écrivaient jusqu'ici dans la coquille de
 * l'outil. Recopiés, ils auraient fini par diverger, et un `@id` qui ne
 * correspond à rien ne relie rien : le graphe se casse en silence, sans une
 * erreur de console, exactement comme un canonique et un `og:url` qui se
 * contredisent.
 */
import type { Dictionnaire } from './i18n/types.ts';
import { DICOS, LANGUES } from './i18n/index.ts';

/** L'adresse de la page d'une langue — l'outil, pas un guide. */
export const urlOutil = (site: string, T: Dictionnaire) => `${site}${T.base}`;

export const idSite = (site: string) => `${site}/#site`;
export const idEditeur = (site: string) => `${site}/#editeur`;
export const idApplication = (site: string, T: Dictionnaire) =>
  `${urlOutil(site, T)}#application`;

/** Le site lui-même, dans toutes ses langues. */
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

/** Qui publie. */
export function noeudEditeur(site: string) {
  return {
    '@type': 'Organization',
    '@id': idEditeur(site),
    name: 'Geotager',
    url: `${site}/`,
    logo: `${site}/icons/icon-512.png`,
    // Le dépôt est la seule autre adresse où ce projet existe sous son nom.
    // `sameAs` sert à cela et à rien d'autre : dire « c'est la même entité ».
    sameAs: ['https://github.com/MathieuSoysal/geotager'],
  };
}

/** L'outil, dans une langue. */
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
 * Le fil d'Ariane, du site jusqu'à la page courante.
 *
 * Le seul balisage de ce dépôt qui produise quelque chose de VISIBLE dans une
 * page de résultats : Google remplace l'adresse par le chemin nommé. Il est
 * accompagné d'un fil d'Ariane réel dans la page — un balisage qui décrit une
 * navigation absente est un balisage faux, et c'est la première chose que la
 * documentation de Google demande de ne pas faire.
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
