/**
 * Command-line parsing.
 *
 * Written by hand rather than delegated: this package has exactly one
 * dependency, its own engine, and that is a property you can check at a glance
 * in `package.json`. A tool whose selling point is that nothing leaves your
 * machine owes you a dependency tree a human can read in full.
 *
 * `node:util.parseArgs` would have done, but for one detail that matters here:
 * it does not distinguish "option absent" from "option present but empty", and
 * it refuses an attached negative value. Coordinates are negative half the
 * time, so a parser whose rules we know exactly is preferable.
 */

export interface Analyse {
  commande: string | null;
  /** Whatever was not an option: paths, patterns. */
  operandes: string[];
  options: Map<string, string | true>;
  /** Options written but not recognised, so the message can name the mistake. */
  inconnues: string[];
}

/**
 * The options that expect a value. Everything else is a flag.
 *
 * This list is what separates `--out dir` (two words, one option) from
 * `--in-place file.jpg` (a flag, then a path). Without it we would have to
 * guess, and guessing would drop a file from the list to process, silently.
 */
const AVEC_VALEUR = new Set([
  'lat',
  'lng',
  'lon',
  'alt',
  'out',
  'accuracy',
  'suffix',
  'format',
]);

const DRAPEAUX = new Set([
  'in-place',
  'help',
  'version',
  'quiet',
  'dry-run',
  'all',
  'all-metadata',
  'no-suffix',
]);

/** Short options, and the long option each maps to. */
const COURTES: Record<string, string> = {
  h: 'help',
  v: 'version',
  o: 'out',
  q: 'quiet',
  n: 'dry-run',
};

export function analyser(argv: string[]): Analyse {
  const operandes: string[] = [];
  const options = new Map<string, string | true>();
  const inconnues: string[] = [];
  let commande: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    /*
     * `--` closes the options: everything after it is a path, even if it
     * starts with a dash. This is not POSIX affectation; a file can legitimately
     * be called `-2024-photo.jpg`, and without this there would be no way to
     * name it.
     */
    if (arg === '--') {
      operandes.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const corps = arg.slice(2);
      const egal = corps.indexOf('=');
      const nom = egal < 0 ? corps : corps.slice(0, egal);
      const collee = egal < 0 ? null : corps.slice(egal + 1);

      if (AVEC_VALEUR.has(nom)) {
        if (collee !== null) {
          options.set(nom, collee);
        } else if (i + 1 < argv.length) {
          options.set(nom, argv[++i]);
        } else {
          // A value option with no value: keep it empty rather than drop it,
          // so validation can say "--lat expects a number" instead of "--lat
          // missing".
          options.set(nom, '');
        }
        continue;
      }
      if (DRAPEAUX.has(nom)) {
        options.set(nom, true);
        continue;
      }
      inconnues.push(arg);
      continue;
    }

    // A short option. `-o dir` and `-o=dir`; short flags do not bundle, since
    // there are five of them and bundling would help nobody.
    if (arg.length > 1 && arg[0] === '-' && !estUnNombre(arg)) {
      const corps = arg.slice(1);
      const egal = corps.indexOf('=');
      const lettre = egal < 0 ? corps : corps.slice(0, egal);
      const nom = COURTES[lettre];
      if (!nom) {
        inconnues.push(arg);
        continue;
      }
      if (AVEC_VALEUR.has(nom)) {
        const collee = egal < 0 ? null : corps.slice(egal + 1);
        if (collee !== null) options.set(nom, collee);
        else if (i + 1 < argv.length) options.set(nom, argv[++i]);
        else options.set(nom, '');
      } else {
        options.set(nom, true);
      }
      continue;
    }

    if (commande === null) commande = arg;
    else operandes.push(arg);
  }

  return { commande, operandes, options, inconnues };
}

/**
 * True if the word is a negative number rather than a short option.
 *
 * Without this question, `geotager set photo.jpg --lat -33.9 --lng 151.2`
 * works, since the value is consumed by `--lat`, but a bare `-33.9` arriving
 * from a script that quoted its arguments badly would be read as the short
 * option `-3`. The message would say "unknown option -33.9", which is true and
 * useless.
 */
function estUnNombre(mot: string): boolean {
  return /^-\d/.test(mot);
}

/** An option's value as a finite number, or null. */
export function nombre(a: Analyse, nom: string): number | null {
  const v = a.options.get(nom);
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : null;
}

/** An option's value as non-empty text, or null. */
export function texte(a: Analyse, nom: string): string | null {
  const v = a.options.get(nom);
  return typeof v === 'string' && v !== '' ? v : null;
}

export const drapeau = (a: Analyse, nom: string): boolean => a.options.get(nom) === true;
