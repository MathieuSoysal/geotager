/**
 * Writes `dist/sw.js` from `scripts/sw-modele.js`.
 *
 * The precache list is derived from what the build actually produced. Writing it
 * by hand would guarantee it lies at the first rename: the files in `_astro/`
 * carry a content hash, so their names change on every modification.
 *
 * What goes in, and why:
 *
 *   - every page, in its URL form ("/", "/fr/", "/guides/…") rather than its
 *     file form: that is what the browser asks for, and so what the cache must
 *     key on. They are derived from the `index.html` files produced, never
 *     listed by hand. Rule 3 of the template requires it, and it only holds if
 *     the inventory is automatic: a page forgotten here would be a navigation
 *     the fallback would catch by serving the home page, so a guide address
 *     quietly answering with something other than the guide;
 *   - the stylesheet and the interface island;
 *   - the reading worker. It is loaded by `new Worker(new URL(...))`, so it
 *     appears in no tag and a scan of the HTML would never see it. Without it
 *     the cache can display the page but not read a photo, which is the most
 *     baffling failure possible;
 *   - the manifest and the icons, so the installed app depends on nothing at
 *     startup.
 *
 * What stays out: the map chunk. See the template's comment.
 *
 * A check in `check-build.mjs` sweeps every literal absolute URL out of the
 * served JavaScript, `dist/sw.js` included: everything below must therefore stay
 * relative to the origin, without exception.
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

/** The path of a file in `dist/`, as the browser will ask for it. */
const adresse = (f) => '/' + relative(DIR, f).split(/[\\/]/).join('/');

const actifs = tous.map(adresse);

/** The map chunk, recognised by its entry name. Never precached. */
const estCarte = (a) => /^\/_astro\/carte\./.test(a);

/*
 * Navigation URLs, not file paths.
 *
 * An error page is not one: `404.html` is not called `index.html`, so it drops
 * out on its own, which is what we want. Precaching a page that says "this
 * address does not exist" would be the one cache entry whose presence helps
 * nobody.
 */
const navigations = tous
  .filter((f) => /(^|[\\/])index\.html$/.test(f))
  .map((f) => adresse(f).replace(/index\.html$/, ''));

const precache = [
  ...navigations,
  ...actifs.filter((a) => a.startsWith('/_astro/') && extname(a) === '.css'),
  ...actifs.filter((a) => a.startsWith('/_astro/') && extname(a) === '.js' && !estCarte(a)),
  ...actifs.filter((a) => a.startsWith('/icons/')),
  ...actifs.filter((a) => a.endsWith('.webmanifest')),
];

// Guard rails

const echecs = [];

// The reading worker is referenced by no tag: if it falls off the list, the
// page opens offline and refuses every photo, without a word.
if (!precache.some((a) => /^\/_astro\/exif\.worker[-.]/.test(a))) {
  echecs.push("le worker de lecture n'est pas dans la liste de préchargement");
}
if (!precache.some((a) => extname(a) === '.css')) {
  echecs.push('aucune feuille de style dans la liste de préchargement');
}
if (precache.some(estCarte)) {
  echecs.push('le morceau de la carte ne doit pas être préchargé');
}
// The root is the last resort of the offline navigation handler. Without it,
// an unknown address leads nowhere at all.
if (!navigations.includes('/')) echecs.push("la racine n'est pas dans la liste de préchargement");
for (const a of precache) {
  const cible = a.endsWith('/') ? `${a.slice(1)}index.html` : a.slice(1);
  if (!existsSync(join(DIR, cible))) echecs.push(`${a} n'existe pas dans ${DIR}/`);
}

/*
 * A cap, because `addAll` is atomic and is paid for at install time.
 *
 * The precache carried two pages; it carries sixteen, and it will carry more
 * the day a guide is added. A derived list grows on its own and silently: that
 * is its virtue, and it is also what means that one day a first visit would
 * download several megabytes before having served any purpose. The cap does not
 * say "do not add guides", it says "beyond this it is no longer a shell, and
 * what to precache has to be decided". The figure is printed on every build,
 * not merely compared.
 */
const BUDGET_PRECACHE = 2 * 1024 * 1024;
const fichierDe = (a) => join(DIR, a.endsWith('/') ? `${a.slice(1)}index.html` : a.slice(1));
const poids = precache.reduce(
  (n, a) => n + (existsSync(fichierDe(a)) ? statSync(fichierDe(a)).size : 0),
  0,
);
if (poids > BUDGET_PRECACHE) {
  echecs.push(`précache de ${poids} o, plafond ${BUDGET_PRECACHE} o`);
}
if (echecs.length) {
  console.error('\ngen-sw en échec :');
  for (const e of echecs) console.error(`  - ${e}`);
  process.exit(1);
}

/*
 * The version is the hash of the precached content rather than a date: two
 * builds of the same code produce the same worker, so no update is offered for
 * nothing. A build that changes anything produces a different one, and the
 * browser, which compares `sw.js` byte for byte, sees it.
 */
const empreinte = createHash('sha256');
for (const a of precache.slice().sort()) {
  empreinte.update(a);
  const f = fichierDe(a);
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
console.log(
  `  service worker ${version} — ${precache.length} entrées précachées ` +
    `(${navigations.length} pages, ${Math.round(poids / 1024)} Ko, ` +
    `${((poids / BUDGET_PRECACHE) * 100).toFixed(1)} % du budget)`,
);
