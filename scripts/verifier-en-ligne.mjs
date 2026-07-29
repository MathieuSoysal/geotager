/**
 * Ce que l'hébergeur sert VRAIMENT — Q-020.
 *
 * Tous les autres contrôles du dépôt regardent `dist/` : `check-build.mjs` lit
 * les fichiers produits, le test de bout en bout les sert depuis un serveur
 * local. Aucun des deux ne peut voir ce que Cloudflare ajoute en chemin, et
 * c'est précisément le risque que Q-020 avait identifié :
 *
 *   - Web Analytics est actif PAR DÉFAUT sur les zones gratuites depuis le
 *     15 octobre 2025, et injecte `cloudflareinsights.com/beacon.min.js` ;
 *   - « Email Address Obfuscation » injecte `email-decode.min.js` ;
 *   - « Bot Fight Mode » injecte `/cdn-cgi/challenge-platform/…` ET pose un
 *     cookie `cf_clearance` ;
 *   - Rocket Loader réécrit les scripts, Zaraz en ajoute.
 *
 * Chacun de ces quatre défait, à lui seul, la promesse que la page écrit noir
 * sur blanc — et aucun ne laisse la moindre trace dans le dépôt. Q-020 a écarté
 * l'option qui les rendait structurellement impossibles et retenu « des
 * interrupteurs dans le tableau de bord, plus un contrôle post-déploiement ».
 * Les interrupteurs existaient ; le contrôle, non. C'est lui.
 *
 * Il n'est PAS dans `npm run build` — la build de Cloudflare n'a rien à
 * interroger — ni dans `npm run test:all`, qui doit rester sans réseau. Il se
 * lance à la main ou depuis un travail planifié :
 *
 *     npm run verifier:en-ligne
 *     npm run verifier:en-ligne -- https://une-preview.workers.dev
 */
import { readFileSync } from 'node:fs';

const CIBLE = (process.argv[2] ?? 'https://geotager.app').replace(/\/$/, '');
const CHEMINS = ['/', '/fr/'];

/**
 * Ce qui ne doit jamais apparaître dans une réponse.
 *
 * Motifs nommés un par un plutôt qu'une expression fourre-tout : quand l'un
 * d'eux se déclenche, le message doit dire LEQUEL, sans quoi on cherche à
 * l'aveugle dans une page entière.
 */
const INJECTIONS = [
  ['Web Analytics (beacon)', /cloudflareinsights|beacon\.min\.js/i],
  ['un point de terminaison /cdn-cgi/', /\/cdn-cgi\//i],
  ['Rocket Loader', /rocket-?loader/i],
  ["l'obfuscation d'adresses e-mail", /email-decode/i],
  ['Bot Fight Mode', /challenge-platform/i],
  ['Zaraz', /\bzaraz\b/i],
];

/** Les en-têtes du bloc `/*`, lus dans le fichier livré. */
const ATTENDUS = (() => {
  const brut = readFileSync('public/_headers', 'utf8').split('\n');
  const debut = brut.findIndex((l) => l.trim() === '/*');
  const out = {};
  for (const ligne of brut.slice(debut + 1)) {
    if (/^\S/.test(ligne)) break;
    const m = ligne.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
})();

const echecs = [];
const avertissements = [];

for (const chemin of CHEMINS) {
  const url = `${CIBLE}${chemin}`;
  let reponse;
  try {
    reponse = await fetch(url, { redirect: 'manual' });
  } catch (e) {
    echecs.push(`${url} est injoignable : ${e.message}`);
    continue;
  }
  if (!reponse.ok) {
    echecs.push(`${url} répond ${reponse.status}`);
    continue;
  }
  const corps = await reponse.text();

  for (const [nom, motif] of INJECTIONS) {
    if (motif.test(corps)) echecs.push(`${url} : ${nom} est injecté dans la page`);
  }

  // Un cookie posé par l'hébergeur est un cookie que le site n'a pas voulu, et
  // dont la page affirme qu'il n'existe pas.
  if (reponse.headers.get('set-cookie')) {
    echecs.push(`${url} : l'hébergeur pose un cookie — ${reponse.headers.get('set-cookie')}`);
  }
  // Speed Brain précharge des pages pour le visiteur, donc émet des requêtes
  // que personne n'a demandées. Voir PLAN-GATE1.md §864.
  if (reponse.headers.get('speculation-rules')) {
    echecs.push(`${url} : un en-tête « speculation-rules » est servi (Speed Brain)`);
  }

  for (const [nom, valeur] of Object.entries(ATTENDUS)) {
    const servi = reponse.headers.get(nom);
    if (servi === null) echecs.push(`${url} : l'en-tête « ${nom} » n'est pas servi`);
    else if (servi.replace(/\s+/g, ' ').trim() !== valeur.replace(/\s+/g, ' ').trim()) {
      echecs.push(
        `${url} : « ${nom} » diffère de public/_headers\n` +
          `      servi   : ${servi}\n` +
          `      attendu : ${valeur}`,
      );
    }
  }
  console.log(`  ${url} — ${corps.length} o, ${[...reponse.headers.keys()].length} en-têtes`);
}

/* Le service worker doit être servi, et ne doit surtout pas être mis en cache. */
try {
  const sw = await fetch(`${CIBLE}/sw.js`);
  if (!sw.ok) echecs.push(`${CIBLE}/sw.js répond ${sw.status}`);
  else {
    const cache = sw.headers.get('cache-control') ?? '';
    if (!/no-cache|no-store|max-age=0/.test(cache)) {
      echecs.push(
        `${CIBLE}/sw.js est mis en cache (« ${cache} ») : la détection de mise à jour ne marche plus`,
      );
    }
    const texte = await sw.text();
    const absolues = [...texte.matchAll(/["'`](https?:\/\/[^"'`\s]+)["'`]/g)];
    if (absolues.length) {
      echecs.push(`${CIBLE}/sw.js contient une URL absolue : ${absolues[0][1]}`);
    }
  }
} catch (e) {
  avertissements.push(`sw.js n'a pas pu être vérifié : ${e.message}`);
}

/* Les deux manifestes, et l'identité d'installation qu'ils partagent. */
for (const chemin of ['/manifest.webmanifest', '/fr/manifest.webmanifest']) {
  try {
    const r = await fetch(`${CIBLE}${chemin}`);
    if (!r.ok) {
      echecs.push(`${CIBLE}${chemin} répond ${r.status}`);
      continue;
    }
    if (!/manifest\+json/.test(r.headers.get('content-type') ?? '')) {
      echecs.push(`${CIBLE}${chemin} : type « ${r.headers.get('content-type')} », refusé à l'installation`);
    }
    const m = JSON.parse(await r.text());
    if (m.id !== '/') echecs.push(`${CIBLE}${chemin} : « id » vaut « ${m.id} »`);
  } catch (e) {
    echecs.push(`${CIBLE}${chemin} : ${e.message}`);
  }
}

for (const a of avertissements) console.log(`  avertissement : ${a}`);

if (echecs.length) {
  console.error(`\nVérification en ligne en échec (${echecs.length}) :`);
  for (const e of echecs) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`\nVérification en ligne passée — ${CIBLE} sert exactement ce que le dépôt décrit.`);
