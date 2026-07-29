/**
 * Contrôles de build bloquants.
 *
 * Cloudflare ne lit QUE le code de sortie de la commande de build : une sortie
 * en 0 publie les assets même si des erreurs ont été écrites sur stderr. Tout
 * échec doit donc se traduire par un code non nul, jamais par un message.
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

/** Hôtes autorisés en LIEN hypertexte. Aucun n'est chargé comme ressource. */
const LIENS_AUTORISES = new Set([
  'geotager.app',
  'www.geotager.app',
  'github.com',
  'schema.org',
  'exiftool.org',
  'developer.mozilla.org',
  // L'attribution exigée par OpenStreetMap. C'est un lien, pas une ressource.
  'www.openstreetmap.org',
]);

/**
 * Hôtes autorisés en RESSOURCE — la seule exception du projet, et elle se
 * compte sur un doigt. Toute entrée ici doit être justifiée dans CREDITS.md.
 */
const RESSOURCES_AUTORISEES = new Set([
  // Tuiles de la carte de choix du lieu, chargées seulement si l'utilisateur
  // ouvre la carte. Voir CREDITS.md et l'entrée Q-044 de QUESTIONS.md.
  'tile.openstreetmap.org',
]);

/**
 * Hôtes qui apparaissent en URL sans jamais être chargés : des identifiants
 * d'espace de noms XML, qui ressemblent à des adresses parce que la spécifi-
 * cation le veut ainsi. `exifr` en embarque deux pour XMP. Aucun navigateur ne
 * va les chercher, et les confondre avec une ressource ferait crier le contrôle
 * pour rien — ce qui est le meilleur moyen de le faire désactiver.
 */
const HOTES_DECLARATIFS = new Set(['ns.adobe.com']);

/** L'hôte d'une URL, ou null si elle est illisible. */
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
 * Longueur réellement perçue par un moteur de recherche.
 * Astro échappe l'apostrophe en `&#39;` : compter les octets du HTML
 * surestimerait le titre de quatre caractères par apostrophe.
 */
/** Décode les entités HTML, pour comparer du texte et non de l'échappement. */
function texteVisible(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .trim();
}

const longueurVisible = (s) => texteVisible(s).length;

/* --- 1. structure et plafonds ------------------------------------- */

if (!fichiers.includes(join(DIR, 'index.html'))) echecs.push("dist/index.html est absent");
if (fichiers.length > MAX_FICHIERS) echecs.push(`${fichiers.length} fichiers, plafond ${MAX_FICHIERS}`);
for (const f of fichiers) {
  const o = statSync(f).size;
  if (o > MAX_TAILLE) echecs.push(`${rel(f)} fait ${o} o, plafond 25 MiB`);
}

/* --- 2. aucune ressource tierce ----------------------------------- */

/*
 * On distingue un LIEN hypertexte (l'utilisateur clique, rien n'est chargé)
 * d'une RESSOURCE (le navigateur va la chercher tout seul). Seule la seconde
 * est interdite.
 *
 * Ce critère ne souffrait aucune exception. Il en souffre désormais UNE, nommée
 * dans `RESSOURCES_AUTORISEES` : les tuiles de la carte, que rien ne demande
 * tant que l'utilisateur n'a pas ouvert la carte. La phrase précédente disait
 * « aucune exception » ; la laisser telle quelle aurait fait mentir le seul
 * endroit où quelqu'un vient vérifier.
 *
 * Et la liste ci-dessous ne suffisait pas. Elle cherche des formes HTML et CSS
 * — `<img src=…>`, `url(…)`, `fetch('…')`. Une URL construite dans du
 * JavaScript, par concaténation, n'en déclenche aucune : un fond de carte tiers
 * serait passé sans un mot. Le contrôle §2 bis, plus bas, ferme ce trou.
 */
const RESSOURCES = [
  /<script[^>]+src\s*=\s*["'](https?:\/\/[^"']+)/gi,
  // `rel="canonical"` et `rel="alternate"` déclarent une URL, ils ne chargent
  // rien : ils sont exclus explicitement plutôt que par une exception cachée.
  /<link(?![^>]*rel\s*=\s*["'](?:canonical|alternate)["'])[^>]+href\s*=\s*["'](https?:\/\/[^"']+)/gi,
  /<img[^>]+src\s*=\s*["'](https?:\/\/[^"']+)/gi,
  /<(?:video|audio|source|iframe|embed)[^>]+src\s*=\s*["'](https?:\/\/[^"']+)/gi,
  // `(?<![\w-])` : sans cela, le drapeau `i` fait correspondre `URL(` aussi
  // bien que `url(`, et un `new URL('https://…')` parfaitement légitime fait
  // échouer la build avec un message qui accuse une feuille de style.
  /(?<![\w-])url\(\s*["']?(https?:\/\/[^)"']+)/gi,
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
      if (RESSOURCES_AUTORISEES.has(hote(m[1]))) continue;
      echecs.push(`${rel(f)} charge une ressource tierce : ${m[1].slice(0, 80)}`);
    }
  }
  // Les liens hypertextes restent contrôlés, mais sur une liste blanche.
  for (const m of contenu.matchAll(/<a[^>]+href\s*=\s*["']https?:\/\/([^"'/]+)/gi)) {
    if (!LIENS_AUTORISES.has(m[1])) {
      echecs.push(`${rel(f)} pointe vers un hôte non listé : ${m[1]}`);
    }
  }
}

/* --- 2 bis. aucune URL absolue inattendue dans le JavaScript ------- */

/*
 * Les motifs du §2 attrapent des balises et des appels écrits en toutes
 * lettres. Ils n'attrapent pas `const T = 'https://exemple/{z}/{x}/{y}.png'`,
 * qui suffit pourtant à charger un tiers depuis une `<img>` construite à la
 * volée. On contrôle donc TOUTE URL absolue littérale du JavaScript servi,
 * contre l'union des deux listes blanches.
 *
 * Aucun fichier du dépôt n'en plaçait dans le bundle avant la carte : ce
 * contrôle naît vert, et il n'a de sens qu'à cette condition.
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

/* --- 3. titles, metas et contenu servi sans JS -------------------- */

/*
 * Les blocs de contenu attendus, par langue. Le §7 les impose ; ils doivent
 * exister dans le HTML SERVI, donc sans JavaScript. Une langue absente de cette
 * table fait échouer la build : ajouter une page sans ajouter ses contrôles
 * reviendrait à publier une page que rien ne vérifie.
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
  // La capture doit s'arrêter au guillemet OUVRANT, pas au premier apostrophe :
  // une description française en contient presque toujours une.
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

  // Le contenu doit exister sans JavaScript : on le vérifie sur le HTML servi,
  // et dans la langue que la page déclare. Une page anglaise dont on chercherait
  // les titres français passerait pour vide.
  const lang = html.match(/<html[^>]+lang=["']([a-z-]+)["']/i)?.[1] ?? '';
  // Astro échappe les apostrophes venues d'une expression : « qu'il » devient
  // « qu&#39;il ». Chercher le texte brut dans le HTML échappé ne trouverait
  // rien, et ferait passer une page pleine pour une page vide.
  const lisible = texteVisible(html);
  const attendus = BLOCS_OBLIGATOIRES[lang];
  if (!attendus) {
    echecs.push(`${rel(f)} : langue « ${lang} » inconnue du contrôle de contenu`);
  } else {
    for (const [nom, re] of attendus) {
      if (!re.test(lisible)) echecs.push(`${rel(f)} : le bloc « ${nom} » est absent du HTML servi`);
    }
  }

  // Les liens réciproques entre langues : chaque page doit annoncer TOUTES les
  // langues, elle-même comprise, sans quoi Google ignore la déclaration.
  for (const l of Object.keys(BLOCS_OBLIGATOIRES)) {
    if (!new RegExp(`hreflang=["']${l}["']`, 'i').test(html)) {
      echecs.push(`${rel(f)} : aucun lien alternatif ne déclare la langue « ${l} »`);
    }
  }
  if (!/hreflang=["']x-default["']/i.test(html)) {
    echecs.push(`${rel(f)} : aucun lien alternatif « x-default »`);
  }
}

/* --- 4. budget JavaScript ----------------------------------------- */

const js = fichiers.filter((f) => ['.js', '.mjs'].includes(extname(f)));
const totalGzip = js.reduce((n, f) => n + gzipSync(readFileSync(f), { level: 9 }).length, 0);
infos.push(
  `JS ${js.length} fichiers, ${totalGzip} o gzip (${((totalGzip / BUDGET_JS_GZIP) * 100).toFixed(1)} % du budget)`,
);
if (totalGzip > BUDGET_JS_GZIP) {
  echecs.push(`budget JS dépassé : ${totalGzip} o gzip, plafond ${BUDGET_JS_GZIP}`);
}

/* --- 5. en-têtes -------------------------------------------------- */

const headers = join(DIR, '_headers');
if (existsSync(headers)) {
  let motif = '';
  const motifsNoindex = [];
  for (const ligne of readFileSync(headers, 'utf8').split('\n')) {
    if (/^\S/.test(ligne) && !ligne.startsWith('#')) motif = ligne.trim();
    else if (/x-robots-tag/i.test(ligne)) {
      // Un X-Robots-Tag sous motif relatif s'appliquerait au domaine canonique
      // et désindexerait le site. Il ne doit exister que scopé par hôte.
      if (!motif.startsWith('https://')) {
        echecs.push(`_headers : X-Robots-Tag sous le motif relatif « ${motif} »`);
      } else {
        motifsNoindex.push(motif);
      }
    }
  }

  /*
   * Un motif d'hôte qui ne matche rien est pire qu'absent : il donne
   * l'impression que le domaine technique est protégé alors qu'il ne l'est pas.
   * Sur Workers l'hôte est <worker>.<sous-domaine>.workers.dev, soit trois
   * étiquettes ; la syntaxe Pages n'en avait que deux, et un placeholder ne
   * traverse pas le point. On exige donc le bon compte.
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

/* --- 6. le garde-fou de déploiement est en place ------------------- */

/*
 * Q-038 : une build a promu en production depuis une branche de travail, parce
 * qu'un réglage de tableau de bord le demandait et que rien dans le dépôt ne
 * s'y opposait. `scripts/deploy.mjs` remet la décision dans le dépôt ; ce
 * contrôle vérifie qu'on ne l'en a pas retirée depuis. Un garde-fou qu'on peut
 * effacer sans que rien ne proteste n'est pas un garde-fou.
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

/* --- 7. le tableau du README dit la même chose que le code --------- */

/*
 * Le tableau de la page est rendu depuis capacites.ts, donc il ne peut pas
 * dériver. Celui du README est écrit à la main, donc il le peut — et c'est le
 * premier que lit quelqu'un qui découvre le projet.
 *
 * On compare le README au tableau RÉELLEMENT SERVI, et non à la constante :
 * c'est le même témoin, en plus fort, puisqu'il porte sur l'artefact publié.
 * Cela évite au passage d'importer un module TypeScript depuis ce script —
 * l'image de build tourne sur la version de `.nvmrc`, qui ne sait pas les lire
 * sans drapeau.
 *
 * On compare les cellules, pas les libellés : la mention entre parenthèses
 * reste libre de part et d'autre.
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
      // Le libellé de ligne est un `<th scope="row">` et non un `<td>` : la
      // liste des `<td>` ne contient donc plus QUE les capacités, et la couper
      // d'un cran perdrait la première colonne au lieu du nom du format.
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

/* --- rendu -------------------------------------------------------- */

for (const i of infos) console.log(`  ${i}`);
if (echecs.length) {
  console.error(`\nContrôles de build en échec (${echecs.length}) :`);
  for (const e of echecs) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`\nContrôles de build passés — ${fichiers.length} fichiers dans ${DIR}/.`);
