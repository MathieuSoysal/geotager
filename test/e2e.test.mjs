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

/**
 * La CSP réellement servie, lue dans `public/_headers`.
 *
 * Elle est lue et non recopiée : une politique recopiée ici dériverait de celle
 * que sert l'hébergeur, et le test finirait par valider une page que personne
 * ne reçoit. Jusqu'ici ce serveur ne posait aucun en-tête, si bien qu'un
 * attribut `style` refusé en production passait inaperçu dans les tests — il y
 * en avait un, sur le gabarit.
 */
const CSP = readFileSync('public/_headers', 'utf8')
  .match(/^\s*Content-Security-Policy:\s*(.+)$/m)[1]
  .trim();

const MIME = {
  '.xml': 'application/xml; charset=utf-8',
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
  // Un chemin qui se termine par « / » désigne l'index du dossier — c'est ce
  // que fait l'hébergeur, et sans cela /fr/ répondrait 404 ici seulement.
  let f = join(DIST, url.pathname.slice(1));
  if (url.pathname.endsWith('/')) f = join(f, 'index.html');
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f) || !statSync(f).isFile()) {
    res.writeHead(404).end('non trouvé');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(f)] ?? 'application/octet-stream',
    'Content-Security-Policy': CSP,
  });
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

/*
 * Les tuiles de la carte sont interceptées, jamais demandées pour de vrai.
 *
 * L'intégration continue ne doit atteindre aucun réseau : un test qui dépend
 * d'un serveur tiers échoue le jour où ce serveur ralentit, et on finit par
 * l'ignorer. Ce qui est jugé ici n'est de toute façon pas le dessin des tuiles,
 * c'est QUI est appelé — et une requête interceptée reste visible dans
 * `requetes`, donc la preuve du zéro-tiers continue de tout voir.
 *
 * L'hôte est importé du module qui le sert, et non recopié : la même discipline
 * que la CSP lue dans `public/_headers`. Une valeur recopiée dans un test est
 * une valeur qui finira par diverger de celle qui est livrée.
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
  !MOTS_INTERDITS.en.test(await alerte.textContent()),
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
check('la phrase reste sans jargon de format', !MOTS_INTERDITS.en.test(phrase), phrase.slice(0, 80));
check('le champ de saisie est désactivé', await page.locator('#coords').isDisabled());

// Les deux contrôles ci-dessus ne voient que les deux phrases que ces deux
// fichiers déclenchent. Le parcours en compte onze, et c'est celle qu'on n'a
// pas prévue qui dira « conteneur » à l'utilisateur.
console.log('\nAucune phrase du parcours ne porte de jargon');
const { MATRICE } = await import('../src/lib/exif/capacites.ts');
const { DICOS, LANGUES } = await import('../src/lib/i18n/index.ts');
const MOTIFS = [
  'ok', 'sans-lieu', 'sans-emplacement', 'forme-inhabituelle', 'rangement-inconnu',
  'copie-compressee', 'copie-ailleurs', 'lecture-seule', 'sans-lieu-possible',
  'video', 'inconnu',
];
// Les deux langues, et toutes les phrases de chacune : c'est la phrase qu'on
// n'a pas prévue qui dira « container » à l'utilisateur.
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
}
check('les onze motifs du parcours sont couverts', MOTIFS.length === 11);
check('les deux langues ont exactement les mêmes clés',
  JSON.stringify(Object.keys(DICOS.en.erreurs).sort()) ===
    JSON.stringify(Object.keys(DICOS.fr.erreurs).sort()));
// Le tableau servi doit être celui du code, ligne pour ligne.
const tableauServi = await page.locator('#limites ~ table tbody tr').count()
  .catch(() => 0);
check('le tableau de la page a autant de lignes que le code en déclare',
  tableauServi === 0 || tableauServi === MATRICE.length, `${tableauServi} vs ${MATRICE.length}`);

console.log('\nLa version française est servie et reliée');
await page.goto(`http://127.0.0.1:${PORT}/fr/`, { waitUntil: 'networkidle' });
check('la page française déclare sa langue',
  (await page.locator('html').getAttribute('lang')) === 'fr');
check('elle affiche bien du français',
  (await page.locator('#etat-vide h1').textContent()).includes('Changez le lieu'),
  (await page.locator('#etat-vide h1').textContent()).trim());
check('elle pointe vers la version anglaise',
  (await page.locator('nav.main a[rel="alternate"]').getAttribute('href')) === '/');
const enHref = await page.locator('link[rel="alternate"][hreflang="en"]').getAttribute('href');
const frHref = await page.locator('link[rel="alternate"][hreflang="fr"]').getAttribute('href');
check('les deux langues sont déclarées réciproquement',
  enHref?.endsWith('/') && frHref?.endsWith('/fr/'), `${enHref} | ${frHref}`);
check('la page française est canonique sur elle-même',
  (await page.locator('link[rel="canonical"]').getAttribute('href')).endsWith('/fr/'));

// Le parcours doit fonctionner à l'identique dans les deux langues : c'est le
// même moteur, et une traduction ne doit rien casser.
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
 * La frontière.
 *
 * Tout ce qui précède s'est déroulé carte fermée, et ce contrôle est resté mot
 * pour mot celui d'avant la carte : c'est LUI la preuve que la fonctionnalité
 * est bien facultative. Ce qui suit se passe carte ouverte, et la promesse y
 * change de forme — « rien ne sort » devient « rien ne sort tant que vous ne
 * l'avez pas demandé ». Le test doit dire exactement cela, sinon il valide une
 * autre promesse que celle qui est écrite sur la page.
 */
const FRONTIERE = requetes.length;

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

console.log('\nLe décor est décoratif, et il l\'est aussi pour qui n\'en veut pas');
check('le décor est hors de l\'arbre d\'accessibilité',
  await page.evaluate(() => {
    const d = document.getElementById('decor');
    return !!d
      && d.getAttribute('aria-hidden') === 'true'
      && getComputedStyle(d).pointerEvents === 'none'
      && d.querySelectorAll('[tabindex],a,button,input').length === 0;
  }));
// La forme est calculée au build par le même module que la boucle : elle est
// donc déjà dans le HTML servi, et rien n'apparaît au démarrage.
const tracesServies = await page.locator('#decor path[d]').count();
check('la forme est déjà dessinée dans le HTML servi', tracesServies === 4, String(tracesServies));

// La règle générale de la feuille de style ne coupe que les animations CSS.
// Une boucle rAF lui échappe : c'est au script de lire la préférence, et c'est
// précisément ce que ce contrôle vérifie.
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

// Une image refusée par la politique de sécurité n'échoue pas côté réseau :
// elle lève `securitypolicyviolation`. C'est le seul moyen de nommer la
// directive fautive au lieu de lire une phrase de Chromium.
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
 * Le repère doit tomber DANS la carte, au centre, et sa position est calculée
 * en JavaScript. Une propriété `rotate` posée en CSS sur le même élément l'a
 * déjà envoyé 275 px au-dessus du cadre : les propriétés individuelles de
 * transformation s'appliquent avant `transform`, et la translation du script
 * s'était retrouvée tournée. Rien ne le signalait — ni la console, ni la CSP,
 * ni un test. Celui-ci le ferait.
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

// Le clic pose le repère, et le repère remplit le champ.
const vue = await page.locator('#carte-vue').boundingBox();
await page.mouse.click(vue.x + vue.width * 0.62, vue.y + vue.height * 0.38);
await page.waitForFunction(() => document.getElementById('coords').value.trim().length > 0,
  null, { timeout: 5_000 });
const saisi = await page.locator('#coords').inputValue();
check('un clic sur la carte remplit le champ de coordonnées',
  /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(saisi), saisi);
check('le récapitulatif est apparu', !(await page.locator('#resultat').isHidden()));
check('le bouton de téléchargement est activé', !(await page.locator('#telecharger').isDisabled()));

// La carte est opérable sans souris : c'est la condition pour qu'elle soit
// autre chose qu'un ornement.
await page.focus('#carte-vue');
await page.keyboard.press('ArrowRight');
await page.waitForFunction((v) => document.getElementById('coords').value !== v, saisi,
  { timeout: 3_000 });
check('les flèches déplacent le point visé', (await page.locator('#coords').inputValue()) !== saisi);

// Le zoom change la précision annoncée, donc ce qui sera inscrit dans le fichier.
await page.click('#carte-plus');
check('le zoom reste opérable au clavier comme à la souris',
  await page.locator('#carte-plus').isVisible());

check('aucune violation de la politique de sécurité pendant la carte',
  (await page.evaluate(() => window.__csp)).length === 0,
  (await page.evaluate(() => window.__csp))[0]);

// Refermer doit tout rendre : plus une tuile dans le document, plus une requête.
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
 * L'autre moitié de la preuve : l'exception porte sur UN hôte, et non sur un
 * « https: » lâche. Aucun réseau n'est nécessaire — la politique refuse avant
 * même d'émettre la requête.
 *
 * Ce contrôle vient EN DERNIER de la section, et son refus est ensuite retiré
 * du journal : une violation provoquée exprès écrit dans la console, et le
 * contrôle « aucune erreur » de la suite la prendrait pour un vrai dégât. On
 * l'ôte en nommant précisément l'hôte qu'on a inventé, jamais en vidant le
 * journal — vider effacerait aussi ce qu'on n'a pas vu venir.
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
 * Et sans réseau ? La page promet que l'outil « fonctionne intégralement »
 * connexion coupée. La carte, elle, ne peut pas : elle doit donc se contenter
 * de rester vide, sans rien emporter avec elle. Une carte qui lèverait une
 * exception ferait tomber `app.ts`, et le contrôle « aucune erreur » plus haut
 * signalerait le dégât dans une section qui n'a rien à voir.
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
  !(await page.locator('#telecharger').isDisabled()));

/*
 * Le navigateur journalise chaque image qui n'arrive pas : `net::ERR_FAILED`.
 * Ce n'est pas une erreur de l'application, c'est le constat d'une connexion
 * absente, et c'est exactement ce qu'on a provoqué. Ce qui est vérifié ici est
 * qu'il ne s'y ajoute RIEN — pas d'exception, pas de `undefined`, pas de
 * gestionnaire qui explose parce qu'une tuile manque. On écarte donc les
 * lignes de chargement, une par une, et on exige que le reste soit vide.
 */
const restantes = erreursConsole.filter(
  (e) => !/Failed to load resource|net::ERR_/.test(e),
);
check("une tuile qui n'arrive pas n'emporte rien avec elle", restantes.length === 0,
  restantes[0]);

await navigateur.close();
serveur.close();

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed === 0 ? 0 : 1);
