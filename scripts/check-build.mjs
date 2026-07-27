// Contrôles de build bloquants — graine de ce que le plan (§7.4) décrit.
//
// Cloudflare ne lit QUE le code de sortie de la commande de build : une sortie
// en 0 publie les assets même si des erreurs ont été écrites sur stderr. Tout
// échec doit donc se traduire par un code non nul, jamais par un simple message.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const DIR = 'site';
const HOTES_AUTORISES = new Set(['github.com']);
const echecs = [];

function fichiers(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? fichiers(join(dir, e.name)) : [join(dir, e.name)]
  );
}

const tous = fichiers(DIR);

if (!tous.includes(join(DIR, 'index.html'))) {
  echecs.push(`${DIR}/index.html est absent`);
}

// Limites d'assets Workers, plan gratuit.
if (tous.length > 20_000) echecs.push(`${tous.length} fichiers, plafond 20 000`);
for (const f of tous) {
  const octets = statSync(f).size;
  if (octets > 25 * 1024 * 1024) echecs.push(`${f} fait ${octets} o, plafond 25 MiB`);
}

// Aucune requête vers un domaine tiers : c'est la contrainte fondatrice du
// projet, et le seul critère qui ne souffre aucune exception.
for (const f of tous.filter((f) => ['.html', '.css', '.js', '.json'].includes(extname(f)))) {
  for (const url of readFileSync(f, 'utf8').match(/https?:\/\/[a-zA-Z0-9._-]+/g) ?? []) {
    const hote = url.replace(/^https?:\/\//, '');
    if (!HOTES_AUTORISES.has(hote)) echecs.push(`${f} référence un hôte tiers : ${hote}`);
  }
}

if (echecs.length) {
  console.error('Contrôles de build en échec :');
  for (const e of echecs) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`Contrôles de build passés — ${tous.length} fichiers dans ${DIR}/.`);
