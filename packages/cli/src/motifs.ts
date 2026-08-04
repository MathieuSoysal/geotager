/**
 * Développement des motifs de chemin, et collecte des fichiers à traiter.
 *
 * Pourquoi ce module existe alors que le shell développe déjà les motifs : il
 * ne le fait pas toujours, et surtout pas quand ça compte.
 *
 *   - `cmd.exe` et PowerShell ne développent RIEN : sous Windows, le motif
 *     arrive au programme tel qu'il a été tapé.
 *   - Un motif cité — `geotager read '*.jpg'` — arrive intact partout, et le
 *     citer est ce qu'on fait naturellement quand on ne veut pas que le shell
 *     s'en mêle.
 *   - Un agent qui construit une ligne de commande n'a souvent PAS de shell
 *     entre lui et le programme : `spawn` sans `shell: true` passe les
 *     arguments littéralement.
 *
 * Sans ce module, tous ces cas rendraient « fichier introuvable : *.jpg », ce
 * qui est le genre de message qui fait conclure à tort que l'outil est cassé.
 *
 * On développe donc nous-mêmes, ET on accepte ce que le shell a déjà développé
 * — un chemin sans caractère de motif n'est pas modifié, il est juste vérifié.
 */

import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

/** Extensions que l'outil sait ouvrir. Sert à `--all` et aux dossiers. */
export const EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif',
  '.avif', '.tif', '.tiff', '.gif', '.mp4', '.m4v', '.mov',
];

const A_UN_MOTIF = (s: string) => /[*?[\]{}]/.test(s);

/**
 * Un segment de motif → une expression régulière ancrée.
 *
 * `*` ne traverse pas un séparateur, `?` vaut un caractère, `[abc]` une classe,
 * `{a,b}` une alternative. Tout le reste est littéral — et l'échappement est
 * exhaustif plutôt que sélectif : un fichier nommé `photo (1).jpg` contient des
 * parenthèses, qui sans échappement deviendraient un groupe de capture et
 * feraient correspondre le motif à des noms qu'il ne désigne pas.
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
        // `[!abc]` est la négation en glob, `[^abc]` en expression régulière.
        out += `[${dedans.startsWith('!') ? '^' + dedans.slice(1) : dedans}]`;
        i = fin;
      }
    } else out += c.replace(/[.+^$()|\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/**
 * Les fichiers désignés par un motif, triés.
 *
 * Le parcours part du plus long préfixe SANS caractère de motif : `photos/2024/
 * *.jpg` n'ouvre pas la racine du disque pour la filtrer ensuite, il ouvre
 * `photos/2024`. `**` traverse les sous-dossiers, et une profondeur maximale le
 * borne — un lien symbolique circulaire ne doit pas faire tourner l'outil sans
 * fin sur les photos de quelqu'un.
 */
const PROFONDEUR_MAX = 32;

function developper(motif: string): string[] {
  const normalise = motif.split(sep === '\\' ? /[\\/]/ : '/').filter((s) => s !== '');
  const absolu = isAbsolute(motif);
  const racine = absolu ? (motif.startsWith(sep) ? sep : motif.slice(0, motif.indexOf(sep) + 1)) : '.';

  // Le préfixe fixe : tout ce qui précède le premier segment à motif.
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
      // `**` vaut « zéro dossier ou plus » : on essaie d'abord de le sauter,
      // puis on descend. Sans le saut, `**/*.jpg` raterait les fichiers du
      // dossier de départ lui-même.
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
      // `isDirectory` est faux sur un lien symbolique VERS un dossier, et un
      // dossier de photos rangé par lien est un cas ordinaire.
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
  /** Motifs et chemins qui n'ont désigné aucun fichier. */
  introuvables: string[];
}

/**
 * Les fichiers désignés par les opérandes de la ligne de commande.
 *
 * Un DOSSIER passé en argument est développé en ses fichiers reconnus, sans
 * descendre : `geotager read photos/` traite les photos de `photos`, et pas les
 * quatre mille d'un sous-dossier de sauvegarde. Qui veut la descente écrit
 * `photos/**` et le dit.
 *
 * Les doublons sont retirés sur le chemin RÉSOLU : `./a.jpg` et `a.jpg` sont le
 * même fichier, et l'écrire deux fois serait au mieux du travail perdu, au pire
 * — avec `--in-place` — une seconde opération sur le résultat de la première.
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

    // Un chemin nommé explicitement est traité même si son extension n'est pas
    // dans la liste : le format est reconnu aux OCTETS, jamais au nom, et
    // refuser sur l'extension contredirait la règle centrale du moteur.
    if (existe(op)) ajouter(op);
    else introuvables.push(op);
  }

  return { fichiers, introuvables };
}

/** Le dossier d'un chemin, pour poser le fichier produit à côté de l'original. */
export const dossierDe = (chemin: string): string => dirname(chemin);
