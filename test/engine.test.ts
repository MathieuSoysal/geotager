/**
 * Test bench for the EXIF engine, on real files.
 *
 * Rule: a write is never validated by our own reader alone. A symmetrically
 * wrong encoder and decoder would pass a self-reread with a difference of
 * exactly zero. ExifTool therefore serves as an independent oracle.
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
} from '../packages/core/src/jpeg.ts';
import { parseTiff, readPosition, degreesToDms } from '../packages/core/src/tiff.ts';
import {
  conteneurDe,
  detecterFormat,
  ecrirePosition,
  effacerPosition,
  lirePosition,
  memesOctetsHorsPlages,
  toutEffacer,
} from '../packages/core/src/conteneurs.ts';
import '../packages/core/src/formats.ts';
import { empreinteDesEmplacements, itemsDuFichier } from '../packages/core/src/isobmff.ts';
import { boites, enfants, toutesLesBoites } from '../packages/core/src/bmff.ts';
import { writeU32 } from '../packages/core/src/octets.ts';
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
} from '../packages/core/src/quicktime.ts';
import { createHash } from 'node:crypto';
import { commandePour } from '../scripts/deploy.mjs';
import { MATRICE, capacitesDe, cellules } from '../packages/core/src/capacites.ts';
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
} from '../packages/core/src/coords.ts';
import type { Format } from '../packages/core/src/types.ts';
import { lireDms } from '../packages/core/src/coords.ts';

// Same default as scripts/fetch-fixtures.mjs: without it the bench looked for
// the corpus at the root of the repository and failed on an uncaught exception,
// which made it look as though the engine were at fault.
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

/** Position read by ExifTool, in signed decimal degrees. */
function exifPosition(file: string): { lat: number; lon: number } | null {
  const out = exif(['-n', '-s', '-s', '-s', '-GPSLatitude', '-GPSLongitude', file]).trim();
  const lines = out.split('\n').filter(Boolean);
  if (lines.length < 2) return null;
  const lat = Number(lines[0]);
  const lon = Number(lines[1]);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/**
 * Inventory of the tags that must survive an operation on the location.
 *
 * Four families are excluded, and only those: [GPS] tags, which are what we
 * modify; [Composite] tags derived from GPS, which ExifTool recomputes; the
 * volatile system tags (path, access dates, size) that describe the file on
 * disk rather than its content; and, for a video, the location itself, which
 * ExifTool files under [UserData], [Keys] or [ItemList] and never under [GPS].
 * Without that last exclusion, the inventory meant to prove "everything else is
 * preserved" would compare a position against a position, and report the change
 * we had just asked for as a loss.
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
 * Digest of every item other than the Exif one, for an ISOBMFF file.
 *
 * It is the most direct witness that the secondary images survived: it looks at
 * the bytes, not at what a tool says about them. Since Chromium does not decode
 * HEIC, it also stands in for a real decode, and does so to advantage:
 * identical bytes decode identically.
 */
function empreintesDesItems(fichier: string): string {
  const b = new Uint8Array(readFileSync(fichier));
  return itemsDuFichier(b)
    .filter((x) => x.type !== 'Exif')
    .map((x) => `${x.id}:${x.type}:${createHash('sha256').update(b.subarray(x.debut, x.debut + x.longueur)).digest('hex').slice(0, 16)}`)
    .join('|');
}

/**
 * Entries of the location table that moved between two states.
 *
 * "The table is intact" is the right witness as long as nothing changes length.
 * As soon as a location is added, one entry must move, and exactly one. That is
 * the assertion proving that repointing the location item displaced no other
 * item.
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
 * True if libheif, a third-party decoder, can still decode this file.
 *
 * ExifTool says what the file contains; this says that it still decodes. Those
 * are two different questions, and moving a location block can satisfy the
 * first without the second.
 *
 * The tool being absent does not count as a successful decode, and must not be
 * confused with a failed one either: the first call settles it once and for
 * all, so that "heif-convert is not installed" shows up in the report instead
 * of disguising itself as an engine regression.
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

/** Number of entries actually present in the MakerNote, according to ExifTool. */
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

/** Readable summary of an inventory difference, so a failure can be diagnosed. */
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
      // Tolerance of 10 cm: beyond that it is an encoding bug, not a precision
      // one.
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

    // Nikon MakerNotes carry absolute offsets: one byte moved would make them
    // unreadable. It is the harshest witness of the lot.
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

  // It must be possible to go back.
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

// Losing the profile visibly shifts the colours in any colour-managed
// application: that is a degradation of the image, not a removal of
// information. PNG and WebP already preserved it; JPEG was the only one out of
// step.
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

// Generic guarantees
//
// The TIFF blocks built below serve refusal paths and
// one vector with a known value. The "real photos" rule targets the
// nominal paths: you cannot find in the wild a file
// guaranteed to carry one precise defect.

/** Minimal TIFF block carrying a GPS IFD, with chosen rationals. */
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
  // A Galaxy S10 with no fix writes 0/0 rationals; GIMP leaves 0/1 0/1 0/1
  // behind when it purges the coordinates. Both read as "0, 0", a perfectly
  // valid position off the Gulf of Guinea.
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
  // A symmetrically wrong encoder and decoder agree perfectly. So we compare
  // the bytes produced in both endiannesses, without rereading.
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

// HEIC and AVIF
//
// Every operation here is strictly length-preserving: the
// item's length does not change, so the location table does
// not change, so no other item's offset becomes wrong.
// We prove it every time rather than assert it.

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

// This Nokia's block sits 4.4 kB from the end of the file, with nobody having
// rearranged the container: it is a device's own layout, not a regression file
// built for the occasion.
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

  // Asking to remove what is not there must return the original, not a
  // "cleaned" copy with a byte moved along the way.
  const res = effacerPosition(c, src);
  check('l\'effacement ne touche rien', res.bytes.length === src.length &&
    memesOctetsHorsPlages(src, res.bytes, []));
});

// Adding a location to HEIC and AVIF
//
// Nothing grows in place: the new block goes into a box
// appended at the end of the file, and the one entry of the
// location table that concerns it is repointed. What these
// scenarios prove is that a single entry moves, that no other
// item changes by a bit, and that a third-party decoder still opens it.

/** The nominal add path, whatever the starting point. */
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

  // Symmetry rule, the same one applied to the second reader: if it could open
  // the input, it must be able to open the output. If it could not, whether
  // through a missing decoder or a format this install does not handle, its
  // silence does not count as a failure on our part. An oracle queried without
  // knowing whether it can answer proves nothing either way.
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

// After an erase the entry pointing at the location block is gone from IFD0, so
// writing a location again is no longer a correction but a creation. It is the
// only way to exercise the add path on a real AVIF, since no AVIF in the corpus
// arrives without a location block.
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

  // A trailing box declaring size 0 extends to the end of the file: it would
  // swallow anything appended behind it, and the location block would become
  // image data in the eyes of every reader.
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

  // Bytes no box claims: our reading of the structure is wrong somewhere, and
  // we build nothing on top of it.
  const avecTraine = new Uint8Array(src.length + 3);
  avecTraine.set(src, 0);
  check('des octets en trop après la dernière boîte ferment l\'ajout',
    c.accepteAjout?.(avecTraine) === false);

  // With no location item to repoint, the item table would have to grow: out of
  // reach on this route, and advertised as such.
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

    // ExifTool does display 0: that is what is written in the file. The
    // question is not who is right about the bytes, but what we show somebody
    // asking "where was this photo taken?". "Nowhere" is the only honest
    // answer.
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

// PNG
//
// The only format in this batch where adding is fully safe: no
// internal absolute offsets, so inserting or growing a chunk invalidates nothing.

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

// WebP
//
// Three quirks of real files are exercised here: a block preceded
// by a JPEG preamble, a badly named text chunk, and
// header flags that do not describe the actual content.

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
  // The format can grow, so we can rewrite a whole block rather than refuse.
  // That is the difference with an iPhone photo.
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

// TIFF
//
// Here the file is the block: the pixels live inside it, addressed
// by strip offsets. The range map is the only thing that
// protects them, and that is what these scenarios exercise.

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

// Telling an ordinary image from a digital negative
//
// A DNG, a NEF, a CR2 are all TIFF. The allowlist is only worth
// something if it is exercised both ways on real files: it
// must accept ordinary images and turn away every negative.
// A test that had never seen a negative would prove nothing.

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

    // A refusal that had touched the file anyway would be worse than a refusal.
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

// Fixing and erasing stay open on a negative: both are length-preserving, and
// the range map in tiff.ts protects the pixel strips. That behaviour predates
// this batch and rested on nothing; it rests on this now.
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

// The table cannot lie
//
// The page renders the table from capacites.ts, so it cannot
// drift from what the engine believes it can do. But nothing tied
// it to what the engine actually can do: "a cell only turns to yes
// once its test is green" stayed a written discipline. This
// scenario makes it a mechanical property: it really runs
// every advertised operation, on a real file of that format.

// Videos
//
// The row was closed on a precise objection: a video
// stores its location in several places, sometimes spelled out, and
// the timed tracks live in the data the engine skips over.
// Each of those cases now has its file, and its scenario.

/** Every video in the corpus. Each exercises a case the others do not. */
const VIDEOS = [
  'sans-lieu.mp4', 'avec-lieu.mp4', 'piste-de-lieu.mp4',
  'tete-nue.mov', 'avec-lieu.mov', 'nom-de-lieu.mov', 'texte-de-lieu.mov',
  'fragmente.mp4', 'appareil.mp4', 'lieu-hors-piste.mp4', 'lieu-illisible.mp4',
  'lieu-en-lettres.mp4',
];

scenario('Les coordonnées d\'une vidéo se lisent dans les trois largeurs', () => {
  // The same position, written in degrees, in degrees and minutes, then in
  // degrees, minutes and seconds. The count of digits before the decimal point
  // is the only clue. Tolerance is one metre rather than ten centimetres: the
  // three forms do not cut the degree at the same place, and one arcsecond is
  // thirty metres, so a tenth of a second is three. What is being exercised is
  // not precision, it is that the width is understood: a naive read would give
  // "4356.958 degrees", an impossible location, or worse, a possible one
  // thousands of kilometres away.
  const attendu = { lat: 43.9493, lon: 4.8055 };
  for (const forme of ['+43.9493+004.8055/', '+4356.958+00448.330/', '+435657.5+0044819.8/']) {
    const lu = lireIso6709(forme);
    check(`« ${forme} » est lu`, lu !== null &&
      distanceMetres(lu, attendu) < 1, lu ? `${lu.lat}, ${lu.lon}` : 'null');
  }
  for (const absurde of ['', 'bidon', '+43.9493/', '+9943.9493+004.8055/', '43.9493 4.8055']) {
    check(`« ${absurde} » est refusé plutôt que deviné`, lireIso6709(absurde) === null);
  }
  // The fixed length is the heart of writing in place.
  check('une chaîne s\'écrit à la longueur exacte demandée',
    ecrireIso6709(attendu, 22) === '+43.949300+004.805500/');
  check('l\'altitude déjà écrite est conservée telle quelle',
    ecrireIso6709(attendu, 26, '+026.000') === '+43.9493+004.8055+026.000/');
  // The name of the reference system takes up room without carrying a
  // coordinate: it is returned as is, and it is the decimals that give ground.
  check('le nom du système de repère est conservé tel quel',
    ecrireIso6709(attendu, 28, '', '/CRSWGS_84/') === '+43.9493+004.8055/CRSWGS_84/',
    String(ecrireIso6709(attendu, 28, '', '/CRSWGS_84/')));
});

/**
 * A video derived from the corpus, whose location string we choose byte by
 * byte.
 *
 * ExifTool writes the string as given as long as it looks valid to it, which is
 * how most of the forms below come about. For the others, the ones it refuses
 * to write but knows how to read, we replace the box payload at constant
 * length: no byte moves, the container stays that of a real video, and only the
 * string changes.
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
 * The defect that cost five round trips, and the rule that came out of it.
 *
 * Two perfectly common spellings, the C-style string terminated by a null byte
 * and the one that names its reference system, were located by the engine and
 * refused by its decoder. The box was there, its text was in front of us, and
 * the screen showed nothing: no marker, no position line. The phone's own tools
 * read them fine.
 *
 * The missing check is this one: on each spelling, what we read must equal what
 * the oracle reads. A divergence in that direction, it reads and we do not, is
 * exactly the reported symptom, and no test could see it.
 */
scenario('Ce que l\'oracle lit dans une chaîne de position, nous le lisons aussi', () => {
  const attendu = { lat: 43.90811, lon: 4.86387 };
  // [name, what ExifTool writes, what we put in its place, same length]
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
    // A form the oracle is silent about proves nothing about it; it only proves
    // that we are not silent.
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
   * And when we genuinely cannot read it, show the string as it is.
   *
   * That is the lesson of this batch, and it is worth more than the fixes
   * above: staying silent makes the disagreement invisible. One line in the
   * panel, carrying the file's own characters, is enough for a screenshot to
   * name the form we are missing, without anyone having to send us their video.
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
 * A location written to be read, and the defect that made it invisible.
 *
 * The report concerned a video whose location field holds
 * `43°54′29.2″N 4°51′49.9″E`, which is what an application shows on screen
 * rather than the run of digits the standard describes. Two defects compounded,
 * and the first masked the second:
 *
 *   1. The payload was read one byte per character. The degree sign takes two
 *      bytes in UTF-8, so the string reached the reader mangled, and no amount
 *      of leniency downstream could have saved it.
 *   2. The reader only knew the numeric form.
 *
 * The oracle does not settle this case: ExifTool reports the field and yields
 * NaN. So we bring it in differently. It supplies the reference value, read
 * from a file carrying the same coordinates in the numeric form. Our reading of
 * the letters has to land on it.
 */
scenario('Un lieu écrit en degrés, minutes et secondes', () => {
  // The reference comes from the oracle, on the form it can read.
  const reference = exifPosition(join(FIXTURES, 'avec-lieu.mp4'));
  check('l\'oracle donne la position de référence', reference !== null);

  // The tolerance follows the resolution of the form rather than the reverse:
  // four decimal degrees cut an eleven-metre grid, so demanding a metre on that
  // form would be demanding a precision it does not have.
  const FORMES: Array<[string, string, number]> = [
    ['symboles typographiques', '43°54′29.2″N 4°51′49.9″E', 1],
    ['guillemets ordinaires', '43°54\'29.2"N, 4°51\'49.9"E', 1],
    ['espacée', '43° 54′ 29.2″ N 4° 51′ 49.9″ E', 1],
    ['hémisphère en tête', 'N 43°54\'29.2" E 4°51\'49.9"', 1],
    ['degrés et minutes décimales', '43°54.4866\'N 4°51.8322\'E', 1],
    ['degrés décimaux', '43.9081°N 4.8639°E', 6],
  ];
  const attendu = { lat: 43.90811, lon: 4.86387 };
  for (const [libelle, forme, tolerance] of FORMES) {
    const lu = lireDms(forme);
    check(`${libelle} : « ${forme} » est lue`,
      lu !== null && distanceMetres(lu, attendu) < tolerance,
      lu ? `${lu.lat}, ${lu.lon}` : 'null');
  }

  // South and west: one letter changes, and the sign with it. A reader ignoring
  // it would show the antipode without looking wrong.
  const austral = lireDms('43°54′29.2″S 4°51′49.9″W');
  check('le sud et l\'ouest donnent des nombres négatifs',
    austral !== null && austral.lat < 0 && austral.lon < 0, JSON.stringify(austral));

  /*
   * And what must stay refused. The degree sign is what distinguishes a location
   * from a title with two numbers loose in it: without that requirement the
   * reader would invent positions out of arbitrary text, which is the one
   * mistake a privacy tool cannot make.
   */
  for (const absurde of [
    'Avignon, France', '43.9081, 4.8639', '43°54′29.2″N', '', 'tourné à 43 degrés',
    '43°54′29.2″N 4°51′49.9″E 5°12′00.0″W', '43°99′29.2″N 4°51′49.9″E',
  ]) {
    check(`« ${absurde} » est refusé plutôt que deviné`, lireDms(absurde) === null,
      JSON.stringify(lireDms(absurde)));
  }

  /*
   * The witness file, and the full pass over it.
   *
   * This is where the first of the two defects is proved: the string lives in
   * UTF-8 inside a real MP4, and nothing that follows works if it is read one
   * byte per character.
   */
  const chemin = join(FIXTURES, 'lieu-en-lettres.mp4');
  const src = new Uint8Array(readFileSync(chemin));
  const lu = lirePositionVideo(src);
  check('le fichier témoin livre sa position',
    lu !== null && distanceMetres(lu, attendu) < 1, lu ? `${lu.lat}, ${lu.lon}` : 'null');
  check('et le volet montre un lieu, non une chaîne brute',
    infosVideo(src).details.every((d) => d.cle !== 'LieuBrut'),
    JSON.stringify(infosVideo(src).details));
  check('la sonde le donne pour lisible et effaçable',
    sonderVideo(src).position !== null && sonderVideo(src).capacites.effacer);

  // Erasing really does remove it, and that is the direction that counts most:
  // a location we cannot read is a location we do not think to remove.
  const vide = effacerPositionVideo(src);
  check('l\'effacement le retire', lirePositionVideo(vide.bytes) === null);
  check('et il ne reste aucune copie ailleurs', !copieDuLieuAilleursVideo(vide.bytes));
  check('la description du fichier tient debout après effacement', structureIntacte(vide.bytes));

  // The fix: the lettered string gives way to the numeric form, at constant
  // length, and it is the oracle that rereads, since that one it can read.
  const corrige = ecrirePositionVideo(src, AVIGNON.lat, AVIGNON.lon);
  const sortie = join(tmp, 'lieu-en-lettres-corrige.mp4');
  writeFileSync(sortie, corrige.bytes);
  const relu = exifPosition(sortie);
  check('après correction, l\'oracle lit le lieu demandé',
    relu !== null && distanceMetres(relu, AVIGNON) < 1,
    relu ? `${relu.lat}, ${relu.lon}` : 'null');
  check('et la description tient toujours debout', structureIntacte(corrige.bytes));

  /*
   * The decoding defect, taken at its root rather than by its consequences.
   *
   * The corpus device name carries accents on purpose. Read one byte per
   * character it comes out as "ModÃ¨le". Everything else in the corpus being
   * ASCII, nothing else would ever have flagged it.
   */
  const accents = infosVideo(new Uint8Array(readFileSync(join(FIXTURES, 'appareil.mp4'))));
  check('un nom d\'appareil accentué s\'affiche tel qu\'il est écrit',
    accents.camera === 'Geotager Modèle Témoin', String(accents.camera));
});

/*
 * Widening brand recognition means risking the reclassification of a file that
 * worked. A HEIC image can announce itself under a generic brand that video
 * claims too, and nothing but this would report that it went the wrong way. The
 * list is hard-coded on purpose: it must fail if a format changes its mind, not
 * adapt.
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
  // The file-type box is an MP4 invention: a true QuickTime starts straight
  // with the description. Requiring that box made this file "unknown", so
  // untreatable, with nothing to report it.
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

  // And the refusal is grounded, not superstitious: the oracle, with the option
  // both READMEs already recommend, does find one location per sample.
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

  // Two metres, and that is the right measure: this box records degrees in
  // fixed point, in steps of one sixty-five-thousandth, which is one metre
  // seven in latitude. That is precisely why the engine refuses to write into
  // it in place.
  const mine = lirePositionVideo(src);
  const theirs = exifPosition(chemin);
  check('la position y est lue, en virgule fixe',
    mine !== null && theirs !== null && distanceMetres(mine, theirs) < 2,
    mine && theirs ? `${distanceMetres(mine, theirs).toFixed(3)} m` : 'null');

  // The heart of it: erasing the coordinates while leaving "Avignon" behind
  // would return a file the user would believe clean.
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
  // The residual sweep looks for names and not only for numbers: that is
  // exactly what the old design was faulted for.
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

  // An arbitrary position rather than one that lands exactly: that is what
  // exercises how many decimals the string can carry.
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

  // The proof that counts on a file of several megabytes: the pictures and the
  // sound have not moved by a byte, even though everything after them shifted.
  // We measure it on the bytes themselves, not on a size.
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
 * The byte-exact proof, restored to full strength on the route that grows the
 * file.
 *
 * `memesOctetsHorsPlages` compares index by index. An insertion shifts
 * everything after it, so the announced range necessarily covers the whole tail
 * of the file, and the proof, on that route, proves almost nothing: on an
 * eight-megabyte file it exempts eight megabytes.
 *
 * What has to be established is not "nothing moved", which is false by
 * construction, but "nothing changed": the tail of the produced file must be
 * the tail of the original, shifted by exactly what we inserted, and not one
 * byte more.
 */
scenario('Un ajout ne fait que décaler, jamais réécrire', () => {
  for (const nom of VIDEOS) {
    const src = new Uint8Array(readFileSync(join(FIXTURES, nom)));
    const s = sonderVideo(src);
    if (s.position || !s.capacites.ajouter) continue;
    // A file whose text packet carries a copy of the location has that packet
    // purged during the write as well, legitimately, or the file would state
    // two locations. The tail is then no longer a simple shift, and this check
    // does not apply. It is skipped explicitly rather than silently.
    if (copieDuLieuAilleursVideo(src)) {
      check(`${nom} : écarté, son paquet de texte porte une copie à purger`, true);
      continue;
    }

    const pose = ecrirePositionVideo(src, AVIGNON.lat, AVIGNON.lon);
    const ajoute = pose.bytes.length - src.length;
    // Two boxes on an MP4, the plain one and Apple's, a single one on a
    // QuickTime. In every case a few dozen bytes and no more.
    check(`${nom} : le fichier ne grandit que de ses rangements`,
      ajoute > 0 && ajoute < 512, `${ajoute} o`);

    // The insertion point is read from the structure, not from the first byte
    // that differs: the parents' sizes and the chunk offsets change too, and
    // they live before the insertion point.
    const moov = boites(src, 0, src.length).find((x) => x.type === 'moov')!;
    const udta = enfants(src, moov).find((x) => x.type === 'udta');
    const insertion = udta ? udta.debut + udta.taille : moov.debut + moov.taille;

    // The comparison that follows only means something if no offset table lives
    // after the insertion point. Otherwise its entries change, legitimately,
    // and the tail of the file is no longer a simple shift. No file in the
    // corpus is in that case; we require it rather than assume it, so that this
    // check fails plainly the day a file puts one there.
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
 * The post-write check, exercised in both directions.
 *
 * For videos it stands in for the second, independently written reader that
 * does not exist in a browser. It shipped green and yet refused every real
 * video: it descended into leaf boxes, whose payload is made of numbers that
 * read like headers. No test reached it, because it lived in the worker while
 * the video scenarios called the engine directly, without going through a full
 * write.
 *
 * Hence the two halves below, and the second counts as much as the first: a
 * check nobody has ever seen fail is not a check.
 */
scenario('La description de chaque vidéo se tient debout', () => {
  for (const nom of VIDEOS) {
    const src = new Uint8Array(readFileSync(join(FIXTURES, nom)));
    check(`${nom} : à l'entrée`, structureIntacte(src));

    // And on the output of every operation the probe opens: that is where a
    // forgotten box size would live.
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

  // The defect genuinely feared: a box that grew whose parent kept its old
  // size. It is the only defect the byte-exact proof would not see, since it
  // compares bytes, not declared sizes.
  for (const [nom, ecart] of [['gardée trop courte', -34], ['annoncée trop longue', 8]] as const) {
    const abime = sain.slice();
    const moov = boiteDeTete(abime, 'moov');
    writeU32(abime, moov.debut, moov.taille + ecart, 'BE');
    check(`une description ${nom} est refusée`, !structureIntacte(abime));
  }

  // What this check does not see, and what catches it elsewhere: if it is
  // `udta` that keeps its old size, the structure stays coherent, and the
  // location box simply becomes `udta`'s sibling instead of its child. Rereading
  // the position catches that, by no longer finding anything. The two checks
  // complement each other, and neither is enough on its own.
  //
  // We exercise it on a QuickTime, which carries only one box: on an MP4 the
  // second, Apple's, would still carry the location and would hide the
  // demonstration. Two boxes covering for each other is good news; it is not a
  // reason to stop exercising the net.
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
 * What we advertise matches what we do, on videos too.
 *
 * This is the property the earlier defect broke in front of a user: the field
 * was live, the button was live, and the write failed. Nothing checked it for
 * video, since the matrix scenario covers only one witness file per format.
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
    // An advertised write must also pass the post-write check, or the
    // application will refuse it after the fact, which was the exact defect.
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
  // Its absolute offsets live in places this module does not rewrite. The
  // refusal already existed; it rested on no file.
  check('la création y est refusée', !accepteAjoutVideo(src));
  check('et la sonde le dit avant l\'action', !sonderVideo(src).capacites.ajouter);
  let leve = false;
  try { ecrirePositionVideo(src, AVIGNON.lat, AVIGNON.lon); } catch { leve = true; }
  check('l\'écriture lève plutôt que d\'abîmer le fichier', leve);
});

scenario('Le lieu créé est écrit dans les deux rangements attendus', () => {
  /*
   * `moov/udta/©xyz` is what Android, FFmpeg, VLC and MediaInfo read. Apple's
   * software reads only the named key. Writing both is the difference between
   * "the file carries the location" and "the location shows up".
   *
   * The oracle is queried group by group rather than on the composed position:
   * that would be satisfied by a single box and would say nothing about the
   * other.
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

  // And erasing removes both: removing only one would return a file the user
  // would believe clean.
  const vide = effacerPositionVideo(pose.bytes);
  const outVide = join(tmp, 'deux-rangements-vide.mp4');
  writeFileSync(outVide, vide.bytes);
  check('l\'effacement ne laisse aucun rangement porteur',
    !copieDuLieuAilleursVideo(vide.bytes));
  const reste = exif(['-a', '-G1', '-s', '-ee', '-gps*', outVide]).trim();
  check('et l\'oracle ne trouve plus rien', reste === '', reste.slice(0, 120));
});

/*
 * What a video says about itself.
 *
 * The "other information" panel depended entirely on the second reader, which
 * opens neither MOV nor MP4: a video therefore had nothing to put in it, and it
 * disappeared. This is the first scenario in the repository to look at that
 * panel; neither videos nor photos had ever had one.
 *
 * It checks both directions, and the second counts as much: what must be there
 * is, and what must not be is not. A file whose date is padding must not show a
 * date.
 */
scenario('Une vidéo dit sa durée, ses dimensions et sa date', () => {
  const lignes = (nom: string) => {
    const i = infosVideo(new Uint8Array(readFileSync(join(FIXTURES, nom))));
    return { i, m: new Map(i.details.map((d) => [d.cle, d.value])) };
  };

  for (const nom of VIDEOS) {
    const { m } = lignes(nom);
    // They all carry images: size is the only line owed everywhere.
    check(`${nom} : les dimensions sont lues`, /^\d+ × \d+$/.test(m.get('Dimensions') ?? ''),
      m.get('Dimensions') ?? '(rien)');
  }

  // Duration and date, cross-checked against the independent oracle.
  for (const [nom, dureeAttendue, dateAttendue] of [
    ['piste-de-lieu.mp4', '0:24', '2018-01-24'],
    ['tete-nue.mov', '0:05', '2005-08-11'],
  ] as const) {
    const { i, m } = lignes(nom);
    check(`${nom} : la durée est lue`, m.get('Duree') === dureeAttendue, m.get('Duree') ?? '(rien)');
    check(`${nom} : la date est lue`, (i.takenAt ?? '').startsWith(dateAttendue), String(i.takenAt));
    // The oracle reads the same fields in the same file.
    const oracle = exif(['-s3', '-CreateDate', join(FIXTURES, nom)]).trim();
    check(`${nom} : et l'oracle dit la même date`,
      oracle.slice(0, 10).replace(/:/g, '-') === dateAttendue, oracle);
  }

  // And the other direction. These two carry a padding date, zero for one and
  // the value that lands exactly on 1 January 1970 for the other. Nothing must
  // show: a date nobody lived through is not a date.
  for (const nom of ['sans-lieu.mp4', 'fragmente.mp4']) {
    const { i } = lignes(nom);
    check(`${nom} : aucune date n'est inventée`, i.takenAt === null, String(i.takenAt));
  }

  // The device, on the only file that names it.
  const { i: avecAppareil } = lignes('appareil.mp4');
  check('appareil.mp4 : l\'appareil est lu',
    avecAppareil.camera === 'Geotager Modèle Témoin', String(avecAppareil.camera));
  const { i: sansAppareil } = lignes('piste-de-lieu.mp4');
  check('piste-de-lieu.mp4 : aucun appareil n\'est inventé', sansAppareil.camera === null);

  // No unreadable value: older files write their text in a character set
  // nothing declares, and showing it byte for byte would produce gibberish. We
  // prefer to show nothing.
  for (const nom of VIDEOS) {
    const { i } = lignes(nom);
    const sale = i.details.find((d) => /[\u0000-\u001f\u007f-\u009f]/.test(d.value));
    check(`${nom} : rien d'illisible n'est affiché`, sale === undefined,
      sale ? `${sale.cle}=${JSON.stringify(sale.value)}` : '');
  }
});

scenario('Un lieu rangé ailleurs que là où l\'on regardait', () => {
  /*
   * The reader looked for each box at a fixed path, and took only the first box
   * at each level. A file storing its location in a second `udta`, in a track's
   * own, in an `ilst` hung elsewhere, or in the text packet the standard places
   * as a top-level box slipped past us, while every other reader displayed it.
   *
   * This file is the dangerous case, not merely a missing display: the residual
   * sweep did not see that packet, so an erase could return a file announced as
   * clean that still said where it had been shot.
   */
  const chemin = join(FIXTURES, 'lieu-hors-piste.mp4');
  const src = new Uint8Array(readFileSync(chemin));

  // The packet is where the standard puts it, and not in `moov/udta`.
  const haut = boites(src, 0, src.length);
  check('le paquet de texte est une boîte de premier niveau',
    haut.some((x) => x.type === 'uuid'), haut.map((x) => x.type).join(' '));
  check('aucun rangement ordinaire ne porte le lieu', porteursDeLieu(src).length === 0);

  // 1. It is read, which is the complaint, exactly as filed.
  const mine = lirePositionVideo(src);
  const theirs = exifPosition(chemin);
  check('le lieu y est pourtant lu', mine !== null && theirs !== null &&
    distanceMetres(mine, theirs) < 1, mine ? `${mine.lat}, ${mine.lon}` : 'null');

  // 2. The residual sweep sees it, without which the erase would be lying.
  check('et le balayage résiduel le voit', copieDuLieuAilleursVideo(src));

  // 3. Erasing really removes it, and the oracle confirms.
  const vide = effacerPositionVideo(src);
  const out = join(tmp, 'hors-piste-vide.mp4');
  writeFileSync(out, vide.bytes);
  check('taille identique à l\'octet près', vide.bytes.length === src.length);
  check('plus rien ne subsiste', !copieDuLieuAilleursVideo(vide.bytes));
  check('et l\'oracle ne trouve plus de lieu', exifPosition(out) === null);

  // 4. A correction does not leave the two versions contradicting each other.
  const ecrit = ecrirePositionVideo(src, AVIGNON.lat, AVIGNON.lon);
  const out2 = join(tmp, 'hors-piste-ecrit.mp4');
  writeFileSync(out2, ecrit.bytes);
  const relu = exifPosition(out2);
  check('après correction, l\'oracle lit le lieu demandé',
    relu !== null && distanceMetres(relu, AVIGNON) < 1);
  // The old copy does not survive: two locations in one file are a lie.
  const ancien = exif(['-a', '-G1', '-s', '-XMP:GPSLatitude', out2]).trim();
  check('et l\'ancienne copie a disparu du paquet de texte', ancien === '', ancien.slice(0, 80));
});

/** One real file carrying a location, per format. Without it, no proof. */
const TEMOINS: Partial<Record<Format, string>> = {
  jpeg: 'DSCN0010.jpg',
  heic: 'iphone.heic',
  avif: 'photo.avif',
  png: 'avec-lieu.png',
  webp: 'avec-lieu.webp',
  tiff: 'avec-lieu.tif',
  // The only one of the three video files that can hold all four columns: the
  // GoPro carries a location track that closes writing, and the bare QuickTime
  // stores its location the Apple way but is there first to exercise format
  // recognition. See the dedicated video scenario further down.
  video: 'avec-lieu.mp4',
};

/**
 * The four operations, whatever the format family.
 *
 * A video carries no TIFF block: its engine is another module, with its own
 * entry point. This small switch exists so that the scenario below stays word
 * for word the same across all six rows. It is what turns "a cell only turns to
 * yes once its test is green" into a mechanical property, and a row with a
 * scenario of its own would escape it.
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

      // A row advertising anything must have the means to prove it. This is
      // where an open cell that no file exercises shows up.
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

      // "Add" is proved on a file that no longer carries a location, so on the
      // output of the erase, whatever the format.
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

// A build once promoted to production from a working branch, because a
// dashboard setting asked for it and nothing in the repository stood in the
// way. The decision now lives in the repository; a test still has to exercise
// it, or the guard rail is only an ornament.
scenario('Le garde-fou de déploiement ne promeut que depuis main', () => {
  check('la branche de production promeut',
    JSON.stringify(commandePour('main')) === JSON.stringify(['wrangler', 'deploy']));
  for (const branche of ['feature/video-final-cases', 'main-truqué', 'Main', 'mainx']) {
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
  // The defect as experienced: a degenerate GPS rational makes the second
  // reader return NaN, `typeof NaN === 'number'` gets past the naive guard, and
  // the interface shows "NaN, NaN" before blanking the map.
  check('la garde naïve accepterait NaN — c’est bien elle qui manquait',
    typeof NaN === 'number');
  check('et « NaN, NaN » est exactement ce que l’affichage en tire',
    formatDecimal({ lat: NaN, lon: NaN }) === 'NaN, NaN');

  // Why the map disappears rather than merely sitting off centre: the
  // projection propagates NaN, so neither tile nor marker has a position.
  const pixels = versPixels({ lat: NaN, lon: NaN }, 13);
  check('la projection propage NaN jusqu’aux pixels, ce qui vide la vue',
    Number.isNaN(pixels.x) && Number.isNaN(pixels.y));

  // The fix. One rule, and it refuses.
  check('deux NaN sont refusés', validerPosition({ lat: NaN, lon: NaN }) === null);
  check('un seul NaN suffit à refuser', validerPosition({ lat: 48.8566, lon: NaN }) === null);
  check('l’infini est refusé aussi', validerPosition({ lat: Infinity, lon: 2.3522 }) === null);

  // Same source, same remedy: a third-party reader with no guarantees can also
  // return an out-of-range value, as unusable as an absent one.
  check('une latitude hors plage est refusée', validerPosition({ lat: 500, lon: 2.3522 }) === null);
  check('une longitude hors plage est refusée', validerPosition({ lat: 48.8566, lon: -400 }) === null);

  // And what is readable passes untouched, exact bounds included.
  const paris = validerPosition({ lat: 48.8566, lon: 2.3522 });
  check('une position lisible traverse inchangée',
    paris !== null && paris.lat === 48.8566 && paris.lon === 2.3522);
  check('les bornes exactes sont valables, ce sont des lieux réels',
    validerPosition({ lat: -90, lon: 180 }) !== null);

  // The exact-zero rule is not here, and that is deliberate: `validerPosition`
  // also serves manual entry, where "0, 0" is the user's choice. It is
  // `readPosition` that discards that point for a file, because there it is the
  // trace of an incomplete purge rather than a reading, and the cross-check does
  // not apply it either, so that it stays an independent witness.
  check('le zéro exact reste une saisie valable, la politique vit ailleurs',
    validerPosition({ lat: 0, lon: 0 }) !== null);
});

scenario('Projection de la carte — aller et retour', () => {
  // The anchors. At zoom 0 the world fits in one 256 px tile: the point (0, 0)
  // is at the centre, and the top-left corner is the limiting latitude.
  const centre = versPixels({ lat: 0, lon: 0 }, 0);
  check('le méridien de Greenwich et l’équateur tombent au centre',
    Math.abs(centre.x - 128) < 1e-9 && Math.abs(centre.y - 128) < 1e-9,
    `${centre.x} ${centre.y}`);
  const coin = versPixels({ lat: LAT_MAX, lon: -180 }, 0);
  check('la latitude limite est le bord de la projection, pas un point au hasard',
    Math.abs(coin.x) < 1e-6 && Math.abs(coin.y) < 1e-6, `${coin.x} ${coin.y}`);

  // The round trip. It is the property everything else depends on: a click is
  // converted to pixels then read back as degrees, and the drift must stay
  // invisible.
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

  // The reference tiles: an error of half a world would show up here, and
  // nowhere else.
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
   * The poles are not representable: clamp them to the edge rather than let the
   * projection run off to infinity.
   *
   * The edge is zero to within rounding rather than zero: clamping the latitude
   * and reprojecting it goes through a logarithm, and the result lands a few
   * 1e-8 from the edge, on the wrong side. That is why the tile arithmetic
   * discards rows outside [0, 2^z) instead of trusting the bound; a tile on row
   * -1 is a request that would answer 404.
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
   * A published table of ground resolutions at latitude 46.5°, the one the
   * earlier analysis used to show that a click could not aim precisely. It is
   * reproduced as is: if somebody touches the constant, the failure points at
   * the figures rather than at a value copied here without a source.
   */
  const attendu: Array<[number, number]> = [
    [12, 26.31], [13, 13.15], [14, 6.58], [16, 1.64], [17, 0.82],
  ];
  for (const [z, m] of attendu) {
    const calcule = metresParPixel(46.5, z);
    check(`au zoom ${z}, un pixel vaut ${m} m comme l’annonce l’attestation`,
      Math.abs(calcule - m) < 0.01, calcule.toFixed(4));
  }

  // That is what justifies reopening the question: the earlier analysis
  // concluded it was impossible with a zoom ceiling of 14. At zoom 17, aiming
  // at a doorway becomes a sensible operation again.
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
   * The manifest was read by no test at all. It declares the two doors through
   * which the system hands over files, and its "Open with" entry shipped in
   * v1.3 with a field that was never standardised, `launch_type`, promising
   * "one window receives the whole batch" with nothing to back it.
   * `check-build.mjs` now rereads the produced manifest; this rereads the
   * function that writes it, before a build even exists.
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
    // The trailing slash decides: without it the host redirects, and a
    // precached entry that redirects takes the whole application out of service
    // offline. See the matching check in `check-build.mjs`.
    check(`${langue} : l’adresse d’ouverture finit par une barre oblique`,
      typeof h?.action === 'string' && h.action.endsWith('/'), String(h?.action));
    check(`${langue} : elle reste dans la portée du manifeste`,
      typeof h?.action === 'string' && h.action.startsWith(m.scope), `${h?.action} / ${m.scope}`);
    check(`${langue} : le champ jamais normalisé ne revient pas`,
      h !== undefined && !('launch_type' in h));

    /*
     * The manifest names itself, in both languages. An installation remembers
     * the address of the manifest it was made from: announcing only its own
     * would leave an application installed from "/fr/" unrecognisable from the
     * English page, and the install button would reappear in front of somebody
     * who has already installed.
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
    // Set to true it would suppress the install prompt, and so the button.
    check(`${langue} : rien ne détourne vers une autre application`,
      m.prefer_related_applications !== true);

    /*
     * The table is authoritative, as everywhere else. Registering for a format
     * we cannot give a location to is offering work we cannot do to somebody
     * who did not ask for it. A GIF falls on `RIEN` in `capacitesDe`, so the
     * "add" cell refuses it outright: there is nothing to keep up to date here
     * when the matrix moves.
     *
     * Videos were the example of that refusal while their row was closed. It no
     * longer is, and this very check is what forced their registration: the
     * meaning of the rule has not changed, only its conclusion.
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
     * And the other direction, the one no eye catches: a format added to the
     * engine without being added here would stay invisible to the system. The
     * tool would know how to read it, and it would not appear under "Open with"
     * for it.
     */
    const proposes = new Set(Object.keys(h?.accept ?? {}).map((t) => PAR_TYPE[t]));
    for (const ligne of MATRICE) {
      if (!ligne.capacites.ajouter) continue;
      for (const f of ligne.formats) {
        check(`${langue} : le tableau sait donner un lieu à « ${f} », le manifeste le propose`,
          proposes.has(f));
      }
    }

    // Share, on the other hand, accepts `image/*`: taking a file of a type we
    // did not name and explaining that we cannot work on it is better than
    // refusing it without a word. "Open with" does not have that luxury, since
    // registering there means appearing in a system menu. The two lists
    // therefore have no reason to be equal.
    check(`${langue} : le partage reste plus large que l’ouverture`,
      m.share_target.params.files[0].accept.includes('image/*') &&
        !Object.keys(h?.accept ?? {}).includes('image/*'));
  }
});

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed === 0 ? 0 : 1);
