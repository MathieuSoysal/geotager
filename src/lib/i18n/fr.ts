/** Les mots français. La forme est imposée par `types.ts`. */
import type { Dictionnaire } from './types.ts';

export const fr: Dictionnaire = {
  langue: 'fr',
  htmlLang: 'fr',
  ogLocale: 'fr_FR',
  base: '/fr/',

  meta: {
    titre: "Modifier la géolocalisation d'une photo — Geotager",
    description:
      "Ajoutez, modifiez ou supprimez les coordonnées GPS d'une photo directement dans votre navigateur. Aucun envoi de fichier, aucune inscription.",
    nomLangue: 'Français',
    sousCategorie: "Édition de métadonnées d'image",
    systeme: 'Tout navigateur web moderne',
    fonctions: [
      "Lire la position GPS d'une photo",
      "Modifier la position GPS d'une photo",
      "Supprimer la position GPS d'une photo",
      'Supprimer toutes les métadonnées',
    ],
  },

  nav: {
    viePrivee: 'Vie privée',
    modeEmploi: "Mode d'emploi",
    verifier: 'Vérifier vous-même',
    sections: 'Sections',
    aller: 'Aller au contenu',
  },

  etapes: {
    titre: 'Étapes',
    deposer: 'Déposer une photo',
    choisir: 'Choisir le lieu',
    telecharger: 'Télécharger',
  },

  hero: {
    deposez: 'Déposez une photo',
    ouCollez: 'ou collez-la',
    titre: 'Changez le lieu',
    titreEm: "d'une photo",
    sous: "Rien n'est envoyé nulle part : tout se passe dans votre navigateur.",
    formats: 'JPEG · HEIC · PNG · WebP · TIFF',
    defiler: "Comment ça marche, et pourquoi c'est privé ↓",
  },

  app: {
    titreActif: 'Photo chargée',
    changer: 'Changer de photo',
    ouPrise: 'Où cette photo a-t-elle été prise ?',
    aideCoords:
      'Collez des coordonnées depuis une carte : dans Google Maps, clic droit sur le lieu puis clic sur les chiffres pour les copier. Le format décimal et le format degrés-minutes-secondes sont acceptés. ',
    aideCoordsFort: 'Votre photo reste ici.',
    coordsInvalides: 'Coordonnées non valides — indiquez une latitude et une longitude, par exemple 43,9493, 4,8055.',
    ouvrirCarte: 'Placer sur une carte',
    fermerCarte: 'Fermer la carte',
    avisCarte:
      "La carte est dessinée par openstreetmap.org : l'ouvrir leur indique approximativement la zone que vous regardez. Votre photo, elle, ne quitte toujours pas ce navigateur.",
    carteLabel: 'Carte. Cliquez un lieu pour y placer le repère.',
    carteAide:
      'Cliquez sur le lieu, ou faites glisser la carte sous le repère. Les flèches marchent aussi.',
    zoomAvant: 'Zoom avant',
    zoomArriere: 'Zoom arrière',
    contributeurs: 'contributeurs',
    repereOrigine: 'Le lieu inscrit dans la photo',
    positionChoisie: (p) => `Choisi sur la carte : ${p}`,
    telecharger: 'Télécharger la photo',
    effacer: 'Effacer la position',
    effacerTout: 'Tout effacer',
    autres: 'Voir les autres informations',
    aucuneChargee: 'Aucune photo chargée.',
    actuellement: 'Actuellement',
    illisible: 'illisible',
    positionLue: 'position lue',
    sansPosition: 'sans position',
    effacementSeul: 'effacement seul',
    lectureSeule: 'lecture seule',
    fichiers: 'fichiers',
    modifiables: 'modifiables',
    lecturePlurielle: (n) => `Lecture de ${n} fichier${n > 1 ? 's' : ''}…`,
    traitement: (i, n) => `Traitement ${i} sur ${n}…`,
    photoLue: (p) => `Photo lue. Position actuelle : ${p}.`,
    photoLueSansPosition: 'Photo lue. Aucune position enregistrée dans ce fichier.',
    illisibleAlerte: "Ce fichier n'a pas pu être lu.",
    aucunProduit: "Aucun fichier n'a pu être produit. Vos originaux n'ont pas été modifiés.",
    aucunProduitAnnonce: 'Échec : aucun fichier produit. Vos originaux sont intacts.',
    sansRienDeplacer: 'sans rien déplacer',
    ecrit: 'écrit',
    virgule: ',',
    octets: ['o', 'Ko', 'Mo'],
    nomVideo: 'Vidéo',
    nomInconnu: 'Inconnu',
    telechargerPhotos: (n) => (n > 1 ? `Télécharger les ${n} photos` : 'Télécharger la photo'),
    depuisOrigine: (d) => `à ${d} de la position d'origine`,
    nouvellePosition: 'nouvelle position pour cette photo',
    pretsVerifies: (n) =>
      `${n} fichier${n > 1 ? 's' : ''} prêt${n > 1 ? 's' : ''}, vérifié${n > 1 ? 's' : ''} après écriture.`,
    pretsAvecEchecs: (n, e) =>
      `${n} fichier(s) prêt(s), ${e} en échec. Les originaux concernés sont intacts.`,
    zip: 'photos-geotager.zip',
    suffixeLieu: '-geotager',
    suffixeSansLieu: '-sans-position',
    suffixeSansInfos: '-sans-metadonnees',
  },

  infos: {
    Appareil: 'Appareil',
    PriseDeVue: 'Prise de vue',
    Position: 'Position',
    Altitude: 'Altitude',
    Orientation: 'Orientation',
    ExposureTime: 'Temps de pose',
    FNumber: 'Ouverture',
    ISO: 'Sensibilité',
    FocalLength: 'Focale',
    LensModel: 'Objectif',
    Software: 'Logiciel',
    Artist: 'Auteur',
    Copyright: 'Copyright',
  },

  motifs: {
    ok: 'La position sera écrite dans le fichier, sans retoucher l’image.',
    'sans-lieu':
      'Cette photo ne porte aucun lieu. Nous savons en retirer un, mais pas encore en ajouter un à ce type de photo.',
    'sans-emplacement': 'Ce fichier ne contient aucune information de lieu à modifier.',
    'forme-inhabituelle':
      'Le lieu est enregistré ici d’une façon inhabituelle. Nous savons le lire, mais le modifier risquerait d’abîmer la photo : nous préférons ne pas y toucher.',
    'rangement-inconnu':
      'Cette photo range ses informations d’une façon que nous ne savons pas encore manipuler sans risque.',
    'copie-ailleurs':
      'Cette photo range aussi le lieu à un autre endroit, sous une forme que nous ne savons pas encore retirer. Nous préférons ne rien retirer plutôt que d’en oublier une copie.',
    'copie-compressee':
      'Cette image range aussi le lieu sous une forme compressée que nous ne savons pas encore rouvrir. Nous préférons ne rien retirer plutôt que d’en oublier une copie.',
    'lecture-seule':
      'Nous savons lire la position de ce fichier, mais pas encore la modifier sans risquer de l’abîmer.',
    'sans-lieu-possible':
      'Cette image n’a pas d’emplacement prévu pour un lieu, et nous ne savons pas encore lui en créer un.',
    video:
      'Nous ne savons pas encore travailler sur les vidéos : une vidéo range le lieu à plusieurs endroits, parfois en toutes lettres, et nous préférons ne rien promettre que nous ne tenions.',
    inconnu: 'Nous ne reconnaissons pas ce type de fichier.',
  },

  erreurs: {
    AJOUT_IMPOSSIBLE:
      "Ce fichier ne porte pas de lieu, et nous ne savons pas encore lui en ajouter un sans risquer de l'abîmer.",
    COPIE_DU_LIEU_SUBSISTE:
      "Une copie du lieu subsiste dans ce fichier, sous une forme que nous ne savons pas retirer. Nous préférons vous rendre l'original intact.",
    EFFACEMENT_TOTAL_IMPOSSIBLE:
      'Nous ne savons pas encore retirer toutes les informations de ce type de fichier.',
    ERREUR_INATTENDUE: "Ce fichier n'a pas pu être traité. Votre original est intact.",
    EXIF_CORROMPU: 'Les informations du fichier sont illisibles.',
    EXIF_TROP_VOLUMINEUX:
      "Les informations de ce fichier sont déjà à la limite de ce que le format autorise : nous ne pouvons pas y ajouter la position sans risque.",
    FICHIER_CORROMPU: 'La structure de ce fichier est incohérente.',
    FICHIER_TRONQUE: "Le fichier s'arrête au milieu d'une section.",
    FORMAT_NON_MODIFIABLE:
      'Nous savons lire ce fichier, mais pas encore le modifier sans risquer de l’abîmer.',
    FORMAT_NON_PRIS_EN_CHARGE:
      "Cette image utilise une variante que nous ne savons pas encore ouvrir. Elle n'a pas été touchée.",
    OCTETS_HORS_PLAGE:
      "Des octets auraient changé en dehors de ce qui était annoncé. L'opération est annulée et votre original vous est rendu intact.",
    PAS_UN_JPEG: 'Ce fichier ne commence pas par une signature JPEG.',
    PLAGES_CHEVAUCHANTES:
      "Ce fichier a une structure inhabituelle : le modifier risquerait d'abîmer d'autres informations. Nous préférons ne pas y toucher.",
    RELECTURE_CROISEE_DIVERGENTE:
      "Nos deux lecteurs ne lisent pas la même chose dans le fichier produit. Nous préférons vous rendre l'original.",
    STRUCTURE_INATTENDUE:
      "Ce fichier a une structure que nous ne savons pas modifier sans risque. Il n'a pas été touché.",
    VERIFICATION_ECHOUEE:
      "La relecture du fichier produit n'a pas donné le résultat attendu. Votre original vous est rendu intact.",
  },

  matrice: {
    format: 'Format',
    colonnes: ['Lire', 'Corriger', 'Ajouter', 'Effacer'],
    oui: 'oui',
    pasEncore: 'pas encore',
    lignes: {
      jpeg: { libelle: 'JPEG' },
      heic: { libelle: 'HEIC, AVIF', mention: 'iPhone' },
      png: { libelle: 'PNG' },
      webp: { libelle: 'WebP', mention: 'forme étendue' },
      tiff: { libelle: 'TIFF', mention: 'hors fichiers bruts' },
      video: { libelle: 'Vidéos (MOV, MP4)' },
    },
  },

  titres: {
    pourquoiPrive: 'Pourquoi vos fichiers ne partent pas',
    modeEmploi: "Mode d'emploi",
    limites: "Ce que l'outil sait faire, et ce qu'il ne sait pas encore",
    exif: "Ce qu'est une donnée GPS dans une photo",
    viePrivee: "Ce qu'un géotag révèle",
    verifier: 'Vérifier vous-même, avec un autre outil',
  },

  pitch: [
    {
      titre: 'Simple',
      texte:
        'Déposez, indiquez un lieu, téléchargez. Aucun réglage à comprendre avant de commencer.',
    },
    {
      titre: 'Précis',
      texte:
        'Coordonnées en décimal ou en degrés-minutes-secondes, et collage direct depuis une carte. La précision réelle est inscrite dans le fichier.',
    },
    {
      titre: 'Privé',
      texte:
        'Votre photo ne quitte jamais le navigateur. Aucun compte, aucune publicité, aucun traceur.',
    },
  ],

  pied: 'Geotager — outil gratuit, sans compte et sans traceur. Code source sous licence MIT :',
};
