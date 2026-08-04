#!/usr/bin/env node
/**
 * geotager: the command line.
 *
 * It knows nothing about file formats: all the binary work is in
 * `@geotager/core`, including the verification that precedes every write. This
 * module does three things, and deliberately few: parse arguments, put bytes on
 * disk, and report.
 *
 * Two outputs, two audiences. JSON goes to standard output and nothing else
 * ever does, so a program can run `geotager read '*.jpg' | jq` without
 * filtering anything. Sentences for humans go to standard error, where they
 * pollute no pipe. `--quiet` silences the latter and never the former.
 *
 * One rule above the others: the original is not overwritten without
 * `--in-place`. It is not enforced where the output name is built, which is too
 * early and which an `--out .` would slip past, but immediately before opening
 * for writing, on resolved paths. That is the only place where "am I about to
 * overwrite an input?" has an exact answer.
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
 * The exit codes, and why there are so few.
 *
 * A caller tests them; it does not guess them. Four values you can remember
 * beat twelve you have to look up, and each answers a different question: did I
 * call the tool wrongly (2), did it find anything to work on (3), did it all
 * succeed (0 or 1).
 */
const OK = 0;
const ECHEC_PARTIEL = 1;
const ERREUR_USAGE = 2;
const AUCUN_FICHIER = 3;

/** JSON, and only JSON, on standard output. */
function rapporter(valeur: unknown): void {
  process.stdout.write(`${JSON.stringify(valeur, null, 2)}\n`);
}

/** Sentences for humans, on standard error. */
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

// Naming the produced file

interface Destination {
  suffixe: string;
  dossier: string | null;
  sansSuffixe: boolean;
  surPlace: boolean;
}

/**
 * Where to put the produced file.
 *
 * The suffix goes before the extension (`photo-geotagged.jpg`, not
 * `photo.jpg-geotagged`) because on every system it is the extension that
 * decides what opens the file. A produced file the system no longer associates
 * with a viewer is a file the user will believe is broken.
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

// read

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

// set and strip

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

  // The input paths, resolved once: every write is checked against them just
  // before it happens.
  const entrees = new Set(fichiers.map((f) => resolve(f)));

  const rapport: unknown[] = [];
  let echecs = 0;
  let ecrits = 0;

  for (const chemin of fichiers) {
    const sortie = cheminDeSortie(chemin, destination);

    /*
     * The guarantee, applied at the last possible moment.
     *
     * `--out .` on files in the current directory produces an output path that
     * is an input path, with no overwrite option passed. The comparison is on
     * resolved paths, the only form in which `./a.jpg`, `a.jpg` and
     * `/abs/a.jpg` are recognised as the same file.
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
        // The engine's code, this interface's words: see `phrases.ts`.
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
      // The engine only returns a file once it has proved this equality;
      // reporting it plainly saves a caller from thinking they must check it.
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

/** A location without a useless `alt` key when the file carries none. */
function nettoyer(p: GpsCoordinates | null): GpsCoordinates | null {
  if (!p) return null;
  return p.alt === undefined ? { lat: p.lat, lng: p.lng } : p;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function detailErreur(e: unknown): { code: string; message: string } {
  /*
   * A filesystem error (`ENOENT`, `EACCES`) already carries a perfectly clear
   * code and English message, and its sentence names the offending path. It is
   * kept as it is: the table only knows engine codes, and its fallback would
   * return the original message here anyway.
   */
  const code =
    e && typeof e === 'object' && 'code' in e && typeof e.code === 'string'
      ? e.code
      : 'ERREUR_INATTENDUE';
  return { code, message: phrase(code, message(e)) };
}

// Dispatch

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
   * Help that was asked for goes to standard output and returns 0: it is what
   * the user came for. Help shown for lack of a command goes to standard error
   * and returns 2. Without that distinction, `geotager > out.json` would write
   * a help page into a file a program is about to read as JSON, and report
   * success while doing it.
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
      // The range is checked here and in the engine. Here so it can be said
      // before any file is opened, naming the offending option; there because
      // the engine trusts no caller.
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
