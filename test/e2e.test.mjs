/**
 * Vérification de bout en bout, dans un vrai navigateur.
 *
 * Ce test ne regarde pas le code : il pilote l'application comme le ferait un
 * utilisateur, récupère le fichier réellement téléchargé, et le fait relire par
 * ExifTool. Il journalise aussi toutes les requêtes réseau émises par la page —
 * c'est la seule preuve recevable de la promesse « rien ne sort du navigateur ».
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const DIST = 'dist';
const FIXTURES = process.env.FIXTURES ?? 'test/fixtures';
const PORT = 4319;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
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
  let f = join(DIST, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  if (!existsSync(f) || !statSync(f).isFile()) {
    res.writeHead(404).end('non trouvé');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => serveur.listen(PORT, r));

// L'environnement fournit Chromium à un emplacement fixe ; la version de
// Playwright installée en attend un autre. On pointe explicitement dessus
// plutôt que de télécharger un second navigateur.
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const navigateur = await chromium.launch(
  existsSync(CHROME) ? { executablePath: CHROME } : {},
);
const contexte = await navigateur.newContext({ acceptDownloads: true });
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
check('le titre est en place', (await page.title()).includes('Geotagor'));
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
check('la position lue est affichée', /Actuellement/.test(pill), pill);
const [latAff, lonAff] = pill.replace(/[^\d.,\-]/g, '').split(',').map(Number);
check(
  "la position affichée correspond à celle du fichier",
  Math.abs(latAff - attendueOrigine[0]) < 0.0001 && Math.abs(lonAff - attendueOrigine[1]) < 0.0001,
  `affiché ${latAff},${lonAff} / réel ${attendueOrigine.join(',')}`,
);
check('les étapes ont avancé', (await page.locator('.step.on').textContent()).includes('lieu'));
check('le bouton principal est encore désactivé', await page.locator('#telecharger').isDisabled());

console.log('\nSaisie de nouvelles coordonnées');
await page.fill('#coords', '43.9493, 4.8055');
await page.waitForSelector('#resultat:not([hidden])');
check('le récapitulatif apparaît', (await page.locator('#resultat-coords').textContent()).includes('43,94949') === false);
check('la distance à l\'origine est annoncée',
  /km|m$/.test((await page.locator('#resultat-detail').textContent()).trim()));
check('le bouton principal est activé', !(await page.locator('#telecharger').isDisabled()));

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

console.log('\nPreuve du zéro-tiers');
const tiers = requetes.filter((u) => {
  if (u.startsWith('data:') || u.startsWith('blob:')) return false;
  return !u.startsWith(`http://127.0.0.1:${PORT}/`);
});
check('aucune requête vers un domaine tiers sur un cycle complet', tiers.length === 0,
  tiers.slice(0, 3).join(' | '));
console.log(`       ${requetes.length} requêtes, toutes vers l'origine du site`);
check('aucune erreur JavaScript sur tout le parcours', erreursConsole.length === 0,
  erreursConsole[0]);

console.log('\nAccessibilité du chemin principal');
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
const focusable = await page.evaluate(() => {
  const sel = 'a[href],button:not([disabled]),input:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
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

await navigateur.close();
serveur.close();

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed === 0 ? 0 : 1);
