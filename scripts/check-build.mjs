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

/**
 * Une liste littérale du service worker construit, relue telle quelle.
 *
 * `gen-sw.mjs` écrit `PRECACHE` en JSON, et `sw-modele.js` écrit `PARTAGE` à la
 * main avec des guillemets doubles : les deux se relisent donc par `JSON.parse`,
 * sans qu'un contrôle ait à deviner ce que le worker reconnaît. Une liste
 * illisible rend un tableau vide, et l'appelant décide s'il s'en plaint — c'est
 * la seule manière de ne pas transformer une absence en fausse réussite.
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

// `.webmanifest` en fait partie : c'est le seul fichier du site où une icône
// hébergée ailleurs — ou une cible de partage, ou une capture — passerait sans
// que rien ne la voie. Le laisser hors du balayage aurait ouvert un trou dans
// le garde-fou principal du projet au moment même où on ajoutait le fichier.
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

/**
 * Une page d'erreur n'est pas une page du site.
 *
 * Elle n'a ni les six blocs de prose de l'outil, ni de liens entre langues, et
 * exiger d'elle les uns ou les autres ferait échouer la build pour une page
 * dont le rôle est précisément de ne rien promettre. Elle porte en revanche un
 * `noindex`, et le contrôle le vérifie plus bas — l'exclusion est nommée, elle
 * n'est pas un trou.
 */
const estIntrouvable = (f) => /(^|[\\/])404\.html$/.test(f);

/** Les pages qu'on demande à un moteur d'indexer, et elles seules. */
const pagesIndexables = fichiers.filter((x) => extname(x) === '.html' && !estIntrouvable(x));

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

  if (estIntrouvable(f)) {
    // Ce qu'on demande à une page d'erreur, et rien d'autre : dire qu'elle ne
    // veut pas être indexée, et ramener quelque part.
    if (!/<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html)) {
      echecs.push(`${rel(f)} : une page d'erreur doit porter « noindex »`);
    }
    if (!/<a[^>]+href=["']\/(fr\/)?["']/i.test(html)) {
      echecs.push(`${rel(f)} : aucun lien de retour vers l'outil`);
    }
    continue;
  }

  /*
   * Le bouton d'installation, présent et CACHÉ.
   *
   * Le `hidden` est tout le dispositif : le bouton n'est découvert que par
   * l'invitation du navigateur, qui n'arrive jamais si l'application est déjà
   * installée. Le perdre — un attribut, une ligne — l'afficherait pour tout le
   * monde, y compris là où il ne peut rien faire, ce qui est exactement
   * l'inverse de ce qu'on veut. Le retirer tout court reviendrait à ne plus
   * proposer l'installation du tout, sans que rien ne le dise.
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

  // Une page indexable ne doit surtout PAS porter de noindex. L'inverse de la
  // page d'erreur, et la panne la plus chère du lot : elle est invisible à
  // l'écran et retire le site des résultats.
  if (/<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html)) {
    echecs.push(`${rel(f)} : une page du site porte « noindex »`);
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

/* --- 8. le manifeste et ses icônes ---------------------------------- */

/*
 * Une icône introuvable est la panne la plus silencieuse de tout le lot : le
 * site continue de s'afficher, l'installation continue d'être proposée, et
 * c'est seulement sur l'écran d'accueil qu'on découvre un carré vide. Sous
 * Chrome Android, un manifeste en 404 suspend en outre la vérification des
 * mises à jour pendant trente jours.
 *
 * On contrôle donc la chaîne entière, depuis la page : le lien existe, la cible
 * existe, elle est du JSON, et chacune de ses adresses désigne un fichier
 * réellement présent dans `dist/`.
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

    // `id` est l'identité d'une installation. Deux manifestes qui ne le
    // partagent pas sont deux applications, et le changer un jour orphelinerait
    // toutes les installations existantes.
    if (m.id !== '/') echecs.push(`${rel(cible)} : « id » vaut « ${m.id} », il doit valoir « / »`);
    if (m.scope !== '/') echecs.push(`${rel(cible)} : « scope » doit valoir « / »`);

    // `start_url` est l'adresse que le système ouvre en cliquant l'icône. Elle
    // n'était vérifiée que comme chaîne : une page absente passait en vert.
    const depart = String(m.start_url ?? '');
    if (!depart.endsWith('/') || !existsSync(join(DIR, depart.replace(/^\//, ''), 'index.html'))) {
      echecs.push(`${rel(cible)} : « start_url » ne désigne aucune page — ${depart}`);
    }

    /*
     * `share_target.action` et `file_handlers[].action` sont des adresses vers
     * lesquelles le SYSTÈME enverra des fichiers de l'utilisateur. Une seule
     * d'entre elles pointant ailleurs qu'ici, et le système de partage
     * livrerait des photos à un tiers — sur la foi d'un manifeste que
     * personne ne relit. C'est l'endroit du site où une adresse étrangère
     * coûterait le plus cher, donc c'est l'endroit où on la cherche.
     */
    const adresses = [
      ['start_url', m.start_url],
      ['scope', m.scope],
      ...(m.share_target ? [['share_target.action', m.share_target.action]] : []),
      ...(m.file_handlers ?? []).map((h, n) => [`file_handlers[${n}].action`, h.action]),
      ...(m.icons ?? []).map((i, n) => [`icons[${n}].src`, i.src]),
      ...(m.screenshots ?? []).map((i, n) => [`screenshots[${n}].src`, i.src]),
      // Une adresse de plus que le système lit : elle hérite du refus des
      // adresses étrangères, comme toutes les autres.
      ...(m.related_applications ?? []).map((a, n) => [`related_applications[${n}].url`, a.url]),
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

    // Une icône masquable est rognée jusqu'à 20 % de chaque côté. Sans elle, le
    // système en fabrique une en collant l'icône ordinaire au centre d'un
    // carré blanc — ce qui est toujours laid et souvent illisible.
    if (!(m.icons ?? []).some((i) => String(i.purpose ?? '').split(/\s+/).includes('maskable'))) {
      echecs.push(`${rel(cible)} : aucune icône « maskable »`);
    }

    /*
     * CE QUI REND L'APPLICATION INSTALLABLE, et que rien ne vérifiait.
     *
     * La liste publiée par Chrome, mot pour mot : l'application n'est pas déjà
     * installée, les heuristiques d'engagement sont remplies, le site est en
     * HTTPS, et le manifeste porte « short_name or name », des icônes « must
     * include a 192px and a 512px icon », « start_url », un « display » parmi
     * fullscreen / standalone / minimal-ui / window-controls-overlay, et
     * « prefer_related_applications must not be present, or be false ».
     *
     * Deux choses valent d'être notées, parce qu'on croyait le contraire. Le
     * SERVICE WORKER n'y figure pas : ni lui, ni un gestionnaire `fetch`, ni la
     * moindre capacité hors ligne. Et `display_override` non plus — c'est
     * `display` seul qui est jugé.
     *
     * Tant que l'installation n'était offerte que par le menu du navigateur,
     * perdre un de ces champs passait inaperçu. Depuis qu'un BOUTON en dépend,
     * la même perte le fait disparaître de la page pour tout le monde — sans
     * message, sans erreur, sans rien.
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
     * `prefer_related_applications` à « true » signifie « proposez plutôt une
     * autre application que celle-ci ». Le critère d'installabilité cesse alors
     * d'être rempli, plus aucune invitation n'est émise, et le bouton
     * d'installation disparaît de toutes les pages. C'est la régression la moins
     * visible du lot : rien ne casse, rien ne s'affiche, un bouton cesse
     * simplement d'exister.
     */
    if (m.prefer_related_applications === true) {
      echecs.push(
        `${rel(cible)} : « prefer_related_applications » à vrai supprime l'invitation à installer`,
      );
    }

    /*
     * Le manifeste se désigne lui-même pour que la page puisse demander au
     * navigateur si l'application est déjà installée. Une entrée mal formée ne
     * lève rien : la question reçoit simplement une réponse vide, et on
     * retombe sans le savoir sur la déduction qu'on voulait remplacer.
     */
    const parentes = m.related_applications ?? [];
    if (!parentes.length) {
      echecs.push(`${rel(cible)} : « related_applications » est absent — voir getInstalledRelatedApps`);
    }
    for (const [n, a] of parentes.entries()) {
      const nom = `related_applications[${n}]`;
      if (a.platform !== 'webapp') {
        echecs.push(`${rel(cible)} : « ${nom}.platform » vaut « ${a.platform} », attendu « webapp »`);
      }
      const adresse = String(a.url ?? '');
      if (!adresse.startsWith('/') || !existsSync(join(DIR, adresse.replace(/^\//, '')))) {
        echecs.push(`${rel(cible)} : « ${nom}.url » ne désigne aucun manifeste — ${adresse}`);
      }
    }

    /*
     * La cible de partage n'existe QUE dans le service worker : aucun fichier
     * ne lui correspond dans `dist/`. Si le worker cessait de la reconnaître,
     * le partage tomberait en 404 sans que rien ne prévienne — le manifeste,
     * lui, continuerait de la promettre au système.
     */
    if (m.share_target) {
      const sw = join(DIR, 'sw.js');
      const chemin = String(m.share_target.action ?? '');
      if (!existsSync(sw)) {
        echecs.push(`${rel(cible)} annonce un partage, mais ${rel(sw)} n'existe pas`);
      } else if (!listeDuWorker(sw, 'PARTAGE').includes(chemin)) {
        /*
         * Ce contrôle a longtemps été creux. Il cherchait
         * `\$\{?\w*\}?|partager`, dont la première branche accepte un simple
         * « $ » — et `sw.js` en contient toujours un. Il passait donc quoi que
         * fasse le worker, et le 404 que le paragraphe ci-dessus dit prévenir
         * serait parti en production sans un mot. Il lit maintenant la liste que
         * le worker consulte vraiment.
         */
        echecs.push(`${rel(sw)} ne reconnaît pas la cible de partage « ${chemin} »`);
      }
      if (m.share_target.method !== 'POST' || m.share_target.enctype !== 'multipart/form-data') {
        echecs.push(`${rel(cible)} : un partage de FICHIERS exige POST + multipart/form-data`);
      }
    }

    /*
     * « Ouvrir avec » est l'autre porte par laquelle le SYSTÈME envoie des
     * fichiers, et la seule dont l'adresse désigne un document RÉEL. Si elle
     * pointait à côté — une langue qui n'existe pas, une barre oblique finale
     * oubliée — le système ouvrirait une redirection ou un 404, et personne ne
     * le saurait avant qu'un utilisateur ne s'en plaigne. C'est arrivé : le
     * lancement était livré en V1.3 sans qu'aucun contrôle ne le regarde.
     */
    const sw = join(DIR, 'sw.js');
    const precache = existsSync(sw) ? listeDuWorker(sw, 'PRECACHE') : [];
    for (const [n, h] of (m.file_handlers ?? []).entries()) {
      const nom = `file_handlers[${n}]`;
      const action = String(h.action ?? '');

      /*
       * La barre oblique finale n'est pas une coquetterie. `/fr` répond 307 chez
       * l'hébergeur, et une entrée préchargée qui redirige est stockée comme
       * telle : le worker la rendrait à une navigation dont le mode de
       * redirection est `manual`, ce dont le navigateur fait une erreur réseau.
       * Ce n'est pas « Ouvrir avec » qui tomberait alors, c'est l'application
       * entière, hors ligne.
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
       * Et elle vaut `start_url`. C'est le contrôle qui porte vraiment : les deux
       * manifestes ne diffèrent que par leur langue, et celui du français
       * pointant sur la page anglaise ferait atterrir une photo dans une langue
       * que son propriétaire n'a pas installée. La portée, elle, vaut « / » pour
       * les deux et ne pouvait rien attraper.
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
       * `launch_type` est le champ des débuts du File Handling, jamais
       * normalisé : il déclarait ici « une seule fenêtre reçoit tout le lot »
       * sans que rien ne le tienne. On refuse son retour, pour qu'il ne
       * réapparaisse pas à côté du membre qui décide vraiment.
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

  // Le lien `apple-touch-icon` ne passe par aucun manifeste : iOS ne lit que lui.
  for (const f of pages) {
    const html = readFileSync(f, 'utf8');
    const apple = html.match(/<link[^>]+rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i)?.[1];
    if (!apple) echecs.push(`${rel(f)} : aucun <link rel="apple-touch-icon">`);
    else if (!existsSync(join(DIR, apple.replace(/^\//, '')))) {
      echecs.push(`${rel(f)} : apple-touch-icon ${apple} est absent de ${DIR}/`);
    }
  }
}

/* --- 9. ce qu'on dit aux moteurs ----------------------------------- */

/*
 * Personne ne surveillait `robots.txt` ni le plan du site, et cela s'est vu :
 * l'en-tête de `sitemap-index.xml.ts` raconte que « robots.txt l'annonçait
 * depuis le début sans que rien ne le produise : le fichier renvoyait 404 ». Le
 * défaut a vécu jusqu'à ce qu'un humain le remarque, alors que c'est
 * exactement la classe de panne que ce fichier attrape partout ailleurs.
 *
 * Ces deux fichiers-là ne sont lus QUE par des machines. Personne ne les ouvre,
 * personne ne voit qu'ils sont faux, et ils sont la première chose qu'un moteur
 * demande. C'est ce qui justifie de les traiter comme le reste : un contrôle
 * bloquant, et pas une relecture.
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
     * Aucun « Disallow » non vide. Ce n'est pas une préférence : les domaines
     * techniques sont retirés de l'index par un `X-Robots-Tag: noindex`, que le
     * moteur ne peut lire QUE s'il a le droit de venir chercher la page. Un
     * « Disallow » ici retirerait ce droit et laisserait les adresses
     * s'indexer quand même, sans même un extrait. C'est le contresens que le
     * commentaire du fichier décrit, et que rien ne protégeait.
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
      // LE contrôle qui aurait attrapé le 404 d'origine.
      const cible = join(DIR, adresse.slice(racine.length + 1));
      if (!existsSync(cible)) {
        echecs.push(`${DIR}/robots.txt annonce ${adresse}, que la build ne produit pas`);
      }
    }
  }

  /* --- le plan du site --------------------------------------------- */

  const plan = join(DIR, 'sitemap-index.xml');
  if (!existsSync(plan)) {
    echecs.push(`${DIR}/sitemap-index.xml est absent`);
  } else {
    const xml = readFileSync(plan, 'utf8');

    if (!/<urlset[^>]+xmlns=["']http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["']/.test(xml)) {
      echecs.push(`${rel(plan)} : racine « urlset » ou espace de noms manquant`);
    }

    /*
     * « Google ignores <priority> and <changefreq> values. » Les écrire
     * laisserait croire à un signal de fraîcheur qui n'existe pas ; ce contrôle
     * est là pour qu'ils ne reviennent pas s'installer un jour de distraction.
     */
    for (const mort of ['changefreq', 'priority']) {
      if (new RegExp(`<${mort}>`).test(xml)) {
        echecs.push(`${rel(plan)} porte « ${mort} », que les moteurs ignorent`);
      }
    }

    /*
     * `lastmod` est la seule des trois qui compte, et seulement si elle est
     * vérifiable. Une date postérieure au jour de la build ne l'est par
     * construction pas : c'est la signature d'un horodatage inventé.
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
     * L'ensemble des adresses annoncées est exactement l'ensemble des pages
     * indexables produites. En trop : on demande d'indexer ce qui n'existe pas.
     * En moins : on cache une page à un moteur sans l'avoir décidé. Et les
     * pages d'erreur n'y sont ni dans un sens ni dans l'autre.
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
     * Et les mêmes langues des deux côtés. Le plan du site et le `<head>` sont
     * deux déclarations du même fait ; si elles se contredisent, un moteur ne
     * tranche pas en notre faveur, il les ignore toutes les deux.
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

  /* --- le <head> des pages indexables -------------------------------- */

  for (const f of pagesIndexables) {
    const html = readFileSync(f, 'utf8');
    const adresse = `${racine}/${rel(f).replace(/index\.html$/, '')}`;

    // Un canonique auto-référent sur chaque page indexable. Seule la page
    // française était vérifiée, et seulement par le test de bout en bout.
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
    // « canonique = liens internes = plan du site = og:url ». Des signaux qui
    // se contredisent sont des signaux qu'un moteur écarte.
    if (balise('og:url') && balise('og:url') !== canonique) {
      echecs.push(`${rel(f)} : « og:url » et le canonique diffèrent`);
    }

    /*
     * Le JSON-LD n'était parsé par personne. Une virgule de trop l'aurait
     * cassé en silence : le bloc reste dans la page, il ne lève aucune erreur
     * de console — un `type` inconnu rend l'élément inerte — et plus rien n'est
     * compris. On le lit donc vraiment.
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

/* --- rendu -------------------------------------------------------- */

for (const i of infos) console.log(`  ${i}`);
if (echecs.length) {
  console.error(`\nContrôles de build en échec (${echecs.length}) :`);
  for (const e of echecs) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`\nContrôles de build passés — ${fichiers.length} fichiers dans ${DIR}/.`);
