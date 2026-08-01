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
const PIXLS = 'https://raw.pixls.us/getfile.php';
const GOPRO = 'https://raw.githubusercontent.com/gopro/gpmf-parser/main/samples';
const CHROMIUM = 'https://raw.githubusercontent.com/chromium/chromium/main/media/test/data';
const EXIFTOOL = 'https://raw.githubusercontent.com/exiftool/exiftool/master/t/images';

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

  { nom: 'gros-boutiste.tif', url: `${IANARE}/tiff/Arbitro.tiff`, requis: true,
    role: 'TIFF gros-boutiste, une seule bande de pixels' },
  { nom: 'multi-bandes.tif', url: `${IANARE}/tiff/Picoawards.tiff`, requis: true,
    role: 'TIFF petit-boutiste à soixante et une bandes de pixels' },

  // The digital negatives. A DNG, a NEF and a CR2 are TIFFs: they are exactly
  // what kept the "Add" column closed, and without them the test that opens it
  // would be conjecture. The Kodak is the decisive case, a negative whose file
  // name says ".TIF".
  { nom: 'negatif.dng', url: `${PIXLS}/6584/nice/Canon%20-%20EOS-1D%20X%20-%201:1.dng`, requis: true,
    role: 'Canon EOS-1D X — le négatif canonique, DNGVersion en clair' },
  { nom: 'negatif.nef', url: `${PIXLS}/4269/nice/Nikon%20-%20Nikon%20COOLSCAN%20V%20ED%20-%20uncompressed%20(3:2).nef`, requis: true,
    role: 'Nikon COOLSCAN V ED — brut de scanner de film, pas d\'appareil' },
  { nom: 'negatif.cr2', url: `${PIXLS}/2102/nice/Canon%20-%20EOS%2040D%20-%20sRAW2%20(sRAW)%20(3:2).CR2`, requis: true,
    role: 'Canon EOS 40D — brut propriétaire à magie secondaire' },
  { nom: 'negatif.tif', url: `${PIXLS}/2465/nice/Kodak%20-%20EOS%20DCS%203%20-%208bit%20(4:3).TIF`, requis: true,
    role: 'Kodak EOS DCS 3 — un négatif numérique qui EST un « .tif »' },

  // The videos. They had been closed for want of a file, and that conclusion
  // was wrong: these three exist under a free licence, and each exercises a case
  // the other two do not show.
  { nom: 'piste-de-lieu.mp4', url: `${GOPRO}/hero6.mp4`, requis: true,
    role: 'GoPro HERO6 — lieu écrit par un vrai appareil, ET une piste qui l\'enregistre en continu' },
  { nom: 'sans-lieu.mp4', url: `${CHROMIUM}/bear.mp4`, requis: true,
    role: 'Vrai MP4 sans lieu — exerce la création' },
  { nom: 'tete-nue.mov', url: `${EXIFTOOL}/QuickTime.mov`, requis: true,
    role: 'Vrai QuickTime SANS boîte de tête — le format ne se devine qu\'à la structure' },
  { nom: 'fragmente.mp4', url: `${CHROMIUM}/bear-av1.mp4`, requis: true,
    role: 'MP4 fragmenté — les rangs absolus y vivent là où ce moteur ne va pas : éprouve le refus' },
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
  {
    nom: 'avec-lieu.tif', depuis: 'gros-boutiste.tif', requis: true,
    role: 'TIFF gros-boutiste portant le bloc de position d\'un vrai Nikon',
    args: ['-tagsfromfile', join(DIR, 'DSCN0010.jpg'), '-gps:all'],
  },
  {
    nom: 'bandes-avec-lieu.tif', depuis: 'multi-bandes.tif', requis: true,
    role: 'TIFF à soixante et une bandes portant le bloc de position d\'un vrai Nikon',
    args: ['-tagsfromfile', join(DIR, 'DSCN0010.jpg'), '-gps:all'],
  },

  /*
   * The geotagged videos. The group prefix is not decorative: in ExifTool,
   * `ItemList` is preferred for writing, so a bare `-GPSCoordinates=` would go
   * somewhere other than intended. The three slots below are deliberately
   * written in three different places; our reader has to understand all three,
   * which is more demanding than a file found already geotagged.
   *
   * Six decimals, not four: an eighteen-character string has only four decimals
   * per side, an eleven-metre grid, and the engine's final check requires the
   * metre. The reference file must therefore carry a string long enough for the
   * correction to happen in place.
   */
  {
    nom: 'avec-lieu.mp4', depuis: 'sans-lieu.mp4', requis: true,
    role: 'MP4 réel dont ExifTool a inscrit le lieu à la façon la plus répandue',
    args: ['-n', '-UserData:GPSCoordinates=+43.949300+004.805500/'],
  },
  {
    nom: 'avec-lieu.mov', depuis: 'tete-nue.mov', requis: true,
    role: 'QuickTime dont le lieu est rangé à la façon d\'Apple, par clés nommées',
    args: ['-n', '-Keys:GPSCoordinates=+43.949300+004.805500/'],
  },
  {
    nom: 'nom-de-lieu.mov', depuis: 'tete-nue.mov', requis: true,
    role: 'QuickTime qui écrit le lieu EN TOUTES LETTRES à côté des coordonnées — le cas « Avignon »',
    args: ['-n', '-UserData:LocationInformation=Avignon Role=shooting Lat=43.9493 Lon=4.8055 Alt=26'],
  },
  {
    nom: 'lieu-hors-piste.mp4', depuis: 'sans-lieu.mp4', requis: true,
    role: 'MP4 dont le lieu n\'est QUE dans le paquet de texte, rangé en boîte de premier niveau — le cas où l\'effacement pouvait mentir',
    args: ['-n', '-XMP:GPSLatitude=43.90811', '-XMP:GPSLongitude=4.86387'],
  },
  {
    nom: 'appareil.mp4', depuis: 'sans-lieu.mp4', requis: true,
    role: 'MP4 qui nomme son appareil — sans lui, la ligne « Appareil » du volet ne serait éprouvée par rien',
    args: ['-n', '-UserData:Make=Geotager', '-UserData:Model=Modele Temoin'],
  },
  {
    nom: 'texte-de-lieu.mov', depuis: 'tete-nue.mov', requis: true,
    role: 'QuickTime dont le paquet de texte descriptif nomme la ville, sans aucune coordonnée',
    args: ['-XMP:City=Avignon', '-XMP:Country=France'],
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
