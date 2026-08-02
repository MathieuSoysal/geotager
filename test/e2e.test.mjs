/**
 * End-to-end verification, in a real browser.
 *
 * This test does not look at the code: it drives the application the way a user
 * would, picks up the file actually downloaded, and has ExifTool read it back.
 * It also logs every network request the page makes, which is the only
 * admissible proof of the promise that nothing leaves the browser.
 */
import { createServer } from 'node:http';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const DIST = 'dist';
const FIXTURES = process.env.FIXTURES ?? 'test/fixtures';
const PORT = 4319;

/**
 * Every header actually served for `/*`, read from `public/_headers`.
 *
 * They are read rather than copied: a policy copied here would drift from the
 * one the host serves, and the test would end up validating a page nobody
 * receives. Until now this server set no header at all, so a `style` attribute
 * refused in production went unnoticed in the tests, and there was one, on the
 * template.
 *
 * And until now it only set the CSP. The six other headers, which the pages
 * describe in so many words, were asserted by nothing: one could be removed
 * without a single check complaining.
 */
const EN_TETES = (() => {
  const brut = readFileSync('public/_headers', 'utf8').split('\n');
  const debut = brut.findIndex((l) => l.trim() === '/*');
  const entetes = {};
  for (const ligne of brut.slice(debut + 1)) {
    if (/^\S/.test(ligne)) break; // le bloc suivant commence
    const m = ligne.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
    if (m) entetes[m[1]] = m[2].trim();
  }
  return entetes;
})();

const MIME = {
  // Without those two the test server returns `application/octet-stream`:
  // Chromium then refuses the manifest, and the "no JavaScript error" checks go
  // red for a reason foreign to the application.
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.xml': 'application/xml; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * The full list of banned words.
 *
 * It used to be copied in two places, in two diverging versions, one knowing
 * "worker" but not "RIFF" and the other the reverse, and six words were checked
 * nowhere: "balise", "DMS", "décimal", "WGS84", "sidecar", "upload". A
 * duplicated list is a list one half of which ends up lying.
 */
const MOTS_INTERDITS = {
  fr: /\b(EXIF|IFD|ISOBMFF|VP8X|RIFF|conteneur|m[ée]tadonn[ée]es|balise|DMS|d[ée]cimal|WGS ?84|sidecar|upload|parser|worker|chunk|morceau|atome|bo[îi]te)\b/i,
  en: /\b(EXIF|IFD|ISOBMFF|VP8X|RIFF|container|metadata|tag|DMS|WGS ?84|sidecar|upload|parser|worker|chunk|atom|box)\b/i,
};

let passed = 0;
let failed = 0;
const check = (nom, ok, detail = '') => {
  if (ok) {
    passed++;
    console.log(`  ok   ${nom}`);
  } else {
    failed++;
    console.log(`  FAIL ${nom}${detail ? ` — ${detail}` : ''}`);
  }
};

const serveur = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  // A path ending in "/" means the folder index, which is what the host does,
  // and without it /fr/ would answer 404 here and only here.
  let f = join(DIST, url.pathname.slice(1));
  if (url.pathname.endsWith('/')) f = join(f, 'index.html');
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f) || !statSync(f).isFile()) {
    res.writeHead(404).end('non trouvé');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(f)] ?? 'application/octet-stream',
    ...EN_TETES,
  });
  res.end(readFileSync(f));
});
await new Promise((r) => serveur.listen(PORT, r));

// The environment provides Chromium at a fixed location; the installed version
// of Playwright expects another. We point at it explicitly rather than download
// a second browser.
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const navigateur = await chromium.launch(
  existsSync(CHROME) ? { executablePath: CHROME } : {},
);
/*
 * `serviceWorkers: 'block'`, and it is not a convenience.
 *
 * This whole file rests on the request log: the zero-third-party proof, the
 * boundary before the map opens, the tile count. A service worker serving from
 * its cache removes those requests from the log, and the checks would start
 * passing for the wrong reason, which is to say proving nothing. The main
 * journey is therefore judged without one.
 *
 * The service worker has its own section, at the very bottom, in a context of
 * its own.
 */
const contexte = await navigateur.newContext({
  acceptDownloads: true,
  serviceWorkers: 'block',
});

/*
 * Map tiles are intercepted, never actually requested.
 *
 * Continuous integration must reach no network: a test depending on a
 * third-party server fails the day that server slows down, and ends up ignored.
 * What is being judged here is not how the tiles look anyway, it is who gets
 * called, and an intercepted request stays visible in `requetes`, so the
 * zero-third-party proof still sees everything.
 *
 * The host is imported from the module that serves it rather than copied: the
 * same discipline as the CSP read from `public/_headers`. A value copied into a
 * test is a value that will eventually diverge from the one that ships.
 */
const { HOTE_TUILES } = await import('../src/lib/ui/carte.ts');
const TUILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBASempletAAAAAElFTkSuQmCC',
  'base64',
);
let tuilesDemandees = 0;
await contexte.route(`https://${HOTE_TUILES}/**`, (route) => {
  tuilesDemandees++;
  return route.fulfill({ status: 200, contentType: 'image/png', body: TUILE_PNG });
});

const page = await contexte.newPage();

const requetes = [];
page.on('request', (r) => requetes.push(r.url()));
const erreursConsole = [];
page.on('pageerror', (e) => erreursConsole.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') erreursConsole.push(m.text());
});

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

console.log('\nChargement de la page');
check('aucune erreur JavaScript au chargement', erreursConsole.length === 0, erreursConsole[0]);
check('le titre est en place', (await page.title()).includes('Geotager'));
check("l'état vide est visible", await page.locator('#etat-vide').isVisible());
check("l'état actif est masqué", !(await page.locator('#etat-actif').isVisible()));

const source = join(FIXTURES, 'DSCN0010.jpg');
const attendueOrigine = execFileSync(
  'exiftool',
  ['-n', '-s', '-s', '-s', '-GPSLatitude', '-GPSLongitude', source],
  { encoding: 'utf8' },
).trim().split('\n').map(Number);

console.log('\nDépôt d\'une photo géolocalisée');
await page.setInputFiles('#picker', source);
await page.waitForSelector('#etat-actif:not([hidden])', { timeout: 15_000 });
await page.waitForFunction(() => {
  const p = document.getElementById('pill-position');
  return p && !p.hidden && p.textContent.trim().length > 0;
}, null, { timeout: 15_000 });

const pill = (await page.locator('#pill-position').textContent()).trim();
check('la position lue est affichée', /Currently/.test(pill), pill);
const [latAff, lonAff] = pill.replace(/[^\d.,\-]/g, '').split(',').map(Number);
check(
  "la position affichée correspond à celle du fichier",
  Math.abs(latAff - attendueOrigine[0]) < 0.0001 && Math.abs(lonAff - attendueOrigine[1]) < 0.0001,
  `affiché ${latAff},${lonAff} / réel ${attendueOrigine.join(',')}`,
);
check('les étapes ont avancé', (await page.locator('.step.on').textContent()).includes('place'));
check('le bouton principal est encore inactif',
  (await page.locator('#telecharger').getAttribute('aria-disabled')) === 'true');

console.log('\nSaisie de nouvelles coordonnées');
await page.fill('#coords', '43.9493, 4.8055');
await page.waitForSelector('#resultat:not([hidden])');
check('le récapitulatif apparaît', (await page.locator('#resultat-coords').textContent()).includes('43,94949') === false);
check('la distance à l\'origine est annoncée',
  /km|m$/.test((await page.locator('#resultat-detail').textContent()).trim()));
check('le bouton principal est actif',
  (await page.locator('#telecharger').getAttribute('aria-disabled')) === 'false');

console.log('\nTéléchargement et relecture par ExifTool');
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 20_000 }),
  page.click('#telecharger'),
]);
const produit = join('/tmp', download.suggestedFilename());
await download.saveAs(produit);
check('le nom d\'origine est conservé', download.suggestedFilename().includes('DSCN0010'));

const relu = execFileSync(
  'exiftool',
  ['-n', '-s', '-s', '-s', '-GPSLatitude', '-GPSLongitude', produit],
  { encoding: 'utf8' },
).trim().split('\n').map(Number);
check('ExifTool relit la position demandée',
  Math.abs(relu[0] - 43.9493) < 0.00002 && Math.abs(relu[1] - 4.8055) < 0.00002,
  `relu ${relu.join(', ')}`);
check('le fichier produit a exactement la taille de l\'original',
  statSync(produit).size === statSync(source).size,
  `${statSync(source).size} -> ${statSync(produit).size}`);

const mnAvant = execFileSync('exiftool', ['-v3', source], { encoding: 'utf8', maxBuffer: 32e6 })
  .match(/MakerNotes directory with (\d+) entries/)?.[1];
const mnApres = execFileSync('exiftool', ['-v3', produit], { encoding: 'utf8', maxBuffer: 32e6 })
  .match(/MakerNotes directory with (\d+) entries/)?.[1];
check('le MakerNote a survécu au passage par le navigateur',
  mnAvant && mnAvant === mnApres, `${mnAvant} -> ${mnApres}`);

console.log('\nEffacement de la position');
await page.setInputFiles('#picker', source);
await page.waitForFunction(() => {
  const p = document.getElementById('pill-position');
  return p && !p.hidden;
}, null, { timeout: 15_000 });
const [dl2] = await Promise.all([
  page.waitForEvent('download', { timeout: 20_000 }),
  page.click('#effacer'),
]);
const efface = join('/tmp', dl2.suggestedFilename());
await dl2.saveAs(efface);
const gpsRestant = execFileSync('exiftool', ['-a', '-G1', '-s', '-GPS:all', efface], {
  encoding: 'utf8',
}).trim();
check('plus aucun tag GPS après effacement', gpsRestant === '', gpsRestant.slice(0, 100));
check('taille inchangée après effacement', statSync(efface).size === statSync(source).size);

console.log('\nDépôt d\'une photo iPhone');
const heic = join(FIXTURES, 'iphone.heic');
const gpsHeic = execFileSync(
  'exiftool',
  ['-n', '-s', '-s', '-s', '-GPSLatitude', '-GPSLongitude', heic],
  { encoding: 'utf8' },
).trim().split('\n').map(Number);

// Page reloaded: the interface shows the filename as soon as the file is
// dropped, before it is read, so waiting for "a non-empty pill" would compare
// the iPhone photo against the previous file's position. Starting from a clean
// state removes the race instead of working around it.
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('#etat-vide:not([hidden])');

await page.setInputFiles('#picker', heic);
await page.waitForFunction(() => {
  const p = document.getElementById('pill-position');
  return p && !p.hidden && p.textContent.trim().length > 0;
}, null, { timeout: 30_000 });

const pillHeic = (await page.locator('#pill-position').textContent()).trim();
const [latHeic, lonHeic] = pillHeic.replace(/[^\d.,\-]/g, '').split(',').map(Number);
check('la position de la photo iPhone est affichée',
  Math.abs(latHeic - gpsHeic[0]) < 0.0001 && Math.abs(lonHeic - gpsHeic[1]) < 0.0001,
  `affiché ${latHeic},${lonHeic} / réel ${gpsHeic.join(',')}`);

// The interface announces the route before the action: here, fixing and erasing
// are possible, adding is not, and that is exactly what has to be said.
const alerte = page.locator('#alerte-format');
check('la voie retenue est annoncée avant toute action',
  await alerte.isVisible() && (await alerte.textContent()).trim().length > 0,
  (await alerte.textContent()).trim().slice(0, 80));
check('la phrase affichée ne contient aucun jargon de format',
  !MOTS_INTERDITS.en.test(await alerte.textContent()),
  (await alerte.textContent()).trim().slice(0, 80));
check('« Tout effacer » est désactivé là où l\'opération n\'existe pas',
  (await page.locator('#effacer-tout').getAttribute('aria-disabled')) === 'true');

const [dlHeic] = await Promise.all([
  page.waitForEvent('download', { timeout: 30_000 }),
  page.click('#effacer'),
]);
const heicEfface = join('/tmp', dlHeic.suggestedFilename());
await dlHeic.saveAs(heicEfface);
check('plus aucun tag GPS dans la photo iPhone produite',
  execFileSync('exiftool', ['-a', '-G1', '-s', '-GPS:all', heicEfface], { encoding: 'utf8' }).trim() === '',
  'des tags GPS subsistent');
check('la photo iPhone produite a exactement la taille de l\'original',
  statSync(heicEfface).size === statSync(heic).size,
  `${statSync(heic).size} -> ${statSync(heicEfface).size}`);
check('l\'image reste de mêmes dimensions',
  execFileSync('exiftool', ['-s', '-s', '-s', '-ImageSize', heicEfface], { encoding: 'utf8' }).trim() ===
    execFileSync('exiftool', ['-s', '-s', '-s', '-ImageSize', heic], { encoding: 'utf8' }).trim());

console.log('\nDépôt d\'une image PNG');
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('#etat-vide:not([hidden])');
const png = join(FIXTURES, 'avec-lieu.png');
await page.setInputFiles('#picker', png);
await page.waitForFunction(() => {
  const p = document.getElementById('pill-position');
  return p && !p.hidden && p.textContent.trim().length > 0;
}, null, { timeout: 20_000 });
check('le champ de saisie est modifiable sur un PNG',
  (await page.locator('#coords').getAttribute('readonly')) === null);

await page.fill('#coords', '43.9493, 4.8055');
await page.waitForSelector('#resultat:not([hidden])');
const [dlPng] = await Promise.all([
  page.waitForEvent('download', { timeout: 20_000 }),
  page.click('#telecharger'),
]);
const pngProduit = join('/tmp', dlPng.suggestedFilename());
await dlPng.saveAs(pngProduit);
const reluPng = execFileSync('exiftool',
  ['-n', '-s', '-s', '-s', '-GPSLatitude', '-GPSLongitude', pngProduit],
  { encoding: 'utf8' }).trim().split('\n').map(Number);
check('ExifTool relit la position demandée dans le PNG',
  Math.abs(reluPng[0] - 43.9493) < 0.00002 && Math.abs(reluPng[1] - 4.8055) < 0.00002,
  `relu ${reluPng.join(', ')}`);

// Chromium decodes PNG natively: a decoder entirely independent of ours, and
// the most direct proof that the produced image is still an image.
const octetsPng = readFileSync(pngProduit);
const decode = await page.evaluate(async (donnees) => {
  const blob = new Blob([new Uint8Array(donnees)], { type: 'image/png' });
  const img = await createImageBitmap(blob);
  return { l: img.width, h: img.height };
}, Array.from(octetsPng));
check('le navigateur décode l\'image produite',
  decode.l > 0 && decode.h > 0, JSON.stringify(decode));

console.log('\nDépôt d\'une image WebP');
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('#etat-vide:not([hidden])');
const webp = join(FIXTURES, 'avec-lieu.webp');
await page.setInputFiles('#picker', webp);
await page.waitForFunction(() => {
  const p = document.getElementById('pill-position');
  return p && !p.hidden && p.textContent.trim().length > 0;
}, null, { timeout: 20_000 });
// Write first: this is the case the cross-check would have refused if it
// required the second reader to be able to open a WebP, which it cannot do. The
// symmetry rule is what lets us verify it anyway, by handing it the extracted
// block rather than the whole file.
await page.fill('#coords', '43.9493, 4.8055');
await page.waitForSelector('#resultat:not([hidden])');
const [dlWebpEcrit] = await Promise.all([
  page.waitForEvent('download', { timeout: 20_000 }),
  page.click('#telecharger'),
]);
const webpEcrit = join('/tmp', dlWebpEcrit.suggestedFilename());
await dlWebpEcrit.saveAs(webpEcrit);
const reluWebp = execFileSync('exiftool',
  ['-n', '-s', '-s', '-s', '-GPSLatitude', '-GPSLongitude', webpEcrit],
  { encoding: 'utf8' }).trim().split('\n').map(Number);
check('ExifTool relit la position écrite dans le WebP',
  Math.abs(reluWebp[0] - 43.9493) < 0.00002 && Math.abs(reluWebp[1] - 4.8055) < 0.00002,
  `relu ${reluWebp.join(', ')}`);

const [dlWebp] = await Promise.all([
  page.waitForEvent('download', { timeout: 20_000 }),
  page.click('#effacer'),
]);
const webpProduit = join('/tmp', dlWebp.suggestedFilename());
await dlWebp.saveAs(webpProduit);
check('plus aucun tag GPS dans le WebP produit',
  execFileSync('exiftool', ['-a', '-G1', '-s', '-GPS:all', webpProduit], { encoding: 'utf8' }).trim() === '');
check('le WebP produit a exactement la taille de l\'original',
  statSync(webpProduit).size === statSync(webp).size);
const decodeWebp = await page.evaluate(async (donnees) => {
  const img = await createImageBitmap(new Blob([new Uint8Array(donnees)], { type: 'image/webp' }));
  return { l: img.width, h: img.height };
}, Array.from(readFileSync(webpProduit)));
check('le navigateur décode le WebP produit', decodeWebp.l > 0 && decodeWebp.h > 0,
  JSON.stringify(decodeWebp));

console.log('\nUn format resté en lecture seule');
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.setInputFiles('#picker', join(FIXTURES, 'simple.webp'));
await page.waitForSelector('#alerte-format:not([hidden])', { timeout: 20_000 });
const phrase = (await page.locator('#alerte-format').textContent()).trim();
check('la limite est annoncée avant toute action', phrase.length > 0, phrase.slice(0, 80));
check('la phrase reste sans jargon de format', !MOTS_INTERDITS.en.test(phrase), phrase.slice(0, 80));
// An inactive text field is `readonly`, not `disabled`: it stays focusable, is
// announced as read-only, and its content stays selectable.
check('le champ de saisie est en lecture seule',
  (await page.locator('#coords').getAttribute('readonly')) !== null);

/*
 * The "other information" panel, looked at at last.
 *
 * No test in the repository had ever opened it, for a video or for a photo. It
 * depended entirely on the second reader, which opens neither MOV nor MP4: a
 * video therefore had nothing to put in it and it disappeared, without anything
 * complaining.
 */
/*
 * The screen after a write, rather than the file produced.
 *
 * No check in the repository had ever looked there. We verified what the file
 * contains, never what the tool displays once it has written it: the screen
 * therefore kept the state of the file as loaded. After an add it showed no
 * location, and after an erase it still showed the one just removed, which on a
 * privacy tool is the worse of the two. Five reports went through that hole.
 */
console.log("\nL'écran dit ce que le fichier porte MAINTENANT");
const lieuAffiche = async () => {
  const pill = page.locator('#pill-position');
  const cache = await pill.getAttribute('hidden');
  const surPastille = cache === null ? (await pill.textContent()).trim() : '';
  // The panel is a disclosure: folded, its content is not rendered text. It has
  // to be opened to be read, as somebody consulting it would.
  let volet = '';
  if ((await page.locator('#autres').getAttribute('hidden')) === null) {
    await page.locator('#autres').evaluate((d) => { d.open = true; });
    volet = await page.locator('#autres-liste').innerText();
  }
  return { surPastille, volet };
};

for (const [fichier, coords, motif] of [
  ['sans-lieu.mp4', '43.90811, 4.86387', /43[.,]908/],
  ['Canon_40D.jpg', '43.90811, 4.86387', /43[.,]908/],
]) {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await page.setInputFiles('#picker', join(FIXTURES, fichier));
  await page.waitForSelector('#etat-actif:not([hidden])', { timeout: 60_000 });
  await page.fill('#coords', coords);
  await page.waitForSelector('#resultat:not([hidden])', { timeout: 20_000 });
  await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.click('#telecharger'),
  ]);
  // The screen has to catch up with the file: the reprobe is asynchronous.
  await page.waitForFunction(() => {
    const p = document.getElementById('pill-position');
    return p && !p.hidden && p.textContent.includes('43');
  }, null, { timeout: 30_000 }).catch(() => {});
  const { surPastille, volet } = await lieuAffiche();
  check(`${fichier} : le lieu écrit s'affiche sur la pastille`,
    motif.test(surPastille), surPastille || '(pastille cachée)');
  check(`${fichier} : et le volet porte sa ligne de lieu`,
    /Location/.test(volet), volet.replace(/\n/g, ' / ').slice(0, 90));
}

for (const fichier of ['DSCN0010.jpg', 'avec-lieu.mp4']) {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await page.setInputFiles('#picker', join(FIXTURES, fichier));
  await page.waitForSelector('#pill-position:not([hidden])', { timeout: 60_000 });
  await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.click('#effacer'),
  ]);
  await page.waitForFunction(() => {
    const p = document.getElementById('pill-position');
    return p && p.hidden;
  }, null, { timeout: 30_000 }).catch(() => {});
  const { surPastille, volet } = await lieuAffiche();
  // The direction that counts most: we have just clicked "remove the location".
  check(`${fichier} : après l'effacement, plus de lieu sur la pastille`,
    surPastille === '', surPastille);
  check(`${fichier} : ni de ligne de lieu dans le volet`,
    !/Location/.test(volet), volet.replace(/\n/g, ' / ').slice(0, 90));
}

console.log('\nLe volet des autres informations');
for (const [fichier, attendu] of [
  ['DSCN0010.jpg', /Camera/],
  ['piste-de-lieu.mp4', /Length/],
  ['sans-lieu.mp4', /Size/],
  // The simplest case there is, and it was verified nowhere: a video that
  // already carries a location, opened as is. The panel checks covered
  // duration, size, and the exotic boxes; the one everybody meets was missing.
  // The two most widespread boxes, an MP4's text atom and a QuickTime's named
  // keys, are here.
  ['avec-lieu.mp4', /Location/],
  ['avec-lieu.mov', /Location/],
  // The complaint, exactly as filed: the location is readable by a mobile tool
  // and did not appear here, because it is stored in the text packet the
  // standard places as a top-level box, where we were not looking.
  ['lieu-hors-piste.mp4', /Location/],
  // And the case where we cannot read the string. Staying silent then is what
  // cost five round trips: the tool knew where the field was, could see its
  // text, and displayed nothing. It now shows the string as written, so a
  // screenshot is enough to name the form we are missing.
  ['lieu-illisible.mp4', /43\.9081,4\.8639,26/],
]) {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await page.setInputFiles('#picker', join(FIXTURES, fichier));
  await page.waitForSelector('#etat-actif:not([hidden])', { timeout: 60_000 });
  await page.waitForFunction(() => {
    const d = document.getElementById('autres');
    return d && !d.hidden;
  }, null, { timeout: 30_000 }).catch(() => {});

  const present = (await page.locator('#autres').getAttribute('hidden')) === null;
  check(`${fichier} : le volet est proposé`, present);
  if (!present) continue;
  await page.locator('#autres > summary').click();
  const texte = (await page.locator('#autres-liste').innerText()).trim();
  check(`${fichier} : et il porte de quoi le remplir`, attendu.test(texte),
    texte.replace(/\n/g, ' / ').slice(0, 90));
}

console.log('\nUne vidéo dont le lieu bouge : lue, et pas touchée');
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.setInputFiles('#picker', join(FIXTURES, 'piste-de-lieu.mp4'));
await page.waitForSelector('#pill-position:not([hidden])', { timeout: 60_000 });
const phraseVideo = (await page.locator('#alerte-format').textContent()).trim();
check('la raison est annoncée avant toute action', phraseVideo.length > 0, phraseVideo.slice(0, 80));
check('elle reste sans jargon de format',
  !MOTS_INTERDITS.en.test(phraseVideo), phraseVideo.slice(0, 80));
// The main location does show, and that is the point: it is because we can read
// it that we have to say it is not the only one.
const luVideo = (await page.locator('#pill-position').textContent()).trim();
check('le lieu écrit par l\'appareil est bien affiché', /33\.12/.test(luVideo), luVideo);
check('mais le champ reste en lecture seule',
  (await page.locator('#coords').getAttribute('readonly')) !== null);
for (const bouton of ['#effacer', '#effacer-tout']) {
  check(`${bouton} est inactif sur une vidéo dont le lieu bouge`,
    (await page.locator(bouton).getAttribute('aria-disabled')) === 'true');
}

/*
 * The journey that was missing, and that would have caught the reported
 * failure.
 *
 * The old one stopped at the state of the interface: field live, buttons live.
 * That is exactly what the screenshot showed before the failure: the tool
 * offered, and did not deliver. As long as we do not click and do not pick up
 * the file, half the path is executed by nobody.
 */
console.log('\nUne vidéo sans lieu : ajout mené jusqu\'au fichier récupéré');
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.setInputFiles('#picker', join(FIXTURES, 'sans-lieu.mp4'));
await page.waitForSelector('#etat-actif:not([hidden])', { timeout: 60_000 });
check('le bouton est inactif tant qu\'aucun lieu n\'est saisi',
  (await page.locator('#telecharger').getAttribute('aria-disabled')) === 'true');

await page.fill('#coords', '43.90811, 4.86387');
await page.waitForSelector('#resultat:not([hidden])', { timeout: 20_000 });
check('le bouton devient actif', (await page.locator('#telecharger').getAttribute('aria-disabled')) === 'false');

await page.addInitScript(() => {
  const vrai = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (o) => { window.__typeProduit = o && o.type; return vrai(o); };
});
await page.reload({ waitUntil: 'networkidle' });
await page.setInputFiles('#picker', join(FIXTURES, 'sans-lieu.mp4'));
await page.waitForSelector('#etat-actif:not([hidden])', { timeout: 60_000 });
await page.fill('#coords', '43.90811, 4.86387');
await page.waitForSelector('#resultat:not([hidden])', { timeout: 20_000 });
const [videoDl] = await Promise.all([
  page.waitForEvent('download', { timeout: 60_000 }),
  page.click('#telecharger'),
]);
const typeAnnonce = await page.evaluate(() => window.__typeProduit);
const videoProduite = join('/tmp', videoDl.suggestedFilename());
await videoDl.saveAs(videoProduite);
check('un fichier est bien produit', statSync(videoProduite).size > 0);

/*
 * The advertised type, and not only the content.
 *
 * The produced file came out with no declared type. On a phone, a file filed
 * under downloads with no type is not indexed as a video: the gallery shows no
 * entry for it, and our own picker, restricted to images and videos, can stop
 * offering it. The file was perfect, and the user saw nothing. No check looked
 * at what the browser says about the file; this one does.
 */
check('le fichier produit s\'annonce comme une vidéo',
  typeAnnonce === 'video/mp4', typeAnnonce || '(aucun type)');

// And it goes back through the picker, which filters on that type.
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.setInputFiles('#picker', videoProduite);
await page.waitForSelector('#pill-position:not([hidden])', { timeout: 60_000 });
check('rechargé dans l\'outil, il montre le lieu écrit',
  /43\.908/.test((await page.locator('#pill-position').textContent()).trim()));

// And finally the words: no sentence may call a video a photo any more.
const zoneVideo = (await page.locator('#etat-actif').innerText()).toLowerCase();
check('aucune phrase n\'appelle « photo » une vidéo',
  !zoneVideo.includes('photo'),
  zoneVideo.split('\n').filter((l) => l.includes('photo')).slice(0, 3).join(' | '));

const reluVideo = execFileSync(
  'exiftool',
  ['-n', '-s', '-s', '-s', '-GPSLatitude', '-GPSLongitude', videoProduite],
  { encoding: 'utf8' },
).trim().split('\n').map(Number);
check('l\'oracle relit dans la vidéo le lieu demandé',
  Math.abs(reluVideo[0] - 43.90811) < 0.0001 && Math.abs(reluVideo[1] - 4.86387) < 0.0001,
  `relu ${reluVideo.join(', ')}`);
check('la vidéo reste lisible après le passage par le navigateur',
  execFileSync('exiftool', ['-s3', '-ImageSize', videoProduite], { encoding: 'utf8' }).trim()
    === execFileSync('exiftool', ['-s3', '-ImageSize', join(FIXTURES, 'sans-lieu.mp4')], { encoding: 'utf8' }).trim());

console.log('\nUne vidéo ordinaire : effacement mené jusqu\'au fichier récupéré');
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.setInputFiles('#picker', join(FIXTURES, 'avec-lieu.mp4'));
await page.waitForSelector('#pill-position:not([hidden])', { timeout: 60_000 });
check('le lieu de la vidéo est affiché',
  /43\.94/.test((await page.locator('#pill-position').textContent()).trim()));
check('et le champ accepte une saisie',
  (await page.locator('#coords').getAttribute('readonly')) === null);
check('l\'effacement est offert',
  (await page.locator('#effacer').getAttribute('aria-disabled')) !== 'true');

const [videoVide] = await Promise.all([
  page.waitForEvent('download', { timeout: 60_000 }),
  page.click('#effacer'),
]);
const videoNettoyee = join('/tmp', videoVide.suggestedFilename());
await videoVide.saveAs(videoNettoyee);
const residuVideo = execFileSync('exiftool', ['-a', '-ee', '-gps*', videoNettoyee], { encoding: 'utf8' }).trim();
check('l\'oracle ne trouve plus aucun lieu dans la vidéo', residuVideo === '', residuVideo.slice(0, 120));
check('et le fichier garde exactement sa taille',
  statSync(videoNettoyee).size === statSync(join(FIXTURES, 'avec-lieu.mp4')).size);

// The checks above only see the sentences these three files trigger. The
// journey has eleven, and it is the one we did not anticipate that will say
// "container" to the user.
console.log('\nAucune phrase du parcours ne porte de jargon');
const { MATRICE } = await import('../src/lib/exif/capacites.ts');
const { DICOS, LANGUES } = await import('../src/lib/i18n/index.ts');
const MOTIFS = [
  'ok', 'sans-lieu', 'sans-emplacement', 'forme-inhabituelle', 'rangement-inconnu',
  'copie-compressee', 'copie-ailleurs', 'lecture-seule', 'sans-lieu-possible',
  'lieu-en-mouvement', 'inconnu',
];
// Both languages, and every sentence of each: it is the sentence we did not
// anticipate that will say "container" to the user.
for (const langue of LANGUES) {
  const T = DICOS[langue];
  for (const motif of MOTIFS) {
    const p = T.motifs[motif];
    check(`${langue} / « ${motif} » : une phrase sans jargon`,
      Boolean(p) && !MOTS_INTERDITS[langue].test(p), (p ?? '(absente)').slice(0, 90));
  }
  for (const [code, p] of Object.entries(T.erreurs)) {
    check(`${langue} / erreur « ${code} » : sans jargon`,
      Boolean(p) && !MOTS_INTERDITS[langue].test(p), (p ?? '(absente)').slice(0, 90));
  }
  /*
   * The sentences for arrivals from the system. They appear in no served HTML,
   * since the script sets them when something has failed, so no page sweep sees
   * them go by.
   *
   * Named one by one rather than by walking all of `T.app`: that object also
   * carries filename suffixes, and `suffixeSansInfos` is "-sans-metadonnees".
   * That is not a sentence from the journey, and the rule is about sentences
   * from the journey.
   */
  for (const cle of ['partagePerdu', 'ouverturePerdue', 'installer', 'installee']) {
    const p = T.app[cle];
    check(`${langue} / « ${cle} » : une phrase sans jargon`,
      Boolean(p) && !MOTS_INTERDITS[langue].test(p), (p ?? '(absente)').slice(0, 90));
  }
  for (const cle of Object.keys(T.introuvable)) {
    const p = T.introuvable[cle];
    check(`${langue} / « introuvable.${cle} » : une phrase sans jargon`,
      Boolean(p) && !MOTS_INTERDITS[langue].test(p), (p ?? '(absente)').slice(0, 90));
  }
  for (const cle of ['ouvertureIncomplete', 'ajoutees', 'lotPlafonne']) {
    for (const n of [1, 3]) {
      const p = T.app[cle](n);
      check(`${langue} / « ${cle}(${n}) » : une phrase sans jargon`,
        Boolean(p) && !MOTS_INTERDITS[langue].test(p), (p ?? '(absente)').slice(0, 90));
    }
  }
}
check('les onze motifs du parcours sont couverts', MOTIFS.length === 11);
check('les deux langues ont exactement les mêmes clés',
  JSON.stringify(Object.keys(DICOS.en.erreurs).sort()) ===
    JSON.stringify(Object.keys(DICOS.fr.erreurs).sort()));
// The served table must be the one from the code, row for row.
const tableauServi = await page.locator('#limites ~ * table tbody tr').count()
  .catch(() => 0);
check('le tableau de la page a autant de lignes que le code en déclare',
  tableauServi === 0 || tableauServi === MATRICE.length, `${tableauServi} vs ${MATRICE.length}`);

console.log('\nLa version française est servie et reliée');
await page.goto(`http://127.0.0.1:${PORT}/fr/`, { waitUntil: 'networkidle' });
check('la page française déclare sa langue',
  (await page.locator('html').getAttribute('lang')) === 'fr');
check('elle affiche bien du français',
  (await page.locator('#outil h1').textContent()).includes('Changez le lieu'),
  (await page.locator('#outil h1').textContent()).trim());
check('elle pointe vers la version anglaise',
  (await page.locator('nav.main a[rel="alternate"]').getAttribute('href')) === '/');
const enHref = await page.locator('link[rel="alternate"][hreflang="en"]').getAttribute('href');
const frHref = await page.locator('link[rel="alternate"][hreflang="fr"]').getAttribute('href');
check('les deux langues sont déclarées réciproquement',
  enHref?.endsWith('/') && frHref?.endsWith('/fr/'), `${enHref} | ${frHref}`);
check('la page française est canonique sur elle-même',
  (await page.locator('link[rel="canonical"]').getAttribute('href')).endsWith('/fr/'));

/*
 * What we tell the engines, actually served.
 *
 * `check-build.mjs` reads these files from disk; here we request them, through
 * the same server and the same headers as everything else. It is the only way
 * to know that they answer: the sitemap spent a long time returning 404 while
 * `robots.txt` announced it, and nothing noticed.
 */
console.log('\nCe qu\'on dit aux moteurs');
const robots = await page.evaluate(() =>
  fetch('/robots.txt').then((r) => r.text().then((t) => ({ ok: r.ok, t }))));
check('robots.txt répond', robots.ok);
check('il laisse le site se faire parcourir',
  /User-agent:\s*\*/i.test(robots.t) && !/^\s*Disallow:\s*\S/im.test(robots.t));

const annonce = robots.t.match(/^\s*Sitemap:\s*(\S+)/im)?.[1];
check('il annonce un plan du site', Boolean(annonce), String(annonce));
const plan = await page.evaluate(
  (u) => fetch(new URL(u).pathname).then((r) => r.text().then((t) => ({ ok: r.ok, t }))),
  annonce);
check('et ce plan répond vraiment', plan.ok);

const locs = [...plan.t.matchAll(/<loc>([^<]*)<\/loc>/g)].map(([, u]) => u);
/*
 * The sitemap must announce every page produced. It announced two, and this
 * check required the number two. A number hard-coded in a test is a check that
 * becomes false the day the site grows, which is to say the day it would be
 * useful. So we count the pages actually built: a page added without being
 * announced brings the line down.
 */
const pagesProduites = (function liste(d) {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? liste(join(d, e.name)) : [join(d, e.name)],
  );
})(DIST).filter((f) => /(^|[\\/])index\.html$/.test(f)).length;
check('il annonce toutes les pages produites', locs.length === pagesProduites,
  `${locs.length} annoncées / ${pagesProduites} produites`);
check('les deux langues de l\'outil en font partie',
  locs.some((u) => new URL(u).pathname === '/') && locs.some((u) => new URL(u).pathname === '/fr/'));
const toutesLa = await page.evaluate(
  (l) => Promise.all(l.map((u) => fetch(new URL(u).pathname).then((r) => r.ok))),
  locs);
check('chaque adresse annoncée répond', toutesLa.every(Boolean));
check('aucune fréquence de mise à jour n\'est promise', !/<changefreq>/.test(plan.t));

/*
 * The guides, actually served.
 *
 * What is judged here is not the prose, which `check-build.mjs` handles, down
 * to counting the words. It is what a check on files cannot see: that a guide
 * opens, that it does not load the tool's island, and that the twin page it
 * announces in another language really exists.
 */
console.log('\nLes guides');
await page.goto(`http://127.0.0.1:${PORT}/guides/`, { waitUntil: 'networkidle' });
const listes = await page.locator('.liste-guides > li').count();
check('le sommaire liste des guides', listes >= 3, String(listes));
const premier = await page.locator('.liste-guides h2 a').first().getAttribute('href');
check('et chacun a une adresse propre', /^\/guides\/[a-z-]+\/$/.test(premier ?? ''), String(premier));

const avantGuide = requetes.length;
await page.goto(`http://127.0.0.1:${PORT}${premier}`, { waitUntil: 'networkidle' });
check('le guide répond et porte un titre', (await page.locator('h1').textContent()).trim().length > 10);
check('la réponse est donnée en tête', await page.locator('p.reponse').isVisible());
check("le fil d'Ariane compte trois marches",
  (await page.locator('nav.fil li').count()) === 3);
check("il ramène à l'outil", (await page.locator('a.brand[href="/"]').count()) > 0);
check('il ramène au sommaire', (await page.locator('nav.fil a[href="/guides/"]').count()) > 0);
check('il est canonique sur lui-même',
  (await page.locator('link[rel="canonical"]').getAttribute('href')).endsWith(premier));

/*
 * No script. Astro bundles hoisted scripts into a single package: the smallest
 * flourish imported by a guide's shell would pull all of `app.ts` in with it,
 * which is the code of a tool absent from the page. The check covers both
 * halves: no script tag, and no request for a module.
 */
const scriptsGuide = await page.evaluate(() =>
  [...document.querySelectorAll('script')].filter((s) => s.type !== 'application/ld+json').length);
check('un guide ne charge aucun script', scriptsGuide === 0, String(scriptsGuide));
const jsDuGuide = requetes.slice(avantGuide).filter((u) => /\/_astro\/.*\.js/.test(u));
check("et il n'en demande aucun au réseau", jsDuGuide.length === 0, jsDuGuide[0] ?? '');

const grapheGuide = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
const typesGuide = (grapheGuide['@graph'] ?? [grapheGuide]).map((n) => n['@type']);
check("un guide se décrit comme un article, avec son fil d'Ariane",
  ['Article', 'BreadcrumbList'].every((t) => typesGuide.includes(t)), typesGuide.join(', '));

const jumeauFr = await page.locator('link[rel="alternate"][hreflang="fr"]').getAttribute('href');
check('il annonce une adresse française sous /fr/guides/',
  new URL(jumeauFr).pathname.startsWith('/fr/guides/'), String(jumeauFr));
await page.goto(`http://127.0.0.1:${PORT}${new URL(jumeauFr).pathname}`, { waitUntil: 'networkidle' });
check('et cette page existe et est en français',
  (await page.locator('html').getAttribute('lang')) === 'fr');
check("elle renvoie réciproquement vers l'anglaise",
  (await page.locator('link[rel="alternate"][hreflang="en"]').getAttribute('href')).endsWith(premier));
check("son lien de langue mène au guide, pas à l'accueil",
  (await page.locator('nav.main a[rel="alternate"]').getAttribute('href')) === premier);

// The English page's canonical was verified nowhere.
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
const canonEn = await page.locator('link[rel="canonical"]').getAttribute('href');
check('la page anglaise est canonique sur elle-même', canonEn.endsWith('geotager.app/'), canonEn);
check('et son « og:url » dit la même chose',
  (await page.locator('meta[property="og:url"]').getAttribute('content')) === canonEn);

const graphe = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
const types = (graphe['@graph'] ?? [graphe]).map((n) => n['@type']);
check('les données structurées relient l\'application, le site et son éditeur',
  ['SoftwareApplication', 'WebSite', 'Organization'].every((t) => types.includes(t)),
  types.join(', '));

/*
 * The error page, reached by its path. A real 404 cannot be provoked here:
 * it is the host that walks up to the nearest "404.html", and this bench's
 * server does not imitate it. What is judged is therefore what depends on us,
 * the page itself, and not the setting that serves it.
 */
console.log('\nUne adresse qui ne mène nulle part');
for (const [chemin, retour] of [['/404.html', '/'], ['/fr/404.html', '/fr/']]) {
  await page.goto(`http://127.0.0.1:${PORT}${chemin}`, { waitUntil: 'load' });
  check(`${chemin} refuse d'être indexée`,
    (await page.locator('meta[name="robots"]').getAttribute('content')).includes('noindex'));
  check(`${chemin} dit ce qui se passe`,
    (await page.locator('h1').textContent()).trim().length > 5);
  check(`${chemin} ramène à l'outil`,
    (await page.locator(`a[href="${retour}"]`).count()) > 0);
  check(`${chemin} n'affiche pas le sélecteur de photo`,
    (await page.locator('#picker').count()) === 0);
}
await page.goto(`http://127.0.0.1:${PORT}/fr/`, { waitUntil: 'networkidle' });

// The journey must work identically in both languages: it is the same engine,
// and a translation must break nothing.
await page.setInputFiles('#picker', source);
await page.waitForSelector('#etat-actif:not([hidden])', { timeout: 15_000 });
await page.waitForFunction(() => {
  const p = document.getElementById('pill-position');
  return p && !p.hidden && p.textContent.trim().length > 0;
}, null, { timeout: 15_000 });
const pillFr = (await page.locator('#pill-position').textContent()).trim();
check('la position est lue aussi sur la page française', /Actuellement/.test(pillFr), pillFr);

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
check('la page anglaise déclare sa langue',
  (await page.locator('html').getAttribute('lang')) === 'en');
check('elle pointe vers la version française',
  (await page.locator('nav.main a[rel="alternate"]').getAttribute('href')) === '/fr/');

console.log('\nPreuve du zéro-tiers');
const horsOrigine = (liste) => liste.filter((u) => {
  if (u.startsWith('data:') || u.startsWith('blob:')) return false;
  return !u.startsWith(`http://127.0.0.1:${PORT}/`);
});
const tiers = horsOrigine(requetes);
check('aucune requête vers un domaine tiers sur un cycle complet', tiers.length === 0,
  tiers.slice(0, 3).join(' | '));
check("la carte n'a rien demandé : personne ne l'a ouverte", tuilesDemandees === 0);
console.log(`       ${requetes.length} requêtes, toutes vers l'origine du site`);
check('aucune erreur JavaScript sur tout le parcours', erreursConsole.length === 0,
  erreursConsole[0]);

/*
 * The boundary.
 *
 * Everything above happened with the map closed, and this check has stayed word
 * for word the one from before the map existed: it is the proof that the
 * feature really is optional. What follows happens with the map open, and the
 * promise changes shape there: "nothing leaves" becomes "nothing leaves until
 * you ask for it". The test has to say exactly that, or it validates a promise
 * other than the one written on the page.
 */
const FRONTIERE = requetes.length;

console.log('\nAccessibilité du chemin principal');
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
const focusable = await page.evaluate(() => {
  // `aria-disabled` removes nothing from the tab order, which is its whole
  // point. The selector must therefore stop excluding inactive controls.
  const sel = 'a[href],button,input:not([type="hidden"]),summary,[tabindex]:not([tabindex="-1"])';
  return [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null).length;
});
check('des éléments focalisables existent dès le HTML', focusable > 3, String(focusable));
check("la zone de dépôt est un label lié à un input de fichier",
  await page.evaluate(() => {
    const l = document.querySelector('label.bubble');
    return !!l && l.getAttribute('for') === 'picker' && !!document.getElementById('picker');
  }));
check('une région live existe pour les annonces',
  await page.locator('#annonce[aria-live="polite"]').count() === 1);

// All three landmarks were missing. Somebody navigating from landmark to
// landmark found only a navigation and a footer, never the tool.
const reperes = await page.evaluate(() => ({
  main: document.querySelectorAll('main').length,
  header: document.querySelectorAll('body > .app header.bar, header.bar').length,
  footer: document.querySelectorAll('footer').length,
  // A `footer` stops being "contentinfo" as soon as it is inside a `main`.
  footerDansMain: !!document.querySelector('main footer'),
  headerDansMain: !!document.querySelector('main header'),
}));
check('la page a exactement un repère principal', reperes.main === 1, String(reperes.main));
check('la bannière et le pied de page existent',
  reperes.header === 1 && reperes.footer === 1);
check('ni la bannière ni le pied ne sont enfermés dans le repère principal',
  !reperes.footerDansMain && !reperes.headerDansMain);
check("le lien d'évitement mène à l'outil, pas à la prose",
  (await page.locator('a.saut').getAttribute('href')) === '#outil');

// The iOS decimal pad carries no minus sign: no southern latitude or western
// longitude could be typed with a finger.
check("le champ de coordonnées n'impose plus de pavé décimal",
  (await page.locator('#coords').getAttribute('inputmode')) === null);

// The <h1> lived in the empty state and disappeared with it.
await page.setInputFiles('#picker', source);
await page.waitForFunction(() => !document.getElementById('etat-actif').hidden);
check("un titre de niveau 1 subsiste une fois la photo chargée",
  await page.evaluate(() => {
    const h = document.querySelector('h1');
    // `visually-hidden` stays in the tree; `hidden` does not.
    return !!h && h.offsetParent !== null || (!!h && !h.closest('[hidden]'));
  }));
check("le focus n'est pas retombé sur le corps du document",
  await page.evaluate(() => document.activeElement !== document.body));

/*
 * The very point of moving to `aria-disabled`: an inactive control stays
 * reachable. With `disabled` it left the tab order, and nobody could land on it
 * to learn why it did nothing.
 *
 * And it stays harmless: `aria-disabled` does not prevent the click, the
 * handler's guard does. The check therefore covers both halves: you reach it,
 * and reaching it triggers nothing.
 */
const inactifAtteignable = await page.evaluate(() => {
  const b = document.getElementById('telecharger');
  b.focus();
  return {
    inactif: b.getAttribute('aria-disabled') === 'true',
    focalise: document.activeElement === b,
    explique: !!document.getElementById(b.getAttribute('aria-describedby') ?? '')
      ?.textContent?.trim(),
  };
});
check('un bouton inactif reçoit tout de même le focus',
  inactifAtteignable.inactif && inactifAtteignable.focalise);
check("et il dit pourquoi il est inactif", inactifAtteignable.explique);

/*
 * Clicking it must do nothing. The event is dispatched rather than clicked:
 * Playwright refuses to act on an element carrying `aria-disabled="true"`,
 * which is in itself the best confirmation that the attribute is there, but
 * that caution belongs to the test tool, not to the application. What we want
 * to exercise here is the handler's guard, the only thing that protects a real
 * browser, where the click goes through.
 */
await page.locator('#telecharger').dispatchEvent('click');
await page.waitForTimeout(500);
check("cliquer un bouton inactif ne déclenche rien",
  await page.locator('#resultat').isHidden());

// And the same for the button that erases everything, on a file where the
// operation does not exist: that is the one whose guard really counts.
const effacerToutInactif = await page.evaluate(async () => {
  const b = document.getElementById('effacer-tout');
  if (b.getAttribute('aria-disabled') !== 'true') return 'actif ici';
  const avant = document.getElementById('lot-liste').children.length;
  b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  return document.getElementById('lot-liste').children.length === avant ? 'inerte' : 'a agi';
});
check("« Tout effacer » inactif reste inerte au clic",
  effacerToutInactif !== 'a agi', effacerToutInactif);

// A refused entry said nothing: the button greyed out, and that was all.
await page.fill('#coords', 'nulle part');
await page.locator('#coords').blur();
check("une saisie refusée est signalée",
  (await page.locator('#coords').getAttribute('aria-invalid')) === 'true');
check("le message d'erreur est visible et non vide",
  await page.locator('#coords-erreur').isVisible()
  && (await page.locator('#coords-erreur').textContent()).trim().length > 0);
check("le message d'erreur est relié au champ",
  (await page.locator('#coords').getAttribute('aria-describedby') ?? '').includes('coords-erreur'));
await page.fill('#coords', '43.9493, 4.8055');
await page.locator('#coords').blur();
check("elle cesse de l'être dès que la saisie redevient lisible",
  (await page.locator('#coords').getAttribute('aria-invalid')) === null
  && !(await page.locator('#coords-erreur').isVisible()));

/*
 * The headers the pages promise in so many words. They were served by the host
 * and asserted by nobody: one could be removed without a single check
 * complaining, and the prose would have gone on announcing them.
 *
 * They are read from `public/_headers`, so this check judges the file that
 * ships rather than a copy, but it requires each one to be present and to say
 * the right thing.
 */
/*
 * Outgoing share.
 *
 * Chromium without system integration has no file sharing: `canShare` says no,
 * the button stays hidden, and that is the correct behaviour, which is the
 * first thing verified. The rest is exercised on a separate page where the API
 * is simulated, because what matters is not that the sheet opens but what we
 * put in it: the produced file, never the original.
 */
/*
 * Axe, the automatic net.
 *
 * The accessibility checks in this file are written by hand: they state
 * precisely what is expected, and fail with a sentence you can understand. On
 * the other hand they only find what somebody thought of. Axe covers whole
 * families of rules nobody thought of.
 *
 * It is injected through `addInitScript`: `addScriptTag` would create an inline
 * script, which `script-src 'self'` refuses. This one goes through the
 * debugging protocol, out of reach of the page policy, which this test server
 * does serve, so the constraint is real.
 */
const AXE = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');

/*
 * Two rules are waived, by name, each for a written reason. A blanket list of
 * exemptions would make the whole check decorative.
 *
 * `color-contrast`: axe reads declared colours and cannot compose them. The
 * decoration is a `fixed` layer in `mix-blend-mode: screen` under text, and the
 * real ratios were measured and then recorded in `global.css`. Axe recomputes
 * them blind and gets them wrong in both directions. It is contrast that
 * governs the decoration's opacities, not the other way round; the measurement
 * stays manual.
 *
 * `aria-allowed-role` on the map view: `role="application"` there is a
 * deliberate choice, since the map consumes the arrow keys that a screen reader
 * in browse mode would take from it, and it comes with its instructions and a
 * fully keyboard-driven fallback, the coordinates field.
 */
const REGLES_ECARTEES = { 'color-contrast': { enabled: false } };

async function auditer(cible, nom) {
  await cible.evaluate(AXE);
  const resultat = await cible.evaluate(
    (regles) => window.axe.run(document, {
      rules: regles,
      resultTypes: ['violations'],
    }),
    REGLES_ECARTEES,
  );
  const graves = resultat.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  check(`axe : ${nom} — aucune violation grave`, graves.length === 0,
    graves.map((v) => `${v.id} (${v.nodes.length})`).join(', '));
  const mineures = resultat.violations.filter((v) => !['serious', 'critical'].includes(v.impact));
  if (mineures.length) {
    console.log(`       ${nom} — mineures : ${mineures.map((v) => v.id).join(', ')}`);
  }
  return resultat.violations;
}

console.log('\nAudit automatique (axe-core)');
/*
 * A separate context, with its own tile routing.
 *
 * The audit opens the map, so it requests tiles. In the main context those
 * incremented `tuilesDemandees`, the counter the proof "dropping a photo
 * requests no tile" rests on. The check failed, and for the worst possible
 * reason: not because the application was at fault, but because its own audit
 * had dirtied the witness. A proof a neighbouring test can falsify proves
 * nothing any more.
 */
const ctxAxe = await navigateur.newContext({ serviceWorkers: 'block' });
await ctxAxe.route(`https://${HOTE_TUILES}/**`, (route) =>
  route.fulfill({ status: 200, contentType: 'image/png', body: TUILE_PNG }));
const pageAxe = await ctxAxe.newPage();
await pageAxe.addInitScript({ content: AXE });

await pageAxe.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await auditer(pageAxe, 'accueil, état vide');

await pageAxe.setInputFiles('#picker', source);
await pageAxe.waitForSelector('#etat-actif:not([hidden])', { timeout: 15_000 });
await auditer(pageAxe, 'photo chargée');

await pageAxe.click('#carte-bascule');
await pageAxe.waitForSelector('#carte:not([hidden])');
await pageAxe.waitForTimeout(500);
await auditer(pageAxe, 'carte ouverte');

await pageAxe.goto(`http://127.0.0.1:${PORT}/fr/`, { waitUntil: 'networkidle' });
await auditer(pageAxe, 'version française');

// The guides have a shell of their own, with a breadcrumb, lists and tables, so
// they have their own ways of breaking. An audit looking only at the tool would
// leave fourteen pages out of reach of the automatic net.
await pageAxe.goto(`http://127.0.0.1:${PORT}/guides/`, { waitUntil: 'networkidle' });
await auditer(pageAxe, 'sommaire des guides');
await pageAxe.goto(`http://127.0.0.1:${PORT}/guides/social-networks-photo-location/`, {
  waitUntil: 'networkidle',
});
await auditer(pageAxe, 'un guide, avec son tableau');
await pageAxe.goto(`http://127.0.0.1:${PORT}/fr/guides/modifier-geolocalisation-photo/`, {
  waitUntil: 'networkidle',
});
await auditer(pageAxe, 'un guide français');
await ctxAxe.close();

console.log('\nPartager la photo nettoyée');
check("sans partage de fichiers, le bouton reste caché",
  await page.locator('#partager-sortie').isHidden());

const pagePartage = await contexte.newPage();
await pagePartage.addInitScript(() => {
  // `addInitScript` rather than `addScriptTag`: the latter injects an inline
  // script, which `script-src 'self'` refuses. This one goes through the
  // debugging protocol, out of reach of the page policy.
  window.__partages = [];
  navigator.canShare = () => true;
  navigator.share = async (donnees) => {
    window.__partages.push(
      (donnees.files ?? []).map((f) => ({ nom: f.name, taille: f.size })),
    );
  };
});
await pagePartage.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await pagePartage.setInputFiles('#picker', source);
await pagePartage.waitForSelector('#etat-actif:not([hidden])', { timeout: 15_000 });
await pagePartage.fill('#coords', '43.9493, 4.8055');
await pagePartage.waitForSelector('#resultat:not([hidden])');
const [dlPartage] = await Promise.all([
  pagePartage.waitForEvent('download'),
  pagePartage.click('#telecharger'),
]);
const produitPartage = join('/tmp', dlPartage.suggestedFilename());
await dlPartage.saveAs(produitPartage);

check("le bouton apparaît une fois un fichier produit",
  await pagePartage.locator('#partager-sortie').isVisible());
await pagePartage.click('#partager-sortie');
await pagePartage.waitForFunction(() => window.__partages.length > 0, null, { timeout: 5_000 });
const partages = await pagePartage.evaluate(() => window.__partages);

check("un seul fichier est partagé", partages[0].length === 1, JSON.stringify(partages[0]));
// The check: it is the produced photo that leaves, not the one we dropped.
check("c'est le fichier produit qui est partagé, pas l'original",
  partages[0][0].nom === dlPartage.suggestedFilename()
  && partages[0][0].nom !== 'DSCN0010.jpg',
  `${partages[0][0].nom} vs ${dlPartage.suggestedFilename()}`);
check("et ce sont bien ses octets",
  partages[0][0].taille === statSync(produitPartage).size,
  `${partages[0][0].taille} vs ${statSync(produitPartage).size}`);
// The shared file is the one ExifTool reads back with no position.
const [latPartage, lonPartage] = execFileSync(
  'exiftool',
  ['-n', '-s', '-s', '-s', '-GPSLatitude', '-GPSLongitude', produitPartage],
  { encoding: 'utf8' },
).trim().split('\n').map(Number);
check("le lieu qu'il porte est le nouveau, pas celui de l'origine",
  Math.abs(latPartage - 43.9493) < 0.0001 && Math.abs(lonPartage - 4.8055) < 0.0001,
  `${latPartage}, ${lonPartage}`);
await pagePartage.close();

console.log('\nLes en-têtes promis sont bien là');
for (const [nom, motif] of [
  ['Referrer-Policy', /^no-referrer$/],
  ['X-Frame-Options', /^DENY$/],
  ['X-Content-Type-Options', /^nosniff$/],
  ['Strict-Transport-Security', /max-age=\d{7,}/],
  ['Cross-Origin-Opener-Policy', /^same-origin$/],
  ['Cross-Origin-Resource-Policy', /^same-origin$/],
  ['Permissions-Policy', /geolocation=\(\)/],
]) {
  check(`« ${nom} » est servi et dit ce qu'il doit`,
    motif.test(EN_TETES[nom] ?? ''), EN_TETES[nom] ?? '(absent)');
}
// Geolocation is refused on purpose: that is why there is no "locate me"
// button, and the prose builds on it.
check('aucune fonction sensible n\'est laissée ouverte',
  ['camera', 'microphone', 'geolocation', 'browsing-topics', 'interest-cohort']
    .every((f) => (EN_TETES['Permissions-Policy'] ?? '').includes(`${f}=()`)));

console.log("\nLe manifeste et ses icônes");
for (const [base, langue, depart] of [['/', 'en', '/'], ['/fr/', 'fr', '/fr/']]) {
  await page.goto(`http://127.0.0.1:${PORT}${base}`, { waitUntil: 'networkidle' });
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  check(`${base} déclare son manifeste`, href === `${base}manifest.webmanifest`, String(href));

  // Fetched by the page itself: it is the only way to observe the MIME type and
  // the body the browser actually receives.
  const m = await page.evaluate(async (u) => {
    const r = await fetch(u);
    return { ok: r.ok, type: r.headers.get('content-type'), corps: await r.text() };
  }, href);
  check(`${base} sert un manifeste lisible`, m.ok && /manifest\+json/.test(m.type ?? ''), m.type);

  let json = null;
  try { json = JSON.parse(m.corps); } catch { /* json reste nul */ }
  check(`${base} sert du JSON valide`, json !== null);
  if (!json) continue;

  check(`${base} annonce la bonne langue et le bon départ`,
    json.lang === langue && json.start_url === depart,
    `${json.lang} / ${json.start_url}`);
  // Two URLs, a single `id`: that is what makes one installed application
  // rather than two, and what must never change.
  check(`${base} partage l'identité d'installation`, json.id === '/', String(json.id));
  check(`${base} reste dans sa portée`, json.scope === '/');
  check(`${base} porte une icône masquable`,
    (json.icons ?? []).some((i) => String(i.purpose ?? '').split(/\s+/).includes('maskable')));

  // An icon declared but not found is the quietest failure of the lot: nothing
  // shows before the home screen.
  const manquantes = await page.evaluate(
    (srcs) => Promise.all(srcs.map((s) => fetch(s).then((r) => (r.ok ? null : s)))),
    (json.icons ?? []).map((i) => i.src),
  );
  check(`${base} : toutes les icônes déclarées répondent`,
    manquantes.filter(Boolean).length === 0, String(manquantes.filter(Boolean)));
}

// `summary_large_image` was declared without a single image.
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
const og = await page.locator('meta[property="og:image"]').getAttribute('content');
check("une image de partage est déclarée", !!og && og.endsWith('/og.png'), String(og));
check("elle a un texte de remplacement",
  ((await page.locator('meta[property="og:image:alt"]').getAttribute('content')) ?? '').length > 10);
check("elle existe vraiment",
  await page.evaluate(() => fetch('/og.png').then((r) => r.ok)));

/*
 * The install button.
 *
 * A real install prompt cannot be provoked from a test: it comes from the
 * browser, which decides on criteria we do not drive. What follows can be, so
 * we hand the page exactly what the browser would hand it, and judge what it
 * does with it.
 *
 * The four locks behind "hidden if already installed" are judged separately, so
 * that none can fail silently behind another.
 */
console.log("\nProposer l'installation, et seulement quand elle est possible");

const POSER_INVITE = () => {
  // `addInitScript` rather than `addScriptTag`: the latter injects an inline
  // script, which `script-src 'self'` refuses. This one goes through the
  // debugging protocol, out of reach of the page policy.
  window.__invites = { prompt: 0, choix: null };
  window.__inviterInstall = () => {
    const e = new Event('beforeinstallprompt');
    e.prompt = () => {
      window.__invites.prompt++;
      return Promise.resolve();
    };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  };
  window.__installee = () => window.dispatchEvent(new Event('appinstalled'));
  // The bench's browser could answer whatever it likes to "is this application
  // installed?". We answer in its place, so that the "not installed" case is a
  // fact of the test rather than luck.
  navigator.getInstalledRelatedApps = async () => [];
};

const pageInstall = await contexte.newPage();
const erreursInstall = [];
pageInstall.on('pageerror', (e) => erreursInstall.push(String(e)));
pageInstall.on('console', (m) => {
  if (m.type() === 'error') erreursInstall.push(m.text());
});
await pageInstall.addInitScript(POSER_INVITE);
await pageInstall.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

// Lock 1: the default state is absent. That is what any browser issuing no
// prompt sees, and any already-installed application.
check("sans invitation, le bouton n'est pas là",
  await pageInstall.locator('#installer').isHidden());

// Lock 2: only the prompt reveals it.
await pageInstall.evaluate(() => window.__inviterInstall());
check("l'invitation du navigateur fait apparaître le bouton",
  await pageInstall.locator('#installer').isVisible());
check('et il est atteignable au clavier',
  await pageInstall.evaluate(() => {
    const b = document.getElementById('installer');
    b.focus();
    return document.activeElement === b;
  }));

await pageInstall.click('#installer');
check("cliquer demande l'installation au navigateur",
  (await pageInstall.evaluate(() => window.__invites.prompt)) === 1);
// A prompt is not replayed: a second call on the same event throws.
check('et le bouton s\'efface, l\'invitation étant consommée',
  await pageInstall.locator('#installer').isHidden());

// Lock 4: the install succeeds, the button goes away, and we say so.
await pageInstall.evaluate(() => window.__inviterInstall());
check('une nouvelle invitation le fait revenir',
  await pageInstall.locator('#installer').isVisible());
await pageInstall.evaluate(() => window.__installee());
check("une fois installée, le bouton disparaît",
  await pageInstall.locator('#installer').isHidden());
check('et le lecteur d\'écran l\'apprend',
  (await pageInstall.locator('#annonce').textContent()).includes('Geotager'));

/*
 * Lock 3: in the installed window, even a prompt must show nothing.
 * Playwright's `emulateMedia` does not know `display-mode`, so we fake
 * `matchMedia` before the island runs, which is exactly what the browser would
 * answer there.
 */
const pageInstallee = await contexte.newPage();
await pageInstallee.addInitScript(POSER_INVITE);
await pageInstallee.addInitScript(() => {
  const vrai = window.matchMedia.bind(window);
  window.matchMedia = (q) =>
    q.includes('display-mode') ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : vrai(q);
});
await pageInstallee.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await pageInstallee.evaluate(() => window.__inviterInstall());
check("dans la fenêtre installée, le bouton reste absent malgré l'invitation",
  await pageInstallee.locator('#installer').isHidden());
await pageInstallee.close();

/*
 * Lock 5: the browser answers that the application is already installed.
 *
 * It is the only lock that infers nothing: the other four rest on the absence
 * of a prompt or on the display mode, this one asks the question. It covers the
 * case the others let through: the application is installed, and the site is
 * reopened in an ordinary tab.
 */
const pageDejaPosee = await contexte.newPage();
await pageDejaPosee.addInitScript(POSER_INVITE);
await pageDejaPosee.addInitScript(() => {
  navigator.getInstalledRelatedApps = async () => [{ platform: 'webapp', url: '/manifest.webmanifest' }];
});
await pageDejaPosee.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await pageDejaPosee.evaluate(() => window.__inviterInstall());
check("quand le navigateur confirme l'installation, le bouton reste absent",
  await pageDejaPosee.locator('#installer').isHidden());
await pageDejaPosee.close();

const restantesInstall = erreursInstall.filter((e) => !/Failed to load resource|net::ERR_/.test(e));
check("aucune exception sur le chemin de l'installation",
  restantesInstall.length === 0, restantesInstall[0]);

console.log('\nLe décor est décoratif, et il l\'est aussi pour qui n\'en veut pas');
check('le décor est hors de l\'arbre d\'accessibilité',
  await page.evaluate(() => {
    const d = document.getElementById('decor');
    return !!d
      && d.getAttribute('aria-hidden') === 'true'
      && getComputedStyle(d).pointerEvents === 'none'
      && d.querySelectorAll('[tabindex],a,button,input').length === 0;
  }));
// The shape is computed at build time by the same module as the loop: it is
// therefore already in the served HTML, and nothing appears on startup.
const tracesServies = await page.locator('#decor path[d]').count();
check('la forme est déjà dessinée dans le HTML servi', tracesServies === 4, String(tracesServies));

// The stylesheet's blanket rule only cuts CSS animations. A rAF loop escapes
// it: it is up to the script to read the preference, and that is precisely what
// this check verifies.
{
  const calme = await navigateur.newContext({ reducedMotion: 'reduce' });
  const pageCalme = await calme.newPage();
  await pageCalme.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  const avant = await pageCalme.locator('#decor path').first().getAttribute('d');
  await pageCalme.waitForTimeout(2000);
  const apres = await pageCalme.locator('#decor path').first().getAttribute('d');
  const grave = readFileSync(join(DIST, 'index.html'), 'utf8').match(/d="(M[^"]*)"/)[1];
  check('« moins de mouvement » : la forme ne bouge pas', avant === apres);
  check('« moins de mouvement » : c\'est l\'image gravée au build', avant === grave);
  await calme.close();
}

console.log('\nLa carte : rien avant le clic, un seul hôte après');
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

// An image refused by the security policy does not fail on the network side: it
// raises `securitypolicyviolation`. It is the only way to name the offending
// directive instead of reading a sentence from Chromium.
await page.evaluate(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation',
    (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
});

await page.setInputFiles('#picker', source);
await page.waitForSelector('#etat-actif:not([hidden])', { timeout: 15_000 });

check('la carte est repliée à l\'arrivée',
  (await page.locator('#carte-bascule').getAttribute('aria-expanded')) === 'false');
check("déposer une photo ne demande toujours aucune tuile", tuilesDemandees === 0);

const avantOuverture = requetes.length;
await page.click('#carte-bascule');
await page.waitForSelector('#carte:not([hidden])');
await page.waitForFunction(() => document.querySelectorAll('#carte-vue img').length > 3,
  null, { timeout: 15_000 });

check('des tuiles sont demandées après le clic, et pas avant', tuilesDemandees > 0,
  String(tuilesDemandees));
const apresOuverture = horsOrigine(requetes.slice(avantOuverture));
check("le seul hôte tiers atteint est celui que le code déclare",
  apresOuverture.length > 0 && apresOuverture.every((u) => new URL(u).host === HOTE_TUILES),
  apresOuverture.find((u) => new URL(u).host !== HOTE_TUILES) ?? '');
check('toutes les tuiles passent par https', apresOuverture.every((u) => u.startsWith('https://')));
check('le bouton annonce que la carte est ouverte',
  (await page.locator('#carte-bascule').getAttribute('aria-expanded')) === 'true');
check("l'attribution est visible dès que la carte l'est",
  await page.locator('#carte a[href*="openstreetmap.org/copyright"]').isVisible());

/*
 * The marker must land inside the map, at the centre, and its position is
 * computed in JavaScript. A `rotate` property set in CSS on the same element
 * once sent it 275 px above the frame: individual transform properties apply
 * before `transform`, and the script's translation ended up rotated. Nothing
 * reported it, neither the console, nor the CSP, nor a test. This one would.
 */
check('le repère tombe au centre de la carte, et non à côté', await page.evaluate(() => {
  const v = document.getElementById('carte-vue').getBoundingClientRect();
  const r = document.querySelector('.carte-repere').getBoundingClientRect();
  const dx = (r.left + r.width / 2) - (v.left + v.width / 2);
  const dy = (r.top + r.height / 2) - (v.top + v.height / 2);
  return Math.abs(dx) < 4 && Math.abs(dy) < 4;
}), await page.evaluate(() => {
  const v = document.getElementById('carte-vue').getBoundingClientRect();
  const r = document.querySelector('.carte-repere').getBoundingClientRect();
  return `repère ${Math.round(r.left)},${Math.round(r.top)} · carte ${Math.round(v.left)},${Math.round(v.top)} ${Math.round(v.width)}×${Math.round(v.height)}`;
}));

// The click places the marker, and the marker fills the field.
const vue = await page.locator('#carte-vue').boundingBox();
await page.mouse.click(vue.x + vue.width * 0.62, vue.y + vue.height * 0.38);
await page.waitForFunction(() => document.getElementById('coords').value.trim().length > 0,
  null, { timeout: 5_000 });
const saisi = await page.locator('#coords').inputValue();
check('un clic sur la carte remplit le champ de coordonnées',
  /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(saisi), saisi);
check('le récapitulatif est apparu', !(await page.locator('#resultat').isHidden()));
check('le bouton de téléchargement est actif',
  (await page.locator('#telecharger').getAttribute('aria-disabled')) === 'false');

// The map is operable without a mouse: that is the condition for it to be
// anything other than an ornament.
await page.focus('#carte-vue');
await page.keyboard.press('ArrowRight');
await page.waitForFunction((v) => document.getElementById('coords').value !== v, saisi,
  { timeout: 3_000 });
check('les flèches déplacent le point visé', (await page.locator('#coords').inputValue()) !== saisi);

// Zoom changes the announced precision, and so what will be written to the file.
await page.click('#carte-plus');
/*
 * Pinch. `touch-action: none` disables the browser's zoom on the map, and
 * nothing replaced it: two fingers did strictly nothing, and the only zoom
 * controls were two buttons, the gesture nobody uses on a phone.
 *
 * The events are synthesised: Playwright drives a single contact point, and
 * what is judged here is the two-pointer logic.
 */
/* The zoom level is read from the tile address: /{z}/{x}/{y}.png. */
const zoomServi = async () => {
  const src = await page.locator('.carte-tuile').first().getAttribute('src');
  return Number(src.match(/\/(\d+)\/\d+\/\d+\.png/)[1]);
};
const avantPincement = await zoomServi();
const coordsAvantPincement = await page.locator('#coords').inputValue();

await page.evaluate(() => {
  const vue = document.getElementById('carte-vue');
  const r = vue.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const ev = (type, id, x, y) => vue.dispatchEvent(new PointerEvent(type, {
    pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch',
  }));
  // Two fingers 40 px apart, spread to 160 px: two doublings, so two zoom
  // steps.
  ev('pointerdown', 101, cx - 20, cy);
  ev('pointerdown', 102, cx + 20, cy);
  ev('pointermove', 101, cx - 80, cy);
  ev('pointermove', 102, cx + 80, cy);
  ev('pointerup', 101, cx - 80, cy);
  ev('pointerup', 102, cx + 80, cy);
});
await page.waitForTimeout(300);
const apresPincement = await zoomServi();
check("deux doigts qui s'écartent rapprochent vraiment la carte",
  apresPincement > avantPincement, `${avantPincement} → ${apresPincement}`);

/*
 * A pinch is not a click: it must not carry the chosen point off to where the
 * fingers landed. It does move it by a hair, since `zoomer` re-anchors the view
 * and the number is rewritten to five decimals, so we judge the distance rather
 * than string equality. A misread click would have jumped several hundredths of
 * a degree, which is kilometres.
 */
const [latAv, lonAv] = coordsAvantPincement.split(',').map(Number);
const [latAp, lonAp] = (await page.locator('#coords').inputValue()).split(',').map(Number);
check("le pincement ne se prend pas pour un clic",
  Math.abs(latAp - latAv) < 0.01 && Math.abs(lonAp - lonAv) < 0.01,
  `${coordsAvantPincement} → ${latAp}, ${lonAp}`);

check('le zoom reste opérable au clavier comme à la souris',
  await page.locator('#carte-plus').isVisible());

check('aucune violation de la politique de sécurité pendant la carte',
  (await page.evaluate(() => window.__csp)).length === 0,
  (await page.evaluate(() => window.__csp))[0]);

// Closing must give everything back: no tile left in the document, no request left.
const avantFermeture = tuilesDemandees;
await page.click('#carte-bascule');
check('refermer retire les tuiles du document',
  (await page.locator('#carte-vue img').count()) === 0);
check('refermer ne déclenche plus aucune requête', tuilesDemandees === avantFermeture);
check('la carte fermée le dit',
  (await page.locator('#carte-bascule').getAttribute('aria-expanded')) === 'false');

check('aucune erreur JavaScript sur le parcours de la carte', erreursConsole.length === 0,
  erreursConsole[0]);
console.log(`       ${requetes.length - FRONTIERE} requêtes depuis l'ouverture, ${tuilesDemandees} tuiles`);

/*
 * The other half of the proof: the exception is for one host, not for a loose
 * "https:". No network is needed, since the policy refuses before the request
 * is even issued.
 *
 * This check comes last in the section, and its refusal is then removed from
 * the log: a violation provoked on purpose writes to the console, and the suite's
 * "no errors" check would take it for real damage. We remove it by naming
 * precisely the host we invented, never by emptying the log, since emptying
 * would also erase what we did not see coming.
 */
const HOTE_TEST = 'https://hote-interdit.invalid/tuile.png';
const refus = await page.evaluate((cible) => new Promise((resolve) => {
  document.addEventListener('securitypolicyviolation',
    (e) => resolve(`${e.violatedDirective} ${e.blockedURI}`), { once: true });
  const i = new Image();
  i.src = cible;
  setTimeout(() => resolve(''), 2000);
}), HOTE_TEST);
check("un autre hôte d'image reste refusé par la politique", refus.startsWith('img-src'),
  refus || '(aucune violation levée)');
for (let i = erreursConsole.length - 1; i >= 0; i--) {
  if (erreursConsole[i].includes('hote-interdit.invalid')) erreursConsole.splice(i, 1);
}

/*
 * The map chunk is missing.
 *
 * It is deliberately not precached by the service worker, so offline it is not
 * there and the dynamic import fails. The rejection was caught nowhere: you
 * were left with an open panel, a button saying "Close the map", an empty frame
 * and a console error nobody reads.
 *
 * The failure is provoked by refusing the request rather than by cutting the
 * network: it is the only way to make it a deterministic check.
 */
console.log("\nLe morceau de la carte manque, et l'outil le dit");
await contexte.route('**/_astro/carte*.js', (route) => route.abort('failed'));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.setInputFiles('#picker', source);
await page.waitForSelector('#etat-actif:not([hidden])', { timeout: 15_000 });
const avantEchecCarte = erreursConsole.length;
await page.click('#carte-bascule');
await page.waitForTimeout(1_500);
check("l'indisponibilité de la carte est DITE, et non subie",
  await page.locator('#carte-erreur').isVisible());
check('le message renvoie vers la saisie, qui elle fonctionne',
  ((await page.locator('#carte-erreur').textContent()) ?? '').length > 20);
check('le cadre vide ne reste pas à l\'écran',
  !(await page.locator('.carte-cadre').isVisible()));
check("saisir des coordonnées marche toujours",
  await page.evaluate(async () => {
    const c = document.getElementById('coords');
    c.value = '48.8584, 2.2945';
    c.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    return document.getElementById('telecharger').getAttribute('aria-disabled') === 'false';
  }));
const nouvelles = erreursConsole.slice(avantEchecCarte)
  .filter((e) => !/Failed to load resource|net::ERR_/.test(e));
check("aucune exception ne s'échappe du chargement raté",
  nouvelles.length === 0, nouvelles[0]);
await contexte.unroute('**/_astro/carte*.js');

/*
 * And with no network? The page promises the tool works in full with the
 * connection cut. The map cannot: it therefore has to settle for staying empty,
 * without taking anything with it. A map that threw would bring `app.ts` down,
 * and the "no errors" check above would report the damage in a section that has
 * nothing to do with it.
 */
console.log('\nLa carte hors ligne se contente de rester vide');
await contexte.unroute(`https://${HOTE_TUILES}/**`);
await contexte.route(`https://${HOTE_TUILES}/**`, (route) => route.abort('failed'));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.setInputFiles('#picker', source);
await page.waitForSelector('#etat-actif:not([hidden])', { timeout: 15_000 });
await page.click('#carte-bascule');
await page.waitForSelector('#carte:not([hidden])');
await page.fill('#coords', '48.8584, 2.2945');
await page.waitForFunction(() => !document.getElementById('resultat').hidden, null,
  { timeout: 5_000 });
check('sans tuile, la saisie au clavier fonctionne toujours',
  (await page.locator('#telecharger').getAttribute('aria-disabled')) === 'false');

/*
 * The browser logs every image that does not arrive: `net::ERR_FAILED`. That is
 * not an application error, it is the observation of an absent connection, and
 * it is exactly what we provoked. What is verified here is that nothing is
 * added to it: no exception, no `undefined`, no handler blowing up because a
 * tile is missing. So we discard the loading lines, one by one, and require the
 * rest to be empty.
 */
const restantes = erreursConsole.filter(
  (e) => !/Failed to load resource|net::ERR_/.test(e),
);
check("une tuile qui n'arrive pas n'emporte rien avec elle", restantes.length === 0,
  restantes[0]);

/*
 * The service worker, in a separate context, since the one above blocks them.
 *
 * What is judged here is not that a worker registers: it is that the tool works
 * with the connection cut. The page has always promised it; until now an
 * offline reload gave nothing at all, for want of anybody keeping the shell.
 */
console.log('\nHors ligne, pour de bon');
const ctxSw = await navigateur.newContext();
const pageSw = await ctxSw.newPage();
const erreursSw = [];
pageSw.on('pageerror', (e) => erreursSw.push(String(e)));
pageSw.on('console', (m) => {
  if (m.type() === 'error') erreursSw.push(m.text());
});

await pageSw.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
const controle = await pageSw
  .waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20_000 })
  .then(() => true)
  .catch(() => false);
check('le service worker prend le contrôle de la page', controle);

// The cut is real: nothing leaves any more, not even to the origin.
await ctxSw.setOffline(true);
await pageSw.reload({ waitUntil: 'load' });
check('hors ligne, la page s\'ouvre encore',
  await pageSw.locator('#etat-vide').isVisible());
check('hors ligne, la feuille de style est là aussi',
  await pageSw.evaluate(() => getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)'));

/*
 * The real check. The reading worker is loaded by `new Worker(new URL(…))` and
 * therefore appears in no tag: if it fell out of the precache list, the page
 * would open offline and refuse every photo, without a word. That is the
 * failure this check exists to catch.
 */
await pageSw.setInputFiles('#picker', source);
await pageSw.waitForSelector('#etat-actif:not([hidden])', { timeout: 20_000 });
const lueHorsLigne = await pageSw
  .waitForFunction(() => {
    const p = document.getElementById('pill-position');
    return p && !p.hidden && p.textContent.trim().length > 0;
  }, null, { timeout: 20_000 })
  .then(() => true)
  .catch(() => false);
check('hors ligne, une photo est encore lue de bout en bout', lueHorsLigne);

// The map chunk is deliberately not precached: opening it offline without ever
// having opened it online cannot work, and above all must not take the
// application down with it.
/*
 * Opening the map offline must take nothing with it. What exactly becomes of
 * the chunk depends on the environment, since depending on the version
 * Playwright's cut does or does not reach requests issued by the service worker
 * itself, so all that is judged here is harmlessness. The failure path proper
 * is exercised above, deterministically.
 */
await pageSw.click('#carte-bascule').catch(() => {});
await pageSw.waitForTimeout(1_500);
const restantesSw = erreursSw.filter((e) => !/Failed to load resource|net::ERR_|FetchEvent/.test(e));
check("la carte indisponible hors ligne n'emporte rien avec elle",
  restantesSw.length === 0, restantesSw[0]);

/*
 * Incoming share.
 *
 * The system sends the photo as a multipart POST, and no server receives it:
 * the service worker intercepts it, keeps the bytes in memory, redirects, and
 * the page comes to claim them. It is the whole path that is exercised here. We
 * cannot trigger the system share menu from a test, but everything that happens
 * afterwards, we can.
 *
 * The POST comes from a `fetch` rather than a form: the site policy carries
 * `form-action 'none'`, so a form on our own page would be refused. A real
 * share is not one, since it comes from the system, and the worker only
 * distinguishes the method and the path anyway.
 */
await ctxSw.setOffline(false);
console.log('\nUne photo partagée depuis le système');

const octetsPhoto = readFileSync(source).toString('base64');
const redirection = await pageSw.evaluate(async (b64) => {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const fd = new FormData();
  fd.append('photos', new File([bin], 'partagee.jpg', { type: 'image/jpeg' }));
  const r = await fetch('/partager', { method: 'POST', body: fd, redirect: 'manual' });
  return { type: r.type, status: r.status, url: r.url };
}, octetsPhoto);
check('la cible de partage répond sans serveur',
  redirection.status === 303 || redirection.type === 'opaqueredirect',
  `${redirection.status} / ${redirection.type}`);

// The worker keeps the bytes; the page claims them on arriving at ?partage=1.
await pageSw.goto(`http://127.0.0.1:${PORT}/?partage=1`, { waitUntil: 'load' });
const recue = await pageSw
  .waitForFunction(() => {
    const n = document.getElementById('nom-fichier');
    return n && n.textContent.includes('partagee');
  }, null, { timeout: 20_000 })
  .then(() => true)
  .catch(() => false);
check('la photo partagée arrive dans l\'outil', recue);
check("le paramètre est retiré de l'adresse",
  !pageSw.url().includes('partage='), pageSw.url());
const positionPartagee = await pageSw
  .waitForFunction(() => {
    const p = document.getElementById('pill-position');
    return p && !p.hidden && p.textContent.trim().length > 0;
  }, null, { timeout: 20_000 })
  .then(() => true)
  .catch(() => false);
check('elle est lue comme n\'importe quelle autre', positionPartagee);

/*
 * Rendered once, and once only. Without that, a reload would bring back a photo
 * the user thought they had closed, and the worker would hold its bytes in
 * memory with nothing coming to fetch them.
 */
await pageSw.goto(`http://127.0.0.1:${PORT}/?partage=1`, { waitUntil: 'load' });
await pageSw.waitForTimeout(1_500);
check('un second appel ne rend pas la photo une deuxième fois',
  await pageSw.locator('#etat-vide').isVisible());
check("et il l'explique au lieu de laisser une page muette",
  await pageSw.locator('#avis-vide').isVisible());

const restantesPartage = erreursSw.filter((e) => !/Failed to load resource|net::ERR_|FetchEvent/.test(e));
check('aucune exception sur le chemin du partage',
  restantesPartage.length === 0, restantesPartage[0]);

await ctxSw.close();

/*
 * "Open with", actually played through.
 *
 * The system hands over file handles and nothing else: no parameter in the
 * address, no bytes kept anywhere, nothing to claim from anybody. What is not
 * caught at that instant is lost, and it was lost without a word.
 *
 * The system menu cannot be triggered from a test. Everything that happens
 * afterwards can be: the launch queue is set before the island runs, and we
 * hand it exactly what the system would.
 */
const POSER_FILE = () => {
  // `addInitScript` rather than `addScriptTag`: the latter injects an inline
  // script, which `script-src 'self'` refuses. This one goes through the
  // debugging protocol, out of reach of the page policy.
  //
  // `defineProperty` rather than an assignment: the day the platform defines
  // `launchQueue` as a getter with no setter, an assignment would fail without a
  // word and the test would start passing for nothing.
  let consommateur = null;
  Object.defineProperty(window, 'launchQueue', {
    configurable: true,
    value: {
      setConsumer(f) {
        consommateur = f;
      },
    },
  });
  // A handle is an object that can return a file, and nothing more. The bytes
  // arrive in base64, which is a call argument, so the content policy has
  // nothing to say about it.
  window.__lancer = (lot) =>
    consommateur({
      files: lot.map((p) => ({
        kind: 'file',
        getFile: p.refuse
          ? () => Promise.reject(new DOMException('déplacée', 'NotFoundError'))
          : () =>
              Promise.resolve(
                new File(
                  [p.b64 ? Uint8Array.from(atob(p.b64), (c) => c.charCodeAt(0)) : new Uint8Array(0)],
                  p.nom,
                  { type: 'image/jpeg' },
                ),
              ),
      })),
    });
  window.__lancerSansFichier = () => consommateur({ files: [] });
};

const octetsLancement = readFileSync(source).toString('base64');

console.log('\nUne photo ouverte depuis le système');
const pageLance = await contexte.newPage();
const erreursLance = [];
pageLance.on('pageerror', (e) => erreursLance.push(String(e)));
pageLance.on('console', (m) => {
  if (m.type() === 'error') erreursLance.push(m.text());
});
await pageLance.addInitScript(POSER_FILE);
await pageLance.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

await pageLance.evaluate((b64) => window.__lancer([{ b64, nom: 'ouverte-avec.jpg' }]), octetsLancement);
const arrivee = await pageLance
  .waitForFunction(
    () => {
      const n = document.getElementById('nom-fichier');
      return n && n.textContent.includes('ouverte-avec');
    },
    null,
    { timeout: 20_000 },
  )
  .then(() => true)
  .catch(() => false);
check("une photo ouverte depuis le système arrive dans l'outil", arrivee);
check('et elle est lue comme n’importe quelle autre',
  await pageLance
    .waitForFunction(
      () => {
        const p = document.getElementById('pill-position');
        return p && !p.hidden && p.textContent.trim().length > 0;
      },
      null,
      { timeout: 20_000 },
    )
    .then(() => true)
    .catch(() => false));

/*
 * The second opening joins the first. It used to erase it: `charger` reset
 * `items` without asking, and forty un-exported photos vanished because a
 * forty-first had been opened.
 */
await pageLance.fill('#coords', '43.9493, 4.8055');
await pageLance.evaluate((b64) => window.__lancer([{ b64, nom: 'deuxieme.jpg' }]), octetsLancement);
await pageLance
  .waitForFunction(() => document.querySelectorAll('#lot-liste li').length === 2, null, { timeout: 20_000 })
  .catch(() => {});
const lot = await pageLance.locator('#lot-liste').textContent();
check("une seconde ouverture n'efface pas la première",
  lot.includes('ouverte-avec') && lot.includes('deuxieme'), lot.slice(0, 80));
check('et le lieu déjà désigné reste désigné',
  (await pageLance.locator('#coords').inputValue()).includes('43.9493'));

/*
 * Clicking the application icon also goes through the launch queue, with no
 * file at all. `focus-existing` hands it to the open window like everything
 * else: announcing "this photo did not arrive" on every click of the icon would
 * be a lie told very regularly.
 */
await pageLance.evaluate(() => window.__lancerSansFichier());
await pageLance.waitForTimeout(800);
check('un lancement sans fichier ne fait croire à rien',
  (await pageLance.locator('#avis-vide').isHidden()) &&
    (await pageLance.locator('#lot-liste li').count()) === 2);

console.log('\nUne ouverture qui n’apporte rien le dit');
const pageRien = await contexte.newPage();
const erreursRien = [];
pageRien.on('pageerror', (e) => erreursRien.push(String(e)));
pageRien.on('console', (m) => {
  if (m.type() === 'error') erreursRien.push(m.text());
});
await pageRien.addInitScript(POSER_FILE);
await pageRien.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

/*
 * Zero bytes. Remote storage mounted as a local folder returns files of zero
 * length until it has pulled them down: they were discarded twice in a row, and
 * the window stayed empty and silent.
 */
await pageRien.evaluate(() => window.__lancer([{ nom: 'rien.jpg' }]));
const ditRien = await pageRien
  .waitForSelector('#avis-vide:not([hidden])', { timeout: 10_000 })
  .then(() => true)
  .catch(() => false);
check("une photo sans octets le dit, au lieu de laisser une fenêtre vide", ditRien);
const phraseRien = (await pageRien.locator('#avis-vide').textContent()).trim();
check('et elle le dit aussi à voix haute',
  (await pageRien.locator('#annonce').textContent()).trim() === phraseRien);
check('la phrase reste sans jargon de format', !MOTS_INTERDITS.en.test(phraseRien), phraseRien.slice(0, 80));
check("l'état actif reste masqué", await pageRien.locator('#etat-actif').isHidden());

// One unhappy handle no longer takes the batch with it: that is the whole point of the change.
await pageRien.evaluate(
  (b64) => window.__lancer([{ refuse: true, nom: 'partie.jpg' }, { b64, nom: 'restee.jpg' }]),
  octetsLancement,
);
check("une photo déplacée n'emporte pas celles qui sont restées",
  await pageRien
    .waitForFunction(
      () => {
        const n = document.getElementById('nom-fichier');
        return n && n.textContent.includes('restee');
      },
      null,
      { timeout: 20_000 },
    )
    .then(() => true)
    .catch(() => false));

// And a wholly unhappy batch says so, in the channel that is on screen: the
// active state is displayed, so `#avis-vide` would be visible nowhere in it.
await pageRien.evaluate(() => window.__lancer([{ refuse: true, nom: 'toutes-parties.jpg' }]));
check('un lot entièrement perdu le dit là où on le voit',
  await pageRien
    .waitForFunction(
      () => {
        const a = document.getElementById('alerte-format');
        return a && !a.hidden && a.classList.contains('grave');
      },
      null,
      { timeout: 10_000 },
    )
    .then(() => true)
    .catch(() => false));

const restantesLance = [...erreursLance, ...erreursRien].filter(
  (e) => !/Failed to load resource|net::ERR_/.test(e),
);
check("aucune exception, et aucun rejet non traité, sur le chemin de l'ouverture",
  restantesLance.length === 0, restantesLance[0]);

/*
 * The first-launch race, the reported failure, in a context of its own.
 *
 * A fresh context: no worker is registered in it, so the document loads without
 * a controller. The worker registers on load, activates, claims its clients,
 * and the page used to reload. The launch files, handed over once and only
 * once, had already been consumed: the window came back empty and silent.
 *
 * The `ctxSw` above cannot judge this: it waits to be controlled and then
 * reloads itself, which is precisely the state where the race does not happen.
 */
console.log('\nLe premier lancement, worker non installé');
const ctxCourse = await navigateur.newContext();
const pageCourse = await ctxCourse.newPage();
let chargementsCourse = 0;
pageCourse.on('load', () => chargementsCourse++);
await pageCourse.addInitScript(POSER_FILE);
await pageCourse.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
check("le document du premier lancement n'est pas contrôlé",
  await pageCourse.evaluate(() => navigator.serviceWorker.controller === null));

await pageCourse.evaluate((b64) => window.__lancer([{ b64, nom: 'premier-lancement.jpg' }]), octetsLancement);
const prisLeControle = await pageCourse
  .waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20_000 })
  .then(() => true)
  .catch(() => false);
check('le worker prend le contrôle de la page', prisLeControle);
await pageCourse.waitForTimeout(2_000);
check("le worker qui prend la main ne recharge pas une page qui n'a rien demandé",
  chargementsCourse === 1, `${chargementsCourse} chargement(s)`);
check('et la photo du premier lancement est toujours là',
  (await pageCourse.locator('#nom-fichier').textContent()).includes('premier-lancement'));

await ctxCourse.close();

await navigateur.close();
serveur.close();

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed === 0 ? 0 : 1);
