# geotager

Read, write and remove the GPS location in photos and videos, from the command
line. **Nothing is uploaded** — this tool makes no network requests at all.

```bash
npx geotager read photo.jpg
```

No install needed. The command line for [geotager.app](https://geotager.app),
built on [`@geotager/core`](https://www.npmjs.com/package/@geotager/core).

## Commands

```bash
geotager read <files...>                        # print GPS data as JSON
geotager set  <files...> --lat <n> --lng <n>    # write a location
geotager strip <files...>                       # remove the location
```

### Read

```bash
npx geotager read photo.jpg
```

```json
[
  {
    "file": "photo.jpg",
    "format": "jpeg",
    "size": 161713,
    "gps": { "lat": 43.46744833333334, "lng": 11.885126666663888 },
    "takenAt": "2008-10-22T16:28:39.000Z",
    "camera": "NIKON COOLPIX P6000",
    "can": {
      "read": true,
      "replaceLocation": true,
      "addLocation": true,
      "removeLocation": true,
      "removeAllMetadata": true
    },
    "reason": "ok"
  }
]
```

JSON goes to **stdout** and nothing else ever does, so `geotager read '*.jpg' |
jq` needs no filtering. The human-readable summary goes to stderr; `--quiet`
silences that and never the JSON.

`"gps": null` means no usable location. It is never guessed.

### Set

```bash
npx geotager set photo.jpg --lat 48.8584 --lng 2.2945
npx geotager set photo.jpg --lat 48.8584 --lng 2.2945 --alt 35
npx geotager set '*.jpg' --lat -33.8688 --lng 151.2093 --out ./tagged
```

The location reported back is **re-read from the file that was just written**,
not echoed from your arguments.

### Strip

```bash
npx geotager strip photo.jpg
npx geotager strip '*.heic' --out ./clean
npx geotager strip photo.jpg --all-metadata
```

Date, camera and exposure survive unless you pass `--all-metadata`. Pixels are
never re-encoded.

Every place the file stores the location is removed, not just the main one — a
HEIC can carry a second copy on its thumbnail, a video stores it in several
places at once. If a copy survives in a form the tool cannot remove, the file is
**refused** rather than handed back looking clean.

## Where output goes

**Originals are never overwritten unless you pass `--in-place`.**

| Command | Input | Output |
| --- | --- | --- |
| `set photo.jpg --lat … --lng …` | `photo.jpg` | `photo-geotagged.jpg` |
| `strip photo.jpg` | `photo.jpg` | `photo-no-location.jpg` |
| `strip photo.jpg --all-metadata` | `photo.jpg` | `photo-no-metadata.jpg` |
| `… --out ./dir` | `photo.jpg` | `./dir/photo.jpg` |
| `… --in-place` | `photo.jpg` | `photo.jpg` (overwritten) |

If `--out` resolves to the source directory, that file is refused rather than
overwritten. `--dry-run` reports what would be written and writes nothing.

## Globs

Quote them. geotager expands patterns itself, so they behave identically on
Windows, inside a `spawn()` with no shell, and inside quotes:

```bash
npx geotager read '*.jpg'
npx geotager set '**/*.{jpg,heic}' --lat 35.6762 --lng 139.6503 --out ./tagged
```

Supported: `*` `?` `[abc]` `[!abc]` `{a,b}` and `**` for recursive descent. A
bare directory means its files, not its subdirectories.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success. Every file was processed. |
| `1` | At least one file failed. Those files were left untouched. |
| `2` | Usage error. Nothing was read or written. |
| `3` | No input files matched. |

On exit `1`, each failed entry in the JSON has `"ok": false` and an `error`
object with a stable `code`.

## Formats

JPEG · PNG · WebP · HEIC · HEIF · AVIF · TIFF · MP4 · M4V · MOV — detected from
the file's own bytes, never from the extension.

Not everything is possible on every file. `geotager read` reports it per file:
on an iPhone photo `replaceLocation` is often `true` while `addLocation` is
`false`, because overwriting a location keeps the file the same length and
creating one from nothing does not.

## Every write is verified

Before a file is written, the produced bytes must be identical to the original
**everywhere outside the location itself**, the location must re-read correctly
from the produced bytes, and a second independent reader must agree. If any
check fails, nothing is written and your original is left alone.

## Privacy

No network requests. `npx` fetches the package once; after that nothing leaves
your machine. There is no telemetry, no analytics, and no server.

## Help

```bash
npx geotager --help
npx geotager set --help
```

## Licence

MIT. Source: <https://github.com/MathieuSoysal/geotager>
