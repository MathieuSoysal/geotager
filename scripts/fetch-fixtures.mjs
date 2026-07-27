/**
 * Récupère le corpus de test.
 *
 * Ces fichiers ne sont pas committés : ce sont de vraies photos issues du dépôt
 * public `ianare/exif-samples`, et le projet interdit de tester sur des fichiers
 * fabriqués pour l'occasion. Un fichier généré valide le code contre lui-même ;
 * seule une photo réellement sortie d'un appareil expose les cas qui cassent —
 * boutisme inversé, MakerNote à offsets absolus, tags hors spécification.
 *
 * Aucun appel réseau n'a lieu pendant la construction du site : ce script est
 * réservé aux tests.
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
