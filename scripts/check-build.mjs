/**
 * Blocking build checks.
 *
 * Cloudflare reads only the build command's exit code: exiting 0 publishes the
 * assets even if errors were written to stderr. Every failure must therefore
 * turn into a non-zero code, never into a message.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, extname, relative } from 'node:path';

const DIR = 'dist';
const BUDGET_JS_GZIP = 150 * 1024;
const MAX_TITLE = 60;
const MAX_META = 155;
const MAX_FICHIERS = 20_000; // plafond Workers, plan gratuit
const MAX_TAILLE = 25 * 1024 * 1024;

/** Hosts allowed as a hyperlink. None is loaded as a resource. */
const LIENS_AUTORISES = new Set([
  'geotager.app',
  'www.geotager.app',
  'github.com',
  'schema.org',
  'exiftool.org',
  'developer.mozilla.org',
  // The attribution OpenStreetMap requires. It is a link, not a resource.
  'www.openstreetmap.org',
]);

/**
 * Hosts allowed as a resource: the project's only exception, and it fits on one
 * finger. Every entry here must be justified in CREDITS.md.
 */
const RESSOURCES_AUTORISEES = new Set([
  // Tiles for the location picker map, loaded only if the user opens the map.
  // See CREDITS.md.
  'tile.openstreetmap.org',
]);

/**
 * Hosts that appear as URLs without ever being fetched: XML namespace
 * identifiers, which look like addresses because the specification says so.
 * `exifr` carries two for XMP. No browser fetches them, and mistaking them for
 * a resource would make the check cry wolf, which is the surest way to get it
 * disabled.
 */
const HOTES_DECLARATIFS = new Set(['ns.adobe.com']);

/** The host of a URL, or null if it cannot be parsed. */
function hote(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

const echecs = [];
const infos = [];

if (!existsSync(DIR)) {
  console.error(`Contrôles de build : le répertoire ${DIR}/ n'existe pas.`);
  process.exit(1);
}

const fichiers = (function liste(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? liste(join(dir, e.name)) : [join(dir, e.name)],
  );
})(DIR);

const rel = (f) => relative(DIR, f);

/**
 * The length a search engine actually perceives. Astro escapes the apostrophe
 * as `&#39;`, so counting the HTML's bytes would overstate the title by four
 * characters per apostrophe.
 */
/** Decodes HTML entities, to compare text rather than escaping. */
function texteVisible(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .trim();
}

const longueurVisible = (s) => texteVisible(s).length;

// 1. Structure and caps

if (!fichiers.includes(join(DIR, 'index.html'))) echecs.push("dist/index.html est absent");
if (fichiers.length > MAX_FICHIERS) echecs.push(`${fichiers.length} fichiers, plafond ${MAX_FICHIERS}`);
for (const f of fichiers) {
  const o = statSync(f).size;
  if (o > MAX_TAILLE) echecs.push(`${rel(f)} fait ${o} o, plafond 25 MiB`);
}

// 2. No third-party resource

/*
 * We distinguish a hyperlink, where the user clicks and nothing loads, from a
 * resource, which the browser fetches on its own. Only the second is forbidden.
 *
 * That criterion admitted no exception. It now admits one, named in
 * `RESSOURCES_AUTORISEES`: the map tiles, which nothing requests until the user
 * opens the map.
 *
 * And the list below was not enough. It looks for HTML and CSS forms:
 * `<img src=…>`, `url(…)`, `fetch('…')`. A URL built in JavaScript by
 * concatenation triggers none of them, and a third-party basemap would have
 * gone through without a word. The next check closes that gap.
 */
const RESSOURCES = [
  /<script[^>]+src\s*=\s*["'](https?:\/\/[^"']+)/gi,
  // `rel="canonical"` and `rel="alternate"` declare a URL, they load nothing:
  // they are excluded explicitly rather than through a hidden exception.
  /<link(?![^>]*rel\s*=\s*["'](?:canonical|alternate)["'])[^>]+href\s*=\s*["'](https?:\/\/[^"']+)/gi,
  /<img[^>]+src\s*=\s*["'](https?:\/\/[^"']+)/gi,
  /<(?:video|audio|source|iframe|embed)[^>]+src\s*=\s*["'](https?:\/\/[^"']+)/gi,
  // `(?<![\w-])`: without it, the `i` flag matches `URL(` as readily as
  // `url(`, and a perfectly legitimate `new URL('https://…')` fails the build
  // with a message blaming a stylesheet.
  /(?<![\w-])url\(\s*["']?(https?:\/\/[^)"']+)/gi,
  /@import\s+["'](https?:\/\/[^"']+)/gi,
  /\bfetch\(\s*["'`](https?:\/\/[^"'`]+)/gi,
];

// `.webmanifest` is part of it: it is the only file on the site where an icon
// hosted elsewhere, or a share target, or a screenshot, would pass with nothing
// seeing it. Leaving it out of the sweep would have opened a hole in the
// project's main guard rail at the very moment the file was added.
const textes = fichiers.filter((f) =>
  ['.html', '.css', '.js', '.mjs', '.json', '.xml', '.webmanifest'].includes(extname(f)),
);
for (const f of textes) {
  const contenu = readFileSync(f, 'utf8');
  for (const re of RESSOURCES) {
    re.lastIndex = 0;
    for (const m of contenu.matchAll(re)) {
      if (RESSOURCES_AUTORISEES.has(hote(m[1]))) continue;
      echecs.push(`${rel(f)} charge une ressource tierce : ${m[1].slice(0, 80)}`);
    }
  }
  // Hyperlinks are still checked, but against an allowlist.
  for (const m of contenu.matchAll(/<a[^>]+href\s*=\s*["']https?:\/\/([^"'/]+)/gi)) {
    if (!LIENS_AUTORISES.has(m[1])) {
      echecs.push(`${rel(f)} pointe vers un hôte non listé : ${m[1]}`);
    }
  }
}

// 2b. No unexpected absolute URL in the JavaScript

/*
 * The patterns above catch tags and calls written out in full. They do not
 * catch `const T = 'https://example/{z}/{x}/{y}.png'`, which is nonetheless
 * enough to load a third party from an `<img>` built on the fly. So every
 * literal absolute URL in the served JavaScript is checked against the union of
 * the two allowlists.
 *
 * No file in the repository put one in the bundle before the map: this check is
 * born green, and it only means anything on that condition.
 */
const AUTORISES = new Set([...LIENS_AUTORISES, ...RESSOURCES_AUTORISEES, ...HOTES_DECLARATIFS]);
for (const f of fichiers.filter((x) => ['.js', '.mjs'].includes(extname(x)))) {
  const contenu = readFileSync(f, 'utf8');
  for (const m of contenu.matchAll(/["'`](https?:\/\/[^"'`\s]+)["'`]/g)) {
    const h = hote(m[1]);
    if (h && AUTORISES.has(h)) continue;
    echecs.push(`${rel(f)} contient une URL absolue non listée : ${m[1].slice(0, 80)}`);
  }
}

// 3. Titles, metas and content served without JavaScript

/*
 * The expected content blocks, per language. They must exist in the served
 * HTML, so without JavaScript. A language missing from this table fails the
 * build: adding a page without adding its checks would mean publishing a page
 * nothing verifies.
 */
const BLOCS_OBLIGATOIRES = {
  fr: [
    ['pourquoi vos fichiers ne partent pas', /Pourquoi vos fichiers ne partent pas/i],
    ["mode d'emploi", /Mode d'emploi/i],
    ['limites par format', /ce qu'il ne sait pas encore/i],
    ["ce qu'est une donnée GPS", /Ce qu'est une donnée GPS/i],
    ['vie privée', /Ce qu'un géotag révèle/i],
    ['vérification externe', /exiftool/i],
  ],
  en: [
    ['why your files never leave', /Why your files never leave/i],
    ['how to use it', /How to use it/i],
    ['per-format limits', /what it cannot do yet/i],
    ['what GPS data is', /What GPS data in a photo actually is/i],
    ['privacy', /What a geotag gives away/i],
    ['external verification', /exiftool/i],
  ],
};

for (const f of fichiers.filter((x) => extname(x) === '.html')) {
  const html = readFileSync(f, 'utf8');
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  // The capture must stop at the opening quote, not at the first apostrophe: a
  // French description almost always contains one.
  const meta = html.match(/<meta\s+name=(["'])description\1\s+content=(["'])([\s\S]*?)\2/i)?.[3];
  const nTitle = title ? longueurVisible(title) : 0;
  const nMeta = meta ? longueurVisible(meta) : 0;
  if (!title) echecs.push(`${rel(f)} n'a pas de <title>`);
  else if (nTitle > MAX_TITLE)
    echecs.push(`${rel(f)} : title de ${nTitle} caractères, plafond ${MAX_TITLE}`);
  else infos.push(`title ${String(nTitle).padStart(3)} car. — ${rel(f)}`);

  if (!meta) echecs.push(`${rel(f)} n'a pas de meta description`);
  else if (nMeta > MAX_META)
    echecs.push(`${rel(f)} : meta de ${nMeta} caractères, plafond ${MAX_META}`);
  else infos.push(`meta  ${String(nMeta).padStart(3)} car. — ${rel(f)}`);

  const h1 = [...html.matchAll(/<h1[\s>]/gi)].length;
  if (h1 !== 1) echecs.push(`${rel(f)} contient ${h1} <h1>, il en faut exactement un`);

  // The content must exist without JavaScript: it is checked on the served
  // HTML, and in the language the page declares. An English page searched for
  // French headings would look empty.
  const lang = html.match(/<html[^>]+lang=["']([a-z-]+)["']/i)?.[1] ?? '';
  // Astro escapes apostrophes coming from an expression: "qu'il" becomes
  // "qu&#39;il". Searching for the raw text in escaped HTML would find nothing,
  // and would make a full page look empty.
  const lisible = texteVisible(html);
  const attendus = BLOCS_OBLIGATOIRES[lang];
  if (!attendus) {
    echecs.push(`${rel(f)} : langue « ${lang} » inconnue du contrôle de contenu`);
  } else {
    for (const [nom, re] of attendus) {
      if (!re.test(lisible)) echecs.push(`${rel(f)} : le bloc « ${nom} » est absent du HTML servi`);
    }
  }

  // Reciprocal links between languages: each page must announce every
  // language, itself included, without which Google ignores the declaration.
  for (const l of Object.keys(BLOCS_OBLIGATOIRES)) {
    if (!new RegExp(`hreflang=["']${l}["']`, 'i').test(html)) {
      echecs.push(`${rel(f)} : aucun lien alternatif ne déclare la langue « ${l} »`);
    }
  }
  if (!/hreflang=["']x-default["']/i.test(html)) {
    echecs.push(`${rel(f)} : aucun lien alternatif « x-default »`);
  }
}

// 4. JavaScript budget

const js = fichiers.filter((f) => ['.js', '.mjs'].includes(extname(f)));
const totalGzip = js.reduce((n, f) => n + gzipSync(readFileSync(f), { level: 9 }).length, 0);
infos.push(
  `JS ${js.length} fichiers, ${totalGzip} o gzip (${((totalGzip / BUDGET_JS_GZIP) * 100).toFixed(1)} % du budget)`,
);
if (totalGzip > BUDGET_JS_GZIP) {
  echecs.push(`budget JS dépassé : ${totalGzip} o gzip, plafond ${BUDGET_JS_GZIP}`);
}

// 5. Headers

const headers = join(DIR, '_headers');
if (existsSync(headers)) {
  let motif = '';
  const motifsNoindex = [];
  for (const ligne of readFileSync(headers, 'utf8').split('\n')) {
    if (/^\S/.test(ligne) && !ligne.startsWith('#')) motif = ligne.trim();
    else if (/x-robots-tag/i.test(ligne)) {
      // An X-Robots-Tag under a relative pattern would apply to the canonical
      // domain and de-index the site. It must exist only scoped by host.
      if (!motif.startsWith('https://')) {
        echecs.push(`_headers : X-Robots-Tag sous le motif relatif « ${motif} »`);
      } else {
        motifsNoindex.push(motif);
      }
    }
  }

  /*
   * A host pattern that matches nothing is worse than an absent one: it gives
   * the impression the technical domain is protected when it is not. On Workers
   * the host is <worker>.<subdomain>.workers.dev, three labels; the Pages
   * syntax had only two, and a placeholder does not cross the dot. So the right
   * count is required.
   */
  const hoteWorkers = motifsNoindex.filter((m) => m.includes('.workers.dev'));
  if (hoteWorkers.length === 0) {
    echecs.push('_headers : aucun X-Robots-Tag ne couvre le domaine technique workers.dev');
  }
  for (const m of hoteWorkers) {
    const hote = m.replace(/^https:\/\//, '').split('/')[0];
    const avant = hote.slice(0, -'.workers.dev'.length).split('.').filter(Boolean);
    if (avant.length < 2) {
      echecs.push(
        `_headers : le motif « ${m} » ne peut rien matcher — l'hôte Workers ` +
          `comporte <worker>.<sous-domaine>.workers.dev, il faut au moins deux étiquettes`,
      );
    }
  }
}

// 6. The deployment guard rail is in place

/*
 * A build once promoted to production from a working branch, because a
 * dashboard setting asked for it and nothing in the repository objected.
 * `scripts/deploy.mjs` puts the decision back in the repository; this check
 * verifies it has not been taken out again since. A guard rail you can delete
 * with nothing protesting is not a guard rail.
 */
{
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  if (!/scripts\/deploy\.mjs/.test(pkg.scripts?.deploy ?? '')) {
    echecs.push('package.json : le script « deploy » ne passe plus par scripts/deploy.mjs');
  }
  if (!existsSync('scripts/deploy.mjs')) {
    echecs.push('scripts/deploy.mjs est absent : plus rien ne protège de la promotion en production');
  }
  const branche = (process.env.WORKERS_CI_BRANCH ?? '').trim();
  if (branche) infos.push(`branche construite : « ${branche} »`);
}

// 7. The README table says the same thing as the code

/*
 * The page's table is rendered from capacites.ts, so it cannot drift. The
 * README's is written by hand, so it can, and it is the first one somebody
 * discovering the project reads.
 *
 * The README is compared against the table actually served rather than against
 * the constant: the same witness, but stronger, since it bears on the published
 * artefact. It also avoids importing a TypeScript module from this script,
 * since the build image runs the version in `.nvmrc`, which cannot read them
 * without a flag.
 *
 * Cells are compared, not labels: the parenthesised note stays free on both
 * sides.
 */
for (const [fichierReadme, page] of [
  ['README.md', join(DIR, 'index.html')],
  ['README.fr.md', join(DIR, 'fr', 'index.html')],
]) {
  if (!existsSync(fichierReadme) || !existsSync(page)) {
    echecs.push(`${fichierReadme} ou ${rel(page)} est absent : le tableau n'est comparé à rien`);
    continue;
  }
  const sansBalises = (s) =>
    s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

  const html = readFileSync(page, 'utf8');
  const corps = html.match(/<table>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i)?.[1] ?? '';
  const servi = [...corps.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<td>([\s\S]*?)<\/td>/gi)].map((c) => sansBalises(c[1])),
  );

  const lu = readFileSync(fichierReadme, 'utf8')
    .split('\n')
    .filter((l) => /^\|/.test(l) && !/^\|\s*-+/.test(l) && !/\|\s*(Format)\s*\|/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));

  if (servi.length === 0) {
    echecs.push(`${rel(page)} : aucun tableau de capacités trouvé dans la page servie`);
  } else if (lu.length !== servi.length) {
    echecs.push(
      `${fichierReadme} : le tableau a ${lu.length} lignes, ${rel(page)} en compte ${servi.length}`,
    );
  } else {
    lu.forEach((ligne, i) => {
      // The row label is a `<th scope="row">` rather than a `<td>`: the list of
      // `<td>` therefore holds only the capabilities, and trimming it by one
      // would lose the first column instead of the format name.
      const dites = ligne.slice(1).join('|');
      const vraies = servi[i].join('|');
      if (dites !== vraies) {
        echecs.push(
          `${fichierReadme} : « ${ligne[0]} » annonce ${dites.replace(/\|/g, '/')}, ` +
            `${rel(page)} dit ${vraies.replace(/\|/g, '/')}`,
        );
      }
    });
  }
}

// 8. The manifest and its icons

/*
 * A missing icon is the quietest failure of the lot: the site goes on
 * displaying, installation goes on being offered, and it is only on the home
 * screen that you discover an empty square. On Chrome Android a 404 manifest
 * additionally suspends update checks for thirty days.
 *
 * So the whole chain is checked, from the page: the link exists, the target
 * exists, it is JSON, and each of its addresses names a file actually present
 * in `dist/`.
 */
{
  const pages = fichiers.filter((x) => extname(x) === '.html');
  for (const f of pages) {
    const html = readFileSync(f, 'utf8');
    const lien = html.match(/<link[^>]+rel=["']manifest["'][^>]*href=["']([^"']+)["']/i)?.[1];
    if (!lien) {
      echecs.push(`${rel(f)} : aucun <link rel="manifest">`);
      continue;
    }
    if (/^https?:/i.test(lien)) {
      echecs.push(`${rel(f)} : le manifeste est hébergé ailleurs — ${lien}`);
      continue;
    }
    const cible = join(DIR, lien.replace(/^\//, ''));
    if (!existsSync(cible)) {
      echecs.push(`${rel(f)} : le manifeste ${lien} n'existe pas dans ${DIR}/`);
      continue;
    }

    let m;
    try {
      m = JSON.parse(readFileSync(cible, 'utf8'));
    } catch (e) {
      echecs.push(`${rel(cible)} n'est pas du JSON valide : ${e.message}`);
      continue;
    }

    // `id` is an installation's identity. Two manifests that do not share it
    // are two applications, and changing it one day would orphan every existing
    // installation.
    if (m.id !== '/') echecs.push(`${rel(cible)} : « id » vaut « ${m.id} », il doit valoir « / »`);
    if (m.scope !== '/') echecs.push(`${rel(cible)} : « scope » doit valoir « / »`);

    /*
     * `share_target.action` and `file_handlers[].action` are addresses the
     * system will send the user's files to. One of them pointing anywhere but
     * here, and the share system would deliver photos to a third party, on the
     * strength of a manifest nobody re-reads. It is the place on the site where
     * a foreign address would cost the most, so it is the place we look.
     */
    const adresses = [
      ['start_url', m.start_url],
      ['scope', m.scope],
      ...(m.share_target ? [['share_target.action', m.share_target.action]] : []),
      ...(m.file_handlers ?? []).map((h, n) => [`file_handlers[${n}].action`, h.action]),
      ...(m.icons ?? []).map((i, n) => [`icons[${n}].src`, i.src]),
      ...(m.screenshots ?? []).map((i, n) => [`screenshots[${n}].src`, i.src]),
    ];
    for (const [nom, adresse] of adresses) {
      if (typeof adresse !== 'string') {
        echecs.push(`${rel(cible)} : « ${nom} » est absent`);
      } else if (/^https?:/i.test(adresse)) {
        echecs.push(`${rel(cible)} : « ${nom} » sort de l'origine — ${adresse}`);
      }
    }
    for (const [nom, src] of adresses.filter(([n]) => n.startsWith('icons') || n.startsWith('screenshots'))) {
      if (typeof src !== 'string' || /^https?:/i.test(src)) continue;
      if (!existsSync(join(DIR, src.replace(/^\//, '')))) {
        echecs.push(`${rel(cible)} : « ${nom} » désigne ${src}, absent de ${DIR}/`);
      }
    }

    // A maskable icon is cropped by up to 20% on each side. Without one, the
    // system makes its own by pasting the ordinary icon into the centre of a
    // white square, which is always ugly and often illegible.
    if (!(m.icons ?? []).some((i) => String(i.purpose ?? '').split(/\s+/).includes('maskable'))) {
      echecs.push(`${rel(cible)} : aucune icône « maskable »`);
    }

    /*
     * The share target exists only in the service worker: no file corresponds
     * to it in `dist/`. If the worker stopped recognising it, sharing would
     * fall to a 404 with nothing to warn us, while the manifest went on
     * promising it to the system.
     */
    if (m.share_target) {
      const sw = join(DIR, 'sw.js');
      const chemin = String(m.share_target.action ?? '');
      if (!existsSync(sw)) {
        echecs.push(`${rel(cible)} annonce un partage, mais ${rel(sw)} n'existe pas`);
      } else if (!new RegExp(String.raw`\$\{?\w*\}?|partager`).test(readFileSync(sw, 'utf8'))) {
        echecs.push(`${rel(sw)} ne reconnaît pas la cible de partage « ${chemin} »`);
      }
      if (m.share_target.method !== 'POST' || m.share_target.enctype !== 'multipart/form-data') {
        echecs.push(`${rel(cible)} : un partage de FICHIERS exige POST + multipart/form-data`);
      }
    }
  }

  // The `apple-touch-icon` link goes through no manifest: iOS reads only it.
  for (const f of pages) {
    const html = readFileSync(f, 'utf8');
    const apple = html.match(/<link[^>]+rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i)?.[1];
    if (!apple) echecs.push(`${rel(f)} : aucun <link rel="apple-touch-icon">`);
    else if (!existsSync(join(DIR, apple.replace(/^\//, '')))) {
      echecs.push(`${rel(f)} : apple-touch-icon ${apple} est absent de ${DIR}/`);
    }
  }
}

// Output

for (const i of infos) console.log(`  ${i}`);
if (echecs.length) {
  console.error(`\nContrôles de build en échec (${echecs.length}) :`);
  for (const e of echecs) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`\nContrôles de build passés — ${fichiers.length} fichiers dans ${DIR}/.`);
