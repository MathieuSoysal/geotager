/**
 * Harness for the public facade of `@geotager/core`.
 *
 * `engine.test.ts` exercises the binary surgery. This one exercises the
 * boundary: the names, the shapes, what throws and what returns null. It is the
 * surface people and agents will call without ever opening `conteneurs.ts`, and
 * so the only part of the repository whose breakage would not show in the web
 * application.
 *
 * The project rule applies here too: a write is never validated by our own
 * reader alone. ExifTool decides, on real files.
 *
 * Altitude gets its own series. It arrived with this release, since the tags
 * existed in `tiff.ts` but were neither read nor written, and it carries the
 * trap worth naming: `GPSAltitude` is always positive, and `GPSAltitudeRef`
 * carries the sign. A read that forgets the second announces an open-cast mine
 * above sea level.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  GeotagError,
  applyGps,
  detectFormat,
  inspect,
  readGps,
  readMetadata,
  setGps,
  stripGps,
} from '../packages/core/src/index.ts';

const FIXTURES = process.env.FIXTURES ?? 'test/fixtures';
const tmp = mkdtempSync(join(tmpdir(), 'geotager-api-'));

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

/** What ExifTool reads, as raw numbers. The oracle, never our reader. */
function oracle(fichier: string): { lat: number | null; lon: number | null; alt: number | null } {
  const out = exif([
    '-n', '-s', '-s', '-s',
    '-GPSLatitude', '-GPSLongitude', '-GPSAltitude',
    fichier,
  ]).trim();
  const l = out.split('\n').map((x) => x.trim()).filter(Boolean).map(Number);
  return {
    lat: Number.isFinite(l[0]) ? l[0] : null,
    lon: Number.isFinite(l[1]) ? l[1] : null,
    alt: Number.isFinite(l[2]) ? l[2] : null,
  };
}

/** Does ExifTool apply the altitude's sign? We ask it outright. */
function oracleAltitudeSignee(fichier: string): number | null {
  const brut = exif(['-n', '-s', '-s', '-s', '-GPSAltitude', '-GPSAltitudeRef', fichier])
    .trim()
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
  if (brut.length < 1) return null;
  const v = Number(brut[0]);
  if (!Number.isFinite(v)) return null;
  const ref = brut.length > 1 ? Number(brut[1]) : 0;
  return ref === 1 ? -Math.abs(v) : Math.abs(v);
}

const lire = (nom: string) => new Uint8Array(readFileSync(join(FIXTURES, nom)));

function poser(nom: string, octets: Uint8Array): string {
  const chemin = join(tmp, nom);
  writeFileSync(chemin, octets);
  return chemin;
}

const PARIS = { lat: 48.8584, lng: 2.2945 };
const SYDNEY = { lat: -33.8688, lng: 151.2093 };

async function principal(): Promise<void> {
  // readGps

  console.log('\nreadGps — le lieu, ou null, et jamais une devinette');
  {
    const avec = readGps(lire('DSCN0010.jpg'));
    check('un JPEG géolocalisé rend un lieu', avec !== null);
    check('sous les noms lat/lng', avec !== null && 'lat' in avec && 'lng' in avec);
    const ref = oracle(join(FIXTURES, 'DSCN0010.jpg'));
    check(
      'accord avec ExifTool à moins de 0,001°',
      avec !== null && ref.lat !== null && ref.lon !== null &&
        Math.abs(avec.lat - ref.lat) < 0.001 && Math.abs(avec.lng - ref.lon) < 0.001,
      avec ? `${avec.lat}, ${avec.lng} vs ${ref.lat}, ${ref.lon}` : 'null',
    );

    check('un JPEG sans lieu rend null', readGps(lire('Canon_40D.jpg')) === null);

    /*
     * The most important witness in this series. A rational with a zero
     * denominator, which a Galaxy S10 writes without a fix, must be an absence
     * of location, not the Gulf of Guinea. It is the one mistake a privacy tool
     * cannot make.
     */
    check('un lieu dégénéré est une absence, pas (0, 0)', readGps(lire('gps-degenere.heic')) === null);

    check('des octets qui ne sont pas une image rendent null',
      readGps(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])) === null);

    // The input shapes. A `Buffer` is a `Uint8Array`, an `ArrayBuffer` is not,
    // and a windowed view is the case that breaks silently if the offset is
    // ignored: we would read the neighbour's bytes.
    const brut = readFileSync(join(FIXTURES, 'DSCN0010.jpg'));
    check('accepte un Buffer', readGps(brut) !== null);
    check('accepte un ArrayBuffer',
      readGps(brut.buffer.slice(brut.byteOffset, brut.byteOffset + brut.byteLength)) !== null);
    const rembourre = new Uint8Array(brut.length + 64);
    rembourre.set(brut, 32);
    check('respecte le décalage d’une vue fenêtrée',
      readGps(rembourre.subarray(32, 32 + brut.length)) !== null);
  }

  // detectFormat and inspect

  console.log('\ndetectFormat / inspect — ce qu’on saura faire, dit AVANT d’agir');
  {
    check('le format vient des octets', detectFormat(lire('iphone.heic')) === 'heic');
    check('un fichier illisible est « inconnu »',
      detectFormat(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])) === 'inconnu');

    /*
     * The distinction that justifies two fields rather than one. On an iPhone
     * photo, replacing a location already written does not change the file
     * length; creating one from scratch does. A single "can modify" would lie
     * one way or the other.
     */
    const iphone = inspect(lire('iphone.heic'));
    check('un HEIC géolocalisé porte un lieu', iphone.hasGps === true);
    check('et se dit corrigeable', iphone.can.replaceLocation === true);

    const sansLieu = inspect(lire('iphone-sans-lieu.heic'));
    check('un HEIC sans lieu le dit', sansLieu.hasGps === false);
    check('et donne un motif, jamais une phrase', typeof sansLieu.reason === 'string');

    /*
     * A digital negative is a TIFF, and adding bytes to one would damage an
     * irreplaceable original. The facade must say so before you try.
     */
    const negatif = inspect(lire('negatif.dng'));
    check('un négatif numérique refuse l’ajout', negatif.can.addLocation === false,
      `reason=${negatif.reason}`);
  }

  // readMetadata

  console.log('\nreadMetadata — tout ce que le fichier dit de lui-même');
  {
    const m = await readMetadata(lire('DSCN0010.jpg'));
    check('le format est rendu', m.format === 'jpeg');
    check('la taille est celle des octets reçus',
      m.size === readFileSync(join(FIXTURES, 'DSCN0010.jpg')).length);
    check('le lieu est là', m.gps !== null);
    check('les capacités sont projetées sous des noms lisibles',
      typeof m.can.removeLocation === 'boolean' && typeof m.can.addLocation === 'boolean');
    check('les détails sont des paires clé/valeur',
      Array.isArray(m.details) && m.details.every((d) => 'key' in d && 'value' in d));

    const video = await readMetadata(lire('appareil.mp4'));
    check('une vidéo passe aussi par cette porte', video.format === 'video');
    check('et son appareil est lu', typeof video.camera === 'string' && video.camera.length > 0,
      String(video.camera));
  }

  // setGps

  console.log('\nsetGps — écrire, et le prouver avec un second lecteur');
  {
    const produit = await setGps(lire('DSCN0010.jpg'), PARIS);
    const chemin = poser('paris.jpg', produit);
    const ref = oracle(chemin);
    check('ExifTool relit la latitude demandée',
      ref.lat !== null && Math.abs(ref.lat - PARIS.lat) < 0.0001, String(ref.lat));
    check('ExifTool relit la longitude demandée',
      ref.lon !== null && Math.abs(ref.lon - PARIS.lng) < 0.0001, String(ref.lon));
    check('notre lecteur est d’accord avec lui',
      (() => { const p = readGps(produit); return p !== null && Math.abs(p.lat - PARIS.lat) < 0.0001; })());
    check('l’original n’a pas été modifié',
      readGps(lire('DSCN0010.jpg'))!.lat !== PARIS.lat);

    // Negative values are half the globe: a sign error is silent, and puts the
    // photo in the wrong hemisphere.
    const sydney = await setGps(lire('Canon_40D.jpg'), SYDNEY);
    const refSydney = oracle(poser('sydney.jpg', sydney));
    check('un hémisphère sud est écrit avec son signe',
      refSydney.lat !== null && refSydney.lat < 0 && Math.abs(refSydney.lat - SYDNEY.lat) < 0.0001,
      String(refSydney.lat));
    check('et une longitude est est positive',
      refSydney.lon !== null && Math.abs(refSydney.lon - SYDNEY.lng) < 0.0001, String(refSydney.lon));

    // `lon` as a synonym for `lng`: both spellings circulate.
    const parLon = await setGps(lire('Canon_40D.jpg'), { lat: PARIS.lat, lon: PARIS.lng });
    check('« lon » est accepté comme synonyme de « lng »',
      (() => { const p = readGps(parLon); return p !== null && Math.abs(p.lng - PARIS.lng) < 0.0001; })());
  }

  // Altitude

  console.log('\nsetGps --alt — l’altitude, et son octet de signe');
  {
    const avecAlt = await setGps(lire('Canon_40D.jpg'), { ...PARIS, alt: 137.5 });
    const chemin = poser('altitude.jpg', avecAlt);
    check('ExifTool relit l’altitude demandée',
      (() => { const a = oracle(chemin).alt; return a !== null && Math.abs(a - 137.5) < 0.01; })(),
      String(oracle(chemin).alt));
    check('readGps la rend sous la clé alt',
      (() => { const p = readGps(avecAlt); return p !== null && p.alt !== undefined && Math.abs(p.alt - 137.5) < 0.01; })());

    /*
     * The case that justifies all the care over `GPSAltitudeRef`. The Dead Sea
     * is at -430 m; a write that loses the sign puts it at +430, an error of
     * 860 m on the right side of zero, and no reader will complain.
     */
    const sousLaMer = await setGps(lire('Canon_40D.jpg'), { lat: 31.5, lng: 35.5, alt: -430.2 });
    const cheminBas = poser('mer-morte.jpg', sousLaMer);
    check('une altitude négative est relue négative par ExifTool',
      (() => { const a = oracleAltitudeSignee(cheminBas); return a !== null && Math.abs(a + 430.2) < 0.01; })(),
      String(oracleAltitudeSignee(cheminBas)));
    check('et négative par notre lecteur',
      (() => { const p = readGps(sousLaMer); return p !== null && p.alt !== undefined && Math.abs(p.alt + 430.2) < 0.01; })(),
      String(readGps(sousLaMer)?.alt));

    // Without `alt`, nothing moves: that is what guarantees the web app, which
    // never passes one, writes exactly the bytes it wrote before.
    const sansAlt = await setGps(lire('Canon_40D.jpg'), PARIS);
    check('une écriture sans altitude n’en invente aucune',
      oracle(poser('sans-alt.jpg', sansAlt)).alt === null);

    /*
     * A video stores its location as text, in a notation with no room for an
     * altitude. We refuse rather than return a file missing precisely what was
     * asked to be put in it.
     */
    let leve = false;
    let code = '';
    try {
      await setGps(lire('avec-lieu.mp4'), { ...PARIS, alt: 100 });
    } catch (e) {
      leve = e instanceof GeotagError;
      code = e instanceof GeotagError ? e.code : '';
    }
    check('une altitude sur une vidéo est refusée, pas ignorée', leve, code);
    check('et le refus porte un code exploitable', code === 'ALTITUDE_IMPOSSIBLE', code);
  }

  // stripGps

  console.log('\nstripGps — retirer le lieu, et rien d’autre');
  {
    const original = lire('DSCN0010.jpg');
    const nu = await stripGps(original);
    const chemin = poser('sans-lieu.jpg', nu);
    check('ExifTool ne trouve plus de latitude', oracle(chemin).lat === null);
    check('notre lecteur non plus', readGps(nu) === null);

    // What must survive: the rest of the metadata. A strip that takes the date
    // and the device with it is not what was asked for.
    const avant = await readMetadata(original);
    const apres = await readMetadata(nu);
    check('la date de prise de vue survit', apres.takenAt === avant.takenAt, String(apres.takenAt));
    check('l’appareil survit', apres.camera === avant.camera, String(apres.camera));

    // A file with no location can be cleaned without error.
    const dejaPropre = await stripGps(lire('Canon_40D.jpg'));
    check('retirer un lieu absent n’échoue pas', readGps(dejaPropre) === null);
  }

  // applyGps: the refusal returned, not thrown

  console.log('\napplyGps — la voie du lot : le refus est une valeur');
  {
    const r = await applyGps(lire('DSCN0010.jpg'), { kind: 'set', lat: PARIS.lat, lng: PARIS.lng });
    check('une réussite porte ok: true', r.ok === true);
    check('et la position RELUE, jamais celle demandée',
      r.ok === true && r.verified !== null && Math.abs(r.verified.lat - PARIS.lat) < 0.0001);
    check('et la voie empruntée', r.ok === true && (r.route === 'P1' || r.route === 'P2'), r.ok ? r.route : '');

    const negatif = await applyGps(lire('negatif.dng'), { kind: 'set', lat: 1, lng: 1 });
    check('un négatif numérique est refusé sans lever', negatif.ok === false);
    check('avec un code stable',
      negatif.ok === false && typeof negatif.code === 'string' && negatif.code.length > 0,
      negatif.ok === false ? negatif.code : '');
    check('et le motif annoncé AVANT l’action',
      negatif.ok === false && typeof negatif.reason === 'string',
      negatif.ok === false ? String(negatif.reason) : '');
  }

  // Input validation

  console.log('\nsetGps — ce qui est refusé avant d’ouvrir quoi que ce soit');
  {
    const refuse = async (nom: string, gps: any): Promise<void> => {
      let code = '';
      try {
        await setGps(lire('Canon_40D.jpg'), gps);
      } catch (e) {
        code = e instanceof GeotagError ? e.code : 'AUTRE';
      }
      check(nom, code === 'ENTREE_INVALIDE', code || 'rien levé');
    };

    await refuse('une latitude hors plage est refusée', { lat: 91, lng: 0 });
    await refuse('une longitude hors plage est refusée', { lat: 0, lng: 181 });
    await refuse('NaN est refusé', { lat: NaN, lng: 0 });
    await refuse('l’infini est refusé', { lat: 0, lng: Infinity });
    await refuse('une longitude absente est refusée', { lat: 48 });
    await refuse('une altitude non finie est refusée', { lat: 0, lng: 0, alt: NaN });

    /*
     * The pair (0, 0) is refused, and the test says why it must be refused here
     * rather than at the end of the chain: our reader rejects that pair, so
     * writing it would return a file the tool itself would call locationless.
     * The refusal already happened, but twelve steps later, under a message
     * that blamed the encoder. This test pins the place and the message.
     */
    await refuse('(0, 0) est refusé à l’entrée', { lat: 0, lng: 0 });
    {
      let phrase = '';
      try {
        await setGps(lire('Canon_40D.jpg'), { lat: 0, lng: 0 });
      } catch (e) {
        phrase = e instanceof GeotagError ? e.message : '';
      }
      check('et le message nomme la vraie raison', /no location/i.test(phrase), phrase);
    }

    // Only one of the two at zero is still a location: the equator and the
    // Greenwich meridian pass through perfectly inhabited places.
    let surLEquateur = true;
    try {
      await setGps(lire('Canon_40D.jpg'), { lat: 0, lng: 32.58 });
    } catch {
      surLEquateur = false;
    }
    check('mais une latitude nulle seule reste un lieu', surLEquateur);
  }

  console.log(`\n${passed} réussis, ${failed} échoués`);
  if (failed > 0) process.exitCode = 1;
}

await principal();
