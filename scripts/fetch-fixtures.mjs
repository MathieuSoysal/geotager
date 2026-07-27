/**
 * Fetches the test corpus.
 *
 * These files are not committed: they are real photos from the public
 * `ianare/exif-samples` repository, and the project forbids testing on files
 * made for the occasion. A generated file validates the code against itself;
 * only a photo that genuinely came out of a device exposes the cases that
 * break: inverted byte order, MakerNote with absolute offsets, out-of-spec tags.
 *
 * No network call happens during the site build: this script is for tests only.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://raw.githubusercontent.com/ianare/exif-samples/master/jpg';
const DIR = process.env.FIXTURES ?? 'test/fixtures';

const FICHIERS = [
  ['gps/DSCN0010.jpg', 'JPEG géolocalisé, Nikon, MakerNote à offsets absolus'],
  ['gps/DSCN0021.jpg', 'JPEG géolocalisé, second exemplaire'],
  ['Canon_40D.jpg', 'JPEG sans position — exerce la création du GPS IFD'],
];

mkdirSync(DIR, { recursive: true });

let recuperes = 0;
for (const [chemin, role] of FICHIERS) {
  const nom = chemin.split('/').pop();
  const dest = join(DIR, nom);
  if (existsSync(dest)) {
    console.log(`  déjà là   ${nom}`);
    recuperes++;
    continue;
  }
  try {
    const rep = await fetch(`${BASE}/${chemin}`);
    if (!rep.ok) throw new Error(`HTTP ${rep.status}`);
    writeFileSync(dest, Buffer.from(await rep.arrayBuffer()));
    console.log(`  récupéré  ${nom} — ${role}`);
    recuperes++;
  } catch (e) {
    console.error(`  ÉCHEC     ${nom} : ${e.message}`);
  }
}

if (recuperes < FICHIERS.length) {
  console.error(`\n${recuperes}/${FICHIERS.length} fichiers disponibles. Les tests seront incomplets.`);
  process.exit(1);
}
console.log(`\n${recuperes} fichiers dans ${DIR}/.`);
