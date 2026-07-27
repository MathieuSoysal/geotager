/**
 * Ce que l'outil sait faire, format par format — source unique.
 *
 * Le tableau de la page d'accueil est RENDU à partir de cette constante, et le
 * moteur la lit aussi. Le tableau ne peut donc plus dériver du code : la règle
 * « une case ne passe à oui qu'une fois son test vert » cesse d'être une
 * discipline pour devenir une propriété mécanique.
 *
 * Quatre colonnes, pas trois. « Corriger » et « Ajouter » sont deux opérations
 * différentes, et sur une photo d'iPhone la première est possible quand la
 * seconde ne l'est pas : remplacer un lieu déjà écrit ne change pas la longueur
 * du fichier, en créer un de toutes pièces oui. Une colonne « Modifier » unique
 * obligerait à mentir dans un sens ou dans l'autre.
 */

import type { Format } from './types.ts';

export interface Capacites {
  lire: boolean;
  /** Remplacer un lieu déjà présent. */
  corriger: boolean;
  /** En créer un là où il n'y en a pas. */
  ajouter: boolean;
  effacer: boolean;
  /** Retirer toutes les informations, pas seulement le lieu. */
  effacerTout: boolean;
}

const RIEN: Capacites = {
  lire: false,
  corriger: false,
  ajouter: false,
  effacer: false,
  effacerTout: false,
};
const LECTURE_SEULE: Capacites = { ...RIEN, lire: true };

export interface LigneMatrice {
  /** Formats couverts par la ligne, dans l'ordre d'affichage. */
  formats: Format[];
  libelle: string;
  /** Mention courte affichée à côté du libellé, s'il y a lieu. */
  mention?: string;
  capacites: Capacites;
}

/**
 * La matrice format × opération. Chaque « oui » est adossé à un test qui passe
 * dans `test/engine.test.ts` — c'est la condition pour l'écrire ici.
 */
export const MATRICE: LigneMatrice[] = [
  {
    formats: ['jpeg'],
    libelle: 'JPEG',
    capacites: { lire: true, corriger: true, ajouter: true, effacer: true, effacerTout: true },
  },
  {
    formats: ['heic', 'avif'],
    libelle: 'HEIC, AVIF',
    mention: 'iPhone',
    capacites: LECTURE_SEULE,
  },
  { formats: ['png'], libelle: 'PNG', capacites: LECTURE_SEULE },
  { formats: ['webp'], libelle: 'WebP', capacites: LECTURE_SEULE },
  { formats: ['tiff'], libelle: 'TIFF', capacites: LECTURE_SEULE },
  { formats: ['video'], libelle: 'Vidéos (MOV, MP4)', capacites: LECTURE_SEULE },
];

/** Ce que l'outil sait faire d'un format, indépendamment du fichier reçu. */
export function capacitesDe(format: Format): Capacites {
  const ligne = MATRICE.find((l) => l.formats.includes(format));
  if (ligne) return ligne.capacites;
  // Un GIF ne peut pas porter de lieu, un format inconnu ne se lit pas.
  return RIEN;
}

/** Les colonnes du tableau, dans l'ordre. */
export const COLONNES = ['Lire', 'Corriger', 'Ajouter', 'Effacer'] as const;

export function cellules(c: Capacites): string[] {
  const dire = (v: boolean) => (v ? 'oui' : 'pas encore');
  return [dire(c.lire), dire(c.corriger), dire(c.ajouter), dire(c.effacer)];
}

/* ------------------------------------------------------------------ */
/* Les phrases                                                         */
/* ------------------------------------------------------------------ */

/**
 * Pourquoi l'outil peut, ou ne peut pas, agir sur CE fichier-là.
 *
 * L'interface annonce la voie AVANT l'action. On ne promet jamais une écriture
 * qu'on ne sait pas tenir : mieux vaut dire « nous ne savons pas encore » que
 * rendre un fichier que l'utilisateur croira nettoyé.
 */
export type Motif =
  | 'ok'
  | 'sans-lieu'
  | 'sans-emplacement'
  | 'forme-inhabituelle'
  | 'rangement-inconnu'
  | 'copie-compressee'
  | 'lecture-seule'
  | 'sans-lieu-possible'
  | 'video'
  | 'inconnu';

// Aucun mot de la liste interdite du plan : ni « EXIF », ni « métadonnées »,
// ni « IFD », ni « conteneur », ni le nom d'une boîte ou d'un morceau interne.
const PHRASES: Record<Motif, string> = {
  ok: 'La position sera écrite dans le fichier, sans retoucher l’image.',
  'sans-lieu':
    'Cette photo ne porte aucun lieu. Nous savons en retirer un, mais pas encore en ajouter un à ce type de photo.',
  'sans-emplacement': 'Ce fichier ne contient aucune information de lieu à modifier.',
  'forme-inhabituelle':
    'Le lieu est enregistré ici d’une façon inhabituelle. Nous savons le lire, mais le modifier risquerait d’abîmer la photo : nous préférons ne pas y toucher.',
  'rangement-inconnu':
    'Cette photo range ses informations d’une façon que nous ne savons pas encore manipuler sans risque.',
  'copie-compressee':
    'Cette image range aussi le lieu sous une forme compressée que nous ne savons pas encore rouvrir. Nous préférons ne rien retirer plutôt que d’en oublier une copie.',
  'lecture-seule':
    'Nous savons lire la position de ce fichier, mais pas encore la modifier sans risquer de l’abîmer.',
  'sans-lieu-possible':
    'Cette image n’a pas d’emplacement prévu pour un lieu, et nous ne savons pas encore lui en créer un.',
  video:
    'Nous savons lire le lieu d’une vidéo, mais pas encore le retirer de façon sûre — une vidéo le range à plusieurs endroits.',
  inconnu: 'Nous ne reconnaissons pas ce type de fichier.',
};

export function phraseDe(motif: Motif): string {
  return PHRASES[motif];
}
