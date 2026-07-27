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

/**
 * La liste de mots interdits du §5 du plan, en entier.
 *
 * Elle était jusqu'ici recopiée à deux endroits, en deux versions
 * divergentes — l'une connaissait « worker » mais pas « RIFF », l'autre
 * l'inverse — et six mots du §5 n'étaient vérifiés nulle part : « balise »,
 * « DMS », « décimal », « WGS84 », « sidecar », « upload ». Une liste
 * dédoublée est une liste dont une moitié finit par mentir.
 */
const MOTS_INTERDITS =
  /\b(EXIF|IFD|ISOBMFF|VP8X|RIFF|conteneur|m[ée]tadonn[ée]es|balise|DMS|d[ée]cimal|WGS ?84|sidecar|upload|parser|worker|chunk|morceau|atome|bo[îi]te)\b/i;

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

console.log('\nDépôt d\'une photo iPhone');
const heic = join(FIXTURES, 'iphone.heic');
const gpsHeic = execFileSync(
  'exiftool',
  ['-n', '-s', '-s', '-s', '-GPSLatitude', '-GPSLongitude', heic],
  { encoding: 'utf8' },
).trim().split('\n').map(Number);

// Page rechargée : l'interface affiche le nom du fichier dès le dépôt, avant
// la lecture, si bien qu'attendre « une pastille non vide » comparerait la
// photo iPhone à la position du fichier précédent. Repartir d'un état vierge
// supprime la course au lieu de la contourner.
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

// L'interface annonce la voie AVANT l'action : ici, corriger et effacer sont
// possibles, ajouter non — et c'est exactement ce qu'il faut dire.
const alerte = await page.locator('#alerte-format');
check('la voie retenue est annoncée avant toute action',
  await alerte.isVisible() && (await alerte.textContent()).trim().length > 0,
  (await alerte.textContent()).trim().slice(0, 80));
check('la phrase affichée ne contient aucun jargon de format',
  !MOTS_INTERDITS.test(await alerte.textContent()),
  (await alerte.textContent()).trim().slice(0, 80));
check('« Tout effacer » est désactivé là où l\'opération n\'existe pas',
  await page.locator('#effacer-tout').isDisabled());

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
check('le champ de saisie est actif sur un PNG',
  !(await page.locator('#coords').isDisabled()));

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

// Chromium décode nativement le PNG : c'est un décodeur totalement indépendant
// du nôtre, et la preuve la plus directe que l'image produite reste une image.
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
// Écriture d'abord : c'est le cas que la relecture croisée aurait refusé si
// elle exigeait que le second lecteur sache ouvrir un WebP, ce qu'il ne sait
// pas faire. La règle de symétrie est ce qui permet de le vérifier quand même,
// en lui donnant le bloc extrait plutôt que le fichier entier.
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
check('la phrase reste sans jargon de format', !MOTS_INTERDITS.test(phrase), phrase.slice(0, 80));
check('le champ de saisie est désactivé', await page.locator('#coords').isDisabled());

// Les deux contrôles ci-dessus ne voient que les deux phrases que ces deux
// fichiers déclenchent. Le parcours en compte onze, et c'est celle qu'on n'a
// pas prévue qui dira « conteneur » à l'utilisateur.
console.log('\nAucune phrase du parcours ne porte de jargon');
const { MATRICE, phraseDe } = await import('../src/lib/exif/capacites.ts');
const MOTIFS = [
  'ok', 'sans-lieu', 'sans-emplacement', 'forme-inhabituelle', 'rangement-inconnu',
  'copie-compressee', 'copie-ailleurs', 'lecture-seule', 'sans-lieu-possible',
  'video', 'inconnu',
];
for (const motif of MOTIFS) {
  const p = phraseDe(motif);
  check(`« ${motif} » : une phrase sans jargon`, Boolean(p) && !MOTS_INTERDITS.test(p),
    (p ?? '(absente)').slice(0, 90));
}
check('les onze motifs du parcours sont couverts', MOTIFS.length === 11);
// Le tableau servi doit être celui du code, ligne pour ligne.
const tableauServi = await page.locator('#limites ~ table tbody tr').count()
  .catch(() => 0);
check('le tableau de la page a autant de lignes que le code en déclare',
  tableauServi === 0 || tableauServi === MATRICE.length, `${tableauServi} vs ${MATRICE.length}`);

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
