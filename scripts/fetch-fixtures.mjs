/**
 * Fetches the test corpus.
 *
 * These files are not committed: they are real photos, out of real devices, and
 * the project forbids testing on files made for the occasion. A generated file
 * validates the code against itself; only a photo that genuinely came out of a
 * device exposes the cases that break: inverted byte order, MakerNote with
 * absolute offsets, 0/0 rationals, out-of-spec tags.
 *
 * Two licence regimes, and none invented:
 *   - ianare/exif-samples: CC BY-SA 4.0, per its README.rst. Archived since
 *     April 2025, so stable, but it will receive nothing more.
 *   - drewnoakes/metadata-extractor-images: no licence file, but explicit
 *     permission from the repository ("You are free to use these media files
 *     however you wish."). Outside the CREDITS.md allowlist.
 *   - AOMediaCodec/libavif: BSD-2-Clause.
 *
 * Some cells of the table need a file carrying a location, in a format where no
 * public corpus provides one. In that case ExifTool, the oracle and an
 * implementation independent of ours, writes the starting location into a real
 * device file. The container stays real, and our reader has to understand a
 * third party's writing, which is more demanding than a sample found already
 * geotagged.
 *
 * No network call happens during the site build: this script is for tests only.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.FIXTURES ?? 'test/fixtures';

const IANARE = 'https://raw.githubusercontent.com/ianare/exif-samples/master';
const DREWNOAKES = 'https://raw.githubusercontent.com/drewnoakes/metadata-extractor-images/main';
const LIBAVIF = 'https://raw.githubusercontent.com/AOMediaCodec/libavif/main/tests/data';

/**
 * `requis` mechanically encodes the project's rule: a cell of the table only
 * turns to yes once its test is green. A missing required file fails the whole
 * chain; an optional one produces only a warning, and the corresponding row must
 * stay at "not yet".
 */
const FICHIERS = [
  { nom: 'DSCN0010.jpg', url: `${IANARE}/jpg/gps/DSCN0010.jpg`, requis: true,
    role: 'JPEG géolocalisé, Nikon, MakerNote à offsets absolus' },
  { nom: 'DSCN0021.jpg', url: `${IANARE}/jpg/gps/DSCN0021.jpg`, requis: true,
    role: 'JPEG géolocalisé, second exemplaire' },
  { nom: 'Canon_40D.jpg', url: `${IANARE}/jpg/Canon_40D.jpg`, requis: true,
    role: "JPEG sans position — exerce la création du GPS IFD" },

  { nom: 'iphone.heic', url: `${IANARE}/heic/IMG_5195.HEIC`, requis: true,
    role: 'iPhone 11 Pro Max avec position — bloc gros-boutiste, 45 items, grille' },
  { nom: 'iphone-sans-lieu.heic', url: `${DREWNOAKES}/heic/IMG_2927.HEIC`, requis: true,
    role: "iPhone 11 Pro sans position — exerce le refus d'ajout" },
  { nom: 'bloc-en-queue.heif', url: `${IANARE}/heic/mobile/HMD_Nokia_8.3_5G_hdr.heif`, requis: true,
    role: 'Nokia 8.3 — bloc rangé nativement en fin de fichier, petit-boutiste, sans marque ni modèle' },
  { nom: 'gps-degenere.heic', url: `${DREWNOAKES}/heic/Issue%20487.heic`, requis: true,
    role: 'Galaxy S10 — rationnels 0/0 et boîte de description après les données' },
  { nom: 'photo.avif', url: `${LIBAVIF}/seine_sdr_gainmap_srgb.avif`, requis: true,
    role: 'Pixel 4a avec position réelle — dénominateurs inhabituels, vignette' },
  { nom: 'lieu-purge.avif', url: `${LIBAVIF}/paris_icc_exif_xmp.avif`, requis: true,
    role: 'Pixel 4a dont GIMP a purgé les coordonnées — bloc GPS à zéro' },

  { nom: 'sans-lieu.png', url: `${DREWNOAKES}/png/sampleWithExifData.png`, requis: true,
    role: 'PNG portant un vrai morceau eXIf, sans position' },
  { nom: 'texte.png', url: `${DREWNOAKES}/png/photoshop-8x12-rgb24-all-metadata.png`, requis: true,
    role: 'PNG portant un paquet de texte descriptif Photoshop' },

  { nom: 'avec-lieu.webp', url: `${DREWNOAKES}/webp/HTC%20Desire.webp`, requis: true,
    role: 'HTC Desire — forme étendue, profil de couleurs, bloc gros-boutiste géolocalisé' },
  { nom: 'prefixe.webp', url: `${DREWNOAKES}/webp/Issue%20473%20(Java).webp`, requis: true,
    role: 'iPhone X — bloc précédé du préambule d\'un JPEG, texte descriptif mal nommé' },
  { nom: 'sans-lieu.webp', url: `${DREWNOAKES}/webp/Nikon%20Coolpix%20P7000.webp`, requis: true,
    role: "Coolpix P7000 — forme étendue sans position, exerce la création" },
  { nom: 'lieu-degenere.webp', url: `${DREWNOAKES}/webp/Nikon%20D1X.webp`, requis: true,
    role: 'Nikon D1X — bloc de position présent mais incomplet' },
  { nom: 'simple.webp', url: 'https://www.gstatic.com/webp/gallery/4.webp', requis: true,
    role: 'Forme simple, sans emplacement prévu pour un lieu — reste en lecture seule' },
];

/**
 * Files derived from a real device file, with ExifTool writing the location.
 * See the header.
 */
const PREPARES = [
  {
    nom: 'avec-lieu.png', depuis: 'sans-lieu.png', requis: true,
    role: 'PNG réel portant le bloc de position d\'un vrai Nikon, recopié par ExifTool',
    args: ['-tagsfromfile', join(DIR, 'DSCN0010.jpg'), '-gps:all'],
  },
  {
    nom: 'texte-avec-lieu.png', depuis: 'texte.png', requis: true,
    role: 'PNG dont le paquet de texte porte une seconde copie du lieu',
    args: ['-xmp:GPSLatitude=43.9493', '-xmp:GPSLongitude=4.8055'],
  },
];

mkdirSync(DIR, { recursive: true });

let manquantsRequis = 0;
let manquants = 0;

for (const f of FICHIERS) {
  const dest = join(DIR, f.nom);
  if (existsSync(dest)) {
    console.log(`  déjà là   ${f.nom}`);
    continue;
  }
  try {
    const rep = await fetch(f.url);
    if (!rep.ok) throw new Error(`HTTP ${rep.status}`);
    writeFileSync(dest, Buffer.from(await rep.arrayBuffer()));
    console.log(`  récupéré  ${f.nom} — ${f.role}`);
  } catch (e) {
    manquants++;
    if (f.requis) {
      manquantsRequis++;
      console.error(`  ÉCHEC     ${f.nom} : ${e.message}`);
    } else {
      console.warn(
        `  ABSENT    ${f.nom} : ${e.message} — la ligne correspondante du tableau doit rester à « pas encore »`,
      );
    }
  }
}

for (const p of PREPARES) {
  const dest = join(DIR, p.nom);
  const source = join(DIR, p.depuis);
  if (existsSync(dest)) {
    console.log(`  déjà là   ${p.nom}`);
    continue;
  }
  if (!existsSync(source)) {
    manquants++;
    if (p.requis) manquantsRequis++;
    console.error(`  ÉCHEC     ${p.nom} : ${p.depuis} absent`);
    continue;
  }
  try {
    copyFileSync(source, dest);
    execFileSync('exiftool', [...p.args, '-overwrite_original', dest], { stdio: 'pipe' });
    console.log(`  préparé   ${p.nom} — ${p.role}`);
  } catch (e) {
    manquants++;
    if (p.requis) manquantsRequis++;
    console.error(`  ÉCHEC     ${p.nom} : ${e.message}`);
  }
}

if (manquantsRequis > 0) {
  console.error(`\n${manquantsRequis} fichier(s) requis manquant(s). Les tests seraient incomplets.`);
  process.exit(1);
}
if (manquants > 0) {
  console.warn(`\n${manquants} fichier(s) facultatif(s) absent(s) : certains scénarios seront sautés.`);
}
console.log(`\nCorpus prêt dans ${DIR}/.`);
