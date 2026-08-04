/**
 * What the tool can do, format by format. Single source.
 *
 * Each page's table is rendered from this constant, and the engine reads it
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

export interface LigneMatrice {
  /** Formats covered by the row, in display order. */
  formats: Format[];
  capacites: Capacites;
}

/**
 * The format by operation matrix. Every "yes" is backed by a passing test in
 * `test/engine.test.ts`, which is the condition for writing it here.
 */
export const MATRICE: LigneMatrice[] = [
  {
    formats: ['jpeg'],
    capacites: { lire: true, corriger: true, ajouter: true, effacer: true, effacerTout: true },
  },
  {
    formats: ['heic', 'avif'],
    // "Add" grows nothing in place: the new block goes into a box appended at
    // the end of the file, and the single item location table entry concerned
    // is repointed. The file grows, no existing byte moves. Stays closed file
    // by file when there is no entry to repoint, and the container says so
    // before the action.
    capacites: { lire: true, corriger: true, ajouter: true, effacer: true, effacerTout: false },
  },
  {
    formats: ['png'],
    // No internal absolute offsets: growing a chunk invalidates nothing, so
    // adding is safe. It is the only format here in that position.
    capacites: { lire: true, corriger: true, ajouter: true, effacer: true, effacerTout: true },
  },
  {
    formats: ['webp'],
    // The simple form has no slot for a location: there is nothing to read or
    // correct there, and creating one is out of reach. The interface says so
    // file by file, before the action.
    capacites: { lire: true, corriger: true, ajouter: true, effacer: true, effacerTout: true },
  },
  {
    formats: ['tiff'],
    // A camera raw file is a TIFF, and adding bytes to one would damage an
    // irreplaceable original. "Add" is therefore only open to files that prove
    // they are ordinary images, from an allowlist tested both ways on real
    // DNG, NEF and CR2 files and real TIFFs. On a negative, the container says
    // so before the action.
    capacites: { lire: true, corriger: true, ajouter: true, effacer: true, effacerTout: false },
  },
  {
    formats: ['video'],
    // These four cells sat at "not yet" for want of a file, not for want of
    // code: the earlier corpus search concluded no real freely-licensed video
    // existed, and that was wrong. Three were found, and every cell now runs
    // against one of them.
    //
    // A video stores its location as text, in several places at once.
    // Correcting moves no byte when the slots are long enough; otherwise the
    // file grows, which needs the same permission as adding. And when the
    // location is also written throughout the recording, as an action camera
    // does, the three write operations close file by file rather than hand back
    // a falsely clean file.
    capacites: { lire: true, corriger: true, ajouter: true, effacer: true, effacerTout: false },
  },
];

/** What the tool can do with a format, regardless of the file received. */
export function capacitesDe(format: Format): Capacites {
  const ligne = MATRICE.find((l) => l.formats.includes(format));
  if (ligne) return ligne.capacites;
  // A GIF cannot carry a location, and an unknown format cannot be read.
  return RIEN;
}

/**
 * The four cells of a row, in column order.
 *
 * Returns booleans, not words: the table states the same truth in every
 * language, and the dictionary chooses how to say it.
 */
export function cellules(c: Capacites): boolean[] {
  return [c.lire, c.corriger, c.ajouter, c.effacer];
}

// File types

/**
 * Recognised format to declared type, and the extensions that go with it.
 *
 * Single source, for the same reason as the matrix: this table used to be
 * written twice, in the manifest and in the tests, and the produced file read
 * it in neither place. It came out with no declared type at all.
 *
 * What that costs when forgotten, and what motivated the table: a file placed
 * in a phone's downloads with no type is not indexed as a video. The gallery
 * shows no entry for it, and our own picker, restricted to images and videos,
 * may stop offering it. The file is perfect, and the user sees nothing.
 *
 * Order matters: the first type of a format is the one declared when writing.
 * The rest only serve to recognise.
 */
export const TYPES_PAR_FORMAT: Partial<Record<Format, { types: string[]; extensions: string[] }>> = {
  jpeg: { types: ['image/jpeg'], extensions: ['.jpg', '.jpeg'] },
  png: { types: ['image/png'], extensions: ['.png'] },
  webp: { types: ['image/webp'], extensions: ['.webp'] },
  heic: { types: ['image/heic', 'image/heif'], extensions: ['.heic', '.heif'] },
  avif: { types: ['image/avif'], extensions: ['.avif'] },
  tiff: { types: ['image/tiff'], extensions: ['.tif', '.tiff'] },
  gif: { types: ['image/gif'], extensions: ['.gif'] },
  video: { types: ['video/mp4', 'video/quicktime'], extensions: ['.mp4', '.m4v', '.mov'] },
};

/**
 * The type to declare for a file of this format, or null.
 *
 * A video comes in two types depending on the wrapper, and the file extension
 * is the only clue that separates them; the bytes are the same boxes. This is
 * the one place in the engine where the file name has a say, and only to pick
 * between two equally true labels.
 */
export function typeDeclare(format: Format, nom = ''): string | null {
  const entree = TYPES_PAR_FORMAT[format];
  if (!entree) return null;
  const point = nom.lastIndexOf('.');
  const ext = point < 0 ? '' : nom.slice(point).toLowerCase();
  if (format === 'video' && (ext === '.mov' || ext === '.qt')) return 'video/quicktime';
  if (format === 'heic' && ext === '.heif') return 'image/heif';
  return entree.types[0];
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
  // A video that records the location throughout its duration. The only
  // reason to close all three writes at once while leaving reading open: the
  // main location displays perfectly well, which is exactly why it has to be
  // said that it is not the only one.
  | 'lieu-en-mouvement'
  | 'inconnu';

// The sentences themselves live in src/lib/i18n/: the engine returns a reason
// key and the interface picks the words. That is what allows a second language
// without touching a line of binary surgery, and what makes a missing sentence
// a compile error rather than a French word on an English page.
