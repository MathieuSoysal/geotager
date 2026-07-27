/**
 * What the tool can do, format by format. Single source.
 *
 * The home page table is rendered from this constant, and the engine reads it
 * too. The table can therefore no longer drift from the code: the rule that a
 * cell only turns to yes once its test is green stops being a discipline and
 * becomes a mechanical property.
 *
 * Four columns, not three. Correcting and adding are different operations, and
 * on an iPhone photo the first is possible when the second is not: replacing a
 * location already written does not change the file length, creating one from
 * scratch does. A single "modify" column would force a lie one way or the other.
 */

import type { Format } from './types.ts';

export interface Capacites {
  lire: boolean;
  /** Replace a location that is already there. */
  corriger: boolean;
  /** Create one where there is none. */
  ajouter: boolean;
  effacer: boolean;
  /** Remove all information, not just the location. */
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
  /** Formats covered by the row, in display order. */
  formats: Format[];
  libelle: string;
  /** Short note shown next to the label, where there is one. */
  mention?: string;
  capacites: Capacites;
}

/**
 * The format by operation matrix. Every "yes" is backed by a passing test in
 * `test/engine.test.ts`, which is the condition for writing it here.
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
    // "Add" stays closed: it is the only operation that would grow the block,
    // and so move the item location table. Everything else is strictly constant
    // length and moves no byte.
    capacites: { lire: true, corriger: true, ajouter: false, effacer: true, effacerTout: false },
  },
  { formats: ['png'], libelle: 'PNG', capacites: LECTURE_SEULE },
  { formats: ['webp'], libelle: 'WebP', capacites: LECTURE_SEULE },
  { formats: ['tiff'], libelle: 'TIFF', capacites: LECTURE_SEULE },
  { formats: ['video'], libelle: 'Vidéos (MOV, MP4)', capacites: LECTURE_SEULE },
];

/** What the tool can do with a format, regardless of the file received. */
export function capacitesDe(format: Format): Capacites {
  const ligne = MATRICE.find((l) => l.formats.includes(format));
  if (ligne) return ligne.capacites;
  // A GIF cannot carry a location, and an unknown format cannot be read.
  return RIEN;
}

/** The table columns, in order. */
export const COLONNES = ['Lire', 'Corriger', 'Ajouter', 'Effacer'] as const;

export function cellules(c: Capacites): string[] {
  const dire = (v: boolean) => (v ? 'oui' : 'pas encore');
  return [dire(c.lire), dire(c.corriger), dire(c.ajouter), dire(c.effacer)];
}

// Sentences

/**
 * Why the tool can, or cannot, act on this particular file.
 *
 * The interface announces the route before the action. A write we cannot
 * deliver is never promised: saying "we cannot do this yet" beats handing back
 * a file the user will believe is clean.
 */
export type Motif =
  | 'ok'
  | 'sans-lieu'
  | 'sans-emplacement'
  | 'forme-inhabituelle'
  | 'rangement-inconnu'
  | 'copie-compressee'
  | 'copie-ailleurs'
  | 'lecture-seule'
  | 'sans-lieu-possible'
  | 'video'
  | 'inconnu';

// No container jargon in these sentences: no "EXIF", no "metadata", no "IFD",
// no "container", and no internal box or chunk name.
const PHRASES: Record<Motif, string> = {
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
    'Nous savons lire le lieu d’une vidéo, mais pas encore le retirer de façon sûre — une vidéo le range à plusieurs endroits.',
  inconnu: 'Nous ne reconnaissons pas ce type de fichier.',
};

export function phraseDe(motif: Motif): string {
  return PHRASES[motif];
}
