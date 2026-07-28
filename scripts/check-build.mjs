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
]);

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
 * This is the one project criterion that admits no exception. We distinguish a
 * hyperlink, where the user clicks and nothing loads, from a resource, which the
 * browser fetches on its own. Only the second is forbidden.
 */
const RESSOURCES = [
  /<script[^>]+src\s*=\s*["'](https?:\/\/[^"']+)/gi,
  // `rel="canonical"` and `rel="alternate"` declare a URL, they load nothing:
  // they are excluded explicitly rather than through a hidden exception.
  /<link(?![^>]*rel\s*=\s*["'](?:canonical|alternate)["'])[^>]+href\s*=\s*["'](https?:\/\/[^"']+)/gi,
  /<img[^>]+src\s*=\s*["'](https?:\/\/[^"']+)/gi,
  /<(?:video|audio|source|iframe|embed)[^>]+src\s*=\s*["'](https?:\/\/[^"']+)/gi,
  /url\(\s*["']?(https?:\/\/[^)"']+)/gi,
  /@import\s+["'](https?:\/\/[^"']+)/gi,
  /\bfetch\(\s*["'`](https?:\/\/[^"'`]+)/gi,
];

const textes = fichiers.filter((f) =>
  ['.html', '.css', '.js', '.mjs', '.json', '.xml'].includes(extname(f)),
);
for (const f of textes) {
  const contenu = readFileSync(f, 'utf8');
  for (const re of RESSOURCES) {
    re.lastIndex = 0;
    for (const m of contenu.matchAll(re)) {
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
      const dites = ligne.slice(1).join('|');
      const vraies = servi[i].slice(1).join('|');
      if (dites !== vraies) {
        echecs.push(
          `${fichierReadme} : « ${ligne[0]} » annonce ${dites.replace(/\|/g, '/')}, ` +
            `${rel(page)} dit ${vraies.replace(/\|/g, '/')}`,
        );
      }
    });
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
