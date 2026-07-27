// Blocking build checks.
//
// Cloudflare reads only the build command's exit code: exiting 0 publishes the
// assets even if errors were written to stderr. Every failure must therefore
// turn into a non-zero code, never into a message.
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

// Workers asset limits, free plan.
if (tous.length > 20_000) echecs.push(`${tous.length} fichiers, plafond 20 000`);
for (const f of tous) {
  const octets = statSync(f).size;
  if (octets > 25 * 1024 * 1024) echecs.push(`${f} fait ${octets} o, plafond 25 MiB`);
}

// No request to a third-party domain: the project's founding constraint, and
// the one criterion that admits no exception.
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
