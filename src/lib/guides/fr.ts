/**
 * Les guides français. La forme est imposée par `types.ts`.
 *
 * Deux plafonds gouvernent les chaînes ci-dessous, et c'est `check-build.mjs`
 * qui les tient, pas la bonne volonté : 49 caractères pour `titre` — la
 * coquille ajoute « — Geotager », et le titre rendu est plafonné à 60 — et
 * 155 pour `description`. Au-delà, un moteur coupe la phrase et choisit
 * lui-même où.
 *
 * Contrairement à l'interface, cette prose a le droit de nommer le format.
 * L'interdiction de jargon de `i18n/fr.ts` protège quelqu'un qui traverse
 * l'outil avec une photo à laquelle il tient ; un guide est lu par quelqu'un
 * qui est venu chercher le mot.
 */
import type { Guides } from './types.ts';

export const guidesFr: Guides = {
  sommaire: {
    segment: 'guides',
    titre: 'Guides sur la géolocalisation des photos',
    h1: 'Guides : le lieu inscrit dans une photo',
    description:
      'Des guides simples pour lire, modifier, ajouter ou supprimer la position GPS enregistrée dans une photo, sur tout appareil et sans envoyer le fichier.',
  },

  fiches: {
    modifier: {
      segment: 'modifier-geolocalisation-photo',
      titre: 'Modifier la géolocalisation d’une photo',
      h1: 'Comment modifier la géolocalisation d’une photo',
      description:
        'Remplacez les coordonnées GPS d’une photo JPEG, HEIC, PNG, WebP ou TIFF dans votre navigateur, sans recompresser l’image et sans envoyer le fichier.',
      resume:
        'Remplacez ou corrigez les coordonnées déjà inscrites, sans toucher un seul pixel de l’image.',
    },

    verifier: {
      segment: 'verifier-geolocalisation-photo',
      titre: 'Voir où une photo a été prise',
      h1: 'Comment vérifier la géolocalisation d’une photo',
      description:
        'Savoir si une photo porte un lieu, et lire ses coordonnées exactes : sous Windows, macOS, iPhone, Android, ou dans le navigateur sans rien installer.',
      resume:
        'Savoir si une photo porte un lieu, et lire les coordonnées exactes qu’elle contient.',
    },

    supprimer: {
      segment: 'supprimer-geolocalisation-photo',
      titre: 'Supprimer la géolocalisation d’une photo',
      h1: 'Comment supprimer la géolocalisation d’une photo',
      description:
        'Retirez les coordonnées GPS d’une photo avant de l’envoyer ou de la publier, et vérifiez qu’aucune copie du lieu ne subsiste ailleurs dans le fichier.',
      resume:
        'Retirez le lieu avant de publier ou d’envoyer, et vérifiez qu’aucune copie n’en subsiste.',
    },

    ajouter: {
      segment: 'ajouter-geolocalisation-photo',
      titre: 'Ajouter une géolocalisation à une photo',
      h1: 'Comment ajouter un lieu à une photo qui n’en a pas',
      description:
        'Donnez un lieu à un scan, à une capture d’écran ou à une photo prise sans localisation — et sachez d’avance quels fichiers l’accepteront et lesquels non.',
      resume:
        'Donnez un lieu à un scan, à une capture d’écran, ou à une photo prise sans localisation.',
    },

    iphone: {
      segment: 'geolocalisation-photo-iphone',
      titre: 'Géolocalisation d’une photo sur iPhone',
      h1: 'Modifier ou supprimer le lieu d’une photo sur iPhone',
      description:
        'Ce que « Régler le lieu » change dans Photos, pourquoi le lieu peut revenir, et comment modifier le fichier HEIC pour que le changement le suive.',
      resume:
        'Ce que l’application Photos change vraiment, et comment modifier le fichier pour que le changement le suive.',
    },

    reseaux: {
      segment: 'reseaux-sociaux-geolocalisation-photo',
      titre: 'Quelles applis retirent le lieu d’une photo',
      h1: 'Quelles applications retirent le lieu d’une photo, et lesquelles le transmettent',
      description:
        'La plupart des réseaux perdent le lieu en recompressant la photo. C’est un effet de bord, pas une promesse — et l’envoi en fichier le contourne.',
      resume:
        'Pourquoi « de toute façon ils l’enlèvent » est un effet de bord et non une promesse, et où cela cesse d’être vrai.',
    },
  },
};
