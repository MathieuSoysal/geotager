/**
 * Builds the icons and the share image from a single geometry.
 *
 * The Geotager marker existed only as two hand-written copies, one in the bar
 * and one in the favicon data URL, and the repository carried no binary file. A
 * manifest without icons is worse than no manifest: on Chrome Android, an icon
 * that cannot be found suspends update checks for thirty days.
 *
 * No image library is pulled in for it: Playwright is already here for the
 * end-to-end tests, and a browser can render an SVG and photograph it. The
 * result is committed, like the `fetch-fixtures` corpus, since the production
 * build has neither Playwright nor Chromium and must not need them.
 *
 *   node scripts/build-icons.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'public/icons';
const FOND = '#17161b';
const ROSE = '#FF3385';

/** The marker, in its square of 40. The single source of the shape. */
const REPERE = `<path d="M20 2.5c10.4 0 16.8 6.6 15.4 15.7C34 27.6 26.6 33.7 20 37.5 13.4 33.7 6 27.6 4.6 18.2 3.2 9.1 9.6 2.5 20 2.5z" fill="${ROSE}"/><circle cx="20" cy="17.4" r="5.7" fill="${FOND}"/>`;

/**
 * `marge` is the share of the side left empty around the marker.
 *
 * It is zero for an ordinary icon and 0.2 for a maskable one: the system cuts a
 * shape of its own choosing there, circle, squircle or rounded square, and only
 * guarantees the central disc covering 80% of the side. The marker is drawn to
 * the edges of its square; without this margin a circular mask cuts off its
 * point, which is what makes it a marker.
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

/** The share image: the marker, the name, and the site's sentence. */
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

/**
 * The repository banner: the marker, the name, the site's sentence, and the
 * promise in one line. Same palette and same gradients as the share image, so
 * the README and a shared link look like the same object.
 */
function pageBanniere(phrase, promesse) {
  return `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0}
  body{width:1760px;height:440px;background:${FOND};
       background-image:
         radial-gradient(1100px 900px at 4% -32%, rgba(255,51,133,.42), transparent 62%),
         radial-gradient(1000px 850px at 97% -8%, rgba(139,135,255,.36), transparent 64%),
         radial-gradient(950px 800px at 48% 132%, rgba(0,211,197,.26), transparent 62%);
       display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;
       box-sizing:border-box;
       font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
       color:#f4f1f5}
  .marque{display:flex;align-items:center;gap:24px;font-size:92px;font-weight:800;
          letter-spacing:-.035em}
  .marque svg{width:104px;height:104px}
  p{margin:0;font-size:33px;color:#ded9e2;max-width:1600px;text-align:center}
  .promesse{font-size:24px;color:#a89fb2;letter-spacing:.02em}
</style>
<div class="marque"><svg viewBox="0 0 40 40">${REPERE}</svg>Geotager</div>
<p>${phrase}</p>
<p class="promesse">${promesse}</p>`;
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
 * The SVG is written as it is: it is the modern favicon, it has no business in a
 * bitmap render, and it stays legible at every size.
 */
writeFileSync(
  join(DIR, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">${REPERE}</svg>\n`,
);
console.log(`  ${join(DIR, 'icon.svg')}`);

await png(pageSvg(192), 192, 192, join(DIR, 'icon-192.png'));
await png(pageSvg(512), 512, 512, join(DIR, 'icon-512.png'));
await png(pageSvg(512, { marge: 0.2 }), 512, 512, join(DIR, 'icon-512-maskable.png'));
// iOS neither crops nor composites over transparency: solid background, no margin.
await png(pageSvg(180), 180, 180, join(DIR, 'apple-touch-icon.png'));

/*
 * The share image is in English, like the site root: `og:image` is unique per
 * page, and both pages share one so as not to duplicate a file this size for
 * two sentences.
 */
await png(
  pageOg('Change the location of a photo', 'Nothing is sent anywhere: everything happens in your browser.'),
  1200, 630, 'public/og.png',
);

/*
 * The README banners live in `.github/` rather than `public/`: GitHub reads
 * them, the site never serves them. One per language, like the READMEs they
 * head.
 */
await png(
  pageBanniere(
    'View, change and remove the GPS location of a photo, entirely in the browser.',
    'No server · No account · No ads · No trackers',
  ),
  1760, 440, '.github/banner.png',
);
await png(
  pageBanniere(
    'Voir, modifier et supprimer la position GPS d’une photo, entièrement dans le navigateur.',
    'Aucun serveur · Aucun compte · Aucune publicité · Aucun traceur',
  ),
  1760, 440, '.github/banner.fr.png',
);

await navigateur.close();
console.log('\nIcônes, image de partage et bannières prêtes.');
