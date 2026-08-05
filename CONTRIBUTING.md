# Contributing to Geotager

Thank you for wanting to help. Bug reports, fixes, format knowledge, wording corrections and
translations are all welcome, and so are questions: an unclear sentence in the README or on the
site is a bug too.

## The ground rules

This project holds a few promises that every change must keep. Most of them are enforced by the
build rather than by review, so it is cheaper to know them before writing code:

- **Nothing leaves the user's machine.** The site may load from exactly one outside host, the map
  tiles, and `scripts/check-build.mjs` fails the build if any page references another. A feature
  that needs a server, an analytics endpoint or a CDN will be declined, however good it is.
- **Pixels are never re-encoded.** The engine edits location bytes and proves, byte for byte, that
  it touched nothing else. A change that rewrites files wholesale breaks the contract the tests
  encode.
- **A capability cell only turns to “yes” with proof.** The format table is rendered from
  `packages/core/src/capacites.ts`, every cell is backed by a test on a real device file, and the
  README tables are compared against the served page at build time. Opening a cell without a test
  fails the chain, by design.
- **Both languages move together.** English and French are rendered from the same components and the
  same typed records; a page, a guide or a translation key added in one language and not the other
  is a compile error. Prose changes (READMEs included) should land in both files in the same pull
  request.
- **Guides ship no JavaScript.** The end-to-end test asserts it.

## Reporting a bug

Use the bug report template. The one thing to know before attaching anything:

> **Never attach a photo whose location you would mind publishing.** Coordinates in metadata are
> the very subject of this tool, and a GitHub attachment is public forever. Strip the file first
> (with Geotager, fittingly), or reproduce with a test photo.

A byte-level bug is much easier to chase with the file's format, its source device, and the exact
operation (read, change, add, remove) than with a screenshot of the interface.

## Suggesting a feature

Open a feature request issue before writing code, especially for anything that touches the promises
above; it saves you from building something that cannot be merged. Small corrections (typos,
wording, translations) can go straight to a pull request.

## Development setup

```bash
nvm use          # or any Node matching .nvmrc
npm install
npm run dev      # local server
npm run build    # builds dist/ and runs the blocking checks
```

The test chain needs two external oracles that the application itself never uses: ExifTool to read
what a file *contains*, libheif to prove it still *decodes*.

```bash
sudo apt-get install libimage-exiftool-perl libheif-examples \
  libheif-plugin-libde265 libheif-plugin-dav1d libheif-plugin-aomdec

npm run fixtures   # fetches the real-device test corpus (not committed)
npm run test:all   # the whole chain, the same one CI runs
```

See the [README's Development section](README.md#development) for what each individual script does.

## Pull requests

- Branch from `main`; keep the diff focused on one change.
- `npm run test:all` must pass. CI replays it on every pull request and is the merge gate.
- Fill in the pull request template; its checklist is the ground rules above, in checkbox form.
- If you change user-facing words, change them in both languages. If you genuinely cannot write the
  French (or the English), say so in the pull request and it will be translated for you; an honest
  gap beats a machine-translated one.

## Communication expectations

This project has a single maintainer. Issues and pull requests are usually answered within a few
days, not hours. Silence is a queue, not a verdict.

Everyone interacting with the project (issues, pull requests, discussions) is expected to follow
the [code of conduct](CODE_OF_CONDUCT.md). Security reports go through
[private vulnerability reporting](SECURITY.md), not the public issue tracker.
