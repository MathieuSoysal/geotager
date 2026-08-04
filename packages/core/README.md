# @geotager/core

Read, write and remove the GPS location stored inside photo and video files —
**byte for byte**, in Node and in the browser, with no DOM.

This is the engine behind [geotager.app](https://geotager.app) and the
[`geotager`](https://www.npmjs.com/package/geotager) CLI. Bytes in, bytes out:
no filesystem access, no network, no DOM. It runs unchanged in Node, in a
browser, in a Web Worker and in an edge function.

```bash
npm install @geotager/core
```

## Quick start

```js
import { readGps, setGps, stripGps } from '@geotager/core';
import { readFile, writeFile } from 'node:fs/promises';

const bytes = await readFile('photo.jpg');

readGps(bytes);
// → { lat: 43.4674, lng: 11.8851, alt: 210.5 }   or null

await writeFile('tagged.jpg', await setGps(bytes, { lat: 48.8584, lng: 2.2945 }));
await writeFile('clean.jpg', await stripGps(bytes));
```

Input can be a `Uint8Array`, a `Buffer`, an `ArrayBuffer`, or any
`ArrayBufferView`. In a browser: `new Uint8Array(await file.arrayBuffer())`.
The input is never mutated — writes return new bytes.

## What makes this different

Most EXIF libraries re-serialise the whole file to change one field. That is
what silently destroys a MakerNote with absolute offsets, an ICC profile, or a
thumbnail. This engine takes two routes and **neither moves an existing byte**:

- **P1** — in-place edit at constant length. The GPS values are overwritten
  where they already sit.
- **P2** — append. A new IFD0 is written at the end of the block and the header
  is re-pointed at it. Value offsets are absolute from the start of the block,
  so everything that existed stays valid, bit for bit.

Then it proves it. Before any file is returned:

1. The produced file must be **identical to the original everywhere outside the
   ranges the engine itself declared**. Not "same size" — identical. A bug that
   zeroes 200 kB of MakerNote passes a size check without a word.
2. The location is **re-read from the produced bytes**, with the structure
   relocated from byte zero.
3. A **second, independent reader** must agree. A codec and a decoder that are
   symmetrically wrong pass a self-check with a drift of exactly zero.

If any check fails, nothing is returned — the call throws and your original is
untouched. This library would rather fail loudly than hand back a file you
believe is correct.

## Formats

JPEG · PNG · WebP · HEIC · HEIF · AVIF · TIFF · MP4 · M4V · MOV

Detected from the file's own bytes, never from the extension.

Not every operation is possible on every file, and the library tells you before
you try:

```js
import { inspect } from '@geotager/core';

const { format, hasGps, can, reason } = inspect(bytes);
// can.replaceLocation can be true while can.addLocation is false:
// overwriting a location keeps the file the same length, creating one does not.
```

This is the same probe the engine uses internally, so what it reports and what
happens next cannot disagree. A digital negative (DNG, NEF, CR2) refuses new
bytes outright — it is an irreplaceable original.

## API

| Function | Returns |
| --- | --- |
| `readGps(input)` | `{ lat, lng, alt? }` or `null`. Synchronous. |
| `readMetadata(input)` | Location, altitude, capture time, camera, capabilities, details. |
| `inspect(input)` | What is possible for this file, before acting. |
| `detectFormat(input)` | Format from the bytes alone. |
| `setGps(input, { lat, lng, alt? }, opts?)` | New bytes. Throws on failure. |
| `stripGps(input)` | New bytes with no location. Throws on failure. |
| `stripAllMetadata(input)` | New bytes with no metadata at all. Pixels untouched. |
| `applyGps(input, operation)` | Same work, but returns the refusal instead of throwing. |

Coordinate helpers are also exported: `parseCoordinates` (decimal, DMS, or a
Google Maps paste), `formatDecimal`, `formatDms`, `distanceMetres`.

### Errors

`setGps`, `stripGps` and `stripAllMetadata` throw a `GeotagError` with a stable
`code` rather than return a file they could not verify:

```js
import { GeotagError, setGps } from '@geotager/core';

try {
  await setGps(bytes, { lat: 48.8584, lng: 2.2945 });
} catch (e) {
  if (e instanceof GeotagError) console.error(e.code, e.message);
}
```

For batches, `applyGps` returns the refusal as a value so one bad file does not
abort the rest:

```js
const r = await applyGps(bytes, { kind: 'set', lat: 48.8584, lng: 2.2945 });
if (r.ok) await writeFile(out, r.bytes);
else console.error(r.code, r.message);
```

### Altitude

`alt` is in metres, positive above sea level. It is only written when you pass
it — a file that had no altitude does not gain an invented one.

If the file cannot carry an altitude, the call **fails** rather than quietly
dropping it. `GPSAltitude` is always a positive rational and `GPSAltitudeRef`
carries the sign, so a reader that ignores the second byte puts the Dead Sea
860 m from where it is. Both are written, and both are read.

## Subpath exports

`@geotager/core/coords` and `@geotager/core/capabilities` are pure: importing
them does not pull in the binary engine. Useful when you want coordinate parsing
or the format/capability matrix on a main thread while the engine lives in a
worker.

## Privacy

This library makes **no network requests** and has no networking code. It does
not touch the filesystem either — you hand it bytes, it hands bytes back. Where
those bytes come from and where they go is entirely yours to decide.

## Licence

MIT. Source: <https://github.com/MathieuSoysal/geotager>
