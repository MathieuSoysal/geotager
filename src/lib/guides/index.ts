/**
 * Les guides, et les adresses qu'ils occupent.
 *
 * Ce module est la SEULE source d'adresses des guides. Le sommaire, le plan du
 * site, les liens croisés d'un guide à l'autre, les `hreflang` réciproques et
 * les contrôles de build lisent tous d'ici. Une adresse recopiée ailleurs
 * serait une occasion de plus qu'un canonique, un lien interne et un plan du
 * site se contredisent — et un moteur qui reçoit des signaux contradictoires
 * ne tranche pas en notre faveur : il les ignore et choisit lui-même.
 *
 * C'est la leçon de Q-046, appliquée avant d'avoir à la réapprendre : l'adresse
 * du site était recopiée trois fois, et c'était trois occasions de se
 * contredire.
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

/** L'adresse du sommaire, dans une langue. Toujours terminée par « / ». */
export function cheminSommaire(langue: Langue): string {
  return `${DICOS[langue].base}${GUIDES[langue].sommaire.segment}/`;
}

/** L'adresse d'un guide, dans une langue. Toujours terminée par « / ». */
export function cheminGuide(langue: Langue, id: IdGuide): string {
  return `${cheminSommaire(langue)}${GUIDES[langue].fiches[id].segment}/`;
}

/**
 * Les adresses d'une même page dans toutes les langues.
 *
 * Chaque page annonce TOUTES les langues, elle-même comprise, sans quoi Google
 * ignore la déclaration. C'est aussi ce que le plan du site répète, et le
 * contrôle de build compare les deux listes.
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
 * Le fichier qui porte la prose d'une page, déduit de son adresse.
 *
 * L'invariant tient parce que le routage d'Astro est le système de fichiers :
 * `/guides/change-photo-location/` ne peut venir que de
 * `src/pages/guides/change-photo-location/index.astro`. Le plan du site s'en
 * sert pour demander à l'historique la date du dernier changement RÉEL de
 * chaque page — la seule que Google accepte de lire, parce qu'elle est
 * vérifiable.
 */
export function fichierSommaire(langue: Langue): string {
  return `src/pages${cheminSommaire(langue)}index.astro`;
}

export function fichierGuide(langue: Langue, id: IdGuide): string {
  return `src/pages${cheminGuide(langue, id)}index.astro`;
}

/**
 * Les fichiers qui portent RÉELLEMENT le contenu d'une page.
 *
 * La coquille et le dictionnaire des guides en font partie : une phrase
 * changée dans l'un ou l'autre change la page tout autant qu'un paragraphe de
 * l'article. Cette liste sert deux fois — au `lastmod` du plan du site et à la
 * `dateModified` que la page déclare — et il faut qu'elle soit LA MÊME : deux
 * dates qui divergent sur le même document sont deux signaux contradictoires,
 * qu'un moteur écarte plutôt que d'arbitrer.
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
