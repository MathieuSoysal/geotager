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
  cancels the operation and hands the original back intact. See.
- **No forgotten copy.** An image can keep the location a second time in a descriptive text packet.
  It is purged — the location only, not the title or the author — then **swept again**: if any trace
  survives, or if the packet is compressed and therefore unreadable to this engine, the removal
  fails rather than hand back a file you would believe was clean.

## Languages

English is served at `/`, French at `/fr/`. Both pages are rendered from the same components and the
same capability matrix; only the words differ, and they live in `src/lib/i18n/`. The engine never
returns a sentence — it returns a key — so a missing translation is a compile error, not a French
sentence on an English page.

## Development

```bash
npm install
npm run dev        # local server
npm run build      # builds dist/ then runs the blocking checks
```

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
implementation independent of ours. Sources and licences in [`CREDITS.md`](CREDITS.md).

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
