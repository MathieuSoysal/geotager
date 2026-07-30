# Geotager

*[Version française](README.fr.md)*

View, change and remove the GPS location of a photo, **entirely in the browser**.

No server, no account, no ads, no trackers. The site is a set of static files; image processing
happens in a Web Worker, on your machine.

One thing, and one only, reaches outside: the map behind “Place it on a map”, which fetches its
pictures from `tile.openstreetmap.org`. It is folded away until you click it, so a session that
never opens it makes no outside request at all — and your photo is never part of one either way.

## Status

**V1.1 — all four operations on every image format.** Read, change, add and remove a location on
JPEG, HEIC, AVIF, PNG, WebP and TIFF. Adding grows nothing in place: on an iPhone photo, the new
block is appended at the end of the file and a single address is repointed, so no existing byte
moves. Changing and removing move no byte at all: the file produced is exactly the size of the
original.

Two limits, announced *before* you act rather than after: a simple-form WebP has nowhere to put a
location, and **a camera raw file — DNG, NEF, CR2 — will not accept having one added**, because a
raw file is a TIFF and damaging an original would be irreversible.

Videos are out of reach for now, reading included: a video keeps the location in several places at
once, sometimes spelled out in words, and no public corpus under a free licence provides a real
video to prove it against.

| Format | Read | Change | Add | Remove |
|---|---|---|---|---|
| JPEG | yes | yes | yes | yes |
| HEIC, AVIF *(iPhone)* | yes | yes | yes | yes |
| PNG | yes | yes | yes | yes |
| WebP *(extended form)* | yes | yes | yes | yes |
| TIFF *(excluding camera raw)* | yes | yes | yes | yes |
| Videos (MOV, MP4) | not yet | not yet | not yet | not yet |

*“Change” replaces a location that is already there, “add” creates one where there is none. They are
two different operations: the first does not change the file size, the second does. The table on
each page is rendered from `src/lib/exif/capacites.ts`, which the engine reads too, so it cannot
drift from what the code can actually do.*

The full plan, the decisions and the open questions live in [`PLAN-GATE1.md`](PLAN-GATE1.md) and
[`QUESTIONS.md`](QUESTIONS.md) — both written in French, as the project's working record.

## What the engine guarantees

- **No re-encoding.** Pixels are never touched. Only the bytes of the location change.
- **In-place editing where possible.** Changing or removing a location produces a file of
  **strictly identical size**: nothing moves, so MakerNote, thumbnail, colour profile and vendor
  segments survive *by construction*.
- **Creation without rewriting.** Adding a location to a file that has none inserts nothing in the
  middle of the TIFF block: a new IFD0 is appended at the end and the header is repointed at it.
  Existing absolute offsets stay valid — which is precisely what a naive rewrite breaks.
- **Byte-exact proof.** The engine declares the ranges it writes, and the file produced is compared
  to the original **everywhere else**. Comparing sizes would prove nothing: a defect wiping 200 KB
  of vendor data would sail straight through. It is also what lets us write into a photo of several
  megabytes without ever decoding it: we do not prove the image is still readable, we prove its
  bytes did not move.
- **Verification after writing, in three stages.** Our reader reads the file back from the first
  byte. A **second engine, written by other people**, reads the location block — that is where the
  byte-order defect lives, the one a self-recheck cannot see. Then it reads the whole file, provided
  it could open the original: it does not know every format, and its silence about a file it cannot
  open would prove nothing. A gap of more than a metre, a residue after removal, or a disagreement
  cancels the operation and hands the original back intact. See [`QUESTIONS.md`](QUESTIONS.md),
  entry Q-030.
- **No forgotten copy.** An image can keep the location a second time in a descriptive text packet.
  It is purged — the location only, not the title or the author — then **swept again**: if any trace
  survives, or if the packet is compressed and therefore unreadable to this engine, the removal
  fails rather than hand back a file you would believe was clean.

## Languages

English is served at `/`, French at `/fr/`. Both pages are rendered from the same components and the
same capability matrix; only the words differ, and they live in `src/lib/i18n/`. The engine never
returns a sentence — it returns a key — so a missing translation is a compile error, not a French
sentence on an English page.

## Installing it, and using it offline

Geotager is installable, and it works with no network at all — which is the point: the tool already
ran entirely on your device, and the only reason it used to stop working offline is that nothing
kept a copy of it.

A hand-written service worker (`scripts/sw-modele.js`, ~120 lines, no Workbox) precaches both pages,
the stylesheet, the interface and the reading worker. Three rules govern it:

- **Nothing that is not same-origin.** The first line of the `fetch` handler hands back control for
  anything else. A cached map tile would write a durable on-disk record of the places you looked at,
  which is exactly what this site promises not to do.
- **No unconditional `skipWaiting()`.** Nothing is persisted here, so a forced reload would destroy
  photos you have loaded and not yet downloaded. A new version waits behind a banner until you say so
  — and a window that did not ask is not reloaded because another one said yes.
- **No offline fallback page.** Both real pages are precached, so there is no navigation left for a
  fallback to catch.

The precache list is derived from what the build actually produced — never written by hand — and
`scripts/gen-sw.mjs` refuses to emit a worker whose list is missing the reading worker or the
stylesheet.

### Sending a photo to it from the system

Once installed, Geotager appears in the OS share sheet and as an “Open with” handler for images.

“Open with” is the simple one: the system hands over a file handle, so there is nothing to carry
and nothing to keep.

Simple is not the same as safe, and this is where that sentence used to stop. A handle can point at
a file that has moved since, or at one that has not come down from online storage yet — and the
system hands the batch over exactly once, so there is nothing to come back for. Each handle is
therefore opened on its own, with a time limit: one photo that has gone missing no longer takes the
rest of the batch with it, and an “Open with” that yields nothing usable says so on screen and out
loud instead of leaving an empty window. A launch with no files at all stays silent, because that is
what clicking the app's own icon looks like.

The manifest also states which window receives the files: the one already open, brought forward as
it is, with the new photos **joining** the ones already loaded rather than replacing them. Nothing
is persisted here, so a launch that navigated the window would discard work — the same reason
updates wait behind a banner. The manifest itself is fetched from the network first: it is the only
file the system reads on its own behalf, and served from cache a correction to it would never
arrive.

Sharing is not. The Web Share Target API delivers files as a `POST`, and there is no server here to
receive one — the service worker intercepts it. Every other app that does this parks the file in
Cache Storage, redirects, then reads it back and deletes it. That always works, and it also writes
someone's photo to their disk, which this site says everywhere that it does not do. So the bytes
stay in a variable in the worker instead, and the page claims them over a `MessageChannel`. The
price is honest: if the browser stops the worker first — low memory, system arbitration — the photo
does not arrive and the page says so. You lose a gesture, never a file; the original never moved
from the gallery.

Share target is Android and desktop Chrome/Edge; iOS does not implement it. File handling is
desktop Chrome/Edge.

## Development

```bash
npm install
npm run dev        # local server
npm run build      # builds dist/, generates sw.js, then runs the blocking checks
npm run icons      # regenerates public/icons/ and og.png (committed; needs Playwright)
```

`npm run verifier:en-ligne` fetches the live site and fails if the host has injected anything into
it — a Cloudflare analytics beacon, `/cdn-cgi/` endpoints, Rocket Loader, Zaraz, a cookie — or if any
served header differs from `public/_headers`. Every other check in this repository looks at `dist/`
and therefore cannot see what is added on the way out. It is deliberately outside `npm run build`
(Cloudflare's build has nothing to fetch) and outside `npm run test:all` (CI must reach no network).

### Tests

```bash
npm run fixtures   # fetches real test photos (not committed)
npm test           # EXIF engine, with ExifTool as an independent oracle — 316 assertions
npm run test:e2e   # full journey in Chromium, files read back by ExifTool — 104 assertions
npm run test:all   # the whole chain
```

Every cell of the table above is backed by a test that actually performs the operation on a real
photo of that format — including the “not yet” cells, whose test requires that no witness file
exists. It is therefore no longer a discipline but a property: opening a cell without proof fails
the chain.

ExifTool is required for the tests (`apt install libimage-exiftool-perl`). It is **never** used by
the application: it serves as an external oracle, because an engine that reads itself back proves
nothing — an encoder and a decoder that are symmetrically wrong agree perfectly. libheif
(`apt install libheif-examples` plus its decoder plugins) plays the same role for decoding: ExifTool
says what a file *contains*, libheif says it still *decodes*.

The corpus is not committed and not fabricated: these are real photos from real devices — iPhone 11
Pro Max, iPhone 11 Pro, Nokia 8.3, Galaxy S10, Pixel 4a, HTC Desire, Nikon — plus four real digital
negatives (DNG, NEF, CR2, and a Kodak DCS whose filename says `.TIF`). A file generated for the
occasion validates the code against itself; only a photo that genuinely came out of a device exposes
the cases that break, and this corpus exposes several: reversed byte order, a block stored at the
end of the file, zeroed coordinates, a parasitic preamble. As no public corpus provides a geotagged
PNG or TIFF, the starting location is written into a real device file by ExifTool — an
implementation independent of ours. Sources and licences in [`CREDITS.md`](CREDITS.md), rationale in
[`QUESTIONS.md`](QUESTIONS.md), entry Q-035.

### Continuous integration

`.github/workflows/ci.yml` installs the external oracles and replays `npm run test:all` on every
proposed change. Without it the matrix above would be verified by nothing automatic: the Cloudflare
build only runs `npm run build`, and its image contains neither ExifTool nor libheif.

### Build checks

`scripts/check-build.mjs` exits **non-zero** — the only thing Cloudflare reads — if:

- a page loads a third-party resource from a host that is not on the resource allowlist — which
  holds exactly one entry, the map tiles, recorded in `CREDITS.md`;
- a served JavaScript file contains an absolute URL whose host is on no list at all (the regexes
  above only see HTML- and CSS-shaped references; a URL built by concatenation escaped them);
- a `<title>` exceeds 60 characters or a meta description 155;
- a page does not have exactly one `<h1>`;
- one of the required content blocks is missing from the served HTML, in that page's language;
- a page fails to declare every language, itself included, plus `x-default`;
- a README's table disagrees with the table actually served;
- JavaScript exceeds 150 KB gzipped;
- an `X-Robots-Tag` appears under a relative pattern in `_headers`;
- the manifest's `file_handlers` action does not resolve to a page that is served without a
  redirect, or the never-standardized `launch_type` reappears beside `launch_handler`;
- `robots.txt` disallows crawling, or advertises a sitemap the build does not produce — which is
  exactly what happened once, and went unnoticed;
- the sitemap does not list precisely the indexable pages, carries a `changefreq` or `priority`
  that search engines ignore anyway, or declares languages that contradict the page's own
  `hreflang`;
- a page's canonical is not self-referencing, or `og:url` disagrees with it;
- a page's JSON-LD is not valid JSON, or stops describing the application, the site and its
  publisher;
- an indexable page carries `noindex`, or the 404 page loses it;
- the deployment guard has been removed from the repository.

## Deployment

Cloudflare Workers with static assets, through the Git integration. `wrangler.jsonc` declares no
`main` field: there is no Worker code, only files being served.

`scripts/deploy.mjs` decides, from the branch being built, whether to upload a version or promote to
production — a decision that used to live only in a dashboard setting, and that once put unreviewed
code online. For it to protect anything, **both** build commands in the dashboard must be
`npm run deploy`.

## Licence

MIT. On a tool that claims to send nothing anywhere, readable code is the only argument you can
check for yourself.
