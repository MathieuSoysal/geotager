/**
 * Lecture de la ligne de commande.
 *
 * Écrite à la main plutôt que déléguée : ce paquet n'a qu'UNE dépendance, son
 * propre moteur, et c'est une propriété qu'on peut vérifier d'un coup d'œil sur
 * `package.json`. Un outil dont l'argument de vente est « rien ne quitte votre
 * machine » se doit d'avoir un arbre de dépendances qu'un humain peut lire en
 * entier.
 *
 * `node:util.parseArgs` aurait fait l'affaire, à un détail près qui compte pour
 * l'usage visé : il ne distingue pas « option absente » de « option présente
 * mais vide », et il refuse une valeur négative accolée — `--lat -33.9` passe,
 * `--lat=-33.9` aussi, mais le premier n'est reconnu comme valeur que parce
 * qu'on l'a déclaré. Les coordonnées sont négatives une fois sur deux ; on
 * préfère un lecteur dont on connaît exactement la règle.
 */

export interface Analyse {
  commande: string | null;
  /** Ce qui n'était pas une option : chemins, motifs. */
  operandes: string[];
  options: Map<string, string | true>;
  /** Options écrites mais pas reconnues, pour un message qui NOMME la faute. */
  inconnues: string[];
}

/**
 * Les options qui attendent une valeur. Toutes les autres sont des drapeaux.
 *
 * Cette liste est ce qui permet de trancher `--out dossier` (deux mots, une
 * option) de `--in-place fichier.jpg` (un drapeau, puis un chemin). Sans elle
 * il faudrait deviner, et deviner ferait disparaître un fichier de la liste
 * des fichiers à traiter — sans un mot.
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

/** Options courtes, et l'option longue qu'elles désignent. */
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
     * `--` ferme les options : tout ce qui suit est un chemin, même si ça
     * commence par un tiret. Ce n'est pas une coquetterie POSIX — un fichier
     * peut légitimement s'appeler `-2024-photo.jpg`, et sans cette porte il
     * n'y aurait aucun moyen de le nommer.
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
          // Une option de valeur sans valeur : on la retient VIDE plutôt que de
          // l'ignorer, pour que la validation puisse dire « --lat attend un
          // nombre » au lieu de « --lat manquant ».
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

    // Une option courte. `-o dossier` et `-o=dossier` ; les drapeaux courts
    // ne se groupent pas — il y en a cinq, et les grouper n'aiderait personne.
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
 * Vrai si le mot est un nombre négatif et non une option courte.
 *
 * Sans cette question, `geotager set photo.jpg --lat -33.9 --lng 151.2` marche
 * — la valeur est consommée par `--lat` — mais `-33.9` seul, arrivé là par un
 * script qui a mal cité ses arguments, serait lu comme l'option courte `-3`.
 * Le message dirait « option inconnue -33.9 », ce qui est vrai et inutile.
 */
function estUnNombre(mot: string): boolean {
  return /^-\d/.test(mot);
}

/** La valeur d'une option, en nombre fini, ou null. */
export function nombre(a: Analyse, nom: string): number | null {
  const v = a.options.get(nom);
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : null;
}

/** La valeur d'une option, en texte non vide, ou null. */
export function texte(a: Analyse, nom: string): string | null {
  const v = a.options.get(nom);
  return typeof v === 'string' && v !== '' ? v : null;
}

export const drapeau = (a: Analyse, nom: string): boolean => a.options.get(nom) === true;
