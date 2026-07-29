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

      /*
       * Recevoir une photo depuis le partage du système.
       *
       * `POST` en `multipart/form-data` : c'est la seule forme que l'API
       * accepte pour des fichiers. Il n'y a pourtant aucun serveur pour la
       * recevoir — c'est le service worker qui l'intercepte, garde les octets
       * EN MÉMOIRE, et les passe à la page qui suit. Rien n'est écrit sur le
       * disque, pas même le temps d'un aller-retour : voir `sw-modele.js`.
       *
       * Images seulement. L'outil accepte les vidéos dans le sélecteur — mieux
       * vaut prendre le fichier et expliquer que le refuser sans un mot — mais
       * s'inscrire dans le menu de partage des vidéos serait autre chose : ce
       * serait se proposer pour un travail qu'on ne sait pas faire, à quelqu'un
       * qui ne nous a rien demandé.
       */
      share_target: {
        action: `${T.base}partager`,
        method: 'POST',
        enctype: 'multipart/form-data',
        params: {
          files: [
            {
              name: 'photos',
              accept: [
                'image/*',
                'image/jpeg',
                'image/png',
                'image/webp',
                'image/heic',
                'image/heif',
                'image/avif',
                'image/tiff',
              ],
            },
          ],
        },
      },

      /*
       * « Ouvrir avec ». Plus simple que le partage, et plus propre : le système
       * remet directement une poignée de fichier, sans requête, sans corps de
       * formulaire, donc sans rien à garder entre deux instants.
       *
       * `single-client` : une seule fenêtre reçoit tout le lot, au lieu d'en
       * ouvrir une par photo.
       */
      file_handlers: [
        {
          action: T.base,
          accept: {
            'image/jpeg': ['.jpg', '.jpeg'],
            'image/png': ['.png'],
            'image/webp': ['.webp'],
            'image/heic': ['.heic'],
            'image/heif': ['.heif'],
            'image/avif': ['.avif'],
            'image/tiff': ['.tif', '.tiff'],
          },
          launch_type: 'single-client',
        },
      ],
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
