#!/usr/bin/env node
/**
 * geotager — la ligne de commande.
 *
 * Elle ne sait rien du format des fichiers : tout le travail binaire est dans
 * `@geotager/core`, y compris la vérification qui précède chaque écriture. Ce
 * module ne fait que trois choses, et c'est délibérément peu — lire des
 * arguments, poser des octets sur le disque, et rendre compte.
 *
 * DEUX SORTIES, DEUX PUBLICS. Le JSON va sur la sortie standard et rien
 * d'autre n'y va jamais : un programme peut donc faire `geotager read '*.jpg' |
 * jq` sans filtrer quoi que ce soit. Les phrases pour l'humain vont sur la
 * sortie d'erreur, où elles ne polluent aucun tube. `--quiet` fait taire les
 * secondes et jamais la première.
 *
 * UNE RÈGLE AU-DESSUS DES AUTRES. L'original n'est pas écrasé sans
 * `--in-place`. Elle n'est pas appliquée à l'endroit où l'on construit le nom
 * du fichier produit — c'est trop tôt, et un `--out .` la contournerait — mais
 * juste avant d'ouvrir en écriture, sur les chemins RÉSOLUS. C'est le seul
 * endroit où la question « suis-je en train d'écraser une entrée ? » a une
 * réponse exacte.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import {
  type ApplyResult,
  type GpsCoordinates,
  applyGps,
  readMetadata,
} from '@geotager/core';

import { AIDE_GENERALE, AIDE_READ, AIDE_SET, AIDE_STRIP, VERSION } from './aide.ts';
import { type Analyse, analyser, drapeau, nombre, texte } from './args.ts';
import { collecter } from './motifs.ts';
import { phrase } from './phrases.ts';

/**
 * Les codes de sortie, et pourquoi ils sont si peu nombreux.
 *
 * Un appelant les teste ; il ne les devine pas. Quatre valeurs qu'on peut
 * retenir valent mieux que douze qu'il faudra chercher — et chacune répond à
 * une question différente : « ai-je mal appelé l'outil ? » (2), « a-t-il trouvé
 * de quoi travailler ? » (3), « a-t-il tout réussi ? » (0 ou 1).
 */
const OK = 0;
const ECHEC_PARTIEL = 1;
const ERREUR_USAGE = 2;
const AUCUN_FICHIER = 3;

/** Le JSON, et lui seul, sur la sortie standard. */
function rapporter(valeur: unknown): void {
  process.stdout.write(`${JSON.stringify(valeur, null, 2)}\n`);
}

/** Les phrases pour l'humain, sur la sortie d'erreur. */
function dire(silencieux: boolean, ...lignes: string[]): void {
  if (silencieux) return;
  for (const l of lignes) process.stderr.write(`${l}\n`);
}

function erreurUsage(message: string, aide?: string): number {
  process.stderr.write(`geotager: ${message}\n`);
  if (aide) process.stderr.write(`\n${aide}\n`);
  else process.stderr.write(`\nRun "geotager --help" for usage.\n`);
  return ERREUR_USAGE;
}

/* ------------------------------------------------------------------ */
/* Le nom du fichier produit                                           */
/* ------------------------------------------------------------------ */

interface Destination {
  suffixe: string;
  dossier: string | null;
  sansSuffixe: boolean;
  surPlace: boolean;
}

/**
 * Où poser le fichier produit.
 *
 * Le suffixe est inséré AVANT l'extension — `photo-geotagged.jpg` et non
 * `photo.jpg-geotagged` — parce que c'est l'extension qui décide de ce qui
 * ouvre le fichier, sur tous les systèmes. Un fichier produit que le système
 * n'associe plus à une visionneuse est un fichier que l'utilisateur croira
 * abîmé.
 */
function cheminDeSortie(entree: string, d: Destination): string {
  if (d.surPlace) return entree;

  const nom = basename(entree);
  const ext = extname(nom);
  const base = ext ? nom.slice(0, -ext.length) : nom;
  const final = d.sansSuffixe || d.dossier !== null ? nom : `${base}${d.suffixe}${ext}`;

  return d.dossier !== null ? join(d.dossier, final) : join(dossierParent(entree), final);
}

function dossierParent(chemin: string): string {
  const i = Math.max(chemin.lastIndexOf('/'), chemin.lastIndexOf('\\'));
  return i < 0 ? '.' : chemin.slice(0, i);
}

/* ------------------------------------------------------------------ */
/* read                                                                */
/* ------------------------------------------------------------------ */

async function commandeRead(a: Analyse): Promise<number> {
  if (drapeau(a, 'help')) {
    process.stdout.write(`${AIDE_READ}\n`);
    return OK;
  }
  const silencieux = drapeau(a, 'quiet');
  const { fichiers, introuvables } = collecter(a.operandes, drapeau(a, 'all'));

  if (a.operandes.length === 0) {
    return erreurUsage('read needs at least one file. Example: geotager read photo.jpg', AIDE_READ);
  }
  for (const m of introuvables) {
    process.stderr.write(`geotager: no files matched: ${m}\n`);
  }
  if (fichiers.length === 0) {
    return AUCUN_FICHIER;
  }

  const rapport: unknown[] = [];
  let echecs = 0;

  for (const chemin of fichiers) {
    try {
      const octets = readFileSync(chemin);
      const m = await readMetadata(octets);
      rapport.push({
        file: chemin,
        format: m.format,
        size: m.size,
        gps: m.gps,
        takenAt: m.takenAt,
        camera: m.camera,
        can: m.can,
        reason: m.reason,
      });
    } catch (e) {
      echecs++;
      rapport.push({ file: chemin, error: detailErreur(e) });
    }
  }

  rapporter(rapport);
  const avecLieu = rapport.filter((r) => (r as { gps?: unknown }).gps).length;
  dire(
    silencieux,
    `Read ${fichiers.length} file(s): ${avecLieu} with a location, ` +
      `${fichiers.length - avecLieu - echecs} without` +
      (echecs ? `, ${echecs} unreadable` : '') +
      '.',
  );
  return echecs > 0 ? ECHEC_PARTIEL : OK;
}

/* ------------------------------------------------------------------ */
/* set et strip                                                        */
/* ------------------------------------------------------------------ */

type Demande =
  | { kind: 'set'; lat: number; lng: number; alt?: number; accuracyMetres?: number }
  | { kind: 'strip' }
  | { kind: 'stripAll' };

async function commandeEcriture(a: Analyse, demande: Demande, aide: string): Promise<number> {
  const silencieux = drapeau(a, 'quiet');
  const essai = drapeau(a, 'dry-run');
  const surPlace = drapeau(a, 'in-place');
  const dossier = texte(a, 'out');
  const sansSuffixe = drapeau(a, 'no-suffix');

  if (sansSuffixe && dossier === null && !surPlace) {
    return erreurUsage(
      '--no-suffix would overwrite the originals. Pass --out <dir>, or --in-place if that is what you want.',
      aide,
    );
  }
  if (surPlace && dossier !== null) {
    return erreurUsage('--in-place and --out are mutually exclusive: pick one.', aide);
  }

  const { fichiers, introuvables } = collecter(a.operandes, drapeau(a, 'all'));
  if (a.operandes.length === 0) {
    return erreurUsage(`${demande.kind === 'set' ? 'set' : 'strip'} needs at least one file.`, aide);
  }
  for (const m of introuvables) {
    process.stderr.write(`geotager: no files matched: ${m}\n`);
  }
  if (fichiers.length === 0) return AUCUN_FICHIER;

  const suffixeParDefaut =
    demande.kind === 'set' ? '-geotagged' : demande.kind === 'strip' ? '-no-location' : '-no-metadata';
  const destination: Destination = {
    suffixe: texte(a, 'suffix') ?? suffixeParDefaut,
    dossier,
    sansSuffixe,
    surPlace,
  };

  if (dossier !== null && !essai) {
    try {
      mkdirSync(dossier, { recursive: true });
    } catch (e) {
      return erreurUsage(`cannot create output directory ${dossier}: ${message(e)}`);
    }
  }

  // Les chemins d'ENTRÉE, résolus une fois : c'est contre eux que chaque
  // écriture est confrontée juste avant d'avoir lieu.
  const entrees = new Set(fichiers.map((f) => resolve(f)));

  const rapport: unknown[] = [];
  let echecs = 0;
  let ecrits = 0;

  for (const chemin of fichiers) {
    const sortie = cheminDeSortie(chemin, destination);

    /*
     * La garantie, appliquée au dernier moment possible.
     *
     * `--out .` sur des fichiers du dossier courant produit un chemin de sortie
     * qui EST un chemin d'entrée, alors qu'aucune option d'écrasement n'a été
     * passée. La comparaison porte sur les chemins résolus, seule forme où
     * `./a.jpg`, `a.jpg` et `/abs/a.jpg` sont reconnus comme le même fichier.
     */
    if (!surPlace && entrees.has(resolve(sortie))) {
      echecs++;
      rapport.push({
        file: chemin,
        ok: false,
        error: {
          code: 'ECRASERAIT_ORIGINAL',
          message:
            `Refusing to write over the input file ${sortie}. ` +
            'Pass --in-place to overwrite originals, or choose a different --out directory.',
        },
      });
      continue;
    }

    let octets: Buffer;
    try {
      octets = readFileSync(chemin);
    } catch (e) {
      echecs++;
      rapport.push({ file: chemin, ok: false, error: detailErreur(e) });
      continue;
    }

    let r: ApplyResult;
    try {
      r = await applyGps(octets, demande);
    } catch (e) {
      echecs++;
      rapport.push({ file: chemin, ok: false, error: detailErreur(e) });
      continue;
    }

    if (!r.ok) {
      echecs++;
      rapport.push({
        file: chemin,
        ok: false,
        // Le code du moteur, les mots de cette interface : voir `phrases.ts`.
        error: {
          code: r.code,
          message: phrase(r.code, r.message),
          ...(r.reason ? { reason: r.reason } : {}),
        },
      });
      continue;
    }

    if (essai) {
      rapport.push({
        file: chemin,
        output: sortie,
        ok: true,
        wouldWrite: true,
        gps: nettoyer(r.verified),
        sameLength: r.sameLength,
      });
      continue;
    }

    try {
      writeFileSync(sortie, r.bytes);
    } catch (e) {
      echecs++;
      rapport.push({ file: chemin, ok: false, error: detailErreur(e) });
      continue;
    }

    ecrits++;
    rapport.push({
      file: chemin,
      output: sortie,
      ok: true,
      gps: nettoyer(r.verified),
      // Le moteur ne rend un fichier que s'il a prouvé cette égalité ; la
      // rapporter en clair évite qu'un appelant croie devoir la vérifier.
      bytesIdenticalOutsideLocation: true,
      sameLength: r.sameLength,
    });
  }

  rapporter(rapport);
  dire(
    silencieux,
    essai
      ? `Dry run: ${fichiers.length - echecs} file(s) would be written, ${echecs} would fail. Nothing was written.`
      : `Wrote ${ecrits} file(s)` +
          (echecs ? `, ${echecs} failed and were left untouched.` : '.'),
  );
  return echecs > 0 ? ECHEC_PARTIEL : OK;
}

/** Une position sans clé `alt` inutile quand le fichier n'en porte pas. */
function nettoyer(p: GpsCoordinates | null): GpsCoordinates | null {
  if (!p) return null;
  return p.alt === undefined ? { lat: p.lat, lng: p.lng } : p;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function detailErreur(e: unknown): { code: string; message: string } {
  /*
   * Une erreur du système de fichiers — `ENOENT`, `EACCES` — porte déjà un code
   * et un message anglais parfaitement clairs, et sa phrase NOMME le chemin
   * fautif. On la garde telle quelle : la table ne connaît que les codes du
   * moteur, et son repli rendrait ici le message d'origine de toute façon.
   */
  const code =
    e && typeof e === 'object' && 'code' in e && typeof e.code === 'string'
      ? e.code
      : 'ERREUR_INATTENDUE';
  return { code, message: phrase(code, message(e)) };
}

/* ------------------------------------------------------------------ */
/* Aiguillage                                                          */
/* ------------------------------------------------------------------ */

async function principal(argv: string[]): Promise<number> {
  const a = analyser(argv);

  if (a.inconnues.length > 0) {
    return erreurUsage(`unknown option: ${a.inconnues.join(', ')}`);
  }
  if (drapeau(a, 'version')) {
    process.stdout.write(`${VERSION}\n`);
    return OK;
  }
  /*
   * L'aide DEMANDÉE sort sur la sortie standard et rend 0 : c'est ce qu'on
   * venait chercher. L'aide affichée FAUTE de commande sort sur la sortie
   * d'erreur et rend 2 : sans cette distinction, `geotager > sortie.json`
   * écrirait une page d'aide dans un fichier qu'un programme s'apprête à lire
   * comme du JSON, et le dirait avec un code de succès.
   */
  if (drapeau(a, 'help') && a.commande === null) {
    process.stdout.write(`${AIDE_GENERALE}\n`);
    return OK;
  }
  if (a.commande === null) {
    process.stderr.write(`${AIDE_GENERALE}\n`);
    return ERREUR_USAGE;
  }

  switch (a.commande) {
    case 'read':
      return commandeRead(a);

    case 'set': {
      if (drapeau(a, 'help')) {
        process.stdout.write(`${AIDE_SET}\n`);
        return OK;
      }
      const lat = nombre(a, 'lat');
      const lng = nombre(a, 'lng') ?? nombre(a, 'lon');
      if (lat === null || lng === null) {
        return erreurUsage(
          'set requires --lat and --lng in decimal degrees. ' +
            'Example: geotager set photo.jpg --lat 48.8584 --lng 2.2945',
          AIDE_SET,
        );
      }
      // La plage est vérifiée ici ET dans le moteur. Ici pour le dire AVANT
      // d'ouvrir le moindre fichier, avec le nom de l'option fautive ; là-bas
      // parce que le moteur ne fait confiance à aucun appelant.
      if (Math.abs(lat) > 90) {
        return erreurUsage(`--lat ${lat} is out of range: latitude runs from -90 to 90.`, AIDE_SET);
      }
      if (Math.abs(lng) > 180) {
        return erreurUsage(
          `--lng ${lng} is out of range: longitude runs from -180 to 180.`,
          AIDE_SET,
        );
      }
      const alt = nombre(a, 'alt');
      const accuracy = nombre(a, 'accuracy');
      if (a.options.has('alt') && alt === null) {
        return erreurUsage('--alt expects a number of metres.', AIDE_SET);
      }
      if (a.options.has('accuracy') && accuracy === null) {
        return erreurUsage('--accuracy expects a number of metres.', AIDE_SET);
      }
      return commandeEcriture(
        a,
        {
          kind: 'set',
          lat,
          lng,
          ...(alt === null ? {} : { alt }),
          ...(accuracy === null ? {} : { accuracyMetres: accuracy }),
        },
        AIDE_SET,
      );
    }

    case 'strip': {
      if (drapeau(a, 'help')) {
        process.stdout.write(`${AIDE_STRIP}\n`);
        return OK;
      }
      return commandeEcriture(
        a,
        drapeau(a, 'all-metadata') ? { kind: 'stripAll' } : { kind: 'strip' },
        AIDE_STRIP,
      );
    }

    case 'help':
      process.stdout.write(`${AIDE_GENERALE}\n`);
      return OK;

    default:
      return erreurUsage(
        `unknown command: ${a.commande}. Expected one of: read, set, strip.`,
      );
  }
}

principal(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`geotager: ${message(e)}\n`);
    process.exitCode = ECHEC_PARTIEL;
  },
);
