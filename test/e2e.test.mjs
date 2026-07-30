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
 * TOUS les en-têtes réellement servis pour `/*`, lus dans `public/_headers`.
 *
 * Ils sont lus et non recopiés : une politique recopiée ici dériverait de celle
 * que sert l'hébergeur, et le test finirait par valider une page que personne
 * ne reçoit. Jusqu'ici ce serveur ne posait aucun en-tête, si bien qu'un
 * attribut `style` refusé en production passait inaperçu dans les tests — il y
 * en avait un, sur le gabarit.
 *
 * Et jusqu'ici il ne posait que la CSP. Les six autres en-têtes — dont les pages
 * parlent en toutes lettres — n'étaient donc affirmés par rien : on pouvait en
 * supprimer un sans qu'aucun contrôle ne bronche.
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
  // Sans ces deux-là, le serveur de test renvoie `application/octet-stream` :
  // Chromium refuse alors le manifeste, et les contrôles « aucune erreur
  // JavaScript » virent au rouge pour une raison étrangère à l'application.
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
    ...EN_TETES,
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
/*
 * `serviceWorkers: 'block'` — et ce n'est pas un détail de confort.
 *
 * Tout ce fichier repose sur le JOURNAL DES REQUÊTES : la preuve du zéro-tiers,
 * la frontière avant l'ouverture de la carte, le décompte des tuiles. Un service
 * worker qui sert depuis son cache retire ces requêtes du journal, et les
 * contrôles se mettraient à passer pour la mauvaise raison — c'est-à-dire à ne
 * plus rien prouver. Le parcours principal se juge donc sans lui.
 *
 * Le service worker a sa propre section, tout en bas, dans un contexte à lui.
 */
const contexte = await navigateur.newContext({
  acceptDownloads: true,
  serviceWorkers: 'block',
});

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
// Un champ texte inactif est `readonly`, pas `disabled` : il reste focalisable,
// annoncé en lecture seule, et son contenu reste sélectionnable.
check('le champ de saisie est en lecture seule',
  (await page.locator('#coords').getAttribute('readonly')) !== null);

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
  /*
   * Les phrases des arrivées depuis le système. Elles ne figurent dans aucun
   * HTML servi — c'est le script qui les pose, quand quelque chose a échoué —
   * donc aucun balayage de page ne les voit passer.
   *
   * Nommées une par une, et non par un parcours de tout `T.app` : cet objet
   * porte aussi des suffixes de nom de fichier, et `suffixeSansInfos` vaut
   * « -sans-metadonnees ». Ce n'est pas une phrase du parcours, et la règle du
   * §5 porte sur les phrases du parcours.
   */
  for (const cle of ['partagePerdu', 'ouverturePerdue']) {
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
// Le tableau servi doit être celui du code, ligne pour ligne.
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
 * CE QU'ON DIT AUX MOTEURS, servi pour de vrai.
 *
 * `check-build.mjs` lit ces fichiers sur le disque ; ici on les DEMANDE, par le
 * même serveur et les mêmes en-têtes que le reste. C'est la seule manière de
 * savoir qu'ils répondent — le plan du site a passé longtemps à renvoyer 404
 * pendant que `robots.txt` l'annonçait, et rien ne s'en apercevait.
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
check('il annonce les deux langues', locs.length === 2, locs.join(' '));
const toutesLa = await page.evaluate(
  (l) => Promise.all(l.map((u) => fetch(new URL(u).pathname).then((r) => r.ok))),
  locs);
check('chaque adresse annoncée répond', toutesLa.every(Boolean));
check('aucune fréquence de mise à jour n\'est promise', !/<changefreq>/.test(plan.t));

// Le canonique de la page ANGLAISE n'était vérifié nulle part.
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
 * La page d'erreur, atteinte par son chemin. On ne peut pas provoquer un vrai
 * 404 ici : c'est l'hébergeur qui remonte au « 404.html » le plus proche, et le
 * serveur de ce banc ne l'imite pas. Ce qui est jugé est donc ce qui dépend de
 * nous — la page elle-même — et non le réglage qui la sert.
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
  // `aria-disabled` ne retire rien de l'ordre de tabulation — c'est tout son
  // objet. Le sélecteur ne doit donc plus exclure les contrôles inactifs.
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

// Les repères manquaient tous les trois. Une personne qui navigue de repère en
// repère ne trouvait qu'une navigation et un pied de page, jamais l'outil.
const reperes = await page.evaluate(() => ({
  main: document.querySelectorAll('main').length,
  header: document.querySelectorAll('body > .app header.bar, header.bar').length,
  footer: document.querySelectorAll('footer').length,
  // Un `footer` cesse d'être « contentinfo » dès qu'il est dans un `main`.
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

// Le pavé décimal d'iOS ne porte pas le signe moins : aucune latitude sud ni
// longitude ouest n'était saisissable au doigt.
check("le champ de coordonnées n'impose plus de pavé décimal",
  (await page.locator('#coords').getAttribute('inputmode')) === null);

// Le <h1> vivait dans l'état vide et disparaissait avec lui.
await page.setInputFiles('#picker', source);
await page.waitForFunction(() => !document.getElementById('etat-actif').hidden);
check("un titre de niveau 1 subsiste une fois la photo chargée",
  await page.evaluate(() => {
    const h = document.querySelector('h1');
    // `visually-hidden` reste dans l'arbre ; `hidden` n'y est plus.
    return !!h && h.offsetParent !== null || (!!h && !h.closest('[hidden]'));
  }));
check("le focus n'est pas retombé sur le corps du document",
  await page.evaluate(() => document.activeElement !== document.body));

/*
 * L'objet même du passage à `aria-disabled` : un contrôle inactif reste
 * ATTEIGNABLE. Avec `disabled`, il quittait l'ordre de tabulation et personne ne
 * pouvait s'y poser pour apprendre pourquoi il ne faisait rien.
 *
 * Et il reste inoffensif : `aria-disabled` n'empêche pas le clic, c'est la garde
 * du gestionnaire qui s'en charge. Le contrôle vaut donc pour les deux moitiés —
 * on l'atteint, et l'atteindre ne déclenche rien.
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
 * Cliquer dessus ne doit RIEN faire. L'événement est DISPATCHÉ et non cliqué :
 * Playwright refuse d'actionner un élément portant `aria-disabled="true"` — ce
 * qui est en soi la meilleure confirmation que l'attribut porte — mais cette
 * prudence-là est celle de l'outil de test, pas celle de l'application. Ce qu'on
 * veut éprouver ici est la garde du gestionnaire, seule chose qui protège un
 * vrai navigateur, où le clic passe.
 */
await page.locator('#telecharger').dispatchEvent('click');
await page.waitForTimeout(500);
check("cliquer un bouton inactif ne déclenche rien",
  await page.locator('#resultat').isHidden());

// Et la même chose pour le bouton qui efface tout, sur un fichier où
// l'opération n'existe pas : c'est celui dont la garde compte vraiment.
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


// Une saisie refusée ne disait rien : le bouton se grisait, et c'était tout.
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
 * Les en-têtes que les pages promettent en toutes lettres. Ils étaient servis
 * par l'hébergeur et affirmés par personne : on pouvait en retirer un sans
 * qu'aucun contrôle ne bronche, et la prose aurait continué à les annoncer.
 *
 * On les lit dans `public/_headers`, donc ce contrôle juge le FICHIER LIVRÉ et
 * non une copie — mais il exige que chacun soit présent et dise la bonne chose.
 */
/*
 * LE PARTAGE SORTANT.
 *
 * Chromium sans intégration système n'a pas le partage de fichiers : `canShare`
 * y répond non, le bouton reste caché, et c'est le comportement correct — c'est
 * la première chose vérifiée. Le reste est éprouvé sur une page à part, où
 * l'API est simulée, parce que ce qui compte n'est pas que la feuille s'ouvre
 * mais CE QU'ON Y MET : le fichier produit, jamais l'original.
 */
/*
 * AXE — le filet automatique.
 *
 * Les contrôles d'accessibilité de ce fichier sont écrits à la main : ils
 * disent précisément ce qui est attendu, et échouent avec une phrase qu'on
 * comprend. Ils ne trouvent en revanche que ce à quoi on a pensé. Axe couvre
 * des familles entières de règles auxquelles personne n'a pensé.
 *
 * Il est injecté par `addInitScript` : `addScriptTag` créerait un script EN
 * LIGNE, que `script-src 'self'` refuse. Celui-ci passe par le protocole de
 * débogage, hors de portée de la politique de la page — laquelle est bien
 * servie par ce serveur de test, donc la contrainte est réelle.
 */
const AXE = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');

/*
 * Deux règles sont écartées, nommément, et chacune pour une raison écrite.
 * Une liste de dispenses en bloc rendrait tout le contrôle décoratif.
 *
 * `color-contrast` : axe lit les couleurs DÉCLARÉES et ne sait pas composer. Le
 * décor est un calque `fixed` en `mix-blend-mode: screen` sous du texte, et les
 * ratios réels ont été mesurés puis inscrits dans `global.css` — axe les
 * recalcule à l'aveugle et se trompe dans les deux sens. C'est le contraste qui
 * gouverne les opacités du décor, pas l'inverse ; la mesure reste manuelle.
 *
 * `aria-allowed-role` sur la vue de carte : `role="application"` y est un choix
 * assumé — la carte consomme les flèches du clavier, ce qu'un lecteur d'écran
 * en mode navigation lui prendrait — et il vient avec ses instructions et une
 * voie de repli entièrement au clavier, le champ de coordonnées.
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
 * Un CONTEXTE À PART, avec son propre routage de tuiles.
 *
 * L'audit ouvre la carte, donc il demande des tuiles. Dans le contexte
 * principal, celles-ci incrémentaient `tuilesDemandees` — le compteur sur
 * lequel repose la preuve « déposer une photo ne demande aucune tuile ». Le
 * contrôle tombait, et pour la pire raison qui soit : non pas parce que
 * l'application avait fauté, mais parce que son propre audit avait sali le
 * témoin. Une preuve qu'un test voisin peut fausser ne prouve plus rien.
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
await ctxAxe.close();

console.log('\nPartager la photo nettoyée');
check("sans partage de fichiers, le bouton reste caché",
  await page.locator('#partager-sortie').isHidden());

const pagePartage = await contexte.newPage();
await pagePartage.addInitScript(() => {
  // `addInitScript` et non `addScriptTag` : le second injecte un script EN LIGNE,
  // que `script-src 'self'` refuse. Celui-ci passe par le protocole de débogage,
  // hors de portée de la politique de la page.
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
// LE contrôle : c'est la photo PRODUITE qui part, pas celle qu'on a déposée.
check("c'est le fichier produit qui est partagé, pas l'original",
  partages[0][0].nom === dlPartage.suggestedFilename()
  && partages[0][0].nom !== 'DSCN0010.jpg',
  `${partages[0][0].nom} vs ${dlPartage.suggestedFilename()}`);
check("et ce sont bien ses octets",
  partages[0][0].taille === statSync(produitPartage).size,
  `${partages[0][0].taille} vs ${statSync(produitPartage).size}`);
// Le fichier partagé est celui qu'ExifTool relit sans position.
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
// La géolocalisation est refusée EXPRÈS : c'est pour cela qu'il n'existe aucun
// bouton « me localiser », et la prose s'appuie dessus.
check('aucune fonction sensible n\'est laissée ouverte',
  ['camera', 'microphone', 'geolocation', 'browsing-topics', 'interest-cohort']
    .every((f) => (EN_TETES['Permissions-Policy'] ?? '').includes(`${f}=()`)));

console.log("\nLe manifeste et ses icônes");
for (const [base, langue, depart] of [['/', 'en', '/'], ['/fr/', 'fr', '/fr/']]) {
  await page.goto(`http://127.0.0.1:${PORT}${base}`, { waitUntil: 'networkidle' });
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  check(`${base} déclare son manifeste`, href === `${base}manifest.webmanifest`, String(href));

  // Récupéré par la page elle-même : c'est le seul moyen de constater le type
  // MIME et le corps que le navigateur reçoit réellement.
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
  // Deux URLs, un seul `id` : c'est ce qui fait UNE application installée et
  // non deux, et c'est ce qui ne devra jamais changer.
  check(`${base} partage l'identité d'installation`, json.id === '/', String(json.id));
  check(`${base} reste dans sa portée`, json.scope === '/');
  check(`${base} porte une icône masquable`,
    (json.icons ?? []).some((i) => String(i.purpose ?? '').split(/\s+/).includes('maskable')));

  // Une icône déclarée mais introuvable est la panne la plus discrète du lot :
  // rien ne se voit avant l'écran d'accueil.
  const manquantes = await page.evaluate(
    (srcs) => Promise.all(srcs.map((s) => fetch(s).then((r) => (r.ok ? null : s)))),
    (json.icons ?? []).map((i) => i.src),
  );
  check(`${base} : toutes les icônes déclarées répondent`,
    manquantes.filter(Boolean).length === 0, String(manquantes.filter(Boolean)));
}

// `summary_large_image` était déclaré sans la moindre image.
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
const og = await page.locator('meta[property="og:image"]').getAttribute('content');
check("une image de partage est déclarée", !!og && og.endsWith('/og.png'), String(og));
check("elle a un texte de remplacement",
  ((await page.locator('meta[property="og:image:alt"]').getAttribute('content')) ?? '').length > 10);
check("elle existe vraiment",
  await page.evaluate(() => fetch('/og.png').then((r) => r.ok)));

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
check('le bouton de téléchargement est actif',
  (await page.locator('#telecharger').getAttribute('aria-disabled')) === 'false');

// La carte est opérable sans souris : c'est la condition pour qu'elle soit
// autre chose qu'un ornement.
await page.focus('#carte-vue');
await page.keyboard.press('ArrowRight');
await page.waitForFunction((v) => document.getElementById('coords').value !== v, saisi,
  { timeout: 3_000 });
check('les flèches déplacent le point visé', (await page.locator('#coords').inputValue()) !== saisi);

// Le zoom change la précision annoncée, donc ce qui sera inscrit dans le fichier.
await page.click('#carte-plus');
/*
 * Le pincement. `touch-action: none` coupe le zoom du navigateur sur la carte,
 * et rien ne le remplaçait : deux doigts ne faisaient rigoureusement rien, et
 * les seules commandes de zoom étaient deux boutons — le geste que personne
 * n'emploie sur un téléphone.
 *
 * Les événements sont synthétisés : Playwright ne pilote qu'un seul point de
 * contact, et ce qui est jugé ici est la logique à deux pointeurs.
 */
/* Le niveau de zoom se lit dans l'adresse des tuiles : /{z}/{x}/{y}.png. */
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
  // Deux doigts à 40 px d'écart, écartés jusqu'à 160 px : deux doublements,
  // donc deux crans de zoom.
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
 * Un pincement n'est pas un clic : il ne doit pas emporter le point choisi
 * là où se sont posés les doigts. Il le déplace tout de même d'un cheveu —
 * `zoomer` réancre la vue et le nombre est réécrit à cinq décimales — donc on
 * juge la DISTANCE, pas l'égalité des chaînes. Un clic mal interprété aurait
 * sauté de plusieurs centièmes de degré, soit des kilomètres.
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
 * LE MORCEAU DE LA CARTE MANQUE.
 *
 * Il n'est délibérément pas préchargé par le service worker, donc hors ligne il
 * n'est pas là et l'import dynamique échoue. Le rejet n'était rattrapé nulle
 * part : on restait avec un panneau ouvert, un bouton annonçant « Fermer la
 * carte », un cadre vide et une erreur de console que personne ne lit.
 *
 * La panne est provoquée en refusant la requête, et non en coupant le réseau :
 * c'est le seul moyen d'en faire un contrôle déterministe.
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
  (await page.locator('#telecharger').getAttribute('aria-disabled')) === 'false');

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

/*
 * LE SERVICE WORKER, dans un contexte à part — celui d'au-dessus les bloque.
 *
 * Ce qui est jugé ici n'est pas qu'un worker s'enregistre : c'est que l'outil
 * FONCTIONNE connexion coupée. La page l'a toujours promis ; jusqu'à présent
 * un rechargement hors ligne ne donnait rien du tout, faute que quiconque garde
 * la coquille.
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

// La coupure est réelle : plus rien ne sort, pas même vers l'origine.
await ctxSw.setOffline(true);
await pageSw.reload({ waitUntil: 'load' });
check('hors ligne, la page s\'ouvre encore',
  await pageSw.locator('#etat-vide').isVisible());
check('hors ligne, la feuille de style est là aussi',
  await pageSw.evaluate(() => getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)'));

/*
 * Le vrai contrôle. Le worker de lecture est chargé par `new Worker(new URL(…))`
 * et n'apparaît donc dans aucune balise : s'il tombait de la liste de
 * préchargement, la page s'ouvrirait hors ligne et refuserait TOUTES les photos,
 * sans un mot. C'est la panne que ce contrôle existe pour attraper.
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

// Le morceau de la carte n'est délibérément PAS préchargé : l'ouvrir hors ligne
// sans l'avoir jamais ouvert en ligne ne peut pas marcher, et ne doit surtout
// pas emporter l'application avec lui.
/*
 * Ouvrir la carte hors ligne ne doit rien emporter. Ce qu'il advient
 * exactement du morceau dépend de l'environnement — selon les versions,
 * la coupure de Playwright atteint ou non les requêtes émises par le service
 * worker lui-même — donc on ne juge ici QUE l'innocuité. Le chemin d'échec
 * proprement dit est éprouvé plus haut, de façon déterministe.
 */
await pageSw.click('#carte-bascule').catch(() => {});
await pageSw.waitForTimeout(1_500);
const restantesSw = erreursSw.filter((e) => !/Failed to load resource|net::ERR_|FetchEvent/.test(e));
check("la carte indisponible hors ligne n'emporte rien avec elle",
  restantesSw.length === 0, restantesSw[0]);

/*
 * LE PARTAGE ENTRANT.
 *
 * Le système envoie la photo en `POST` multipart, et aucun serveur ne la reçoit :
 * le service worker l'intercepte, garde les octets EN MÉMOIRE, redirige, et la
 * page vient les réclamer. C'est le chemin entier qui est éprouvé ici — on ne
 * peut pas déclencher le menu de partage du système depuis un test, mais tout
 * ce qui se passe après, si.
 *
 * Le `POST` part d'un `fetch` et non d'un formulaire : la politique du site
 * porte `form-action 'none'`, donc un formulaire de NOTRE page serait refusé.
 * Le partage réel n'en est pas un — il vient du système — et le worker ne
 * distingue de toute façon que la méthode et le chemin.
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

// Le worker garde les octets ; la page les réclame en arrivant sur ?partage=1.
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
 * Rendus une fois, et une seule. Sans cela, un rechargement ferait réapparaître
 * une photo que l'utilisateur croyait avoir refermée — et le worker garderait
 * ses octets en mémoire sans que rien ne vienne les chercher.
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
 * « OUVRIR AVEC », JOUÉ POUR DE VRAI.
 *
 * Le système remet des poignées de fichier, et rien d'autre : pas de paramètre
 * dans l'adresse, pas d'octets gardés quelque part, rien à réclamer à personne.
 * Ce qui n'est pas rattrapé à cet instant est perdu — et l'était SANS UN MOT.
 *
 * On ne peut pas déclencher le menu du système depuis un test. Tout ce qui se
 * passe après, si : la file de lancement est posée avant l'exécution de l'îlot,
 * et on lui remet exactement ce que le système lui remettrait.
 */
const POSER_FILE = () => {
  // `addInitScript` et non `addScriptTag` : le second injecte un script EN
  // LIGNE, que `script-src 'self'` refuse. Celui-ci passe par le protocole de
  // débogage, hors de portée de la politique de la page.
  //
  // `defineProperty` et non une affectation : le jour où la plate-forme définit
  // `launchQueue` en accesseur sans écriture, une affectation échouerait sans un
  // mot et le test se mettrait à passer pour rien.
  let consommateur = null;
  Object.defineProperty(window, 'launchQueue', {
    configurable: true,
    value: {
      setConsumer(f) {
        consommateur = f;
      },
    },
  });
  // Une poignée est un objet qui sait rendre un fichier, et rien de plus. Les
  // octets arrivent en base64 — c'est un argument d'appel, donc la politique du
  // contenu n'a rien à en dire.
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
 * La seconde ouverture REJOINT la première. Elle l'effaçait : `charger` remettait
 * `items` à zéro sans rien demander, et quarante photos non exportées
 * disparaissaient parce qu'on en avait ouvert une quarante-et-unième.
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
 * Cliquer l'icône de l'application passe aussi par la file de lancement, sans
 * aucun fichier. `focus-existing` la remet à la fenêtre ouverte comme le reste :
 * annoncer « cette photo n'est pas arrivée » à chaque clic sur l'icône serait un
 * mensonge dit très régulièrement.
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
 * Zéro octet. Un espace de stockage distant monté comme un dossier local rend
 * des fichiers de taille nulle tant qu'il ne les a pas fait descendre : ils
 * étaient écartés deux fois de suite, et la fenêtre restait vide et muette.
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

// Une poignée fâchée n'emporte plus le lot : c'est tout l'objet du changement.
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

// Et un lot entièrement fâché le dit, dans le canal qui est à l'écran : l'état
// actif est affiché, donc `#avis-vide` n'y serait visible nulle part.
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
 * LA COURSE DU PREMIER LANCEMENT — la panne du rapport, dans son propre contexte.
 *
 * Un contexte neuf : aucun worker n'y est enregistré, donc le document se charge
 * SANS contrôleur. Le worker s'enregistre au chargement, s'active, réclame ses
 * clients — et la page se rechargeait. Les fichiers du lancement, remis une fois
 * et une seule, étaient déjà consommés : la fenêtre repartait vide et muette.
 *
 * Le `ctxSw` d'au-dessus ne peut pas juger ceci : il attend d'être contrôlé puis
 * recharge lui-même, c'est-à-dire précisément l'état où la course n'a pas lieu.
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
