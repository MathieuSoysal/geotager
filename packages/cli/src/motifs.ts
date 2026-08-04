/**
 * Path pattern expansion, and collecting the files to process.
 *
 * Why this module exists when the shell already expands patterns: it does not
 * always, and particularly not when it matters.
 *
 *   - `cmd.exe` and PowerShell expand nothing: on Windows the pattern reaches
 *     the program exactly as typed.
 *   - A quoted pattern (`geotager read '*.jpg'`) arrives intact everywhere, and
 *     quoting is what you naturally do when you do not want the shell involved.
 *   - An agent building a command line often has no shell between it and the
 *     program: `spawn` without `shell: true` passes arguments literally.
 *
 * Without this module all of those would report "file not found: *.jpg", the
 * kind of message that leads people to conclude the tool is broken.
 *
 * So we expand ourselves, and also accept what the shell already expanded: a
 * path with no pattern characters is not modified, only checked.
 */

import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

/** Extensions the tool can open. Used by `--all` and by directories. */
export const EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif',
  '.avif', '.tif', '.tiff', '.gif', '.mp4', '.m4v', '.mov',
];

const A_UN_MOTIF = (s: string) => /[*?[\]{}]/.test(s);

/**
 * One pattern segment to an anchored regular expression.
 *
 * `*` does not cross a separator, `?` matches one character, `[abc]` a class,
 * `{a,b}` an alternative. Everything else is literal, and escaping is
 * exhaustive rather than selective: a file named `photo (1).jpg` contains
 * parentheses, which unescaped would become a capture group and make the
 * pattern match names it does not name.
 */
function segmentEnRegex(segment: string): RegExp {
  let out = '';
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else if (c === '{') out += '(?:';
    else if (c === '}') out += ')';
    else if (c === ',') out += '|';
    else if (c === '[') {
      const fin = segment.indexOf(']', i + 1);
      if (fin < 0) {
        out += '\\[';
      } else {
        const dedans = segment.slice(i + 1, fin);
        // `[!abc]` is glob negation, `[^abc]` is the regular expression one.
        out += `[${dedans.startsWith('!') ? '^' + dedans.slice(1) : dedans}]`;
        i = fin;
      }
    } else out += c.replace(/[.+^$()|\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/**
 * The files named by a pattern, sorted.
 *
 * The walk starts from the longest prefix with no pattern characters:
 * `photos/2024/*.jpg` does not open the root of the disk and filter
 * afterwards, it opens `photos/2024`. `**` crosses subdirectories, and a
 * maximum depth bounds it, so a circular symlink cannot spin the tool forever
 * over somebody's photos.
 */
const PROFONDEUR_MAX = 32;

function developper(motif: string): string[] {
  const normalise = motif.split(sep === '\\' ? /[\\/]/ : '/').filter((s) => s !== '');
  const absolu = isAbsolute(motif);
  const racine = absolu ? (motif.startsWith(sep) ? sep : motif.slice(0, motif.indexOf(sep) + 1)) : '.';

  // The fixed prefix: everything before the first segment with a pattern.
  let i = 0;
  const fixes: string[] = [];
  while (i < normalise.length && !A_UN_MOTIF(normalise[i])) fixes.push(normalise[i++]);
  const depart = join(racine, ...fixes);
  const reste = normalise.slice(i);

  if (reste.length === 0) return existe(depart) ? [depart] : [];

  const trouves: string[] = [];
  const parcourir = (dossier: string, segments: string[], profondeur: number): void => {
    if (profondeur > PROFONDEUR_MAX) return;
    const [tete, ...suite] = segments;

    if (tete === '**') {
      // `**` means "zero directories or more": try skipping it first, then
      // descend. Without the skip, `**/*.jpg` would miss the files in the
      // starting directory itself.
      if (suite.length) parcourir(dossier, suite, profondeur);
      for (const e of entrees(dossier)) {
        if (e.dossier) parcourir(join(dossier, e.nom), segments, profondeur + 1);
        else if (suite.length === 0) trouves.push(join(dossier, e.nom));
      }
      return;
    }

    const re = segmentEnRegex(tete);
    for (const e of entrees(dossier)) {
      if (!re.test(e.nom)) continue;
      const chemin = join(dossier, e.nom);
      if (suite.length === 0) {
        if (!e.dossier) trouves.push(chemin);
      } else if (e.dossier) {
        parcourir(chemin, suite, profondeur + 1);
      }
    }
  };

  parcourir(depart, reste, 0);
  return trouves;
}

function entrees(dossier: string): Array<{ nom: string; dossier: boolean }> {
  try {
    return readdirSync(dossier, { withFileTypes: true }).map((e) => ({
      nom: e.name,
      // `isDirectory` is false on a symlink to a directory, and a photo
      // directory arranged by link is an ordinary case.
      dossier: e.isDirectory() || (e.isSymbolicLink() && estUnDossier(join(dossier, e.name))),
    }));
  } catch {
    return [];
  }
}

function estUnDossier(chemin: string): boolean {
  try {
    return statSync(chemin).isDirectory();
  } catch {
    return false;
  }
}

function existe(chemin: string): boolean {
  try {
    statSync(chemin);
    return true;
  } catch {
    return false;
  }
}

export interface Collecte {
  fichiers: string[];
  /** Patterns and paths that named no file. */
  introuvables: string[];
}

/**
 * The files named by the command line operands.
 *
 * A directory passed as an argument is expanded to its recognised files,
 * without descending: `geotager read photos/` processes the photos in
 * `photos`, not the four thousand in a backup subdirectory. Anyone who wants
 * the descent writes `photos/**` and says so.
 *
 * Duplicates are removed on the resolved path: `./a.jpg` and `a.jpg` are the
 * same file, and writing it twice would be wasted work at best and, with
 * `--in-place`, a second operation on the result of the first at worst.
 */
export function collecter(operandes: string[], tousLesTypes: boolean): Collecte {
  const fichiers: string[] = [];
  const introuvables: string[] = [];
  const vus = new Set<string>();

  const ajouter = (chemin: string) => {
    const cle = resolve(chemin);
    if (vus.has(cle)) return;
    vus.add(cle);
    fichiers.push(chemin);
  };

  const reconnu = (chemin: string) => {
    if (tousLesTypes) return true;
    const nom = basename(chemin).toLowerCase();
    return EXTENSIONS.some((x) => nom.endsWith(x));
  };

  for (const op of operandes) {
    if (A_UN_MOTIF(op)) {
      const trouves = developper(op).filter(reconnu).sort();
      if (trouves.length === 0) introuvables.push(op);
      else trouves.forEach(ajouter);
      continue;
    }

    if (estUnDossier(op)) {
      const dedans = entrees(op)
        .filter((e) => !e.dossier)
        .map((e) => join(op, e.nom))
        .filter(reconnu)
        .sort();
      if (dedans.length === 0) introuvables.push(op);
      else dedans.forEach(ajouter);
      continue;
    }

    // A path named explicitly is processed even if its extension is not in the
    // list: the format is recognised from the bytes, never from the name, and
    // refusing on the extension would contradict the engine's central rule.
    if (existe(op)) ajouter(op);
    else introuvables.push(op);
  }

  return { fichiers, introuvables };
}

/** The directory of a path, to put the produced file beside the original. */
export const dossierDe = (chemin: string): string => dirname(chemin);
