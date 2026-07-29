/**
 * Écrit `dist/sw.js` à partir de `scripts/sw-modele.js`.
 *
 * La liste de préchargement est DÉRIVÉE de ce que la build a réellement produit.
 * L'écrire à la main serait la garantie qu'elle mente au premier renommage : les
 * fichiers de `_astro/` portent une empreinte de contenu, donc leur nom change à
 * chaque modification.
 *
 * Ce qui entre, et pourquoi :
 *
 *   - les deux pages, dans leur forme d'URL (« / » et « /fr/ ») et non de
 *     fichier : c'est ce que le navigateur demande, et donc ce que le cache doit
 *     porter comme clé ;
 *   - la feuille de style et l'îlot d'interface ;
 *   - le worker de lecture. Il est chargé par `new Worker(new URL(...))`, donc
 *     il n'apparaît dans aucune balise et un balayage du HTML ne le verrait
 *     jamais. Sans lui le cache sait afficher la page mais pas lire une photo,
 *     ce qui est la panne la plus déroutante possible ;
 *   - le manifeste et les icônes, pour que l'application installée ne dépende
 *     de rien au démarrage.
 *
 * Ce qui n'entre pas : le morceau de la carte. Voir le commentaire du modèle.
 *
 * Le contrôle §2 bis de `check-build.mjs` balaie toute URL absolue littérale du
 * JavaScript servi, `dist/sw.js` compris : tout ce qui suit doit donc rester
 * relatif à l'origine, sans exception.
 */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, extname } from 'node:path';

const DIR = 'dist';
const MODELE = 'scripts/sw-modele.js';
const SORTIE = join(DIR, 'sw.js');

if (!existsSync(DIR)) {
  console.error(`gen-sw : le répertoire ${DIR}/ n'existe pas.`);
  process.exit(1);
}

const tous = (function liste(d) {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? liste(join(d, e.name)) : [join(d, e.name)],
  );
})(DIR);

/** Le chemin d'un fichier de `dist/`, tel que le navigateur le demandera. */
const adresse = (f) => '/' + relative(DIR, f).split(/[\\/]/).join('/');

const actifs = tous.map(adresse);

/** Le morceau de la carte, reconnu à son nom d'entrée — jamais préchargé. */
const estCarte = (a) => /^\/_astro\/carte\./.test(a);

const precache = [
  // Les URLs de navigation, pas les chemins de fichier.
  '/',
  '/fr/',
  ...actifs.filter((a) => a.startsWith('/_astro/') && extname(a) === '.css'),
  ...actifs.filter((a) => a.startsWith('/_astro/') && extname(a) === '.js' && !estCarte(a)),
  ...actifs.filter((a) => a.startsWith('/icons/')),
  ...actifs.filter((a) => a.endsWith('.webmanifest')),
];

/* --- garde-fous ---------------------------------------------------- */

const echecs = [];

// Le worker de lecture n'est référencé par aucune balise : s'il tombe de la
// liste, la page s'ouvre hors ligne et refuse toutes les photos, sans un mot.
if (!precache.some((a) => /^\/_astro\/exif\.worker[-.]/.test(a))) {
  echecs.push("le worker de lecture n'est pas dans la liste de préchargement");
}
if (!precache.some((a) => extname(a) === '.css')) {
  echecs.push('aucune feuille de style dans la liste de préchargement');
}
if (precache.some(estCarte)) {
  echecs.push('le morceau de la carte ne doit pas être préchargé');
}
for (const a of precache) {
  if (a === '/' || a === '/fr/') continue;
  if (!existsSync(join(DIR, a.slice(1)))) echecs.push(`${a} n'existe pas dans ${DIR}/`);
}
if (echecs.length) {
  console.error('\ngen-sw en échec :');
  for (const e of echecs) console.error(`  - ${e}`);
  process.exit(1);
}

/*
 * La version est l'empreinte du CONTENU précaché, et non une date : deux builds
 * du même code produisent le même worker, donc aucune mise à jour n'est
 * proposée pour rien. Une build qui change quoi que ce soit en produit une
 * autre, et le navigateur — qui compare `sw.js` octet à octet — le voit.
 */
const empreinte = createHash('sha256');
for (const a of precache.slice().sort()) {
  empreinte.update(a);
  const f = join(DIR, a === '/' ? 'index.html' : a === '/fr/' ? 'fr/index.html' : a.slice(1));
  if (existsSync(f) && statSync(f).isFile()) empreinte.update(readFileSync(f));
}
const version = empreinte.digest('hex').slice(0, 12);

const code = readFileSync(MODELE, 'utf8')
  .replace('__VERSION__', version)
  .replace('__PRECACHE__', JSON.stringify(precache.sort(), null, 2));

if (/__VERSION__|__PRECACHE__/.test(code)) {
  console.error('gen-sw : un marqueur du modèle n\'a pas été remplacé.');
  process.exit(1);
}

writeFileSync(SORTIE, code);
console.log(`  service worker ${version} — ${precache.length} entrées précachées`);
