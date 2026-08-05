## What does this change?

<!-- One paragraph. What, and why now. -->

## How was it verified?

<!-- Which parts of the chain you ran, and anything you checked by hand. -->

## Checklist

- [ ] `npm run test:all` passes locally (needs ExifTool and libheif — see [CONTRIBUTING.md](https://github.com/MathieuSoysal/geotager/blob/main/CONTRIBUTING.md))
- [ ] The site still loads from exactly one outside host — no new third-party resource
- [ ] Any capability change is made in `packages/core/src/capacites.ts` and backed by a test on a real file
- [ ] Any user-facing wording changed in both languages (or the gap is called out above)
