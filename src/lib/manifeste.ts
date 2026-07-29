/**
 * Le manifeste d'application, une fois par langue.
 *
 * Deux URLs, un seul `id`. C'est ce qui permet d'installer l'outil sous son nom
 * français depuis `/fr/` et sous son nom anglais depuis `/` sans que le système
 * y voie deux applications : l'identité d'une installation est `id`, et rien
 * d'autre. Il vaut « / » et il ne changera JAMAIS — le changer orphelinerait
 * toutes les installations existantes, qui ne recevraient plus une seule mise à
 * jour et ne pourraient pas davantage être remplacées.
 *
 * Les mots viennent du dictionnaire, comme partout ailleurs : le manifeste ne
 * réinvente pas une seconde formulation du titre et de la description, qui
 * dériverait de celle du `head` à la première retouche.
 *
 * Toutes les adresses sont RELATIVES à l'origine. Le contrôle de build les
 * exige ainsi, et c'est le seul fichier du site où une icône hébergée ailleurs
 * passerait inaperçue.
 */
import type { Langue } from './i18n/types.ts';
import { DICOS } from './i18n/index.ts';

/** Le fond de l'application : écran de démarrage à froid et barre de titre. */
export const FOND = '#17161b';

export function manifeste(langue: Langue): string {
  const T = DICOS[langue];
  return JSON.stringify(
    {
      id: '/',
      name: T.meta.titre,
      short_name: 'Geotager',
      description: T.meta.description,
      lang: T.htmlLang,
      dir: 'ltr',
      /* La page de cette langue, et la portée commune : une installation
         française reste libre d'atteindre la racine anglaise. */
      start_url: T.base,
      scope: '/',
      display: 'standalone',
      display_override: ['standalone', 'minimal-ui', 'browser'],
      orientation: 'any',
      background_color: FOND,
      theme_color: FOND,
      categories: ['photo', 'utilities', 'productivity'],
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        /* Une entrée SÉPARÉE, et non un `purpose` double sur la même image :
           le système rogne une icône masquable jusqu'à 20 % de chaque côté, et
           la même image servirait alors rognée là où elle ne doit pas l'être. */
        {
          src: '/icons/icon-512-maskable.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
        { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      ],
    },
    null,
    2,
  );
}
