/**
 * Fabrique les icônes et l'image de partage, à partir d'UNE seule géométrie.
 *
 * Le repère de Geotager n'existait qu'en deux copies écrites à la main — l'une
 * dans la barre, l'autre dans l'URL de données du favicon — et le dépôt ne
 * portait aucun fichier binaire. Un manifeste sans icônes est pire que pas de
 * manifeste : sous Chrome Android, une icône introuvable suspend la vérification
 * des mises à jour pendant trente jours.
 *
 * On ne dépend pas d'une bibliothèque d'images pour autant : Playwright est déjà
 * là pour les tests de bout en bout, et un navigateur sait rendre un SVG et le
 * photographier. Le résultat est COMMITTÉ, comme le corpus de `fetch-fixtures`
 * — la build de production n'a ni Playwright ni Chromium, et ne doit pas les
 * avoir.
 *
 *   node scripts/build-icons.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'public/icons';
const FOND = '#17161b';
const ROSE = '#FF3385';

/** Le repère, dans son carré de 40. La seule source de la forme. */
const REPERE = `<path d="M20 2.5c10.4 0 16.8 6.6 15.4 15.7C34 27.6 26.6 33.7 20 37.5 13.4 33.7 6 27.6 4.6 18.2 3.2 9.1 9.6 2.5 20 2.5z" fill="${ROSE}"/><circle cx="20" cy="17.4" r="5.7" fill="${FOND}"/>`;

/**
 * `marge` est la part du côté laissée vide autour du repère.
 *
 * Elle vaut zéro pour une icône ordinaire, et 0,2 pour une icône masquable :
 * le système y découpe une forme de son choix — cercle, goutte, carré arrondi —
 * et ne garantit que le disque central de 80 % du côté. Le repère est dessiné
 * jusqu'aux bords de son carré ; sans cette marge, un masque circulaire lui
 * coupe la pointe, c'est-à-dire ce qui en fait un repère.
 */
function pageSvg(taille, { marge = 0, fond = FOND } = {}) {
  const c = 40 / (1 - 2 * marge);
  const d = (c - 40) / 2;
  return `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:${fond}}svg{display:block}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${taille}" height="${taille}"
     viewBox="${-d} ${-d} ${c} ${c}">
  <rect x="${-d}" y="${-d}" width="${c}" height="${c}" fill="${fond}"/>
  ${REPERE}
</svg>`;
}

/** L'image de partage : le repère, le nom, et la phrase du site. */
function pageOg(titre, sous) {
  return `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0}
  body{width:1200px;height:630px;background:${FOND};
       background-image:
         radial-gradient(900px 900px at 2% -14%, rgba(255,51,133,.42), transparent 62%),
         radial-gradient(800px 800px at 99% 0%, rgba(139,135,255,.36), transparent 64%),
         radial-gradient(700px 700px at 46% 114%, rgba(0,211,197,.26), transparent 62%);
       display:flex;flex-direction:column;justify-content:center;gap:28px;
       padding:0 88px;box-sizing:border-box;
       font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
       color:#f4f1f5}
  .marque{display:flex;align-items:center;gap:20px;font-size:44px;font-weight:800;
          letter-spacing:-.025em}
  .marque svg{width:72px;height:72px}
  h1{margin:0;font-size:76px;line-height:1.04;font-weight:800;letter-spacing:-.035em;
     max-width:940px}
  p{margin:0;font-size:34px;color:#ded9e2;max-width:900px}
</style>
<div class="marque"><svg viewBox="0 0 40 40">${REPERE}</svg>Geotager</div>
<h1>${titre}</h1>
<p>${sous}</p>`;
}

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const navigateur = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});

mkdirSync(DIR, { recursive: true });

async function png(html, taille, hauteur, fichier) {
  const page = await navigateur.newPage({
    viewport: { width: taille, height: hauteur },
    deviceScaleFactor: 1,
  });
  await page.setContent(html);
  const octets = await page.screenshot({ type: 'png', omitBackground: false });
  await page.close();
  writeFileSync(fichier, octets);
  console.log(`  ${fichier} — ${octets.length} o`);
}

/*
 * Le SVG, lui, est écrit tel quel : c'est le favicon moderne, il n'a rien à
 * faire dans un rendu bitmap, et il reste lisible à toutes les tailles.
 */
writeFileSync(
  join(DIR, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">${REPERE}</svg>\n`,
);
console.log(`  ${join(DIR, 'icon.svg')}`);

await png(pageSvg(192), 192, 192, join(DIR, 'icon-192.png'));
await png(pageSvg(512), 512, 512, join(DIR, 'icon-512.png'));
await png(pageSvg(512, { marge: 0.2 }), 512, 512, join(DIR, 'icon-512-maskable.png'));
// iOS ne découpe pas et ne compose pas sur transparence : fond plein, sans marge.
await png(pageSvg(180), 180, 180, join(DIR, 'apple-touch-icon.png'));

/*
 * L'image de partage est en anglais, comme la racine du site : `og:image` est
 * unique par page, et les deux pages en partagent une seule pour ne pas doubler
 * un fichier de cette taille pour deux phrases.
 */
await png(
  pageOg('Change the location of a photo', 'Nothing is sent anywhere: everything happens in your browser.'),
  1200, 630, 'public/og.png',
);

await navigateur.close();
console.log('\nIcônes et image de partage prêtes.');
