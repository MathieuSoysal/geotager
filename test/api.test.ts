/**
 * Banc de la façade publique de `@geotager/core`.
 *
 * `engine.test.ts` éprouve la chirurgie binaire. Celui-ci éprouve la FRONTIÈRE :
 * les noms, les formes, ce qui lève et ce qui rend null. C'est la surface que
 * des gens et des agents vont appeler sans jamais ouvrir `conteneurs.ts`, et
 * c'est donc la seule partie du dépôt dont une rupture ne se verrait pas dans
 * l'application web.
 *
 * La règle du projet vaut ici aussi : une écriture n'est jamais validée par
 * notre propre lecteur seul. ExifTool tranche, sur de vrais fichiers.
 *
 * L'altitude a droit à sa propre série. Elle est arrivée avec ce paquet — les
 * tags existaient dans `tiff.ts` mais n'étaient ni lus ni écrits — et elle porte
 * le piège qui vaut d'être nommé : `GPSAltitude` est toujours POSITIF, et c'est
 * `GPSAltitudeRef` qui dit le signe. Une lecture qui oublie le second annonce
 * une mine à ciel ouvert au-dessus du niveau de la mer.
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

/** Ce qu'ExifTool lit, en nombres bruts. L'oracle, jamais notre lecteur. */
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

/** ExifTool applique-t-il le signe de l'altitude ? On le lui demande en clair. */
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
  /* --- readGps ---------------------------------------------------- */

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
     * Le témoin le plus important de cette série. Un rationnel au dénominateur
     * nul — ce qu'écrit un Galaxy S10 sans relevé — doit être une ABSENCE de
     * lieu, pas le golfe de Guinée. C'est la seule faute qu'un outil de
     * confidentialité ne peut pas se permettre.
     */
    check('un lieu dégénéré est une absence, pas (0, 0)', readGps(lire('gps-degenere.heic')) === null);

    check('des octets qui ne sont pas une image rendent null',
      readGps(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])) === null);

    // Les formes d'entrée. Un `Buffer` est un `Uint8Array`, un `ArrayBuffer`
    // non, et une VUE fenêtrée est le cas qui casse en silence si l'offset est
    // ignoré : on lirait les octets du voisin.
    const brut = readFileSync(join(FIXTURES, 'DSCN0010.jpg'));
    check('accepte un Buffer', readGps(brut) !== null);
    check('accepte un ArrayBuffer',
      readGps(brut.buffer.slice(brut.byteOffset, brut.byteOffset + brut.byteLength)) !== null);
    const rembourre = new Uint8Array(brut.length + 64);
    rembourre.set(brut, 32);
    check('respecte le décalage d’une vue fenêtrée',
      readGps(rembourre.subarray(32, 32 + brut.length)) !== null);
  }

  /* --- detectFormat et inspect ------------------------------------ */

  console.log('\ndetectFormat / inspect — ce qu’on saura faire, dit AVANT d’agir');
  {
    check('le format vient des octets', detectFormat(lire('iphone.heic')) === 'heic');
    check('un fichier illisible est « inconnu »',
      detectFormat(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])) === 'inconnu');

    /*
     * La nuance qui justifie deux champs plutôt qu’un. Sur une photo d’iPhone,
     * remplacer un lieu déjà écrit ne change pas la longueur du fichier ;
     * en créer un de toutes pièces oui. Un unique « peut modifier » mentirait
     * dans un sens ou dans l’autre.
     */
    const iphone = inspect(lire('iphone.heic'));
    check('un HEIC géolocalisé porte un lieu', iphone.hasGps === true);
    check('et se dit corrigeable', iphone.can.replaceLocation === true);

    const sansLieu = inspect(lire('iphone-sans-lieu.heic'));
    check('un HEIC sans lieu le dit', sansLieu.hasGps === false);
    check('et donne un motif, jamais une phrase', typeof sansLieu.reason === 'string');

    /*
     * Un négatif numérique est un TIFF, et lui ajouter des octets abîmerait un
     * original irremplaçable. La façade doit le dire AVANT qu’on essaie.
     */
    const negatif = inspect(lire('negatif.dng'));
    check('un négatif numérique refuse l’ajout', negatif.can.addLocation === false,
      `reason=${negatif.reason}`);
  }

  /* --- readMetadata ------------------------------------------------ */

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

  /* --- setGps ------------------------------------------------------ */

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

    // Les valeurs négatives sont la moitié du globe : une faute de signe est
    // silencieuse, et met la photo dans le mauvais hémisphère.
    const sydney = await setGps(lire('Canon_40D.jpg'), SYDNEY);
    const refSydney = oracle(poser('sydney.jpg', sydney));
    check('un hémisphère sud est écrit avec son signe',
      refSydney.lat !== null && refSydney.lat < 0 && Math.abs(refSydney.lat - SYDNEY.lat) < 0.0001,
      String(refSydney.lat));
    check('et une longitude est est positive',
      refSydney.lon !== null && Math.abs(refSydney.lon - SYDNEY.lng) < 0.0001, String(refSydney.lon));

    // `lon` comme synonyme de `lng` : les deux orthographes circulent.
    const parLon = await setGps(lire('Canon_40D.jpg'), { lat: PARIS.lat, lon: PARIS.lng });
    check('« lon » est accepté comme synonyme de « lng »',
      (() => { const p = readGps(parLon); return p !== null && Math.abs(p.lng - PARIS.lng) < 0.0001; })());
  }

  /* --- l’altitude -------------------------------------------------- */

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
     * Le cas qui justifie tout le soin porté à `GPSAltitudeRef`. La mer Morte
     * est à −430 m ; une écriture qui perd le signe la met à +430, soit 860 m
     * d’erreur du bon côté du zéro, et aucun lecteur ne s’en plaindra.
     */
    const sousLaMer = await setGps(lire('Canon_40D.jpg'), { lat: 31.5, lng: 35.5, alt: -430.2 });
    const cheminBas = poser('mer-morte.jpg', sousLaMer);
    check('une altitude négative est relue négative par ExifTool',
      (() => { const a = oracleAltitudeSignee(cheminBas); return a !== null && Math.abs(a + 430.2) < 0.01; })(),
      String(oracleAltitudeSignee(cheminBas)));
    check('et négative par notre lecteur',
      (() => { const p = readGps(sousLaMer); return p !== null && p.alt !== undefined && Math.abs(p.alt + 430.2) < 0.01; })(),
      String(readGps(sousLaMer)?.alt));

    // Sans `alt`, RIEN ne bouge : c’est ce qui garantit que l’application web,
    // qui n’en passe jamais, écrit exactement les octets qu’elle écrivait avant.
    const sansAlt = await setGps(lire('Canon_40D.jpg'), PARIS);
    check('une écriture sans altitude n’en invente aucune',
      oracle(poser('sans-alt.jpg', sansAlt)).alt === null);

    /*
     * Une vidéo range son lieu en texte, dans une notation sans place pour une
     * altitude. On refuse plutôt que de rendre un fichier auquel il manque très
     * exactement ce qu’on avait demandé d’y mettre.
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

  /* --- stripGps ---------------------------------------------------- */

  console.log('\nstripGps — retirer le lieu, et rien d’autre');
  {
    const original = lire('DSCN0010.jpg');
    const nu = await stripGps(original);
    const chemin = poser('sans-lieu.jpg', nu);
    check('ExifTool ne trouve plus de latitude', oracle(chemin).lat === null);
    check('notre lecteur non plus', readGps(nu) === null);

    // Ce qui doit SURVIVRE : le reste des métadonnées. Un « strip » qui emporte
    // la date et l’appareil n’est pas ce qu’on a demandé.
    const avant = await readMetadata(original);
    const apres = await readMetadata(nu);
    check('la date de prise de vue survit', apres.takenAt === avant.takenAt, String(apres.takenAt));
    check('l’appareil survit', apres.camera === avant.camera, String(apres.camera));

    // Un fichier qui n’a pas de lieu peut être « nettoyé » sans erreur.
    const dejaPropre = await stripGps(lire('Canon_40D.jpg'));
    check('retirer un lieu absent n’échoue pas', readGps(dejaPropre) === null);
  }

  /* --- applyGps : le refus rendu, pas levé ------------------------- */

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

  /* --- la validation des entrées ----------------------------------- */

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
     * Le couple (0, 0) est refusé, et le test dit POURQUOI il doit l'être ici
     * plutôt qu'au bout de la chaîne : notre lecteur écarte cette paire, donc
     * l'écrire rendrait un fichier que l'outil lui-même déclarerait sans lieu.
     * Le refus tombait déjà, mais douze étapes plus loin, sous un message qui
     * accusait l'encodeur. Ce test fixe l'endroit ET le message.
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

    // Un seul des deux à zéro reste un lieu : l'équateur et le méridien de
    // Greenwich passent par des endroits parfaitement habités.
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
