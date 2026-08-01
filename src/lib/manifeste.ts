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
import { DICOS, LANGUES } from './i18n/index.ts';
import { TYPES_PAR_FORMAT, capacitesDe } from './exif/capacites.ts';
import type { Format } from './exif/types.ts';

/**
 * Les types que « Ouvrir avec » propose, dérivés du tableau.
 *
 * Écrits à la main, ils dérivaient : c'est le test qui rattrapait l'oubli, dans
 * les deux sens. Ils se lisent maintenant de la même table que celle dont
 * l'interface tire le type du fichier PRODUIT, si bien qu'un format ouvert à
 * l'ajout ne peut plus manquer ici, ni y figurer sans savoir recevoir un lieu.
 */
function typesOuvrables(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [format, entree] of Object.entries(TYPES_PAR_FORMAT)) {
    if (!capacitesDe(format as Format).ajouter) continue;
    for (const type of entree.types) {
      out[type] = entree.extensions.filter(
        (e) => entree.types.length === 1 || estExtensionDe(type, e),
      );
    }
  }
  return out;
}

/** Quelle extension va avec quel type, quand un format en porte plusieurs. */
function estExtensionDe(type: string, ext: string): boolean {
  if (type === 'video/quicktime') return ext === '.mov';
  if (type === 'video/mp4') return ext === '.mp4' || ext === '.m4v';
  if (type === 'image/heif') return ext === '.heif';
  if (type === 'image/heic') return ext === '.heic';
  return true;
}

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
       * Se désigner soi-même, pour que la page puisse DEMANDER au navigateur si
       * l'application est déjà installée au lieu de le déduire de son silence.
       * Voir `getInstalledRelatedApps` dans `ui/app.ts`.
       *
       * Les DEUX manifestes sont listés, et ce n'est pas de la symétrie
       * décorative : une installation retient l'adresse du manifeste par lequel
       * elle s'est faite. Installée depuis « /fr/ », elle ne serait pas reconnue
       * par une page anglaise qui n'annoncerait que le sien.
       *
       * `prefer_related_applications` reste ABSENT, et doit le rester : à
       * « true », le critère d'installabilité cesse d'être rempli, plus aucune
       * invitation n'est émise, et le bouton d'installation disparaît partout
       * sans un mot. Le contrôle de build refuse son retour.
       */
      related_applications: LANGUES.map((l) => ({
        platform: 'webapp',
        url: `${DICOS[l].base}manifest.webmanifest`,
      })),

      /*
       * Recevoir une photo depuis le partage du système.
       *
       * `POST` en `multipart/form-data` : c'est la seule forme que l'API
       * accepte pour des fichiers. Il n'y a pourtant aucun serveur pour la
       * recevoir — c'est le service worker qui l'intercepte, garde les octets
       * EN MÉMOIRE, et les passe à la page qui suit. Rien n'est écrit sur le
       * disque, pas même le temps d'un aller-retour : voir `sw-modele.js`.
       *
       * Les vidéos y figurent depuis que les quatre cases de leur ligne sont
       * ouvertes. Elles n'y étaient pas tant qu'aucune opération ne leur était
       * offerte : s'inscrire au menu de partage d'un format qu'on ne sait pas
       * traiter, c'est se proposer pour un travail qu'on ne sait pas faire, à
       * quelqu'un qui ne l'a pas demandé.
       *
       * `image/*` reste, et n'a pas d'équivalent en face : le partage doit
       * rester STRICTEMENT plus large que « Ouvrir avec », pour la raison
       * expliquée plus bas.
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
                'video/quicktime',
                'video/mp4',
              ],
            },
          ],
        },
      },

      /*
       * Quelle fenêtre reçoit un « Ouvrir avec ».
       *
       * `launch_handler.client_mode` est le membre NORMALISÉ, et c'est lui qui
       * décide. Le `launch_type` des débuts du File Handling, écrit ici jusqu'à
       * la V1.4, ne disait la même chose que dans un navigateur et rien ne le
       * lisait ailleurs : la promesse « une seule fenêtre reçoit tout le lot »
       * était donc écrite sans être tenue. Deux déclarations qui peuvent se
       * contredire ne valent pas mieux qu'une seule ; on ne garde que celle-ci.
       *
       * `focus-existing` : la fenêtre déjà ouverte reçoit le lot SANS être
       * renavigée. C'est ce qui lui laisse les photos qu'elle tenait déjà — un
       * rechargement les effacerait, et personne n'a demandé cela.
       */
      launch_handler: { client_mode: 'focus-existing' },

      /*
       * « Ouvrir avec ». Plus simple que le partage : le système remet
       * directement une poignée de fichier, sans requête, sans corps de
       * formulaire, donc sans rien à garder entre deux instants. Le lot
       * s'AJOUTE à ce que la fenêtre tenait déjà — voir `charger` dans
       * `ui/app.ts`.
       *
       * Les mêmes formats que le partage, à deux absences près. Un GIF n'a
       * nulle part où mettre un lieu — le moteur le range en
       * « sans-lieu-possible » — et un fichier brut d'appareil, DNG, NEF ou
       * CR2, ne doit rien recevoir du tout. S'inscrire pour eux serait se
       * proposer pour un travail qu'on ne sait pas faire, à quelqu'un qui ne
       * l'a pas demandé.
       *
       * Les vidéos y sont entrées avec leur colonne « ajouter ». Le test
       * l'exige dans les DEUX SENS : un format à qui le tableau sait donner un
       * lieu et qui manquerait ici resterait invisible du menu « Ouvrir avec »
       * du système, sans que rien ne le signale.
       */
      file_handlers: [{ action: T.base, accept: typesOuvrables() }],
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
