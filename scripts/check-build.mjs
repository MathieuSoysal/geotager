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

/**
 * A literal list from the built service worker, read back as it stands.
 *
 * `gen-sw.mjs` writes `PRECACHE` as JSON, and `sw-modele.js` writes `PARTAGE`
 * by hand with double quotes: both therefore read back through `JSON.parse`,
 * without a check having to guess what the worker recognises. An unreadable
 * list returns an empty array, and the caller decides whether to complain,
 * which is the only way not to turn an absence into a false success.
 */
function listeDuWorker(chemin, nom) {
  const trouve = readFileSync(chemin, 'utf8').match(
    new RegExp(String.raw`const ${nom} = (\[[\s\S]*?\]);`),
  );
  if (!trouve) return [];
  try {
    return JSON.parse(trouve[1]);
  } catch {
    return [];
  }
}

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

/**
 * An error page is not a page of the site.
 *
 * It has neither the tool's six prose blocks nor links between languages, and
 * requiring either would fail the build for a page whose role is precisely to
 * promise nothing. It does carry a `noindex`, and the check verifies that
 * below: the exclusion is named, it is not a hole.
 */
const estIntrouvable = (f) => /(^|[\\/])404\.html$/.test(f);

/** The pages we ask an engine to index, and only those. */
const pagesIndexables = fichiers.filter((x) => extname(x) === '.html' && !estIntrouvable(x));

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

  if (estIntrouvable(f)) {
    // What is asked of an error page, and nothing else: to say it does not want
    // to be indexed, and to lead somewhere.
    if (!/<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html)) {
      echecs.push(`${rel(f)} : une page d'erreur doit porter « noindex »`);
    }
    if (!/<a[^>]+href=["']\/(fr\/)?["']/i.test(html)) {
      echecs.push(`${rel(f)} : aucun lien de retour vers l'outil`);
    }
    continue;
  }

  /*
   * The install button, present and hidden.
   *
   * The `hidden` is the whole mechanism: the button is revealed only by the
   * browser's prompt, which never arrives if the app is already installed.
   * Losing it, one attribute, one line, would show it to everybody, including
   * where it can do nothing. Removing it outright would mean no longer offering
   * installation at all, with nothing to say so.
   */
  const bouton = html.match(/<button[^>]*\bid=["']installer["'][^>]*>/i)?.[0];
  if (!bouton) {
    echecs.push(`${rel(f)} : le bouton d'installation est absent`);
  } else if (!/\shidden(?=[\s>=])/i.test(bouton)) {
    echecs.push(`${rel(f)} : le bouton d'installation doit être « hidden » dans le HTML servi`);
  }

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

  // An indexable page must certainly not carry a noindex. The opposite of the
  // error page, and the most expensive failure of the lot: invisible on screen,
  // and it removes the site from results.
  if (/<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html)) {
    echecs.push(`${rel(f)} : une page du site porte « noindex »`);
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

    // `start_url` is the address the system opens when the icon is clicked. It
    // was only checked as a string: a missing page passed green.
    const depart = String(m.start_url ?? '');
    if (!depart.endsWith('/') || !existsSync(join(DIR, depart.replace(/^\//, ''), 'index.html'))) {
      echecs.push(`${rel(cible)} : « start_url » ne désigne aucune page — ${depart}`);
    }

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
     * What makes the application installable, and what nothing was checking.
     *
     * A browser only fires its install prompt if the manifest carries a name, a
     * description, a standalone display mode and icons of at least 192 and 512
     * pixels. While installation was only offered from the browser menu, losing
     * one went unnoticed. Now that a button depends on it, the same loss makes
     * it disappear from the page for everybody, with no message, no error,
     * nothing.
     */
    for (const [cle, valeur] of [
      ['name', m.name],
      ['short_name', m.short_name],
      ['description', m.description],
    ]) {
      if (typeof valeur !== 'string' || !valeur.trim()) {
        echecs.push(`${rel(cible)} : « ${cle} » est vide — le navigateur ne proposera pas d'installer`);
      }
    }
    if (!['standalone', 'fullscreen', 'minimal-ui'].includes(String(m.display))) {
      echecs.push(
        `${rel(cible)} : « display » vaut « ${m.display} » — seul un mode autonome rend installable`,
      );
    }
    for (const taille of ['192x192', '512x512']) {
      if (!(m.icons ?? []).some((i) => String(i.sizes ?? '').split(/\s+/).includes(taille))) {
        echecs.push(`${rel(cible)} : aucune icône « ${taille} », exigée pour l'installation`);
      }
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
      } else if (!listeDuWorker(sw, 'PARTAGE').includes(chemin)) {
        /*
         * This check was hollow for a long time. It looked for
         * `\$\{?\w*\}?|partager`, whose first branch accepts a bare "$", and
         * `sw.js` always contains one. It therefore passed whatever the worker
         * did, and the 404 the paragraph above says it prevents would have gone
         * to production without a word. It now reads the list the worker
         * actually consults.
         */
        echecs.push(`${rel(sw)} ne reconnaît pas la cible de partage « ${chemin} »`);
      }
      if (m.share_target.method !== 'POST' || m.share_target.enctype !== 'multipart/form-data') {
        echecs.push(`${rel(cible)} : un partage de FICHIERS exige POST + multipart/form-data`);
      }
    }

    /*
     * "Open with" is the other door through which the system sends files, and
     * the only one whose address names a real document. If it pointed slightly
     * wrong, a language that does not exist, a forgotten trailing slash, the
     * system would open a redirect or a 404, and nobody would know before a
     * user complained. It happened: launch handling shipped with no check
     * looking at it.
     */
    const sw = join(DIR, 'sw.js');
    const precache = existsSync(sw) ? listeDuWorker(sw, 'PRECACHE') : [];
    for (const [n, h] of (m.file_handlers ?? []).entries()) {
      const nom = `file_handlers[${n}]`;
      const action = String(h.action ?? '');

      /*
       * The trailing slash is not an affectation. `/fr` answers 307 at the host,
       * and a precached entry that redirects is stored as such: the worker would
       * return it to a navigation whose redirect mode is `manual`, which the
       * browser turns into a network error. It would not be "Open with" failing
       * then, it would be the whole application, offline.
       */
      if (!action.endsWith('/')) {
        echecs.push(`${rel(cible)} : « ${nom}.action » doit finir par « / » — ${action}`);
      } else if (!existsSync(join(DIR, action.replace(/^\//, ''), 'index.html'))) {
        echecs.push(`${rel(cible)} : « ${nom}.action » ne désigne aucune page — ${action}`);
      }
      if (!action.startsWith(String(m.scope ?? '/'))) {
        echecs.push(`${rel(cible)} : « ${nom}.action » sort de la portée — ${action}`);
      }
      /*
       * And it equals `start_url`. This is the check that really bites: the two
       * manifests differ only in language, and the French one pointing at the
       * English page would land a photo in a language its owner did not
       * install. The scope is "/" for both and could catch nothing.
       */
      if (action !== m.start_url) {
        echecs.push(
          `${rel(cible)} : « ${nom}.action » vaut ${action} et « start_url » ${m.start_url} — une arrivée n'atterrirait pas dans la langue installée`,
        );
      }
      if (precache.length && !precache.includes(action)) {
        echecs.push(`${rel(sw)} ne précharge pas « ${action} », que ${nom} annonce`);
      }

      const types = Object.entries(h.accept ?? {});
      if (!types.length) echecs.push(`${rel(cible)} : « ${nom}.accept » est vide`);
      for (const [type, exts] of types) {
        if (!/^[a-z]+\/[a-z0-9.+-]+$/.test(type)) {
          echecs.push(`${rel(cible)} : « ${nom}.accept » a une clé douteuse — ${type}`);
        }
        if (!Array.isArray(exts) || !exts.length || !exts.every((e) => /^\.[a-z0-9]+$/.test(e))) {
          echecs.push(`${rel(cible)} : « ${nom}.accept[${type}] » n'est pas une liste d'extensions`);
        }
      }

      /*
       * `launch_type` is the early File Handling field, never standardised: it
       * declared here that one window receives the whole batch with nothing
       * upholding it. Its return is refused, so it cannot reappear beside the
       * member that actually decides.
       */
      if ('launch_type' in h) {
        echecs.push(`${rel(cible)} : « ${nom}.launch_type » n'est pas normalisé, voir launch_handler`);
      }
    }
    if (m.file_handlers?.length) {
      const mode = m.launch_handler?.client_mode;
      if (!['auto', 'focus-existing', 'navigate-existing', 'navigate-new'].includes(mode)) {
        echecs.push(`${rel(cible)} : « launch_handler.client_mode » est absent ou inconnu — ${mode}`);
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

// 9. What we tell the engines

/*
 * Nobody was watching `robots.txt` or the sitemap, and it showed: the sitemap
 * announced in `robots.txt` from the start with nothing producing it, and the
 * file answered 404. The bug survived until a human noticed, when it is exactly
 * the class of failure this file catches everywhere else.
 *
 * Those two files are read only by machines. Nobody opens them, nobody sees
 * they are wrong, and they are the first thing an engine asks for. That is what
 * justifies treating them like the rest: a blocking check, not a review.
 */
{
  const racine = 'https://geotager.app';
  const robots = join(DIR, 'robots.txt');

  if (!existsSync(robots)) {
    echecs.push(`${DIR}/robots.txt est absent — un moteur le demande avant toute autre chose`);
  } else {
    const texte = readFileSync(robots, 'utf8');
    const lignes = texte
      .split('\n')
      .map((l) => l.replace(/#.*$/, '').trim())
      .filter(Boolean);

    if (!lignes.some((l) => /^user-agent\s*:/i.test(l))) {
      echecs.push(`${DIR}/robots.txt n'a aucun groupe « User-agent »`);
    }

    /*
     * No non-empty "Disallow". This is not a preference: the technical domains
     * are removed from the index by an `X-Robots-Tag: noindex`, which an engine
     * can only read if it is allowed to come and fetch the page. A "Disallow"
     * here would remove that right and let the addresses be indexed anyway,
     * without even a snippet. That is the contradiction the file's comment
     * describes, and which nothing protected against.
     */
    for (const l of lignes) {
      const valeur = l.match(/^disallow\s*:\s*(.*)$/i)?.[1];
      if (valeur) echecs.push(`${DIR}/robots.txt interdit « ${valeur} » — voir le commentaire du fichier`);
    }

    const annonces = lignes
      .map((l) => l.match(/^sitemap\s*:\s*(\S+)$/i)?.[1])
      .filter(Boolean);
    if (!annonces.length) {
      echecs.push(`${DIR}/robots.txt n'annonce aucun plan de site`);
    }
    for (const adresse of annonces) {
      if (!adresse.startsWith(`${racine}/`)) {
        echecs.push(`${DIR}/robots.txt annonce un plan de site hors de l'origine — ${adresse}`);
        continue;
      }
      // The check that would have caught the original 404.
      const cible = join(DIR, adresse.slice(racine.length + 1));
      if (!existsSync(cible)) {
        echecs.push(`${DIR}/robots.txt annonce ${adresse}, que la build ne produit pas`);
      }
    }
  }

  // The sitemap

  const plan = join(DIR, 'sitemap-index.xml');
  if (!existsSync(plan)) {
    echecs.push(`${DIR}/sitemap-index.xml est absent`);
  } else {
    const xml = readFileSync(plan, 'utf8');

    if (!/<urlset[^>]+xmlns=["']http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["']/.test(xml)) {
      echecs.push(`${rel(plan)} : racine « urlset » ou espace de noms manquant`);
    }

    /*
     * "Google ignores <priority> and <changefreq> values." Writing them would
     * suggest a freshness signal that does not exist; this check is here so
     * they do not settle back in on a distracted day.
     */
    for (const mort of ['changefreq', 'priority']) {
      if (new RegExp(`<${mort}>`).test(xml)) {
        echecs.push(`${rel(plan)} porte « ${mort} », que les moteurs ignorent`);
      }
    }

    /*
     * `lastmod` is the only one of the three that counts, and only if it is
     * verifiable. A date later than the day of the build is not, by
     * construction: that is the signature of an invented timestamp.
     */
    const aujourdhui = new Date().toISOString().slice(0, 10);
    for (const [, date] of xml.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        echecs.push(`${rel(plan)} : « ${date} » n'est pas une date AAAA-MM-JJ`);
      } else if (date > aujourdhui) {
        echecs.push(`${rel(plan)} : « ${date} » est dans le futur`);
      }
    }

    /*
     * The set of announced addresses is exactly the set of indexable pages
     * produced. Too many, and we ask for pages that do not exist to be indexed.
     * Too few, and we hide a page from an engine without having decided to. And
     * the error pages are in neither direction.
     */
    const annoncees = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(([, u]) => u).sort();
    const produites = pagesIndexables
      .map((f) => `${racine}/${rel(f).replace(/index\.html$/, '')}`)
      .sort();
    if (annoncees.join('|') !== produites.join('|')) {
      echecs.push(
        `${rel(plan)} n'annonce pas les pages produites — annoncées ${annoncees.join(', ')} / produites ${produites.join(', ')}`,
      );
    }
    for (const adresse of annoncees) {
      if (!adresse.startsWith(`${racine}/`) || !adresse.endsWith('/')) {
        echecs.push(`${rel(plan)} : « ${adresse} » doit être absolue et finir par « / »`);
      }
    }

    /*
     * And the same languages on both sides. The sitemap and the `<head>` are
     * two declarations of the same fact; if they contradict each other an
     * engine does not settle in our favour, it ignores both.
     */
    for (const f of pagesIndexables) {
      const html = readFileSync(f, 'utf8');
      const adresse = `${racine}/${rel(f).replace(/index\.html$/, '')}`;
      const bloc = xml.match(new RegExp(`<url>\\s*<loc>${adresse}</loc>([\\s\\S]*?)</url>`))?.[1];
      if (!bloc) continue;
      const duPlan = [...bloc.matchAll(/hreflang="([^"]+)"/g)].map(([, l]) => l).sort();
      const duHead = [...html.matchAll(/<link[^>]+rel=["']alternate["'][^>]+hreflang=["']([^"']+)["']/gi)]
        .map(([, l]) => l)
        .sort();
      if (duPlan.join(',') !== duHead.join(',')) {
        echecs.push(
          `${rel(f)} : les langues du plan du site (${duPlan.join(', ')}) et de la page (${duHead.join(', ')}) diffèrent`,
        );
      }
      if (!duPlan.includes('x-default')) {
        echecs.push(`${rel(plan)} : « ${adresse} » n'a pas de « x-default »`);
      }
    }
  }

  // The <head> of indexable pages

  for (const f of pagesIndexables) {
    const html = readFileSync(f, 'utf8');
    const adresse = `${racine}/${rel(f).replace(/index\.html$/, '')}`;

    // A self-referencing canonical on every indexable page. Only the French
    // page was checked, and only by the end-to-end test.
    const canonique = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1];
    if (canonique !== adresse) {
      echecs.push(`${rel(f)} : canonique « ${canonique ?? '(absent)'} », attendu « ${adresse} »`);
    }

    const balise = (p) =>
      html.match(new RegExp(`<meta[^>]+property=["']${p}["'][^>]+content=["']([^"']*)["']`, 'i'))?.[1];
    for (const p of ['og:title', 'og:description', 'og:url', 'og:locale']) {
      if (!balise(p)) echecs.push(`${rel(f)} : « ${p} » manque`);
    }
    if (!/<meta[^>]+name=["']twitter:card["']/i.test(html)) {
      echecs.push(`${rel(f)} : « twitter:card » manque`);
    }
    // "canonical = internal links = sitemap = og:url". Signals that contradict
    // each other are signals an engine discards.
    if (balise('og:url') && balise('og:url') !== canonique) {
      echecs.push(`${rel(f)} : « og:url » et le canonique diffèrent`);
    }

    /*
     * Nobody was parsing the JSON-LD. One comma too many would have broken it
     * silently: the block stays in the page, it throws no console error, since
     * an unknown `type` makes the element inert, and nothing is understood any
     * more. So it is genuinely parsed.
     */
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    if (!ld) {
      echecs.push(`${rel(f)} : aucun bloc « application/ld+json »`);
    } else {
      try {
        const graphe = JSON.parse(ld);
        const types = (graphe['@graph'] ?? [graphe]).map((n) => n['@type']);
        for (const attendu of ['SoftwareApplication', 'WebSite', 'Organization']) {
          if (!types.includes(attendu)) {
            echecs.push(`${rel(f)} : le JSON-LD ne déclare pas « ${attendu} » — ${types.join(', ')}`);
          }
        }
      } catch (e) {
        echecs.push(`${rel(f)} : le JSON-LD n'est pas du JSON valide — ${e.message}`);
      }
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
