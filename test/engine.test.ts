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

// Same default as scripts/fetch-fixtures.mjs: without it the bench looked for
// the corpus at the root of the repository and failed on an uncaught exception,
// which made it look as though the engine were at fault.
const FIXTURES = process.env.FIXTURES ?? 'test/fixtures';
const tmp = mkdtempSync(join(tmpdir(), 'geotagor-'));

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

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed === 0 ? 0 : 1);
