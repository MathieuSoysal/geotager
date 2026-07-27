/**
 * Récupère le corpus de test.
 *
 * Ces fichiers ne sont pas committés : ce sont de vraies photos, sorties
 * d'appareils réels, et le projet interdit de tester sur des fichiers fabriqués
 * pour l'occasion. Un fichier généré valide le code contre lui-même ; seule une
 * photo réellement sortie d'un appareil expose les cas qui cassent — boutisme
 * inversé, MakerNote à offsets absolus, rationnels 0/0, tags hors spécification.
 *
 * Deux régimes de licence, et aucun inventé :
 *   - ianare/exif-samples : CC BY-SA 4.0, selon son README.rst. Dépôt archivé
 *     depuis avril 2025, donc stable, mais qui ne recevra plus rien.
 *   - drewnoakes/metadata-extractor-images : pas de fichier de licence, mais
 *     une autorisation explicite du dépôt (« You are free to use these media
 *     files however you wish. »). Hors de l'allowlist de CREDITS.md : voir
 *     l'entrée Q-035 du registre.
 *   - AOMediaCodec/libavif : BSD-2-Clause.
 *
 * Certaines cases du tableau demandent un fichier PORTEUR d'un lieu, dans un
 * format où aucun corpus public n'en fournit. Dans ce cas c'est ExifTool —
 * l'oracle, une implémentation indépendante de la nôtre — qui inscrit le lieu
 * de départ dans un vrai fichier d'appareil. Le conteneur reste réel, et notre
 * lecteur doit comprendre l'écriture d'un tiers : c'est plus exigeant qu'un
 * échantillon trouvé déjà géolocalisé. Voir Q-035.
 *
 * Aucun appel réseau n'a lieu pendant la construction du site : ce script est
 * réservé aux tests.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.FIXTURES ?? 'test/fixtures';

const IANARE = 'https://raw.githubusercontent.com/ianare/exif-samples/master';
const DREWNOAKES = 'https://raw.githubusercontent.com/drewnoakes/metadata-extractor-images/main';
const LIBAVIF = 'https://raw.githubusercontent.com/AOMediaCodec/libavif/main/tests/data';

/**
 * `requis` traduit mécaniquement la règle du projet : une case du tableau ne
 * passe à « oui » qu'une fois son test vert. Un fichier requis manquant fait
 * échouer toute la chaîne ; un fichier facultatif ne produit qu'un
 * avertissement, et la ligne correspondante doit rester à « pas encore ».
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
];

/**
 * Fichiers dérivés d'un vrai fichier d'appareil, dont ExifTool inscrit le lieu.
 * Voir l'en-tête et Q-035.
 */
const PREPARES = [];

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
