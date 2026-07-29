/**
 * The English words. The shape is imposed by `types.ts`.
 *
 * Same rule as the French: no format jargon anywhere the user walks through.
 * Never "EXIF", "metadata", "container", "chunk", "box" or "sidecar". Say
 * "information" and "location", and name the file, not its innards.
 */
import type { Dictionnaire } from './types.ts';

export const en: Dictionnaire = {
  langue: 'en',
  htmlLang: 'en',
  ogLocale: 'en_GB',
  base: '/',

  meta: {
    titre: 'Change a photo’s location — Geotager',
    description:
      'Add, change or remove the GPS coordinates of a photo right in your browser. Nothing is uploaded, no account needed.',
    imageAlt: 'Geotager — change the location of a photo, entirely in your browser.',
    nomLangue: 'English',
    sousCategorie: 'Image metadata editing',
    systeme: 'Any modern web browser',
    fonctions: [
      'Read the GPS location of a photo',
      'Change the GPS location of a photo',
      'Remove the GPS location of a photo',
      'Remove all metadata',
    ],
  },

  nav: {
    viePrivee: 'Privacy',
    modeEmploi: 'How to use it',
    verifier: 'Check for yourself',
    sections: 'Sections',
    aller: 'Skip to content',
  },

  etapes: {
    titre: 'Steps',
    deposer: 'Drop a photo',
    choisir: 'Pick the place',
    telecharger: 'Download',
  },

  hero: {
    deposez: 'Drop a photo',
    ouCollez: 'or paste one',
    titre: 'Change the location',
    titreEm: 'of a photo',
    sous: 'Nothing is sent anywhere: everything happens in your browser.',
    formats: 'JPEG · HEIC · PNG · WebP · TIFF',
    sansJs: 'Geotager needs JavaScript to read and change a photo. Everything still runs on your device — nothing is sent anywhere.',
    defiler: 'How it works, and why it stays private ↓',
  },

  app: {
    titreActif: 'Photo loaded',
    changer: 'Change photo',
    ouPrise: 'Where was this photo taken?',
    aideCoords:
      'Paste coordinates from a map: in Google Maps, right-click the spot then click the numbers to copy them. Decimal and degrees-minutes-seconds are both accepted. ',
    aideCoordsFort: 'Your photo stays here.',
    coordsInvalides: 'Invalid coordinates — enter a latitude and a longitude, for example 43.9493, 4.8055.',
    ouvrirCarte: 'Place it on a map',
    fermerCarte: 'Close the map',
    avisCarte:
      'The map is drawn by openstreetmap.org, so opening it tells them roughly which area you are looking at. Your photo still never leaves this browser.',
    carteIndisponible: 'The map could not be loaded — you may be offline. You can still type or paste coordinates above.',
    carteLabel: 'Map. Click a spot to place the marker there.',
    carteAide: 'Click the spot, or drag the map under the marker. Arrow keys work too.',
    zoomAvant: 'Zoom in',
    zoomArriere: 'Zoom out',
    contributeurs: 'contributors',
    repereOrigine: 'Where the photo says it was taken',
    positionChoisie: (p) => `Picked on the map: ${p}`,
    telecharger: 'Download the photo',
    telechargerPourquoi: 'Unavailable until you enter a location above.',
    partagerSortie: 'Share the cleaned photo',
    effacer: 'Remove the location',
    effacerTout: 'Remove everything',
    autres: 'Show the other information',
    aucuneChargee: 'No photo loaded.',
    actuellement: 'Currently',
    illisible: 'unreadable',
    positionLue: 'location read',
    sansPosition: 'no location',
    effacementSeul: 'removal only',
    lectureSeule: 'read only',
    fichiers: 'files',
    modifiables: 'editable',
    lecturePlurielle: (n) => `Reading ${n} file${n > 1 ? 's' : ''}…`,
    traitement: (i, n) => `Processing ${i} of ${n}…`,
    photoLue: (p) => `Photo read. Current location: ${p}.`,
    photoLueSansPosition: 'Photo read. No location stored in this file.',
    illisibleAlerte: 'This file could not be read.',
    aucunProduit: 'No file could be produced. Your originals were not modified.',
    aucunProduitAnnonce: 'Failed: no file produced. Your originals are untouched.',
    sansRienDeplacer: 'without moving a byte',
    ecrit: 'written',
    virgule: '.',
    octets: ['B', 'KB', 'MB'],
    nomVideo: 'Video',
    nomInconnu: 'Unknown',
    telechargerPhotos: (n) => (n > 1 ? `Download the ${n} photos` : 'Download the photo'),
    depuisOrigine: (d) => `${d} from the original location`,
    nouvellePosition: 'new location for this photo',
    pretsVerifies: (n) => `${n} file${n > 1 ? 's' : ''} ready, checked after writing.`,
    pretsAvecEchecs: (n, e) =>
      `${n} file(s) ready, ${e} failed. The originals concerned are untouched.`,
    partagePerdu: 'The shared photo did not make it across — nothing was stored, so nothing was lost. Share it again, or drop it below.',
    majDispo: 'A new version of Geotager is available.',
    majTravaux: 'A new version is available. Download your photos first — reloading discards the ones you have open.',
    majRecharger: 'Reload',
    majPlusTard: 'Later',
    zip: 'photos-geotager.zip',
    suffixeLieu: '-geotagged',
    suffixeSansLieu: '-no-location',
    suffixeSansInfos: '-no-metadata',
  },

  infos: {
    Appareil: 'Camera',
    PriseDeVue: 'Taken',
    Position: 'Location',
    Altitude: 'Altitude',
    Orientation: 'Orientation',
    ExposureTime: 'Exposure',
    FNumber: 'Aperture',
    ISO: 'ISO',
    FocalLength: 'Focal length',
    LensModel: 'Lens',
    Software: 'Software',
    Artist: 'Author',
    Copyright: 'Copyright',
  },

  motifs: {
    ok: 'The location will be written into the file, without touching the image.',
    'sans-lieu':
      'This photo carries no location. We know how to remove one, but not yet how to add one to this kind of photo.',
    'sans-emplacement': 'This file holds no location information to change.',
    'forme-inhabituelle':
      'The location is stored here in an unusual way. We can read it, but changing it could damage the photo, so we would rather not touch it.',
    'rangement-inconnu':
      'This photo arranges its information in a way we cannot yet handle safely.',
    'copie-ailleurs':
      'This photo also keeps the location somewhere else, in a form we cannot yet remove. We would rather remove nothing than forget a copy.',
    'copie-compressee':
      'This image also keeps the location in a compressed form we cannot yet open. We would rather remove nothing than forget a copy.',
    'lecture-seule':
      'We can read this file’s location, but not yet change it without risking damage.',
    'sans-lieu-possible':
      'This image has nowhere to put a location, and we cannot yet create one for it.',
    video:
      'We cannot work on videos yet: a video keeps the location in several places at once, sometimes spelled out in words, and we would rather not promise what we cannot deliver.',
    inconnu: 'We do not recognise this kind of file.',
  },

  erreurs: {
    AJOUT_IMPOSSIBLE:
      'This file carries no location, and we cannot yet add one without risking damage.',
    COPIE_DU_LIEU_SUBSISTE:
      'A copy of the location survives in this file, in a form we cannot remove. We would rather hand you back the untouched original.',
    EFFACEMENT_TOTAL_IMPOSSIBLE:
      'We cannot yet remove all the information from this kind of file.',
    ERREUR_INATTENDUE: 'This file could not be processed. Your original is untouched.',
    EXIF_CORROMPU: 'The information in this file cannot be read.',
    EXIF_TROP_VOLUMINEUX:
      'This file’s information is already at the limit the format allows: we cannot add the location to it safely.',
    FICHIER_CORROMPU: 'The structure of this file is inconsistent.',
    FICHIER_TRONQUE: 'The file stops in the middle of a section.',
    FORMAT_NON_MODIFIABLE:
      'We can read this file, but not yet change it without risking damage.',
    FORMAT_NON_PRIS_EN_CHARGE:
      'This image uses a variant we cannot open yet. It has not been touched.',
    OCTETS_HORS_PLAGE:
      'Bytes would have changed outside what was announced. The operation is cancelled and your original is handed back untouched.',
    PAS_UN_JPEG: 'This file does not start with a JPEG signature.',
    PLAGES_CHEVAUCHANTES:
      'This file has an unusual structure: changing it could damage other information. We would rather not touch it.',
    RELECTURE_CROISEE_DIVERGENTE:
      'Our two readers disagree about the file we produced. We would rather hand you back the original.',
    STRUCTURE_INATTENDUE:
      'This file has a structure we cannot change safely. It has not been touched.',
    VERIFICATION_ECHOUEE:
      'Reading back the file we produced did not give the expected result. Your original is handed back untouched.',
  },

  matrice: {
    legende: 'What Geotager can do with each photo format',
    format: 'Format',
    colonnes: ['Read', 'Change', 'Add', 'Remove'],
    oui: 'yes',
    pasEncore: 'not yet',
    lignes: {
      jpeg: { libelle: 'JPEG' },
      heic: { libelle: 'HEIC, AVIF', mention: 'iPhone' },
      png: { libelle: 'PNG' },
      webp: { libelle: 'WebP', mention: 'extended form' },
      tiff: { libelle: 'TIFF', mention: 'excluding camera raw' },
      video: { libelle: 'Videos (MOV, MP4)' },
    },
  },

  titres: {
    pourquoiPrive: 'Why your files never leave',
    modeEmploi: 'How to use it',
    limites: 'What the tool can do, and what it cannot do yet',
    exif: 'What GPS data in a photo actually is',
    viePrivee: 'What a geotag gives away',
    verifier: 'Check for yourself, with another tool',
  },

  pitch: [
    {
      titre: 'Simple',
      texte: 'Drop, give a place, download. Nothing to configure before you start.',
    },
    {
      titre: 'Precise',
      texte:
        'Decimal or degrees-minutes-seconds, and paste straight from a map. The real accuracy is written into the file.',
    },
    {
      titre: 'Private',
      texte: 'Your photo never leaves the browser. No account, no ads, no trackers.',
    },
  ],

  pied: 'Geotager — free, no account, no trackers. Source code under the MIT licence:',
};
