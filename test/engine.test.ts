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
} from '../src/lib/exif/jpeg.ts';
import { parseTiff, readPosition, degreesToDms } from '../src/lib/exif/tiff.ts';
import {
  conteneurDe,
  ecrirePosition,
  effacerPosition,
  lirePosition,
  memesOctetsHorsPlages,
  toutEffacer,
} from '../src/lib/exif/conteneurs.ts';
import '../src/lib/exif/formats.ts';
import { empreinteDesEmplacements, itemsDuFichier } from '../src/lib/exif/isobmff.ts';
import { createHash } from 'node:crypto';
import { commandePour } from '../scripts/deploy.mjs';
import { MATRICE, cellules } from '../src/lib/exif/capacites.ts';
import {
  LAT_MAX,
  ZOOM_MAX,
  ZOOM_MIN,
  depuisPixels,
  metresParPixel,
  normaliserLon,
  versPixels,
} from '../src/lib/exif/coords.ts';
import type { Format } from '../src/lib/exif/types.ts';

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
 * Three families are excluded, and only those: [GPS] tags, which are what we
 * modify; [Composite] tags derived from GPS, which ExifTool recomputes; and the
 * volatile system tags (path, access dates, size) that describe the file on
 * disk rather than its content.
 */
function inventory(file: string): string[] {
  const volatils =
    /^\[(System|File)\]\s+(Directory|FileName|FileSize|FileAccessDate|FileModifyDate|FileInodeChangeDate|FilePermissions)\b/;
  return exif(['-a', '-G1', '-s', file])
    .split('\n')
    .filter((l) => l.trim())
    .filter((l) => !/^\[GPS\]/.test(l))
    .filter((l) => !/^\[Composite\]\s+GPS/.test(l))
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

for (const [nom, etiquette] of [
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

/** One real file carrying a location, per format. Without it, no proof. */
const TEMOINS: Partial<Record<Format, string>> = {
  jpeg: 'DSCN0010.jpg',
  heic: 'iphone.heic',
  avif: 'photo.avif',
  png: 'avec-lieu.png',
  webp: 'avec-lieu.webp',
  tiff: 'avec-lieu.tif',
};

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
      const conteneur = conteneurOuEchec(src);

      check(`${format} : « Lire » dit vrai`,
        (lirePosition(conteneur, src) !== null) === c.lire, temoin);

      const corrige = (() => {
        try { return ecrirePosition(conteneur, src, AVIGNON.lat, AVIGNON.lon).bytes; }
        catch { return null; }
      })();
      check(`${format} : « Corriger » dit vrai`, (corrige !== null) === c.corriger, temoin);

      const vide = (() => {
        try { return effacerPosition(conteneur, src).bytes; }
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
          try { return ecrirePosition(conteneur, vide, AVIGNON.lat, AVIGNON.lon).bytes; }
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

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed === 0 ? 0 : 1);
