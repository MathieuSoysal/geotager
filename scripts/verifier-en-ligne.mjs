/**
 * What the host actually serves.
 *
 * Every other check in the repository looks at `dist/`: `check-build.mjs` reads
 * the produced files, the end-to-end test serves them from a local server.
 * Neither can see what Cloudflare adds in transit, and that is precisely the
 * risk:
 *
 *   - Web Analytics is on by default on free zones since 15 October 2025, and
 *     injects `cloudflareinsights.com/beacon.min.js`;
 *   - "Email Address Obfuscation" injects `email-decode.min.js`;
 *   - "Bot Fight Mode" injects `/cdn-cgi/challenge-platform/…` and sets a
 *     `cf_clearance` cookie;
 *   - Rocket Loader rewrites scripts, Zaraz adds them.
 *
 * Any one of those four undoes, on its own, the promise the page makes in
 * plain words, and none leaves a trace in the repository. The dashboard
 * switches existed; the check did not. This is it.
 *
 * It is not in `npm run build`, since Cloudflare's build has nothing to query,
 * nor in `npm run test:all`, which must stay offline. It is run by hand or from
 * a scheduled job:
 *
 *     npm run verifier:en-ligne
 *     npm run verifier:en-ligne -- https://a-preview.workers.dev
 */
import { readFileSync } from 'node:fs';

const CIBLE = (process.argv[2] ?? 'https://geotager.app').replace(/\/$/, '');
const CHEMINS = ['/', '/fr/'];

/**
 * What must never appear in a response.
 *
 * Patterns named one by one rather than one catch-all expression: when one of
 * them fires, the message has to say which, or you search a whole page blind.
 */
const INJECTIONS = [
  ['Web Analytics (beacon)', /cloudflareinsights|beacon\.min\.js/i],
  ['un point de terminaison /cdn-cgi/', /\/cdn-cgi\//i],
  ['Rocket Loader', /rocket-?loader/i],
  ["l'obfuscation d'adresses e-mail", /email-decode/i],
  ['Bot Fight Mode', /challenge-platform/i],
  ['Zaraz', /\bzaraz\b/i],
];

/** The headers of the `/*` block, read from the shipped file. */
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

  // A cookie set by the host is a cookie the site did not want, and one the
  // page states does not exist.
  if (reponse.headers.get('set-cookie')) {
    echecs.push(`${url} : l'hébergeur pose un cookie — ${reponse.headers.get('set-cookie')}`);
  }
  // Speed Brain prefetches pages for the visitor, and so issues requests nobody
  // asked for.
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

/* The service worker must be served, and must never be cached. */
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

/* Both manifests, and the install identity they share. */
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
