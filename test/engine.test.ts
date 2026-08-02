/**
 * Banc de test du moteur EXIF, sur de vrais fichiers.
 *
 * Règle : une écriture n'est jamais validée par notre propre lecteur seul. Un
 * encodeur et un décodeur symétriquement faux passeraient une auto-relecture
 * avec un écart de exactement zéro. ExifTool sert donc d'oracle indépendant.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readGpsFromJpeg,
  writeGpsToJpeg,
  deleteGpsFromJpeg,
  stripAllMetadata,
} from '../src/lib/exif/jpeg.ts';
import { parseTiff, readPosition, degreesToDms } from '../src/lib/exif/tiff.ts';
import {
  conteneurDe,
  detecterFormat,
  ecrirePosition,
  effacerPosition,
  lirePosition,
  memesOctetsHorsPlages,
  toutEffacer,
} from '../src/lib/exif/conteneurs.ts';
import '../src/lib/exif/formats.ts';
import { empreinteDesEmplacements, itemsDuFichier } from '../src/lib/exif/isobmff.ts';
import { boites, enfants, toutesLesBoites } from '../src/lib/exif/bmff.ts';
import { writeU32 } from '../src/lib/exif/octets.ts';
import {
  accepteAjoutVideo,
  infosVideo,
  porteursConcordent,
  structureIntacte,
  copieDuLieuAilleursVideo,
  ecrireIso6709,
  ecrirePositionVideo,
  effacerPositionVideo,
  lireIso6709,
  lieuEnMouvement,
  lirePositionVideo,
  porteursDeLieu,
  sonderVideo,
} from '../src/lib/exif/quicktime.ts';
import { createHash } from 'node:crypto';
import { commandePour } from '../scripts/deploy.mjs';
import { MATRICE, capacitesDe, cellules } from '../src/lib/exif/capacites.ts';
import { manifeste } from '../src/lib/manifeste.ts';
import { DICOS, LANGUES } from '../src/lib/i18n/index.ts';
import {
  LAT_MAX,
  ZOOM_MAX,
  ZOOM_MIN,
  depuisPixels,
  formatDecimal,
  metresParPixel,
  normaliserLon,
  validerPosition,
  versPixels,
} from '../src/lib/exif/coords.ts';
import type { Format } from '../src/lib/exif/types.ts';

// Même valeur par défaut que scripts/fetch-fixtures.mjs : sans cela, le banc
// cherchait le corpus à la racine du dépôt et échouait par une exception non
// rattrapée, ce qui donnait l'impression que le moteur était en cause.
const FIXTURES = process.env.FIXTURES ?? 'test/fixtures';
const tmp = mkdtempSync(join(tmpdir(), 'geotager-'));

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function exif(args: string[]): string {
  try {
    return execFileSync('exiftool', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e: any) {
    return e.stdout ?? '';
  }
}

/** Position lue par ExifTool, en degrés décimaux signés. */
function exifPosition(file: string): { lat: number; lon: number } | null {
  const out = exif(['-n', '-s', '-s', '-s', '-GPSLatitude', '-GPSLongitude', file]).trim();
  const lines = out.split('\n').filter(Boolean);
  if (lines.length < 2) return null;
  const lat = Number(lines[0]);
  const lon = Number(lines[1]);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/**
 * Inventaire des tags qui doivent survivre à une opération sur la position.
 *
 * On exclut quatre familles, et seulement celles-là : les tags [GPS] (c'est ce
 * qu'on modifie), les tags [Composite] dérivés du GPS (ExifTool les recalcule),
 * les tags système volatils (chemin, dates d'accès, taille) qui décrivent le
 * fichier sur le disque et non son contenu, et — pour une vidéo — le lieu
 * lui-même, qu'ExifTool range sous [UserData], [Keys] ou [ItemList] et JAMAIS
 * sous [GPS]. Sans cette dernière exclusion, l'inventaire censé prouver que
 * « tout le reste est préservé » comparerait une position à une position, et
 * signalerait comme une perte le changement qu'on venait de demander.
 */
function inventory(file: string): string[] {
  const volatils =
    /^\[(System|File)\]\s+(Directory|FileName|FileSize|FileAccessDate|FileModifyDate|FileInodeChangeDate|FilePermissions)\b/;
  const lieuVideo =
    /^\[(UserData|Keys|ItemList|Track\d+)\]\s+(GPS\w*|LocationInformation|Location\w*)\b/;
  return exif(['-a', '-G1', '-s', file])
    .split('\n')
    .filter((l) => l.trim())
    .filter((l) => !/^\[GPS\]/.test(l))
    .filter((l) => !/^\[Composite\]\s+GPS/.test(l))
    .filter((l) => !lieuVideo.test(l))
    .filter((l) => !volatils.test(l))
    .sort();
}

/**
 * Empreinte de chaque item ≠ Exif d'un fichier ISOBMFF.
 *
 * C'est le témoin le plus direct que les images secondaires ont survécu : il
 * porte sur les octets, pas sur ce qu'un outil en dit. Chromium ne décodant pas
 * le HEIC, c'est aussi ce qui remplace un décodage réel — et le remplace
 * avantageusement : des octets identiques se décodent identiquement.
 */
function empreintesDesItems(fichier: string): string {
  const b = new Uint8Array(readFileSync(fichier));
  return itemsDuFichier(b)
    .filter((x) => x.type !== 'Exif')
    .map((x) => `${x.id}:${x.type}:${createHash('sha256').update(b.subarray(x.debut, x.debut + x.longueur)).digest('hex').slice(0, 16)}`)
    .join('|');
}

/**
 * Entrées de la table des emplacements qui ont bougé entre deux états.
 *
 * « La table est intacte » est le bon témoin tant que rien ne change de
 * longueur. Dès qu'on ajoute un lieu, une entrée DOIT bouger — et une seule.
 * C'est cette assertion-là qui prouve que repointer l'item de position n'a
 * déplacé aucun autre item.
 */
function diffDesEmplacements(avant: Uint8Array, apres: Uint8Array): string[] {
  const decouper = (b: Uint8Array) => new Map(
    empreinteDesEmplacements(b).split('|').filter(Boolean).map((e) => [e.split(':')[0], e]),
  );
  const a = decouper(avant);
  const z = decouper(apres);
  const bouges: string[] = [];
  for (const [id, ligne] of z) if (a.get(id) !== ligne) bouges.push(id);
  for (const id of a.keys()) if (!z.has(id)) bouges.push(id);
  return bouges;
}

/**
 * Vrai si libheif — un décodeur tiers — sait encore décoder ce fichier.
 *
 * ExifTool dit ce que le fichier CONTIENT ; celui-ci dit qu'il se DÉCODE
 * encore. Ce sont deux questions différentes, et déplacer un bloc de position
 * peut très bien satisfaire la première sans la seconde.
 *
 * L'absence de l'outil ne vaut PAS un décodage réussi, et ne doit pas non plus
 * se confondre avec un échec de décodage : le premier appel tranche une fois
 * pour toutes, pour que « heif-convert n'est pas installé » se lise dans le
 * rapport au lieu de se déguiser en régression du moteur.
 */
let libheifPresent: boolean | null = null;
function seDecodeEncore(fichier: string): boolean {
  if (libheifPresent === null) {
    try {
      execFileSync('heif-info', ['--version'], { stdio: 'pipe' });
      libheifPresent = true;
    } catch {
      libheifPresent = false;
      console.log('  !!   heif-convert est absent : installez libheif-examples');
    }
  }
  if (!libheifPresent) return false;
  try {
    execFileSync('heif-convert', [fichier, join(tmp, `decode-${Date.now()}.png`)], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Nombre d'entrées réellement présentes dans le MakerNote, selon ExifTool. */
function makerNoteEntries(file: string): number {
  const m = exif(['-v3', file]).match(/MakerNotes directory with (\d+) entries/);
  return m ? Number(m[1]) : 0;
}

const METRES_PAR_DEGRE = 111_320;
function distanceMetres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (a.lat - b.lat) * METRES_PAR_DEGRE;
  const dLon = (a.lon - b.lon) * METRES_PAR_DEGRE * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/** Résumé lisible d'un écart d'inventaire, pour que l'échec soit diagnostiquable. */
function diffResume(avant: string[], apres: string[]): string {
  const a = new Set(avant);
  const b = new Set(apres);
  const perdus = avant.filter((l) => !b.has(l));
  const gagnes = apres.filter((l) => !a.has(l));
  if (!perdus.length && !gagnes.length) return '';
  const court = (l: string) => l.replace(/\s+/g, ' ').slice(0, 70);
  return [
    perdus.length ? `perdus: ${perdus.slice(0, 3).map(court).join(' | ')}` : '',
    gagnes.length ? `gagnés: ${gagnes.slice(0, 3).map(court).join(' | ')}` : '',
  ].filter(Boolean).join('  //  ');
}

function scenario(title: string, fn: () => void): void {
  console.log(`\n${title}`);
  try {
    fn();
  } catch (e) {
    failed++;
    console.log(`  FAIL exception — ${(e as Error).message}`);
  }
}

/* ------------------------------------------------------------------ */

const geotagged = ['DSCN0010.jpg', 'DSCN0021.jpg'];
const withMakerNote = 'Canon_40D.jpg';

for (const name of geotagged) {
  const path = join(FIXTURES, name);
  const src = new Uint8Array(readFileSync(path));

  scenario(`${name} — lecture`, () => {
    const mine = readGpsFromJpeg(src);
    const theirs = exifPosition(path);
    check('une position est lue', mine !== null && theirs !== null);
    if (mine && theirs) {
      const d = distanceMetres(mine, theirs);
      // Tolérance de 10 cm : au-delà, c'est un bug d'encodage, pas de précision.
      check('accord avec ExifTool à moins de 0,1 m', d < 0.1, `écart ${d.toFixed(4)} m`);
    }
  });

  scenario(`${name} — suppression de la position`, () => {
    const before = inventory(path);
    const res = deleteGpsFromJpeg(src);
    const out = join(tmp, `del-${name}`);
    writeFileSync(out, res.bytes);

    check('taille identique à l\'octet près', res.bytes.length === src.length,
      `${src.length} -> ${res.bytes.length}`);
    check('voie P1 (édition sur place)', res.route === 'P1');
    check('ExifTool ne trouve plus de position', exifPosition(out) === null);

    const residus = exif(['-a', '-G1', '-s', '-GPS:all', out]).trim();
    check('aucun tag GPS résiduel', residus === '', residus.slice(0, 120));

    const after = inventory(out);
    check('tout le reste est préservé', JSON.stringify(before) === JSON.stringify(after),
      diffResume(before, after));

    // Les MakerNotes Nikon portent des offsets absolus : le moindre octet
    // déplacé les rendrait illisibles. C'est le témoin le plus sévère.
    const mnAvant = makerNoteEntries(path);
    const mnApres = makerNoteEntries(out);
    check('le MakerNote est intact', mnAvant > 0 && mnAvant === mnApres,
      `${mnAvant} entrées avant, ${mnApres} après`);
  });

  scenario(`${name} — correction de la position`, () => {
    const cible = { lat: 43.9493, lon: 4.8055 }; // Avignon
    const res = writeGpsToJpeg(src, cible.lat, cible.lon);
    const out = join(tmp, `set-${name}`);
    writeFileSync(out, res.bytes);

    check('voie P1 (les champs existaient déjà)', res.route === 'P1');
    check('taille identique à l\'octet près', res.bytes.length === src.length);

    const relu = exifPosition(out);
    check('ExifTool relit une position', relu !== null);
    if (relu) {
      const d = distanceMetres(relu, cible);
      check('position relue conforme à moins de 0,1 m', d < 0.1, `écart ${d.toFixed(4)} m`);
    }
    check('notre lecteur est d\'accord avec ExifTool',
      relu !== null && distanceMetres(readGpsFromJpeg(res.bytes)!, relu) < 0.1);
  });
}

scenario(`${withMakerNote} — ajout d'une position sur un fichier qui n'en a pas`, () => {
  const path = join(FIXTURES, withMakerNote);
  const src = new Uint8Array(readFileSync(path));
  const before = inventory(path);

  check('aucune position au départ', readGpsFromJpeg(src) === null);

  const cible = { lat: 45.7640, lon: 4.8357 }; // Lyon
  const res = writeGpsToJpeg(src, cible.lat, cible.lon, 2244);
  const out = join(tmp, `add-${withMakerNote}`);
  writeFileSync(out, res.bytes);

  check('voie P2 (le GPS IFD a dû être créé)', res.route === 'P2');

  const relu = exifPosition(out);
  check('ExifTool relit la position ajoutée', relu !== null);
  if (relu) {
    const d = distanceMetres(relu, cible);
    check('position conforme à moins de 0,1 m', d < 0.1, `écart ${d.toFixed(4)} m`);
  }

  const after = inventory(out);
  check('tout le reste est préservé', JSON.stringify(before) === JSON.stringify(after),
    diffResume(before, after));

  const erreur = exif(['-n', '-s', '-s', '-s', '-GPSHPositioningError', out]).trim();
  check('la précision déclarée est écrite', erreur === '2244', `lu « ${erreur} »`);

  // On doit pouvoir revenir en arrière.
  const efface = deleteGpsFromJpeg(res.bytes);
  const out2 = join(tmp, `add-then-del-${withMakerNote}`);
  writeFileSync(out2, efface.bytes);
  check('la position ajoutée peut être retirée', exifPosition(out2) === null);
  check('l\'aller-retour ne perd rien', JSON.stringify(inventory(out2)) === JSON.stringify(before),
    diffResume(before, inventory(out2)));
});

scenario('Tout effacer', () => {
  const path = join(FIXTURES, geotagged[0]);
  const src = new Uint8Array(readFileSync(path));
  const res = stripAllMetadata(src);
  const out = join(tmp, 'strip.jpg');
  writeFileSync(out, res.bytes);

  check('le fichier a rétréci', res.bytes.length < src.length);
  check('aucune position', exifPosition(out) === null);

  const reste = exif(['-a', '-G1', '-s', '-EXIF:all', '-XMP:all', '-IPTC:all', out]).trim();
  check('aucun tag EXIF, XMP ou IPTC résiduel', reste === '', reste.slice(0, 200));

  const dims = exif(['-s', '-s', '-s', '-ImageSize', out]).trim();
  check('l\'image reste décodable et de même taille', dims === exif(['-s', '-s', '-s', '-ImageSize', path]).trim(),
    `« ${dims} »`);
});

// Q-036. Perdre le profil décale visiblement les couleurs dans toute
// application gérée en couleur : c'est une dégradation de l'image, pas un
// retrait d'information. PNG et WebP le conservaient déjà ; le JPEG était le
// seul écart avec att_exif.md §4.
scenario('Tout effacer garde le profil de couleurs d\'un JPEG', () => {
  const path = join(FIXTURES, 'Canon_40D.jpg');
  const src = new Uint8Array(readFileSync(path));
  const empreinteProfil = (f: string) =>
    createHash('sha256').update(exif(['-b', '-ICC_Profile', f])).digest('hex');

  const avant = empreinteProfil(path);
  check('le fichier de départ porte bien un profil',
    exif(['-s', '-s', '-s', '-ICC_Profile:ProfileDescription', path]).trim() !== '');

  const res = stripAllMetadata(src);
  const out = join(tmp, 'strip-icc.jpg');
  writeFileSync(out, res.bytes);

  check('le fichier a rétréci', res.bytes.length < src.length);
  const reste = exif(['-a', '-G1', '-s', '-EXIF:all', '-XMP:all', '-IPTC:all', out]).trim();
  check('aucun tag EXIF, XMP ou IPTC résiduel', reste === '', reste.slice(0, 200));
  check('le profil de couleurs est intact au bit près', empreinteProfil(out) === avant);
  check('l\'image reste décodable et de même taille',
    exif(['-s', '-s', '-s', '-ImageSize', out]).trim() ===
      exif(['-s', '-s', '-s', '-ImageSize', path]).trim());
});

scenario('Fichiers refusés proprement', () => {
  const pasUnJpeg = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let code = '';
  try {
    readGpsFromJpeg(pasUnJpeg);
  } catch (e: any) {
    code = e.code;
  }
  check('un PNG est rejeté avec un code explicite', code === 'PAS_UN_JPEG', code);

  const tronque = new Uint8Array(readFileSync(join(FIXTURES, geotagged[0]))).slice(0, 400);
  let code2 = '';
  try {
    deleteGpsFromJpeg(tronque);
  } catch (e: any) {
    code2 = e.code;
  }
  check('un fichier tronqué est rejeté', code2 === 'FICHIER_TRONQUE' || code2 === 'EXIF_CORROMPU', code2);
});

/* ------------------------------------------------------------------ */
/* Garanties génériques                                                */
/*                                                                     */
/* Les blocs TIFF fabriqués ci-dessous servent des chemins de REFUS et  */
/* un vecteur à valeur connue. La règle « de vraies photos » vise les   */
/* chemins nominaux : on ne peut pas trouver dans la nature un fichier  */
/* garanti porteur d'un défaut précis.                                  */
/* ------------------------------------------------------------------ */

/** Bloc TIFF minimal portant un GPS IFD, aux rationnels imposés. */
function blocGps(boutisme: 'II' | 'MM', lat: Array<[number, number]>, lon: Array<[number, number]>): Uint8Array {
  const b = new Uint8Array(128);
  const le = boutisme === 'II';
  const u16 = (o: number, v: number) => {
    if (le) { b[o] = v & 0xff; b[o + 1] = v >>> 8; } else { b[o] = v >>> 8; b[o + 1] = v & 0xff; }
  };
  const u32 = (o: number, v: number) => {
    if (le) { b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff; b[o + 2] = (v >>> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff; }
    else { b[o] = (v >>> 24) & 0xff; b[o + 1] = (v >>> 16) & 0xff; b[o + 2] = (v >>> 8) & 0xff; b[o + 3] = v & 0xff; }
  };
  b[0] = le ? 0x49 : 0x4d;
  b[1] = le ? 0x49 : 0x4d;
  u16(2, 42);
  u32(4, 8);
  u16(8, 1);
  u16(10, 0x8825); u16(12, 4); u32(14, 1); u32(18, 26); // IFD0 : pointeur GPS
  u32(22, 0);
  u16(26, 4); // GPS IFD, 4 entrées
  const entree = (k: number, tag: number, type: number, count: number, inline: number[] | null, ptr?: number) => {
    const o = 28 + k * 12;
    u16(o, tag); u16(o + 2, type); u32(o + 4, count);
    if (inline) inline.forEach((v, i) => (b[o + 8 + i] = v));
    else u32(o + 8, ptr!);
  };
  entree(0, 0x0001, 2, 2, [0x4e, 0]);   // LatitudeRef « N »
  entree(1, 0x0002, 5, 3, null, 80);    // Latitude
  entree(2, 0x0003, 2, 2, [0x45, 0]);   // LongitudeRef « E »
  entree(3, 0x0004, 5, 3, null, 104);   // Longitude
  u32(76, 0);
  lat.forEach(([n, d], i) => { u32(80 + i * 8, n); u32(84 + i * 8, d); });
  lon.forEach(([n, d], i) => { u32(104 + i * 8, n); u32(108 + i * 8, d); });
  return b;
}

scenario('Une position absente n\'est jamais annoncée comme valide', () => {
  // Un Galaxy S10 sans relevé écrit des rationnels 0/0 ; GIMP laisse 0/1 0/1 0/1
  // en purgeant les coordonnées. Les deux se lisaient « 0, 0 » — une position
  // parfaitement valide au large du golfe de Guinée.
  const zeroSurZero: Array<[number, number]> = [[0, 0], [0, 0], [0, 0]];
  const zeroSurUn: Array<[number, number]> = [[0, 1], [0, 1], [0, 1]];
  const vraie: Array<[number, number]> = [[43, 1], [56, 1], [575_000, 10_000]];

  check('des rationnels 0/0 ne font pas une position',
    readPosition(parseTiff(blocGps('II', zeroSurZero, zeroSurZero))) === null);
  check('des coordonnées nulles ne font pas une position',
    readPosition(parseTiff(blocGps('MM', zeroSurUn, zeroSurUn))) === null);

  const lue = readPosition(parseTiff(blocGps('MM', vraie, vraie)));
  check('une vraie position est toujours lue', lue !== null && Math.abs(lue.lat - 43.9493) < 1e-4,
    JSON.stringify(lue));
});

scenario('Vecteur à valeur connue, en II et en MM', () => {
  // Un encodeur et un décodeur symétriquement faux s'accordent parfaitement.
  // On compare donc les OCTETS produits dans les deux boutismes, sans relire.
  const dms = degreesToDms(43.9493);
  const li = blocGps('II', dms, dms);
  const be = blocGps('MM', dms, dms);
  let miroir = true;
  for (let i = 0; i < 24; i += 4) {
    for (let k = 0; k < 4; k++) if (li[80 + i + k] !== be[80 + i + (3 - k)]) miroir = false;
  }
  check('les 24 octets de latitude sont l\'exact miroir d\'un boutisme à l\'autre', miroir);
  check('les deux boutismes se relisent à la même valeur',
    Math.abs(readPosition(parseTiff(li))!.lat - readPosition(parseTiff(be))!.lat) < 1e-12);
  check('la valeur relue est celle demandée à moins de 0,1 m',
    Math.abs(readPosition(parseTiff(li))!.lat - 43.9493) * METRES_PAR_DEGRE < 0.1);
});

scenario('Rien ne change hors des plages annoncées', () => {
  const a = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const memeLongueur = (mod: number[], plages: Array<[number, number]>) =>
    memesOctetsHorsPlages(a, new Uint8Array(mod), plages);

  check('aucune modification passe', memeLongueur([1, 2, 3, 4, 5, 6, 7, 8], []));
  check('une modification dans la plage passe', memeLongueur([1, 2, 9, 9, 5, 6, 7, 8], [[2, 4]]));
  check('une modification hors plage échoue', !memeLongueur([1, 2, 3, 4, 9, 6, 7, 8], [[2, 4]]));
  check('des plages qui se recouvrent sont fusionnées',
    memeLongueur([1, 9, 9, 9, 9, 6, 7, 8], [[1, 3], [2, 5]]));
  check('un allongement non annoncé échoue',
    !memesOctetsHorsPlages(a, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), []));
  check('un allongement annoncé passe',
    memesOctetsHorsPlages(a, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), [[8, 9]]));
});


/* ------------------------------------------------------------------ */
/* HEIC et AVIF                                                        */
/*                                                                     */
/* Toutes les opérations y sont à longueur strictement constante : la  */
/* longueur de l'item ne change pas, donc la table des emplacements ne  */
/* change pas, donc aucun décalage d'aucun autre item ne devient faux.  */
/* On le prouve à chaque fois, plutôt que de l'affirmer.                */
/* ------------------------------------------------------------------ */

const AVIGNON = { lat: 43.9493, lon: 4.8055 };

function conteneurOuEchec(src: Uint8Array) {
  const c = conteneurDe(src);
  if (!c) throw new Error('aucun conteneur ne reconnaît ce fichier');
  return c;
}

for (const [nom] of [
  ['iphone.heic', 'photo iPhone'],
  ['photo.avif', 'photo AVIF'],
] as const) {
  const chemin = join(FIXTURES, nom);

  scenario(`${nom} — lecture`, () => {
    const src = new Uint8Array(readFileSync(chemin));
    const nous = lirePosition(conteneurOuEchec(src), src);
    const eux = exifPosition(chemin);
    check('une position est lue', nous !== null && eux !== null);
    if (nous && eux) {
      const d = distanceMetres(nous, eux);
      check('accord avec ExifTool à moins de 0,1 m', d < 0.1, `écart ${d.toFixed(4)} m`);
    }
  });

  scenario(`${nom} — correction de la position`, () => {
    const src = new Uint8Array(readFileSync(chemin));
    const avantInv = inventory(chemin);
    const avantItems = empreintesDesItems(chemin);
    const avantIloc = empreinteDesEmplacements(src);

    const res = ecrirePosition(conteneurOuEchec(src), src, AVIGNON.lat, AVIGNON.lon);
    const out = join(tmp, `set-${nom}`);
    writeFileSync(out, res.bytes);

    check('voie P1 (édition sur place)', res.route === 'P1');
    check('taille identique à l\'octet près', res.bytes.length === src.length,
      `${src.length} -> ${res.bytes.length}`);
    check('rien n\'a changé hors des plages annoncées',
      memesOctetsHorsPlages(src, res.bytes, res.changed));

    const relu = exifPosition(out);
    check('ExifTool relit la position demandée',
      relu !== null && distanceMetres(relu, AVIGNON) < 0.1,
      relu ? `écart ${distanceMetres(relu, AVIGNON).toFixed(4)} m` : 'aucune position relue');

    const apresInv = inventory(out);
    check('tout le reste est préservé', JSON.stringify(avantInv) === JSON.stringify(apresInv),
      diffResume(avantInv, apresInv));
    check('la table des emplacements est intacte',
      empreinteDesEmplacements(res.bytes) === avantIloc);
    check('les items secondaires sont intacts au bit près',
      empreintesDesItems(out) === avantItems);
    check('l\'image reste de même taille pour ExifTool',
      exif(['-s', '-s', '-s', '-ImageSize', out]).trim() ===
        exif(['-s', '-s', '-s', '-ImageSize', chemin]).trim());
  });

  scenario(`${nom} — effacement de la position`, () => {
    const src = new Uint8Array(readFileSync(chemin));
    const avantInv = inventory(chemin);
    const avantItems = empreintesDesItems(chemin);
    const avantIloc = empreinteDesEmplacements(src);

    const res = effacerPosition(conteneurOuEchec(src), src);
    const out = join(tmp, `del-${nom}`);
    writeFileSync(out, res.bytes);

    check('taille identique à l\'octet près', res.bytes.length === src.length);
    check('rien n\'a changé hors des plages annoncées',
      memesOctetsHorsPlages(src, res.bytes, res.changed));
    check('ExifTool ne trouve plus de position', exifPosition(out) === null);

    const residus = exif(['-a', '-G1', '-s', '-GPS:all', out]).trim();
    check('aucun tag GPS résiduel', residus === '', residus.slice(0, 160));

    const apresInv = inventory(out);
    check('tout le reste est préservé', JSON.stringify(avantInv) === JSON.stringify(apresInv),
      diffResume(avantInv, apresInv));
    check('la table des emplacements est intacte',
      empreinteDesEmplacements(res.bytes) === avantIloc);
    check('les items secondaires sont intacts au bit près',
      empreintesDesItems(out) === avantItems);
  });
}

// Le bloc de ce Nokia est à 4,4 ko de la fin du fichier, sans que personne
// n'ait réagencé le conteneur : c'est un agencement d'appareil, pas un fichier
// de régression fabriqué pour l'occasion.
scenario('bloc-en-queue.heif — un bloc rangé en fin de fichier', () => {
  const chemin = join(FIXTURES, 'bloc-en-queue.heif');
  const src = new Uint8Array(readFileSync(chemin));
  const c = conteneurOuEchec(src);

  check('la position est lue malgré l\'agencement inhabituel', lirePosition(c, src) !== null);

  const res = effacerPosition(c, src);
  const out = join(tmp, 'del-queue.heif');
  writeFileSync(out, res.bytes);
  check('taille identique', res.bytes.length === src.length);
  check('rien hors des plages annoncées', memesOctetsHorsPlages(src, res.bytes, res.changed));
  check('plus aucune position', exifPosition(out) === null);
  check('les items secondaires sont intacts', empreintesDesItems(out) === empreintesDesItems(chemin));
});

scenario('iphone-sans-lieu.heic — effacer une photo sans lieu ne touche rien', () => {
  const src = new Uint8Array(readFileSync(join(FIXTURES, 'iphone-sans-lieu.heic')));
  const c = conteneurOuEchec(src);
  check('aucune position au départ', lirePosition(c, src) === null);

  // Demander le retrait de ce qui n'est pas là doit rendre l'original, pas une
  // copie « nettoyée » dont un octet aurait bougé au passage.
  const res = effacerPosition(c, src);
  check('l\'effacement ne touche rien', res.bytes.length === src.length &&
    memesOctetsHorsPlages(src, res.bytes, []));
});

/* ------------------------------------------------------------------ */
/* L'ajout sur HEIC et AVIF                                            */
/*                                                                     */
/* On n'agrandit rien sur place : le nouveau bloc va dans une boîte     */
/* ajoutée en fin de fichier, et la seule entrée de la table des        */
/* emplacements qui le concerne est repointée. Ce que ces scénarios     */
/* prouvent, c'est qu'une seule entrée bouge, qu'aucun autre item ne    */
/* change d'un bit, et qu'un décodeur tiers ouvre encore le résultat.   */
/* ------------------------------------------------------------------ */

/** Chemin nominal de l'ajout, quel que soit le point de départ. */
function verifierAjout(nom: string, chemin: string, src: Uint8Array, etiquette: string): void {
  const c = conteneurOuEchec(src);
  const avantItems = empreintesDesItems(chemin);

  check(`${etiquette} : aucune position au départ`, lirePosition(c, src) === null);
  check(`${etiquette} : l'ajout est annoncé possible avant l'action`,
    c.accepteAjout?.(src) === true);

  const res = ecrirePosition(c, src, AVIGNON.lat, AVIGNON.lon);
  const out = join(tmp, `add-${nom}`);
  writeFileSync(out, res.bytes);

  check(`${etiquette} : voie P2 (bloc reconstruit)`, res.route === 'P2');
  check(`${etiquette} : le fichier grandit`, res.bytes.length > src.length,
    `${src.length} -> ${res.bytes.length}`);
  check(`${etiquette} : rien n'a changé hors des plages annoncées`,
    memesOctetsHorsPlages(src, res.bytes, res.changed));

  const relu = exifPosition(out);
  check(`${etiquette} : ExifTool relit la position demandée`,
    relu !== null && distanceMetres(relu, AVIGNON) < 0.1,
    relu ? `écart ${distanceMetres(relu, AVIGNON).toFixed(4)} m` : 'aucune position relue');

  const bouges = diffDesEmplacements(src, res.bytes);
  check(`${etiquette} : une seule entrée de la table a bougé`, bouges.length === 1,
    `entrées déplacées : ${bouges.join(', ') || 'aucune'}`);
  check(`${etiquette} : les items secondaires sont intacts au bit près`,
    empreintesDesItems(out) === avantItems);
  check(`${etiquette} : l'image reste de même taille pour ExifTool`,
    exif(['-s', '-s', '-s', '-ImageSize', out]).trim() ===
      exif(['-s', '-s', '-s', '-ImageSize', chemin]).trim());
  const validation = exif(['-validate', '-warning', '-a', out]);
  check(`${etiquette} : ExifTool ne signale aucun défaut de structure`,
    !/error|corrupt/i.test(validation), validation.trim().slice(0, 160));

  // Règle de symétrie, la même qu'en Q-030 pour le second lecteur : s'il savait
  // ouvrir l'entrée, il doit savoir ouvrir la sortie. S'il ne savait pas —
  // décodeur absent, format non pris en charge par cette installation —, son
  // silence ne vaut PAS un échec de notre part. Un oracle qu'on interroge sans
  // savoir s'il sait répondre ne prouve rien dans un sens comme dans l'autre.
  const ouvraitAvant = seDecodeEncore(chemin);
  check(`${etiquette} : un décodeur tiers ouvre encore le fichier`,
    !ouvraitAvant || seDecodeEncore(out),
    ouvraitAvant ? 'libheif refuse la sortie' : "libheif n'ouvrait pas déjà l'entrée — sans objet");
}

scenario('iphone-sans-lieu.heic — ajout d\'une position', () => {
  const chemin = join(FIXTURES, 'iphone-sans-lieu.heic');
  verifierAjout('iphone-sans-lieu.heic', chemin,
    new Uint8Array(readFileSync(chemin)), 'iPhone sans lieu');
});

// Après effacement, l'entrée qui désigne le bloc de position a disparu d'IFD0 :
// réécrire un lieu n'est donc plus une correction mais bien une création. C'est
// le seul moyen d'éprouver l'ajout sur un AVIF réel — aucun AVIF du corpus
// n'arrive dépourvu de bloc de position.
for (const nom of ['iphone.heic', 'photo.avif'] as const) {
  scenario(`${nom} — effacer puis ajouter`, () => {
    const chemin = join(FIXTURES, nom);
    const src = new Uint8Array(readFileSync(chemin));
    const efface = effacerPosition(conteneurOuEchec(src), src).bytes;
    const intermediaire = join(tmp, `vide-${nom}`);
    writeFileSync(intermediaire, efface);
    verifierAjout(nom, intermediaire, efface, `${nom} vidé`);
  });
}

scenario('L\'ajout est refusé quand le fichier ne s\'y prête pas', () => {
  const src = new Uint8Array(readFileSync(join(FIXTURES, 'iphone.heic')));
  const c = conteneurOuEchec(src);

  // Une boîte finale qui déclare la taille 0 s'étend jusqu'à la fin du fichier :
  // elle avalerait tout ce qu'on ajouterait derrière, et le bloc de position
  // deviendrait des données d'image aux yeux de tout lecteur.
  const boiteSansFin = new Uint8Array(src);
  let o = 0;
  let dernierDebut = 0;
  while (o + 8 <= boiteSansFin.length) {
    const taille = (boiteSansFin[o] * 0x1000000 + (boiteSansFin[o + 1] << 16) +
      (boiteSansFin[o + 2] << 8) + boiteSansFin[o + 3]) >>> 0;
    if (taille < 8 || o + taille > boiteSansFin.length) break;
    dernierDebut = o;
    o += taille;
  }
  boiteSansFin.set([0, 0, 0, 0], dernierDebut);
  check('une boîte finale sans fin déclarée ferme l\'ajout',
    c.accepteAjout?.(boiteSansFin) === false);

  // Des octets qu'aucune boîte ne revendique : notre lecture de la structure
  // est fausse quelque part, on ne bâtit rien dessus.
  const avecTraine = new Uint8Array(src.length + 3);
  avecTraine.set(src, 0);
  check('des octets en trop après la dernière boîte ferment l\'ajout',
    c.accepteAjout?.(avecTraine) === false);

  // Sans item de position à repointer, il faudrait faire grandir la table des
  // items : hors de portée de cette voie, et annoncé comme tel.
  const sansItem = new Uint8Array(src);
  const marque = [0x45, 0x78, 0x69, 0x66]; // « Exif »
  for (let i = 0; i + 4 <= sansItem.length && i < 65536; i++) {
    if (marque.every((x, k) => sansItem[i + k] === x)) sansItem[i] = 0x5a; // « Zxif »
  }
  check('sans emplacement à repointer, l\'ajout est fermé',
    c.accepteAjout?.(sansItem) === false);
  let code = '';
  try {
    ecrirePosition(c, sansItem, AVIGNON.lat, AVIGNON.lon);
  } catch (e: any) {
    code = e.code;
  }
  check('et le refus porte un code explicite', code === 'AJOUT_IMPOSSIBLE', code);
});

for (const [nom, quoi] of [
  ['gps-degenere.heic', 'des rationnels 0/0 d\'un Galaxy S10'],
  ['lieu-purge.avif', 'des coordonnées purgées par GIMP'],
] as const) {
  scenario(`${nom} — ${quoi} ne font pas une position`, () => {
    const chemin = join(FIXTURES, nom);
    const src = new Uint8Array(readFileSync(chemin));
    const c = conteneurOuEchec(src);
    check('notre lecteur n\'annonce aucune position', lirePosition(c, src) === null);

    // ExifTool, lui, affiche bien 0 : c'est ce qui est écrit dans le fichier.
    // La question n'est pas de savoir qui a raison sur les octets, mais ce
    // qu'on affiche à quelqu'un qui demande « où cette photo a-t-elle été
    // prise ? ». « Nulle part » est la seule réponse honnête.
    const res = effacerPosition(c, src);
    const out = join(tmp, `del-${nom}`);
    writeFileSync(out, res.bytes);
    check('l\'effacement reste possible et à longueur constante',
      res.bytes.length === src.length);
    check('rien hors des plages annoncées', memesOctetsHorsPlages(src, res.bytes, res.changed));
    check('plus aucun tag GPS après effacement',
      exif(['-a', '-G1', '-s', '-GPS:all', out]).trim() === '');
    check('les items secondaires sont intacts', empreintesDesItems(out) === empreintesDesItems(chemin));
  });
}

/* ------------------------------------------------------------------ */
/* PNG                                                                 */
/*                                                                     */
/* Seul format de ce lot où l'AJOUT est pleinement sûr : aucun décalage */
/* absolu interne, donc insérer ou agrandir un morceau n'invalide rien. */
/* ------------------------------------------------------------------ */

scenario('avec-lieu.png — lecture et correction', () => {
  const chemin = join(FIXTURES, 'avec-lieu.png');
  const src = new Uint8Array(readFileSync(chemin));
  const c = conteneurOuEchec(src);
  const avant = inventory(chemin);

  const nous = lirePosition(c, src);
  const eux = exifPosition(chemin);
  check('une position est lue', nous !== null && eux !== null);
  if (nous && eux) {
    check('accord avec ExifTool à moins de 0,1 m', distanceMetres(nous, eux) < 0.1);
  }

  const res = ecrirePosition(c, src, AVIGNON.lat, AVIGNON.lon);
  const out = join(tmp, 'set.png');
  writeFileSync(out, res.bytes);
  check('voie P1 (édition sur place)', res.route === 'P1');
  check('taille identique à l\'octet près', res.bytes.length === src.length);
  check('rien hors des plages annoncées', memesOctetsHorsPlages(src, res.bytes, res.changed));
  const relu = exifPosition(out);
  check('ExifTool relit la position demandée',
    relu !== null && distanceMetres(relu, AVIGNON) < 0.1);
  check('la somme de contrôle du morceau reste valide',
    !/error|corrupt/i.test(exif(['-validate', '-warning', '-a', out])),
    exif(['-validate', '-warning', '-a', out]).trim().slice(0, 120));
  check('tout le reste est préservé', JSON.stringify(avant) === JSON.stringify(inventory(out)),
    diffResume(avant, inventory(out)));
});

scenario('avec-lieu.png — effacement', () => {
  const chemin = join(FIXTURES, 'avec-lieu.png');
  const src = new Uint8Array(readFileSync(chemin));
  const avant = inventory(chemin);
  const res = effacerPosition(conteneurOuEchec(src), src);
  const out = join(tmp, 'del.png');
  writeFileSync(out, res.bytes);

  check('taille identique à l\'octet près', res.bytes.length === src.length);
  check('rien hors des plages annoncées', memesOctetsHorsPlages(src, res.bytes, res.changed));
  check('ExifTool ne trouve plus de position', exifPosition(out) === null);
  check('aucun tag GPS résiduel',
    exif(['-a', '-G1', '-s', '-GPS:all', out]).trim() === '');
  check('la somme de contrôle reste valide',
    !/error|corrupt/i.test(exif(['-validate', '-warning', '-a', out])));
  check('tout le reste est préservé', JSON.stringify(avant) === JSON.stringify(inventory(out)),
    diffResume(avant, inventory(out)));
});

scenario('sans-lieu.png — ajout d\'une position', () => {
  const chemin = join(FIXTURES, 'sans-lieu.png');
  const src = new Uint8Array(readFileSync(chemin));
  const c = conteneurOuEchec(src);
  const avant = inventory(chemin);
  check('aucune position au départ', lirePosition(c, src) === null);

  const res = ecrirePosition(c, src, AVIGNON.lat, AVIGNON.lon, 2244);
  const out = join(tmp, 'add.png');
  writeFileSync(out, res.bytes);
  check('voie P2 (le bloc a dû grandir)', res.route === 'P2');
  check('rien hors des plages annoncées', memesOctetsHorsPlages(src, res.bytes, res.changed));
  const relu = exifPosition(out);
  check('ExifTool relit la position ajoutée',
    relu !== null && distanceMetres(relu, AVIGNON) < 0.1);
  check('la précision déclarée est écrite',
    exif(['-n', '-s', '-s', '-s', '-GPSHPositioningError', out]).trim() === '2244');
  check('l\'image reste décodable et de même taille',
    exif(['-s', '-s', '-s', '-ImageSize', out]).trim() ===
      exif(['-s', '-s', '-s', '-ImageSize', chemin]).trim());
  check('tout le reste est préservé', JSON.stringify(avant) === JSON.stringify(inventory(out)),
    diffResume(avant, inventory(out)));

  const efface = effacerPosition(c, res.bytes);
  const out2 = join(tmp, 'add-del.png');
  writeFileSync(out2, efface.bytes);
  check('la position ajoutée peut être retirée', exifPosition(out2) === null);
});

scenario('texte-avec-lieu.png — la seconde copie du lieu est purgée', () => {
  const chemin = join(FIXTURES, 'texte-avec-lieu.png');
  const src = new Uint8Array(readFileSync(chemin));
  const c = conteneurOuEchec(src);

  check('la copie hors bloc principal est détectée', c.copieDuLieuAilleurs?.(src) === true);
  const avantXmp = exif(['-a', '-G1', '-s', '-XMP:all', chemin]);
  check('le lieu est bien dans le paquet de texte au départ', /GPSLatitude/.test(avantXmp));

  const res = effacerPosition(c, src);
  const out = join(tmp, 'del-xmp.png');
  writeFileSync(out, res.bytes);

  check('taille identique à l\'octet près', res.bytes.length === src.length);
  check('rien hors des plages annoncées', memesOctetsHorsPlages(src, res.bytes, res.changed));
  const apresXmp = exif(['-a', '-G1', '-s', '-XMP:all', out]);
  check('plus aucun lieu dans le paquet de texte', !/GPS|LocationCreated/.test(apresXmp),
    apresXmp.trim().slice(0, 120));
  check('le reste du paquet de texte survit', /CreatorTool|ModifyDate/.test(apresXmp),
    apresXmp.trim().slice(0, 120));
  check('la somme de contrôle reste valide',
    !/error|corrupt/i.test(exif(['-validate', '-warning', '-a', out])));
});

scenario('texte.png — tout effacer garde le profil de couleurs', () => {
  const chemin = join(FIXTURES, 'texte.png');
  const src = new Uint8Array(readFileSync(chemin));
  const c = conteneurOuEchec(src);
  const res = toutEffacer(c, src);
  const out = join(tmp, 'strip.png');
  writeFileSync(out, res.bytes);
  check('le fichier a rétréci', res.bytes.length < src.length);
  check('aucun texte descriptif résiduel',
    exif(['-a', '-G1', '-s', '-XMP:all', '-EXIF:all', out]).trim() === '');
  check('l\'image reste décodable et de même taille',
    exif(['-s', '-s', '-s', '-ImageSize', out]).trim() ===
      exif(['-s', '-s', '-s', '-ImageSize', chemin]).trim());
});


/* ------------------------------------------------------------------ */
/* WebP                                                                */
/*                                                                     */
/* Trois travers de vrais fichiers sont exercés ici : un bloc précédé   */
/* du préambule d'un JPEG, un morceau de texte mal nommé, et des        */
/* drapeaux d'en-tête qui ne décrivent pas le contenu réel.             */
/* ------------------------------------------------------------------ */

scenario('avec-lieu.webp — lecture, correction et effacement', () => {
  const chemin = join(FIXTURES, 'avec-lieu.webp');
  const src = new Uint8Array(readFileSync(chemin));
  const c = conteneurOuEchec(src);
  const avant = inventory(chemin);

  const nous = lirePosition(c, src);
  const eux = exifPosition(chemin);
  check('une position est lue', nous !== null && eux !== null);
  if (nous && eux) check('accord avec ExifTool à moins de 0,1 m', distanceMetres(nous, eux) < 0.1);

  const res = ecrirePosition(c, src, AVIGNON.lat, AVIGNON.lon);
  const out = join(tmp, 'set.webp');
  writeFileSync(out, res.bytes);
  check('voie P1 (édition sur place)', res.route === 'P1');
  check('taille identique à l\'octet près', res.bytes.length === src.length);
  check('rien hors des plages annoncées', memesOctetsHorsPlages(src, res.bytes, res.changed));
  const relu = exifPosition(out);
  check('ExifTool relit la position demandée',
    relu !== null && distanceMetres(relu, AVIGNON) < 0.1);
  check('le profil de couleurs survit', /ICC|Profile/i.test(exif(['-a', '-G1', '-s', '-ICC_Profile:all', out])),
    'aucun profil relu');
  check('tout le reste est préservé', JSON.stringify(avant) === JSON.stringify(inventory(out)),
    diffResume(avant, inventory(out)));

  const efface = effacerPosition(c, src);
  const out2 = join(tmp, 'del.webp');
  writeFileSync(out2, efface.bytes);
  check('l\'effacement est à longueur constante', efface.bytes.length === src.length);
  check('rien hors des plages annoncées à l\'effacement',
    memesOctetsHorsPlages(src, efface.bytes, efface.changed));
  check('aucun tag GPS résiduel', exif(['-a', '-G1', '-s', '-GPS:all', out2]).trim() === '');
});

scenario('prefixe.webp — un bloc précédé du préambule d\'un JPEG', () => {
  const chemin = join(FIXTURES, 'prefixe.webp');
  const src = new Uint8Array(readFileSync(chemin));
  const c = conteneurOuEchec(src);

  check('la position est lue malgré le préambule', lirePosition(c, src) !== null);

  const res = ecrirePosition(c, src, AVIGNON.lat, AVIGNON.lon);
  const out = join(tmp, 'set-prefixe.webp');
  writeFileSync(out, res.bytes);
  check('taille identique à l\'octet près', res.bytes.length === src.length);
  check('le préambule est conservé tel quel',
    memesOctetsHorsPlages(src, res.bytes, res.changed));
  const relu = exifPosition(out);
  check('ExifTool relit la position demandée',
    relu !== null && distanceMetres(relu, AVIGNON) < 0.1);
});

scenario('sans-lieu.webp — ajout d\'une position', () => {
  const chemin = join(FIXTURES, 'sans-lieu.webp');
  const src = new Uint8Array(readFileSync(chemin));
  const c = conteneurOuEchec(src);
  const avant = inventory(chemin);
  check('aucune position au départ', lirePosition(c, src) === null);
  check('la forme étendue accepte de grandir', c.accepteAjout?.(src) === true);

  const res = ecrirePosition(c, src, AVIGNON.lat, AVIGNON.lon);
  const out = join(tmp, 'add.webp');
  writeFileSync(out, res.bytes);
  check('voie P2 (le bloc a dû grandir)', res.route === 'P2');
  check('rien hors des plages annoncées', memesOctetsHorsPlages(src, res.bytes, res.changed));
  check('la taille déclarée correspond au fichier',
    res.bytes.length === 8 + (res.bytes[4] | (res.bytes[5] << 8) | (res.bytes[6] << 16) | (res.bytes[7] << 24)));
  const relu = exifPosition(out);
  check('ExifTool relit la position ajoutée',
    relu !== null && distanceMetres(relu, AVIGNON) < 0.1);
  check('ExifTool ne signale aucune anomalie de structure',
    !/error|corrupt|invalid/i.test(exif(['-validate', '-warning', '-a', out])),
    exif(['-validate', '-warning', '-a', out]).trim().slice(0, 140));
  check('l\'image reste décodable et de même taille',
    exif(['-s', '-s', '-s', '-ImageSize', out]).trim() ===
      exif(['-s', '-s', '-s', '-ImageSize', chemin]).trim());
  check('tout le reste est préservé', JSON.stringify(avant) === JSON.stringify(inventory(out)),
    diffResume(avant, inventory(out)));
});

scenario('lieu-degenere.webp — un bloc de position incomplet', () => {
  const src = new Uint8Array(readFileSync(join(FIXTURES, 'lieu-degenere.webp')));
  const c = conteneurOuEchec(src);
  check('aucune position exploitable n\'est annoncée', lirePosition(c, src) === null);
  // Le format sait grandir : on peut donc réécrire un bloc complet plutôt que
  // de refuser. C'est la différence avec une photo d'iPhone.
  const res = ecrirePosition(c, src, AVIGNON.lat, AVIGNON.lon);
  const out = join(tmp, 'set-degenere.webp');
  writeFileSync(out, res.bytes);
  check('la position peut être écrite malgré tout',
    exifPosition(out) !== null && distanceMetres(exifPosition(out)!, AVIGNON) < 0.1);
});

scenario('simple.webp — la forme simple reste en lecture seule', () => {
  const src = new Uint8Array(readFileSync(join(FIXTURES, 'simple.webp')));
  const c = conteneurOuEchec(src);
  check('aucun emplacement pour un lieu', c.localiser(src).length === 0);
  check('la forme simple refuse de grandir', c.accepteAjout?.(src) === false);
  let code = '';
  try {
    ecrirePosition(c, src, AVIGNON.lat, AVIGNON.lon);
  } catch (e: any) {
    code = e.code;
  }
  check('l\'ajout est refusé avec un code explicite', code === 'AJOUT_IMPOSSIBLE', code);
});


/* ------------------------------------------------------------------ */
/* TIFF                                                                */
/*                                                                     */
/* Ici le fichier EST le bloc : les pixels vivent dedans, désignés par  */
/* des adresses de bandes. La carte des plages est la seule chose qui   */
/* les protège, et c'est ce que ces scénarios éprouvent.                */
/* ------------------------------------------------------------------ */

for (const [nom, quoi] of [
  ['avec-lieu.tif', 'gros-boutiste, une bande'],
  ['bandes-avec-lieu.tif', 'petit-boutiste, soixante et une bandes'],
] as const) {
  scenario(`${nom} — ${quoi}`, () => {
    const chemin = join(FIXTURES, nom);
    const src = new Uint8Array(readFileSync(chemin));
    const c = conteneurOuEchec(src);
    const avant = inventory(chemin);
    const pixelsAvant = exif(['-s', '-s', '-s', '-ImageSize', chemin]).trim();

    const nous = lirePosition(c, src);
    const eux = exifPosition(chemin);
    check('une position est lue', nous !== null && eux !== null);
    if (nous && eux) check('accord avec ExifTool à moins de 0,1 m', distanceMetres(nous, eux) < 0.1);

    const res = ecrirePosition(c, src, AVIGNON.lat, AVIGNON.lon);
    const out = join(tmp, `set-${nom}`);
    writeFileSync(out, res.bytes);
    check('voie P1 (édition sur place)', res.route === 'P1');
    check('taille identique à l\'octet près', res.bytes.length === src.length);
    check('rien hors des plages annoncées', memesOctetsHorsPlages(src, res.bytes, res.changed));
    const relu = exifPosition(out);
    check('ExifTool relit la position demandée',
      relu !== null && distanceMetres(relu, AVIGNON) < 0.1);
    check('les bandes de pixels sont intactes',
      exif(['-s', '-s', '-s', '-ImageSize', out]).trim() === pixelsAvant);
    check('tout le reste est préservé', JSON.stringify(avant) === JSON.stringify(inventory(out)),
      diffResume(avant, inventory(out)));

    const efface = effacerPosition(c, src);
    const out2 = join(tmp, `del-${nom}`);
    writeFileSync(out2, efface.bytes);
    check('l\'effacement est à longueur constante', efface.bytes.length === src.length);
    check('rien hors des plages annoncées à l\'effacement',
      memesOctetsHorsPlages(src, efface.bytes, efface.changed));
    check('aucun tag GPS résiduel', exif(['-a', '-G1', '-s', '-GPS:all', out2]).trim() === '');
    check('les bandes de pixels survivent à l\'effacement',
      exif(['-s', '-s', '-s', '-ImageSize', out2]).trim() === pixelsAvant);
    check('tout le reste est préservé après effacement',
      JSON.stringify(avant) === JSON.stringify(inventory(out2)), diffResume(avant, inventory(out2)));
  });
}

/* ------------------------------------------------------------------ */
/* Le discriminant : image ordinaire ou négatif numérique               */
/*                                                                     */
/* Un DNG, un NEF, un CR2 sont des TIFF. La liste blanche ne vaut que   */
/* si elle est éprouvée DANS LES DEUX SENS sur de vrais fichiers : elle */
/* doit accepter les images ordinaires et écarter tous les négatifs.    */
/* Un discriminant qui n'aurait jamais vu de négatif ne prouverait rien.*/
/* ------------------------------------------------------------------ */

for (const [nom, quoi] of [
  ['negatif.dng', 'Canon EOS-1D X, le négatif canonique'],
  ['negatif.nef', 'Nikon COOLSCAN V ED, un brut de scanner'],
  ['negatif.cr2', 'Canon EOS 40D, brut propriétaire'],
  ['negatif.tif', 'Kodak EOS DCS 3 — un négatif qui EST un « .tif »'],
] as const) {
  scenario(`${nom} — ${quoi} : l'ajout est refusé`, () => {
    const chemin = join(FIXTURES, nom);
    const src = new Uint8Array(readFileSync(chemin));
    const c = conteneurOuEchec(src);

    check('le fichier est bien reconnu comme un TIFF', c.format === 'tiff');
    check('l\'ajout est annoncé impossible AVANT l\'action',
      c.accepteAjout?.(src) === false);

    let code = '';
    try {
      ecrirePosition(c, src, AVIGNON.lat, AVIGNON.lon);
    } catch (e: any) {
      code = e.code;
    }
    check('et il est refusé avec un code explicite', code === 'AJOUT_IMPOSSIBLE', code);

    // Un refus qui aurait quand même touché le fichier serait pire qu'un refus.
    const apres = new Uint8Array(readFileSync(chemin));
    check('l\'original n\'a pas été touché d\'un octet',
      Buffer.compare(Buffer.from(src), Buffer.from(apres)) === 0);
  });
}

for (const nom of ['gros-boutiste.tif', 'multi-bandes.tif'] as const) {
  scenario(`${nom} — une image ordinaire accepte un lieu`, () => {
    const chemin = join(FIXTURES, nom);
    const src = new Uint8Array(readFileSync(chemin));
    const c = conteneurOuEchec(src);
    const avant = inventory(chemin);
    const pixelsAvant = exif(['-s', '-s', '-s', '-ImageSize', chemin]).trim();

    check('aucune position au départ', lirePosition(c, src) === null);
    check('l\'ajout est annoncé possible AVANT l\'action', c.accepteAjout?.(src) === true);

    const res = ecrirePosition(c, src, AVIGNON.lat, AVIGNON.lon);
    const out = join(tmp, `add-${nom}`);
    writeFileSync(out, res.bytes);

    check('voie P2 (bloc reconstruit)', res.route === 'P2');
    check('le fichier grandit', res.bytes.length > src.length,
      `${src.length} -> ${res.bytes.length}`);
    check('rien n\'a changé hors des plages annoncées',
      memesOctetsHorsPlages(src, res.bytes, res.changed));
    const relu = exifPosition(out);
    check('ExifTool relit la position demandée',
      relu !== null && distanceMetres(relu, AVIGNON) < 0.1,
      relu ? `écart ${distanceMetres(relu, AVIGNON).toFixed(4)} m` : 'aucune position relue');
    check('les bandes de pixels sont intactes',
      exif(['-s', '-s', '-s', '-ImageSize', out]).trim() === pixelsAvant);
    check('tout le reste est préservé', JSON.stringify(avant) === JSON.stringify(inventory(out)),
      diffResume(avant, inventory(out)));
    const validation = exif(['-validate', '-warning', '-a', out]);
    check('ExifTool ne signale aucun défaut de structure',
      !/error|corrupt/i.test(validation), validation.trim().slice(0, 160));
  });
}

// Corriger et effacer restent ouverts sur un négatif : c'est à longueur
// constante, et la carte des plages de tiff.ts protège les bandes de pixels.
// Ce comportement préexiste à ce lot et n'était adossé à rien — il l'est ici.
scenario('negatif.dng — effacer un lieu ne touche pas au négatif', () => {
  const chemin = join(FIXTURES, 'negatif.dng');
  const src = new Uint8Array(readFileSync(chemin));
  const c = conteneurOuEchec(src);
  const pixelsAvant = exif(['-s', '-s', '-s', '-ImageSize', chemin]).trim();
  const avant = inventory(chemin);

  const res = effacerPosition(c, src);
  const out = join(tmp, 'del-negatif.dng');
  writeFileSync(out, res.bytes);

  check('l\'effacement est à longueur strictement constante',
    res.bytes.length === src.length, `${src.length} -> ${res.bytes.length}`);
  check('rien hors des plages annoncées', memesOctetsHorsPlages(src, res.bytes, res.changed));
  check('aucun tag GPS résiduel', exif(['-a', '-G1', '-s', '-GPS:all', out]).trim() === '');
  check('les données du négatif sont intactes',
    exif(['-s', '-s', '-s', '-ImageSize', out]).trim() === pixelsAvant);
  check('tout le reste est préservé', JSON.stringify(avant) === JSON.stringify(inventory(out)),
    diffResume(avant, inventory(out)));
});

/* ------------------------------------------------------------------ */
/* Le tableau ne peut pas mentir                                       */
/*                                                                     */
/* La page rend le tableau depuis capacites.ts, donc il ne peut pas     */
/* diverger de ce que le MOTEUR croit savoir faire. Mais rien ne le     */
/* reliait à ce que le moteur SAIT faire : « une case ne passe à oui    */
/* qu'une fois son test vert » restait une discipline écrite. Ce        */
/* scénario en fait une propriété mécanique — il exécute réellement     */
/* chaque opération annoncée, sur un vrai fichier de ce format-là.      */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Les vidéos                                                          */
/*                                                                     */
/* Q-006 avait fermé la ligne sur une objection précise : une vidéo     */
/* range le lieu à plusieurs endroits, parfois EN TOUTES LETTRES, et    */
/* les pistes horodatées vivent dans les données que le moteur saute.   */
/* Chacun de ces cas a désormais son fichier, et son scénario.          */
/* ------------------------------------------------------------------ */

/** Toutes les vidéos du corpus. Chacune éprouve un cas que les autres n'ont pas. */
const VIDEOS = [
  'sans-lieu.mp4', 'avec-lieu.mp4', 'piste-de-lieu.mp4',
  'tete-nue.mov', 'avec-lieu.mov', 'nom-de-lieu.mov', 'texte-de-lieu.mov',
  'fragmente.mp4', 'appareil.mp4', 'lieu-hors-piste.mp4', 'lieu-illisible.mp4',
];

scenario('Les coordonnées d\'une vidéo se lisent dans les trois largeurs', () => {
  // La même position, écrite en degrés, en degrés-minutes, puis en
  // degrés-minutes-secondes. Le nombre de chiffres AVANT la virgule est le seul
  // indice : un `Number()` naïf lirait « 4356.958 degrés » et rendrait un lieu
  // impossible — ou pire, un lieu possible et faux.
  // Tolérance d'un mètre, et non de dix centimètres : les trois formes ne
  // découpent pas le degré au même endroit — une seconde d'arc vaut trente
  // mètres, donc un dixième de seconde en vaut trois. Ce qu'on éprouve ici
  // n'est pas la précision, c'est que la LARGEUR soit comprise : une lecture
  // naïve rendrait « 4356,958 degrés », soit un lieu impossible, ou pire, un
  // lieu possible à des milliers de kilomètres.
  const attendu = { lat: 43.9493, lon: 4.8055 };
  for (const forme of ['+43.9493+004.8055/', '+4356.958+00448.330/', '+435657.5+0044819.8/']) {
    const lu = lireIso6709(forme);
    check(`« ${forme} » est lu`, lu !== null &&
      distanceMetres(lu, attendu) < 1, lu ? `${lu.lat}, ${lu.lon}` : 'null');
  }
  for (const absurde of ['', 'bidon', '+43.9493/', '+9943.9493+004.8055/', '43.9493 4.8055']) {
    check(`« ${absurde} » est refusé plutôt que deviné`, lireIso6709(absurde) === null);
  }
  // La longueur imposée est le cœur de l'écriture sur place.
  check('une chaîne s\'écrit à la longueur exacte demandée',
    ecrireIso6709(attendu, 22) === '+43.949300+004.805500/');
  check('l\'altitude déjà écrite est conservée telle quelle',
    ecrireIso6709(attendu, 26, '+026.000') === '+43.9493+004.8055+026.000/');
  // Le nom du système de repère occupe la place sans porter de coordonnée : il
  // est rendu tel quel, et ce sont les décimales qui cèdent du terrain.
  check('le nom du système de repère est conservé tel quel',
    ecrireIso6709(attendu, 28, '', '/CRSWGS_84/') === '+43.9493+004.8055/CRSWGS_84/',
    String(ecrireIso6709(attendu, 28, '', '/CRSWGS_84/')));
});

/**
 * Une vidéo dérivée du corpus, dont on choisit la chaîne de position OCTET PAR
 * OCTET.
 *
 * ExifTool écrit la chaîne telle qu'on la lui donne tant qu'elle lui paraît
 * valide — c'est ainsi que naissent la plupart des formes ci-dessous. Pour les
 * autres, celles qu'il refuse d'ÉCRIRE mais sait LIRE, on remplace la charge
 * du rangement à longueur constante : aucun octet ne se déplace, le conteneur
 * reste celui d'une vraie vidéo, et seule la chaîne change.
 */
function videoDeChaine(nom: string, ecrite: string, remplacement?: string): string {
  const dest = join(tmp, `iso6709-${nom}.mp4`);
  writeFileSync(dest, readFileSync(join(FIXTURES, 'sans-lieu.mp4')));
  execFileSync(
    'exiftool',
    ['-n', `-UserData:GPSCoordinates=${ecrite}`, '-overwrite_original', dest],
    { stdio: 'pipe' },
  );
  if (remplacement !== undefined) {
    const b = new Uint8Array(readFileSync(dest));
    const udta = toutesLesBoites(b, 'udta', boites(b, 0, b.length));
    const xyz = udta.flatMap((u) => enfants(b, u)).find((x) => x.type === '©xyz');
    if (!xyz) throw new Error(`${nom} : ExifTool n'a rien écrit`);
    const debut = xyz.debut + xyz.entete;
    const longueur = (b[debut] << 8) | b[debut + 1];
    if (longueur !== remplacement.length) {
      throw new Error(`${nom} : ${longueur} octets à remplir, ${remplacement.length} fournis`);
    }
    for (let i = 0; i < longueur; i++) b[debut + 4 + i] = remplacement.charCodeAt(i);
    writeFileSync(dest, b);
  }
  return dest;
}

/*
 * Le défaut qui a coûté cinq allers-retours, et la règle qui en sort.
 *
 * Deux formes d'écriture parfaitement courantes — la chaîne terminée par un
 * octet nul, à la mode du langage C, et celle qui nomme son système de repère —
 * étaient TROUVÉES par le moteur et refusées par son décodeur. Le rangement
 * était là, son texte était sous nos yeux, et l'écran n'affichait rien : ni
 * pastille, ni ligne de position. Les outils du téléphone, eux, les lisaient.
 *
 * Le contrôle qui manquait est celui-ci : sur chaque forme, ce que NOUS lisons
 * doit valoir ce que lit l'oracle. Une divergence dans ce sens-là — lui lit, pas
 * nous — est exactement le symptôme signalé, et aucun test ne la voyait.
 */
scenario('Ce que l\'oracle lit dans une chaîne de position, nous le lisons aussi', () => {
  const attendu = { lat: 43.90811, lon: 4.86387 };
  // [nom, ce qu'ExifTool écrit, ce qu'on met à la place — même longueur]
  const FORMES: Array<[string, string, string?]> = [
    ['la forme simple', '+43.908110+004.863870/'],
    ['terminée par un octet nul', '+43.90811+004.863870/', '+43.90811+004.86387/\u0000'],
    ['avec une altitude', '+43.908110+004.863870+026.000/'],
    ['entourée de blancs', '+43.908110+004.863870/', ' +43.90811+004.86387/ '],
    ['nommant son système de repère', '+43.908110000+004.863870000/', '+43.9081+004.8639/CRSWGS_84/'],
    ['sans barre oblique finale', '+43.9081+004.864/', '+43.9081+004.8639'],
    ['en degrés entiers', '+43+004/'],
    ['en degrés et minutes', '+4354.4866+00451.8322/'],
    ['en longitude à un seul chiffre', '+43.9081+004.864/', '+43.90811+4.86387'],
  ];

  for (const [libelle, ecrite, remplacement] of FORMES) {
    const fichier = videoDeChaine(libelle.replace(/\W+/g, '-'), ecrite, remplacement);
    const nous = lirePositionVideo(new Uint8Array(readFileSync(fichier)));
    const oracle = exifPosition(fichier);
    // Une forme sur laquelle l'oracle se tait ne prouve rien de lui ; elle
    // prouve seulement que nous, nous ne nous taisons pas.
    if (oracle) {
      check(`${libelle} : nous lisons ce que l'oracle lit`,
        nous !== null && distanceMetres(nous, oracle) < 0.5,
        nous ? `${nous.lat}, ${nous.lon} contre ${oracle.lat}, ${oracle.lon}` : 'null');
    } else {
      check(`${libelle} : l'oracle se tait, nous lisons quand même le lieu`,
        nous !== null && distanceMetres(nous, attendu) < 2,
        nous ? `${nous.lat}, ${nous.lon}` : 'null');
    }
  }

  /*
   * Et quand nous ne savons VRAIMENT pas lire, on montre la chaîne telle quelle.
   *
   * C'est la leçon du lot, et elle vaut plus que les corrections ci-dessus : se
   * taire rend le désaccord invisible. Une ligne dans le volet, portant les
   * caractères mêmes du fichier, suffit à ce qu'une copie d'écran nomme la
   * forme qui nous manque — sans que personne ait à envoyer sa vidéo.
   */
  const octets = new Uint8Array(readFileSync(join(FIXTURES, 'lieu-illisible.mp4')));
  check('une chaîne que nous ne savons pas décoder ne rend aucune position',
    lirePositionVideo(octets) === null);
  const ligne = infosVideo(octets).details.find((d) => d.cle === 'LieuBrut');
  check('mais le volet la montre TELLE QU\'ELLE EST ÉCRITE',
    ligne?.value === '43.9081,4.8639,26', ligne ? ligne.value : '(aucune ligne)');
  check('et une chaîne bien lue ne la répète pas',
    infosVideo(new Uint8Array(readFileSync(join(FIXTURES, 'avec-lieu.mp4'))))
      .details.every((d) => d.cle !== 'LieuBrut'));
});

/*
 * Élargir la reconnaissance des marques, c'est risquer de reclasser un fichier
 * qui marchait. Une image HEIC peut s'annoncer sous une marque générique que la
 * vidéo revendique aussi — et rien, sinon ceci, ne signalerait qu'elle est
 * partie du mauvais côté. La liste est écrite en dur, exprès : elle doit
 * ÉCHOUER si un format change d'avis, pas s'adapter.
 */
scenario('Aucun fichier du corpus ne change de format', () => {
  const ATTENDU: Record<string, Format> = {
    'DSCN0010.jpg': 'jpeg', 'Canon_40D.jpg': 'jpeg',
    'iphone.heic': 'heic', 'iphone-sans-lieu.heic': 'heic', 'bloc-en-queue.heif': 'heic',
    'gps-degenere.heic': 'heic', 'photo.avif': 'avif', 'lieu-purge.avif': 'avif',
    'sans-lieu.png': 'png', 'avec-lieu.png': 'png',
    'avec-lieu.webp': 'webp', 'simple.webp': 'webp', 'sans-lieu.webp': 'webp',
    'gros-boutiste.tif': 'tiff', 'multi-bandes.tif': 'tiff',
    'negatif.dng': 'tiff', 'negatif.nef': 'tiff', 'negatif.cr2': 'tiff', 'negatif.tif': 'tiff',
    'piste-de-lieu.mp4': 'video', 'sans-lieu.mp4': 'video', 'avec-lieu.mp4': 'video',
    'tete-nue.mov': 'video', 'avec-lieu.mov': 'video', 'nom-de-lieu.mov': 'video',
  };
  for (const [nom, attendu] of Object.entries(ATTENDU)) {
    const src = new Uint8Array(readFileSync(join(FIXTURES, nom)));
    const vu = detecterFormat(src);
    check(`${nom} est un « ${attendu} »`, vu === attendu, `vu « ${vu} »`);
  }
});

scenario('tete-nue.mov — un QuickTime sans boîte de tête est reconnu', () => {
  const chemin = join(FIXTURES, 'tete-nue.mov');
  const src = new Uint8Array(readFileSync(chemin));
  // La boîte de type est une invention MP4 : un vrai QuickTime commence
  // directement par la description. Exiger cette boîte rendait ce fichier
  // « inconnu », donc intraitable, sans que rien ne le signale.
  check('le fichier ne commence pas par une boîte de type',
    String.fromCharCode(src[4], src[5], src[6], src[7]) !== 'ftyp');
  check('il est tout de même reconnu comme une vidéo', detecterFormat(src) === 'video');
});

scenario('piste-de-lieu.mp4 — le lieu en mouvement ferme les trois écritures', () => {
  const chemin = join(FIXTURES, 'piste-de-lieu.mp4');
  const src = new Uint8Array(readFileSync(chemin));

  const mine = lirePositionVideo(src);
  const theirs = exifPosition(chemin);
  check('la position écrite par l\'appareil est lue', mine !== null && theirs !== null);
  if (mine && theirs) {
    const d = distanceMetres(mine, theirs);
    check('accord avec ExifTool à moins de 0,1 m', d < 0.1, `écart ${d.toFixed(4)} m`);
  }

  check('une piste enregistre le lieu en continu', lieuEnMouvement(src));

  // Et le refus est FONDÉ, pas superstitieux : l'oracle, avec l'option que les
  // deux README recommandent déjà, trouve bien un lieu par échantillon.
  const horodatees = exif(['-ee', '-a', '-G1', '-s', '-GPSLatitude', chemin])
    .split('\n').filter((l) => l.trim()).length;
  check('l\'oracle en trouve plusieurs dizaines', horodatees > 5, `${horodatees} lignes`);

  const s = sonderVideo(src);
  check('« Lire » reste ouvert', s.capacites.lire);
  check('« Corriger » se ferme', !s.capacites.corriger);
  check('« Ajouter » se ferme', !s.capacites.ajouter);
  check('« Effacer » se ferme', !s.capacites.effacer);

  for (const [nom, agir] of [
    ['corriger', () => ecrirePositionVideo(src, AVIGNON.lat, AVIGNON.lon)],
    ['effacer', () => effacerPositionVideo(src)],
  ] as const) {
    let leve = false;
    try { agir(); } catch { leve = true; }
    check(`« ${nom} » lève au lieu de rendre un fichier faussement propre`, leve);
  }
});

scenario('avec-lieu.mov — le rangement d\'Apple, par clés nommées', () => {
  const chemin = join(FIXTURES, 'avec-lieu.mov');
  const src = new Uint8Array(readFileSync(chemin));

  const porteurs = porteursDeLieu(src);
  check('le lieu est trouvé là où Apple le range',
    porteurs.length === 1 && porteurs[0].sorte === 'keys',
    porteurs.map((p) => p.sorte).join(', '));

  const mine = lirePositionVideo(src);
  const theirs = exifPosition(chemin);
  check('accord avec ExifTool à moins de 0,1 m',
    mine !== null && theirs !== null && distanceMetres(mine, theirs) < 0.1);

  const avant = inventory(chemin);
  const pose = effacerPositionVideo(src);
  const out = join(tmp, 'video-keys-vide.mov');
  writeFileSync(out, pose.bytes);
  check('taille identique à l\'octet près', pose.bytes.length === src.length);
  check('l\'oracle ne trouve plus de position', exifPosition(out) === null);
  check('rien d\'autre n\'a disparu', JSON.stringify(inventory(out)) === JSON.stringify(avant));
});

scenario('nom-de-lieu.mov — les coordonnées ET la ville en toutes lettres', () => {
  const chemin = join(FIXTURES, 'nom-de-lieu.mov');
  const src = new Uint8Array(readFileSync(chemin));

  const porteurs = porteursDeLieu(src);
  check('le rangement qui nomme le lieu est trouvé',
    porteurs.some((p) => p.sorte === 'loci'));
  check('et son nom est vu comme tel',
    porteurs.some((p) => p.nomDeLieu !== null && p.nomDeLieu.longueur > 0));

  // Deux mètres, et c'est la bonne mesure : ce rangement-là note les degrés en
  // virgule fixe, par pas d'un soixante-cinq-millième — soit un mètre sept en
  // latitude. C'est précisément pourquoi le moteur refuse d'y écrire sur place.
  const mine = lirePositionVideo(src);
  const theirs = exifPosition(chemin);
  check('la position y est lue, en virgule fixe',
    mine !== null && theirs !== null && distanceMetres(mine, theirs) < 2,
    mine && theirs ? `${distanceMetres(mine, theirs).toFixed(3)} m` : 'null');

  // Le cœur de Q-006 : effacer les coordonnées en laissant « Avignon » rendrait
  // un fichier que l'utilisateur croirait propre.
  const pose = effacerPositionVideo(src);
  const out = join(tmp, 'video-nom-vide.mov');
  writeFileSync(out, pose.bytes);
  check('taille identique à l\'octet près', pose.bytes.length === src.length);
  check('l\'oracle ne trouve plus de position', exifPosition(out) === null);
  const reste = exif(['-a', '-G1', '-s', '-UserData:LocationInformation', out]).trim();
  check('le nom de la ville est parti avec les coordonnées', reste === '', reste.slice(0, 120));
  check('le fichier ne contient plus le mot en clair',
    !Buffer.from(pose.bytes).includes('Avignon'));
});

scenario('texte-de-lieu.mov — une ville nommée sans aucune coordonnée', () => {
  const chemin = join(FIXTURES, 'texte-de-lieu.mov');
  const src = new Uint8Array(readFileSync(chemin));

  check('aucune coordonnée n\'y est écrite', lirePositionVideo(src) === null);
  // Le balayage résiduel cherche les NOMS et pas seulement les nombres : c'est
  // très exactement ce que Q-006 reprochait à l'ancienne conception.
  check('une copie du lieu est pourtant vue', copieDuLieuAilleursVideo(src));

  const pose = effacerPositionVideo(src);
  const out = join(tmp, 'video-texte-vide.mov');
  writeFileSync(out, pose.bytes);
  check('taille identique à l\'octet près', pose.bytes.length === src.length);
  const ville = exif(['-a', '-G1', '-s', '-XMP:City', '-XMP:Country', out]).trim();
  check('la ville et le pays sont partis', ville === '', ville.slice(0, 120));
  const auteur = exif(['-a', '-G1', '-s', '-XMP:Creator', out]).trim();
  check('mais l\'auteur, lui, est resté', auteur !== '');
  check('plus aucune copie du lieu', !copieDuLieuAilleursVideo(pose.bytes));
});

scenario('avec-lieu.mp4 — corriger ne déplace pas un octet', () => {
  const chemin = join(FIXTURES, 'avec-lieu.mp4');
  const src = new Uint8Array(readFileSync(chemin));
  const avant = inventory(chemin);

  const pose = ecrirePositionVideo(src, AVIGNON.lat, AVIGNON.lon);
  const out = join(tmp, 'video-corrige.mp4');
  writeFileSync(out, pose.bytes);

  check('taille strictement identique', pose.bytes.length === src.length,
    `${src.length} -> ${pose.bytes.length}`);
  check('identique partout hors des plages annoncées',
    memesOctetsHorsPlages(src, pose.bytes, pose.changed));
  const relu = exifPosition(out);
  check('l\'oracle relit le lieu demandé à moins de 0,1 m',
    relu !== null && distanceMetres(relu, AVIGNON) < 0.1);
  check('rien d\'autre n\'a bougé', JSON.stringify(inventory(out)) === JSON.stringify(avant));

  // Une position quelconque, et non celle qui tombe pile : c'est elle qui
  // éprouve le nombre de décimales que la chaîne peut porter.
  const dur = { lat: 43.94931234, lon: 4.80551234 };
  const pose2 = ecrirePositionVideo(src, dur.lat, dur.lon);
  const out2 = join(tmp, 'video-corrige-2.mp4');
  writeFileSync(out2, pose2.bytes);
  const relu2 = exifPosition(out2);
  check('un lieu qui ne tombe pas juste est écrit au mètre près',
    relu2 !== null && distanceMetres(relu2, dur) < 1,
    relu2 ? `${distanceMetres(relu2, dur).toFixed(3)} m` : 'null');
});

scenario('sans-lieu.mp4 — ajouter un lieu sans toucher aux images', () => {
  const chemin = join(FIXTURES, 'sans-lieu.mp4');
  const src = new Uint8Array(readFileSync(chemin));

  check('le fichier ne porte aucun lieu', lirePositionVideo(src) === null);
  check('et il tolère de grandir', accepteAjoutVideo(src));

  const pose = ecrirePositionVideo(src, AVIGNON.lat, AVIGNON.lon);
  const out = join(tmp, 'video-ajout.mp4');
  writeFileSync(out, pose.bytes);

  check('identique partout hors des plages annoncées',
    memesOctetsHorsPlages(src, pose.bytes, pose.changed));
  const relu = exifPosition(out);
  check('l\'oracle relit le lieu ajouté à moins de 0,1 m',
    relu !== null && distanceMetres(relu, AVIGNON) < 0.1);

  // La preuve qui compte sur un fichier de plusieurs mégaoctets : les images et
  // le son n'ont pas bougé d'un octet, même si tout ce qui les suit s'est
  // décalé. On la mesure sur les octets eux-mêmes, pas sur une taille.
  const mdat = Buffer.from(src).indexOf('mdat');
  const taille = new DataView(src.buffer, src.byteOffset).getUint32(mdat - 4);
  check('les données de la vidéo sont intactes, octet pour octet',
    Buffer.from(src.subarray(mdat - 4, mdat - 4 + taille))
      .equals(Buffer.from(pose.bytes.subarray(mdat - 4, mdat - 4 + taille))),
    `${taille} octets`);
  check('la vidéo reste lisible',
    exif(['-s3', '-ImageSize', out]).trim() === exif(['-s3', '-ImageSize', chemin]).trim());
});

/*
 * La preuve « à l'octet près », rendue à sa force sur la voie qui fait grandir.
 *
 * `memesOctetsHorsPlages` compare index par index. Un ajout décale tout ce qui
 * le suit, donc la plage annoncée couvre nécessairement toute la fin du
 * fichier — et la preuve, sur cette voie-là, ne prouve presque rien : sur un
 * fichier de huit mégaoctets, elle exempte les huit mégaoctets.
 *
 * Ce qu'il faut établir n'est pas « rien n'a changé de place » — c'est faux par
 * construction — mais « rien n'a changé de CONTENU » : la fin du fichier
 * produit doit être la fin du fichier d'origine, décalée d'exactement ce qu'on
 * a inséré, et pas un octet d'autre.
 */
scenario('Un ajout ne fait que décaler, jamais réécrire', () => {
  for (const nom of VIDEOS) {
    const src = new Uint8Array(readFileSync(join(FIXTURES, nom)));
    const s = sonderVideo(src);
    if (s.position || !s.capacites.ajouter) continue;
    // Un fichier dont le paquet de texte porte une copie du lieu voit AUSSI ce
    // paquet purgé pendant l'écriture — légitimement, sinon le fichier dirait
    // deux lieux. La fin n'est alors plus un simple décalage, et ce contrôle-ci
    // ne s'applique pas. Il est écarté explicitement plutôt qu'en silence.
    if (copieDuLieuAilleursVideo(src)) {
      check(`${nom} : écarté, son paquet de texte porte une copie à purger`, true);
      continue;
    }

    const pose = ecrirePositionVideo(src, AVIGNON.lat, AVIGNON.lon);
    const ajoute = pose.bytes.length - src.length;
    // Deux rangements sur un MP4 — le simple et celui d'Apple —, un seul sur un
    // QuickTime. Dans tous les cas, quelques dizaines d'octets et pas davantage.
    check(`${nom} : le fichier ne grandit que de ses rangements`,
      ajoute > 0 && ajoute < 512, `${ajoute} o`);

    // Le point d'insertion se lit dans la STRUCTURE, et non au premier octet
    // qui diffère : les tailles des parents et les rangs des tronçons changent
    // eux aussi, et ils vivent AVANT le point d'insertion.
    const moov = boites(src, 0, src.length).find((x) => x.type === 'moov')!;
    const udta = enfants(src, moov).find((x) => x.type === 'udta');
    const insertion = udta ? udta.debut + udta.taille : moov.debut + moov.taille;

    // La comparaison qui suit n'a de sens que si aucune table de rangs ne vit
    // APRÈS le point d'insertion — sinon ses entrées changent, légitimement, et
    // la fin du fichier n'est plus un simple décalage. Aucun fichier du corpus
    // n'est dans ce cas ; on l'exige plutôt que de le supposer, pour que ce
    // contrôle échoue franchement le jour où un fichier l'y mettrait.
    const tables = toutesLesBoites(src, 'stco').concat(toutesLesBoites(src, 'co64'));
    check(`${nom} : aucune table de rangs après le point d'insertion`,
      tables.every((t) => t.debut < insertion));

    const avant = Buffer.from(src.subarray(insertion));
    const apres = Buffer.from(pose.bytes.subarray(insertion + ajoute));
    check(`${nom} : tout ce qui suit l'insertion est l'original, décalé`,
      avant.equals(apres), `${avant.length} o comparés depuis ${insertion}`);
  }
});

/*
 * Le contrôle d'après écriture, éprouvé dans LES DEUX SENS.
 *
 * Il remplace, pour les vidéos, le second lecteur écrit par d'autres qui
 * n'existe pas dans un navigateur. Livré au vert, il refusait pourtant TOUTES
 * les vidéos réelles : il descendait dans les feuilles, dont la charge est
 * faite de nombres qui se lisent comme des en-têtes. Aucun test ne l'atteignait,
 * parce qu'il vivait dans le worker et que les scénarios vidéo appelaient le
 * moteur en direct, sans passer par l'écriture complète. Voir Q-051.
 *
 * D'où les deux moitiés ci-dessous, et la seconde compte autant que la
 * première : un contrôle qu'on n'a jamais vu ÉCHOUER n'est pas un contrôle.
 */
scenario('La description de chaque vidéo se tient debout', () => {
  for (const nom of VIDEOS) {
    const src = new Uint8Array(readFileSync(join(FIXTURES, nom)));
    check(`${nom} : à l'entrée`, structureIntacte(src));

    // Et sur la sortie de chaque opération que la sonde ouvre : c'est là que
    // vivrait une taille de boîte oubliée.
    const s = sonderVideo(src);
    if (s.position ? s.capacites.corriger : s.capacites.ajouter) {
      const pose = ecrirePositionVideo(src, AVIGNON.lat, AVIGNON.lon);
      check(`${nom} : après écriture`, structureIntacte(pose.bytes));
      check(`${nom} : les rangements s'accordent après écriture`,
        porteursConcordent(pose.bytes));
    }
    if (s.capacites.effacer) {
      check(`${nom} : après effacement`, structureIntacte(effacerPositionVideo(src).bytes));
    }
  }
});

scenario('Et ce contrôle sait échouer', () => {
  const src = new Uint8Array(readFileSync(join(FIXTURES, 'sans-lieu.mp4')));
  const sain = ecrirePositionVideo(src, AVIGNON.lat, AVIGNON.lon).bytes;
  check('le fichier sain passe', structureIntacte(sain));

  const boiteDeTete = (b: Uint8Array, t: string) =>
    boites(b, 0, b.length).find((x) => x.type === t)!;

  // Le défaut RÉELLEMENT redouté : une boîte agrandie dont le parent aurait
  // gardé son ancienne taille. C'est le seul défaut que la preuve à l'octet
  // près ne verrait pas — elle compare des octets, pas des tailles déclarées.
  for (const [nom, ecart] of [['gardée trop courte', -34], ['annoncée trop longue', 8]] as const) {
    const abime = sain.slice();
    const moov = boiteDeTete(abime, 'moov');
    writeU32(abime, moov.debut, moov.taille + ecart, 'BE');
    check(`une description ${nom} est refusée`, !structureIntacte(abime));
  }

  // Ce que ce contrôle-ci ne voit PAS, et qui est rattrapé ailleurs : si c'est
  // `udta` qui garde son ancienne taille, la structure reste cohérente — le
  // rangement du lieu devient simplement le voisin de `udta` au lieu d'être son
  // enfant. C'est la relecture de la position qui l'attrape, en ne retrouvant
  // plus rien. Les deux contrôles se complètent, et aucun ne suffit seul.
  //
  // On l'éprouve sur un QuickTime, qui ne porte QU'UN rangement : sur un MP4, le
  // second — celui d'Apple — porterait encore le lieu, et masquerait la
  // démonstration. Que deux rangements se couvrent l'un l'autre est une bonne
  // nouvelle ; ce n'est pas une raison de ne plus éprouver le filet.
  const seul = new Uint8Array(readFileSync(join(FIXTURES, 'tete-nue.mov')));
  const seulEcrit = ecrirePositionVideo(seul, AVIGNON.lat, AVIGNON.lon).bytes;
  check('le témoin à un seul rangement en a bien un', porteursDeLieu(seulEcrit).length === 1);
  const glisse = seulEcrit.slice();
  const moov = boiteDeTete(glisse, 'moov');
  const udta = enfants(glisse, moov).find((x) => x.type === 'udta')!;
  writeU32(glisse, udta.debut, udta.taille - 34, 'BE');
  check('un lieu sorti de sa boîte échappe à la structure', structureIntacte(glisse));
  check('mais la relecture de la position ne le retrouve plus',
    lirePositionVideo(glisse) === null);
});

/*
 * L'annonce vaut le comportement, sur les vidéos aussi.
 *
 * C'est la propriété que le défaut de Q-051 a prise en défaut sous les yeux
 * d'un utilisateur : le champ était actif, le bouton aussi, et l'écriture
 * échouait. Rien ne la vérifiait pour la vidéo — le scénario de la matrice ne
 * porte que sur UN fichier témoin par format.
 */
scenario('Ce que la sonde vidéo ouvre réussit, ce qu\'elle ferme lève', () => {
  for (const nom of VIDEOS) {
    const src = new Uint8Array(readFileSync(join(FIXTURES, nom)));
    const s = sonderVideo(src);

    const essai = (agir: () => Uint8Array) => {
      try { return { ok: true, bytes: agir() }; } catch { return { ok: false, bytes: null }; }
    };

    const annonceEcriture = s.position ? s.capacites.corriger : s.capacites.ajouter;
    const ecriture = essai(() => ecrirePositionVideo(src, AVIGNON.lat, AVIGNON.lon).bytes);
    check(`${nom} : l'écriture annoncée ${annonceEcriture ? 'possible' : 'fermée'} se comporte ainsi`,
      ecriture.ok === annonceEcriture);
    // Une écriture annoncée doit aussi PASSER le contrôle d'après écriture,
    // sinon l'application la refusera après coup — le défaut exact de Q-051.
    if (annonceEcriture && ecriture.bytes) {
      check(`${nom} : et elle survit au contrôle d'après écriture`,
        structureIntacte(ecriture.bytes) && porteursConcordent(ecriture.bytes));
      const relu = lirePositionVideo(ecriture.bytes);
      check(`${nom} : le lieu relu est celui demandé`,
        relu !== null && distanceMetres(relu, AVIGNON) < 1);
    }

    const effacement = essai(() => effacerPositionVideo(src).bytes);
    check(`${nom} : l'effacement annoncé ${s.capacites.effacer ? 'possible' : 'fermé'} se comporte ainsi`,
      effacement.ok === s.capacites.effacer);
    if (s.capacites.effacer && effacement.bytes) {
      check(`${nom} : et il survit au contrôle d'après écriture`,
        structureIntacte(effacement.bytes));
    }
  }
});

scenario('fragmente.mp4 — un fichier fragmenté est refusé avant l\'action', () => {
  const src = new Uint8Array(readFileSync(join(FIXTURES, 'fragmente.mp4')));
  const haut = boites(src, 0, src.length).map((x) => x.type);
  check('le fichier est bien fragmenté', haut.includes('moof') || haut.includes('mfra'), haut.join(' '));
  // Ses rangs absolus vivent dans des endroits que ce module ne réécrit pas.
  // Le refus existait déjà ; il ne reposait sur aucun fichier.
  check('la création y est refusée', !accepteAjoutVideo(src));
  check('et la sonde le dit avant l\'action', !sonderVideo(src).capacites.ajouter);
  let leve = false;
  try { ecrirePositionVideo(src, AVIGNON.lat, AVIGNON.lon); } catch { leve = true; }
  check('l\'écriture lève plutôt que d\'abîmer le fichier', leve);
});

scenario('Le lieu créé est écrit dans les deux rangements attendus', () => {
  /*
   * `moov/udta/©xyz` est ce que lisent Android, FFmpeg, VLC et MediaInfo. Les
   * logiciels d'Apple ne lisent que la clé nommée. Écrire les deux, c'est la
   * différence entre « le fichier porte le lieu » et « le lieu se voit ».
   *
   * L'oracle est interrogé GROUPE PAR GROUPE, et non sur la position composée :
   * celle-ci se contenterait d'un seul rangement et ne dirait rien de l'autre.
   */
  const src = new Uint8Array(readFileSync(join(FIXTURES, 'sans-lieu.mp4')));
  const pose = ecrirePositionVideo(src, AVIGNON.lat, AVIGNON.lon);
  const out = join(tmp, 'deux-rangements.mp4');
  writeFileSync(out, pose.bytes);

  const sortes = porteursDeLieu(pose.bytes).map((p) => p.sorte).sort();
  check('les deux rangements sont là', JSON.stringify(sortes) === '["keys","xyz-udta"]',
    sortes.join('+'));

  for (const groupe of ['UserData', 'Keys']) {
    const lu = exif(['-n', '-s3', `-${groupe}:GPSCoordinates`, out]).trim();
    check(`l'oracle lit le lieu dans « ${groupe} »`, lu.startsWith('43.9'), lu || '(rien)');
  }
  check('la structure reste debout', structureIntacte(pose.bytes));
  check('et le fichier reste identique partout ailleurs',
    memesOctetsHorsPlages(src, pose.bytes, pose.changed));

  // Et l'effacement les retire TOUS LES DEUX : n'en retirer qu'un rendrait un
  // fichier que l'utilisateur croirait propre.
  const vide = effacerPositionVideo(pose.bytes);
  const outVide = join(tmp, 'deux-rangements-vide.mp4');
  writeFileSync(outVide, vide.bytes);
  check('l\'effacement ne laisse aucun rangement porteur',
    !copieDuLieuAilleursVideo(vide.bytes));
  const reste = exif(['-a', '-G1', '-s', '-ee', '-gps*', outVide]).trim();
  check('et l\'oracle ne trouve plus rien', reste === '', reste.slice(0, 120));
});

/*
 * Ce qu'une vidéo dit d'elle-même.
 *
 * Le volet « autres informations » ne tenait qu'au second lecteur, qui n'ouvre
 * ni MOV ni MP4 : une vidéo n'avait donc rien à y mettre, et il disparaissait.
 * Ce scénario est le PREMIER de tout le dépôt à regarder ce volet — ni les
 * vidéos ni les photos n'en avaient jamais eu.
 *
 * Il vérifie les deux sens, et le second compte autant : ce qui doit être là y
 * est, et ce qui ne doit PAS y être n'y est pas. Un fichier dont la date est
 * un remplissage ne doit pas afficher de date.
 */
scenario('Une vidéo dit sa durée, ses dimensions et sa date', () => {
  const lignes = (nom: string) => {
    const i = infosVideo(new Uint8Array(readFileSync(join(FIXTURES, nom))));
    return { i, m: new Map(i.details.map((d) => [d.cle, d.value])) };
  };

  for (const nom of VIDEOS) {
    const { m } = lignes(nom);
    // Toutes portent des images : la taille est la seule ligne due partout.
    check(`${nom} : les dimensions sont lues`, /^\d+ × \d+$/.test(m.get('Dimensions') ?? ''),
      m.get('Dimensions') ?? '(rien)');
  }

  // La durée et la date, croisées avec l'oracle indépendant.
  for (const [nom, dureeAttendue, dateAttendue] of [
    ['piste-de-lieu.mp4', '0:24', '2018-01-24'],
    ['tete-nue.mov', '0:05', '2005-08-11'],
  ] as const) {
    const { i, m } = lignes(nom);
    check(`${nom} : la durée est lue`, m.get('Duree') === dureeAttendue, m.get('Duree') ?? '(rien)');
    check(`${nom} : la date est lue`, (i.takenAt ?? '').startsWith(dateAttendue), String(i.takenAt));
    // L'oracle lit les mêmes champs dans le même fichier.
    const oracle = exif(['-s3', '-CreateDate', join(FIXTURES, nom)]).trim();
    check(`${nom} : et l'oracle dit la même date`,
      oracle.slice(0, 10).replace(/:/g, '-') === dateAttendue, oracle);
  }

  // Et le sens inverse. Ces deux-là portent une date de remplissage — zéro pour
  // l'un, la valeur qui retombe pile sur le 1er janvier 1970 pour l'autre. Rien
  // ne doit s'afficher : une date que personne n'a vécue n'est pas une date.
  for (const nom of ['sans-lieu.mp4', 'fragmente.mp4']) {
    const { i } = lignes(nom);
    check(`${nom} : aucune date n'est inventée`, i.takenAt === null, String(i.takenAt));
  }

  // L'appareil, sur le seul fichier qui le nomme.
  const { i: avecAppareil } = lignes('appareil.mp4');
  check('appareil.mp4 : l\'appareil est lu',
    avecAppareil.camera === 'Geotager Modele Temoin', String(avecAppareil.camera));
  const { i: sansAppareil } = lignes('piste-de-lieu.mp4');
  check('piste-de-lieu.mp4 : aucun appareil n\'est inventé', sansAppareil.camera === null);

  // Aucune valeur illisible : les anciens fichiers écrivent leur texte dans un
  // jeu de caractères que rien ne déclare, et l'afficher octet pour octet
  // donnerait du charabia. On préfère ne rien montrer.
  for (const nom of VIDEOS) {
    const { i } = lignes(nom);
    const sale = i.details.find((d) => /[\u0000-\u001f\u007f-\u009f]/.test(d.value));
    check(`${nom} : rien d'illisible n'est affiché`, sale === undefined,
      sale ? `${sale.cle}=${JSON.stringify(sale.value)}` : '');
  }
});

scenario('Un lieu rangé ailleurs que là où l\'on regardait', () => {
  /*
   * Le lecteur cherchait chaque rangement à un CHEMIN FIXE, et ne prenait que
   * la première boîte de chaque cran. Un fichier qui range son lieu dans un
   * second `udta`, dans celui d'une piste, dans un `ilst` accroché ailleurs, ou
   * dans le paquet de texte que la norme place en boîte de PREMIER NIVEAU
   * passait à côté de nous — pendant que tous les autres lecteurs l'affichaient.
   *
   * Ce fichier-ci est le cas dangereux, et pas seulement un affichage manquant :
   * le balayage résiduel ne voyait pas ce paquet, donc un effacement pouvait
   * rendre un fichier annoncé propre qui disait encore où il avait été tourné.
   */
  const chemin = join(FIXTURES, 'lieu-hors-piste.mp4');
  const src = new Uint8Array(readFileSync(chemin));

  // Le paquet est bien là où la norme le met, et non dans `moov/udta`.
  const haut = boites(src, 0, src.length);
  check('le paquet de texte est une boîte de premier niveau',
    haut.some((x) => x.type === 'uuid'), haut.map((x) => x.type).join(' '));
  check('aucun rangement ordinaire ne porte le lieu', porteursDeLieu(src).length === 0);

  // 1. Il est lu — c'est la plainte, telle quelle.
  const mine = lirePositionVideo(src);
  const theirs = exifPosition(chemin);
  check('le lieu y est pourtant lu', mine !== null && theirs !== null &&
    distanceMetres(mine, theirs) < 1, mine ? `${mine.lat}, ${mine.lon}` : 'null');

  // 2. Le balayage résiduel le voit — sans quoi l'effacement mentirait.
  check('et le balayage résiduel le voit', copieDuLieuAilleursVideo(src));

  // 3. L'effacement le retire vraiment, et l'oracle le confirme.
  const vide = effacerPositionVideo(src);
  const out = join(tmp, 'hors-piste-vide.mp4');
  writeFileSync(out, vide.bytes);
  check('taille identique à l\'octet près', vide.bytes.length === src.length);
  check('plus rien ne subsiste', !copieDuLieuAilleursVideo(vide.bytes));
  check('et l\'oracle ne trouve plus de lieu', exifPosition(out) === null);

  // 4. Une correction ne laisse pas les deux versions se contredire.
  const ecrit = ecrirePositionVideo(src, AVIGNON.lat, AVIGNON.lon);
  const out2 = join(tmp, 'hors-piste-ecrit.mp4');
  writeFileSync(out2, ecrit.bytes);
  const relu = exifPosition(out2);
  check('après correction, l\'oracle lit le lieu demandé',
    relu !== null && distanceMetres(relu, AVIGNON) < 1);
  // L'ancienne copie ne survit pas : deux lieux dans un fichier sont un mensonge.
  const ancien = exif(['-a', '-G1', '-s', '-XMP:GPSLatitude', out2]).trim();
  check('et l\'ancienne copie a disparu du paquet de texte', ancien === '', ancien.slice(0, 80));
});

/** Un fichier réel PORTEUR d'un lieu, par format. Sans lui, aucune preuve. */
const TEMOINS: Partial<Record<Format, string>> = {
  jpeg: 'DSCN0010.jpg',
  heic: 'iphone.heic',
  avif: 'photo.avif',
  png: 'avec-lieu.png',
  webp: 'avec-lieu.webp',
  tiff: 'avec-lieu.tif',
  // Le seul des trois fichiers vidéo qui puisse tenir les quatre colonnes : la
  // GoPro porte une piste de lieu qui ferme l'écriture, et le QuickTime nu
  // range son lieu à la façon d'Apple mais sert d'abord à éprouver la
  // reconnaissance du format. Voir le scénario vidéo dédié plus bas.
  video: 'avec-lieu.mp4',
};

/**
 * Les quatre opérations, quelle que soit la famille de format.
 *
 * Une vidéo ne porte pas de bloc TIFF : son moteur est un autre module, avec sa
 * propre entrée. Ce petit aiguillage existe pour que le scénario ci-dessous
 * reste MOT POUR MOT le même sur les six lignes — c'est lui qui fait de « une
 * case ne passe à oui qu'une fois son test vert » une propriété mécanique, et
 * une ligne qui aurait son propre scénario y échapperait.
 */
function moteurPour(format: Format, src: Uint8Array) {
  if (format === 'video') {
    return {
      lire: (b: Uint8Array) => lirePositionVideo(b),
      ecrire: (b: Uint8Array, lat: number, lon: number) => ecrirePositionVideo(b, lat, lon).bytes,
      effacer: (b: Uint8Array) => effacerPositionVideo(b).bytes,
    };
  }
  const c = conteneurOuEchec(src);
  return {
    lire: (b: Uint8Array) => lirePosition(c, b),
    ecrire: (b: Uint8Array, lat: number, lon: number) => ecrirePosition(c, b, lat, lon).bytes,
    effacer: (b: Uint8Array) => effacerPosition(c, b).bytes,
  };
}

scenario('Chaque case du tableau est adossée à une opération réelle', () => {
  for (const ligne of MATRICE) {
    for (const format of ligne.formats) {
      const c = ligne.capacites;
      const annonce = [c.lire, c.corriger, c.ajouter, c.effacer];
      const temoin = TEMOINS[format];

      // Une ligne qui annonce quoi que ce soit doit avoir de quoi le prouver.
      // C'est ici que se voit une case ouverte qu'aucun fichier n'éprouve.
      if (!temoin) {
        check(`${format} : une case à « oui » sans fichier témoin`,
          annonce.every((x) => x === false),
          `annoncé ${cellules(c).join('/')} sans aucun fichier pour l'éprouver`);
        continue;
      }

      const chemin = join(FIXTURES, temoin);
      const src = new Uint8Array(readFileSync(chemin));
      const moteur = moteurPour(format, src);

      check(`${format} : « Lire » dit vrai`,
        (moteur.lire(src) !== null) === c.lire, temoin);

      const corrige = (() => {
        try { return moteur.ecrire(src, AVIGNON.lat, AVIGNON.lon); }
        catch { return null; }
      })();
      check(`${format} : « Corriger » dit vrai`, (corrige !== null) === c.corriger, temoin);

      const vide = (() => {
        try { return moteur.effacer(src); }
        catch { return null; }
      })();
      check(`${format} : « Effacer » dit vrai`, (vide !== null) === c.effacer, temoin);
      if (vide) {
        const out = join(tmp, `matrice-vide-${temoin}`);
        writeFileSync(out, vide);
        check(`${format} : « Effacer » retire vraiment le lieu`,
          exif(['-a', '-G1', '-s', '-GPS:all', out]).trim() === '');
      }

      // « Ajouter » se prouve sur un fichier qui ne porte plus de lieu — donc
      // sur la sortie de l'effacement, quel que soit le format.
      if (vide) {
        const ajoute = (() => {
          try { return moteur.ecrire(vide, AVIGNON.lat, AVIGNON.lon); }
          catch { return null; }
        })();
        check(`${format} : « Ajouter » dit vrai`, (ajoute !== null) === c.ajouter, temoin);
        if (ajoute) {
          const out = join(tmp, `matrice-ajout-${temoin}`);
          writeFileSync(out, ajoute);
          const relu = exifPosition(out);
          check(`${format} : « Ajouter » inscrit vraiment le lieu`,
            relu !== null && distanceMetres(relu, AVIGNON) < 0.1);
        }
      }
    }
  }
});

// Q-038 : une build a promu en production depuis une branche de travail parce
// qu'un réglage de tableau de bord le demandait et que rien dans le dépôt ne
// s'y opposait. La décision est revenue dans le dépôt ; encore faut-il qu'un
// test l'exerce, sinon le garde-fou n'est qu'un ornement.
scenario('Le garde-fou de déploiement ne promeut que depuis main', () => {
  check('la branche de production promeut',
    JSON.stringify(commandePour('main')) === JSON.stringify(['wrangler', 'deploy']));
  for (const branche of ['claude/geotager-v1-1-final-cases-kqjsif', 'main-truqué', 'Main', 'mainx']) {
    check(`« ${branche} » téléverse sans promouvoir`,
      JSON.stringify(commandePour(branche)) === JSON.stringify(['wrangler', 'versions', 'upload']));
  }
  check('une branche inconnue est refusée, pas devinée', commandePour('') === null);
  check('une branche faite d\'espaces est refusée aussi', commandePour('   ') === null);
});

scenario('Un TIFF large est refusé plutôt que lu de travers', () => {
  const large = new Uint8Array(16);
  large[0] = 0x49; large[1] = 0x49; large[2] = 43; // « II » puis la magie 43
  let code = '';
  try {
    conteneurDe(large);
  } catch (e: any) {
    code = e.code;
  }
  check('la variante large est reconnue et refusée', code === 'FORMAT_NON_PRIS_EN_CHARGE', code);
});


scenario('« NaN, NaN » — une position illisible est absente, pas repliée', () => {
  // Le défaut vécu : un rationnel GPS dégénéré fait rendre `NaN` au second
  // lecteur, `typeof NaN === 'number'` laisse passer la garde naïve, et
  // l'interface affiche « NaN, NaN » avant de vider la carte.
  check('la garde naïve accepterait NaN — c’est bien elle qui manquait',
    typeof NaN === 'number');
  check('et « NaN, NaN » est exactement ce que l’affichage en tire',
    formatDecimal({ lat: NaN, lon: NaN }) === 'NaN, NaN');

  // Pourquoi la carte disparaît et non se contente d'être décentrée : la
  // projection propage NaN, donc ni tuile ni repère n'ont de position.
  const pixels = versPixels({ lat: NaN, lon: NaN }, 13);
  check('la projection propage NaN jusqu’aux pixels, ce qui vide la vue',
    Number.isNaN(pixels.x) && Number.isNaN(pixels.y));

  // Le correctif. Une seule règle, et elle refuse.
  check('deux NaN sont refusés', validerPosition({ lat: NaN, lon: NaN }) === null);
  check('un seul NaN suffit à refuser', validerPosition({ lat: 48.8566, lon: NaN }) === null);
  check('l’infini est refusé aussi', validerPosition({ lat: Infinity, lon: 2.3522 }) === null);

  // Même source, même remède : un lecteur tiers sans garantie peut aussi rendre
  // une valeur hors plage, aussi inutilisable qu'une valeur absente.
  check('une latitude hors plage est refusée', validerPosition({ lat: 500, lon: 2.3522 }) === null);
  check('une longitude hors plage est refusée', validerPosition({ lat: 48.8566, lon: -400 }) === null);

  // Et ce qui est lisible passe sans être touché — y compris les bornes exactes.
  const paris = validerPosition({ lat: 48.8566, lon: 2.3522 });
  check('une position lisible traverse inchangée',
    paris !== null && paris.lat === 48.8566 && paris.lon === 2.3522);
  check('les bornes exactes sont valables, ce sont des lieux réels',
    validerPosition({ lat: -90, lon: 180 }) !== null);

  // La règle du zéro exact n'est PAS ici, et c'est voulu : `validerPosition`
  // sert aussi la saisie manuelle, où « 0, 0 » est un choix de l'utilisateur.
  // C'est `readPosition` qui écarte ce point pour un FICHIER, parce qu'il y est
  // la trace d'une purge incomplète et non un relevé — et la relecture croisée
  // ne l'applique pas non plus, pour rester un témoin indépendant.
  check('le zéro exact reste une saisie valable, la politique vit ailleurs',
    validerPosition({ lat: 0, lon: 0 }) !== null);
});

scenario('Projection de la carte — aller et retour', () => {
  // Les ancres. Au zoom 0 le monde tient dans une tuile de 256 px : le point
  // (0, 0) est au centre, et le coin haut-gauche est la latitude limite.
  const centre = versPixels({ lat: 0, lon: 0 }, 0);
  check('le méridien de Greenwich et l’équateur tombent au centre',
    Math.abs(centre.x - 128) < 1e-9 && Math.abs(centre.y - 128) < 1e-9,
    `${centre.x} ${centre.y}`);
  const coin = versPixels({ lat: LAT_MAX, lon: -180 }, 0);
  check('la latitude limite est le bord de la projection, pas un point au hasard',
    Math.abs(coin.x) < 1e-6 && Math.abs(coin.y) < 1e-6, `${coin.x} ${coin.y}`);

  // L'aller-retour. C'est la propriété dont dépend tout le reste : un clic est
  // converti en pixels puis relu en degrés, et l'écart doit rester invisible.
  const lieux = [
    { lat: 43.9493, lon: 4.8055 },
    { lat: 0, lon: 0 },
    { lat: 51.5074, lon: -0.1278 },
    { lat: -33.8688, lon: 151.2093 },
    { lat: 85, lon: 179.99 },
    { lat: -85, lon: -179.99 },
  ];
  let pire = 0;
  for (const p of lieux) {
    for (let z = ZOOM_MIN; z <= ZOOM_MAX; z++) {
      const px = versPixels(p, z);
      const r = depuisPixels(px.x, px.y, z);
      pire = Math.max(pire, Math.abs(r.lat - p.lat), Math.abs(r.lon - p.lon));
    }
  }
  check('les degrés survivent au passage en pixels, à tous les zooms', pire < 1e-9, String(pire));

  // Les tuiles de référence : une erreur d'un demi-monde se verrait ici, et
  // nulle part ailleurs.
  const tuile = (p: { lat: number; lon: number }, z: number) => {
    const px = versPixels(p, z);
    return `${Math.floor(px.x / 256)}/${Math.floor(px.y / 256)}`;
  };
  check('Avignon tombe sur la bonne tuile au zoom 12', tuile(lieux[0], 12) === '2102/1490',
    tuile(lieux[0], 12));
  check('Avignon tombe sur la bonne tuile au zoom 16', tuile(lieux[0], 16) === '33642/23843',
    tuile(lieux[0], 16));
  check('Londres tombe sur la bonne tuile au zoom 12', tuile(lieux[2], 12) === '2046/1362',
    tuile(lieux[2], 12));

  /*
   * Les pôles ne sont pas représentables : on les ramène au bord plutôt que de
   * laisser la projection partir à l'infini.
   *
   * Le bord vaut zéro « à l'arrondi près » et non zéro : borner la latitude
   * puis la reprojeter passe par un logarithme, et le résultat retombe à
   * quelques 1e-8 du bord, du mauvais côté. C'est pourquoi le calcul des
   * tuiles écarte les rangées hors [0, 2^z[ au lieu de faire confiance à la
   * borne — une tuile de rangée -1 est une requête qui répondrait 404.
   */
  const pole = versPixels({ lat: 90, lon: 0 }, 5);
  check('le pôle est ramené au bord, et reste un nombre',
    Number.isFinite(pole.y) && Math.abs(pole.y) < 1e-6, String(pole.y));

  check('une longitude qui dépasse fait le tour au lieu d’être coupée',
    Math.abs(normaliserLon(181) - -179) < 1e-9 && Math.abs(normaliserLon(-181) - 179) < 1e-9,
    `${normaliserLon(181)} ${normaliserLon(-181)}`);
});

scenario('Précision d’un clic — la table du Gate 1 fait foi', () => {
  /*
   * `docs/gate1/att_carte.md` a publié une table de résolutions à la latitude
   * 46,5°, et c'est sur elle que l'attestation démontrait qu'un clic ne pouvait
   * pas viser juste. On la reprend telle quelle : si quelqu'un touche à la
   * constante, l'échec pointera vers le document où le nombre fait autorité —
   * et non vers une valeur qu'on aurait recopiée ici sans source.
   */
  const attendu: Array<[number, number]> = [
    [12, 26.31], [13, 13.15], [14, 6.58], [16, 1.64], [17, 0.82],
  ];
  for (const [z, m] of attendu) {
    const calcule = metresParPixel(46.5, z);
    check(`au zoom ${z}, un pixel vaut ${m} m comme l’annonce l’attestation`,
      Math.abs(calcule - m) < 0.01, calcule.toFixed(4));
  }

  // C'est ce qui justifie de rouvrir la question : l'attestation concluait à
  // l'impossibilité avec un plafond de zoom à 14. Au zoom 17, viser une porte
  // redevient une opération sensée.
  check('au zoom 17 un pixel descend sous le mètre, ce qui n’était pas le cas au plafond de 14',
    metresParPixel(46.5, 17) < 1 && metresParPixel(46.5, 14) > 6);

  let precedent = Infinity;
  let croissante = true;
  for (let z = ZOOM_MIN; z <= ZOOM_MAX; z++) {
    const m = metresParPixel(45, z);
    if (m >= precedent) croissante = false;
    precedent = m;
  }
  check('la précision s’améliore à chaque cran de zoom, sans exception', croissante);
  check('elle reste positive jusqu’au dernier cran, aux hautes latitudes',
    metresParPixel(80, ZOOM_MAX) > 0);
});

scenario('« Ouvrir avec » ne promet que ce que le tableau tient', () => {
  /*
   * Le manifeste n'était lu par AUCUN test. Il déclare pourtant les deux portes
   * par lesquelles le système remet des fichiers, et son entrée « Ouvrir avec »
   * a été livrée en V1.3 avec un champ jamais normalisé — `launch_type` — qui
   * promettait « une seule fenêtre reçoit tout le lot » sans que rien ne le
   * tienne. `check-build.mjs` relit désormais le manifeste PRODUIT ; ceci relit
   * la fonction qui l'écrit, avant même qu'une build existe.
   */
  const PAR_TYPE: Record<string, Format> = {
    'image/jpeg': 'jpeg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heic',
    'image/avif': 'avif',
    'image/tiff': 'tiff',
    'image/gif': 'gif',
    'video/quicktime': 'video',
    'video/mp4': 'video',
  };

  for (const langue of LANGUES) {
    const m = JSON.parse(manifeste(langue));
    const T = DICOS[langue];

    check(`${langue} : l’identité d’installation reste « / »`, m.id === '/', String(m.id));
    check(`${langue} : la fenêtre ouverte reçoit le lot sans être renavigée`,
      m.launch_handler?.client_mode === 'focus-existing',
      String(m.launch_handler?.client_mode));

    const h = m.file_handlers?.[0];
    check(`${langue} : « Ouvrir avec » ouvre la page de cette langue`,
      h?.action === T.base, String(h?.action));
    // La barre oblique finale décide : sans elle, l'hébergeur redirige, et une
    // entrée préchargée qui redirige met TOUTE l'application hors service hors
    // ligne. Voir le contrôle correspondant dans `check-build.mjs`.
    check(`${langue} : l’adresse d’ouverture finit par une barre oblique`,
      typeof h?.action === 'string' && h.action.endsWith('/'), String(h?.action));
    check(`${langue} : elle reste dans la portée du manifeste`,
      typeof h?.action === 'string' && h.action.startsWith(m.scope), `${h?.action} / ${m.scope}`);
    check(`${langue} : le champ jamais normalisé ne revient pas`,
      h !== undefined && !('launch_type' in h));

    /*
     * Le manifeste se désigne lui-même, dans LES DEUX langues. Une installation
     * retient l'adresse du manifeste par lequel elle s'est faite : n'annoncer
     * que le sien laisserait une application installée depuis « /fr/ »
     * méconnaissable depuis la page anglaise, et le bouton d'installation
     * reparaîtrait devant quelqu'un qui a déjà installé.
     */
    const parentes: Array<{ platform: string; url: string }> = m.related_applications ?? [];
    check(`${langue} : les deux manifestes sont désignés`,
      parentes.length === LANGUES.length,
      JSON.stringify(parentes.map((a) => a.url)));
    for (const l of LANGUES) {
      check(`${langue} : « ${l} » est désigné par son manifeste`,
        parentes.some(
          (a) => a.platform === 'webapp' && a.url === `${DICOS[l].base}manifest.webmanifest`,
        ));
    }
    // À vrai, il supprimerait l'invitation à installer — donc le bouton.
    check(`${langue} : rien ne détourne vers une autre application`,
      m.prefer_related_applications !== true);

    /*
     * Le tableau fait foi, comme partout ailleurs. S'inscrire pour un format
     * auquel on ne sait pas donner de lieu, c'est se proposer pour un travail
     * qu'on ne sait pas faire à quelqu'un qui ne l'a pas demandé. Un GIF tombe
     * sur `RIEN` dans `capacitesDe`, donc la case « ajouter » le refuse
     * d'office : il n'y a rien à tenir à jour ici quand la matrice bouge.
     *
     * Les vidéos servaient d'exemple à ce refus tant que leur ligne était
     * fermée. Elle ne l'est plus, et c'est ce contrôle-ci qui a exigé leur
     * inscription : le sens de la règle n'a pas changé, seule sa conclusion.
     */
    for (const type of Object.keys(h?.accept ?? {})) {
      const format = PAR_TYPE[type];
      check(`${langue} : « ${type} » est un format que l’outil connaît`,
        format !== undefined, type);
      if (format) {
        check(`${langue} : et le tableau lui accorde « ajouter »`,
          capacitesDe(format).ajouter, `${type} → ${format}`);
      }
    }
    for (const [type, exts] of Object.entries(h?.accept ?? {})) {
      check(`${langue} : « ${type} » liste des extensions pointées`,
        Array.isArray(exts) && exts.length > 0 && (exts as string[]).every((e) => /^\.[a-z0-9]+$/.test(e)),
        JSON.stringify(exts));
    }

    /*
     * Et l'autre sens, qui est celui qu'aucun œil ne voit : un format ajouté au
     * moteur sans être ajouté ici resterait invisible du système. L'outil saurait
     * le lire, et il n'apparaîtrait pas dans « Ouvrir avec » pour lui.
     */
    const proposes = new Set(Object.keys(h?.accept ?? {}).map((t) => PAR_TYPE[t]));
    for (const ligne of MATRICE) {
      if (!ligne.capacites.ajouter) continue;
      for (const f of ligne.formats) {
        check(`${langue} : le tableau sait donner un lieu à « ${f} », le manifeste le propose`,
          proposes.has(f));
      }
    }

    // Le partage, lui, accepte `image/*` : prendre un fichier d'un type qu'on
    // n'a pas nommé et expliquer qu'on ne sait pas le travailler vaut mieux que
    // le refuser sans un mot. « Ouvrir avec » n'a pas ce luxe — s'y inscrire,
    // c'est apparaître dans un menu du système. Les deux listes n'ont donc
    // aucune raison d'être égales.
    check(`${langue} : le partage reste plus large que l’ouverture`,
      m.share_target.params.files[0].accept.includes('image/*') &&
        !Object.keys(h?.accept ?? {}).includes('image/*'));
  }
});

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed === 0 ? 0 : 1);
