/**
 * The help text.
 *
 * It is written for two readers, and the second is new: a language model that
 * discovers the tool by running `geotager --help`, and has to produce a correct
 * command line first time, without trial and error on somebody's files.
 *
 * What that imposes, and it is not how help pages are usually written:
 *
 *   - fixed upper-case section headings (USAGE, COMMANDS, OPTIONS, EXIT CODES,
 *     EXAMPLES) that can be found by exact match rather than by guessing at
 *     the layout;
 *   - the syntax of each command given whole, never in pieces to reassemble;
 *   - the exit codes written out, because a calling program tests them and has
 *     no way to guess them;
 *   - the exact shape of `read`'s output, since it is meant to be parsed;
 *   - complete, copyable examples, paths included.
 *
 * No colour, no boxes, no fixed width: those are precisely the things that
 * survive a pipe badly and make help unpleasant for a machine to read.
 */

export const VERSION = '1.0.0';

const ENTETE = `geotager ${VERSION} — read, write and remove GPS location in photos and videos.

Everything happens on this machine. No file, no coordinate and no byte is ever
sent anywhere: this tool makes no network requests at all.`;

export const AIDE_GENERALE = `${ENTETE}

USAGE
  geotager <command> [files...] [options]

COMMANDS
  read <files...>                          Print GPS data as JSON.
  set <files...> --lat <n> --lng <n>       Write a GPS location.
  strip <files...>                         Remove the GPS location.

  Run "geotager <command> --help" for the full options of one command.

FILE ARGUMENTS
  Every command takes one or more paths. All of these work:
    photo.jpg                  a single file
    a.jpg b.jpg c.jpg          several files
    '*.jpg'                    a glob, quoted so the shell leaves it alone
    'photos/**/*.{jpg,heic}'   a recursive glob
    photos/                    a directory (its files, not its subdirectories)

  Globs are expanded by geotager itself, so they work identically on Windows,
  in a bare spawn() with no shell, and inside quotes. Supported: * ? [abc]
  [!abc] {a,b} and ** for recursive descent.

SUPPORTED FORMATS
  JPEG, PNG, WebP, HEIC, HEIF, AVIF, TIFF, MP4, M4V, MOV.
  The format is detected from the file's own bytes, never from its extension.

GLOBAL OPTIONS
  -h, --help        Show help and exit 0.
  -v, --version     Print the version and exit 0.
  -q, --quiet       Suppress the human-readable summary on stderr.
                    JSON on stdout is never suppressed.

EXIT CODES
  0   Success. Every file was processed.
  1   Partial or total failure. At least one file could not be processed;
      the files that failed were left untouched. Details go to stderr, and
      to the JSON report on stdout.
  2   Usage error. Bad or missing arguments; nothing was read or written.
  3   No input files. The paths or globs given matched nothing.

EXAMPLES
  geotager read photo.jpg
  geotager read '*.jpg' > locations.json
  geotager set photo.jpg --lat 48.8584 --lng 2.2945
  geotager strip '*.heic' --out ./clean

SAFETY
  Originals are never overwritten unless you pass --in-place. By default a
  new file is written next to the original with a suffix added to its name.

  Every write is verified before it is handed back: the produced file must be
  byte-for-byte identical to the original everywhere outside the location
  itself, and two independent readers must agree on what it now says. If a
  check fails, the file is not written and the original is left intact.

LEARN MORE
  https://geotager.app`;

export const AIDE_READ = `geotager read — print the GPS location of files as JSON.

USAGE
  geotager read <files...> [options]

OPTIONS
      --all         Include files whose extension is not a known media type.
  -q, --quiet       Suppress the summary on stderr.
  -h, --help        Show this help and exit 0.

OUTPUT
  A JSON array on stdout, one object per file, in the order the files were
  given. Reading never modifies anything.

  Every object has this exact shape:

  [
    {
      "file": "photo.jpg",
      "format": "jpeg",
      "size": 2411244,
      "gps": { "lat": 48.8584, "lng": 2.2945, "alt": 33.5 },
      "takenAt": "2024-06-01T10:32:11.000Z",
      "camera": "Apple iPhone 15 Pro",
      "can": {
        "read": true,
        "replaceLocation": true,
        "addLocation": false,
        "removeLocation": true,
        "removeAllMetadata": true
      },
      "reason": "ok"
    }
  ]

  FIELD NOTES
    gps        null when the file carries no usable location. Never guessed.
               "alt" is in metres above sea level and is omitted when absent.
    takenAt    ISO 8601 string, or null.
    camera     Maker and model joined by a space, or null.
    can        What this tool can do to THIS file, not to its format.
               "replaceLocation" can be true while "addLocation" is false:
               overwriting a location already present keeps the file the same
               length, creating one from nothing does not.
    reason     A stable key explaining "can", never a sentence. One of:
               ok, sans-lieu, sans-emplacement, forme-inhabituelle,
               rangement-inconnu, copie-compressee, copie-ailleurs,
               lecture-seule, sans-lieu-possible, lieu-en-mouvement, inconnu.
    error      Present INSTEAD of the other fields when the file could not be
               read at all: { "file": "...", "error": { "code", "message" } }.

EXIT CODES
  0   Every file was read.
  1   At least one file could not be read.
  2   Usage error.
  3   No input files matched.

EXAMPLES
  geotager read photo.jpg
  geotager read '*.jpg' '*.heic'
  geotager read photos/ --quiet > locations.json`;

export const AIDE_SET = `geotager set — write a GPS location into files.

USAGE
  geotager set <files...> --lat <degrees> --lng <degrees> [options]

REQUIRED
      --lat <n>     Latitude in decimal degrees, -90 to 90.
      --lng <n>     Longitude in decimal degrees, -180 to 180. Alias: --lon
                    Negative values are fine: --lat -33.8688 --lng 151.2093

OPTIONS
      --alt <n>     Altitude in metres above sea level. Negative is below.
                    Fails the file rather than silently dropping it if the
                    file cannot carry an altitude.
      --accuracy <n>  Horizontal accuracy in metres, written to
                    GPSHPositioningError. Only pass a MEASURED value; an
                    invented one is worse than none.
  -o, --out <dir>   Write results into <dir>, keeping each original filename.
                    The directory is created if it does not exist.
      --in-place    Overwrite the originals. Without this flag, and without
                    --out, a new file is written next to each original.
      --suffix <s>  Suffix for the new filename. Default: -geotagged
      --no-suffix   Use the original filename unchanged. Requires --out.
      --all         Include files whose extension is not a known media type.
  -n, --dry-run     Report what would be written, write nothing.
  -q, --quiet       Suppress the summary on stderr.
  -h, --help        Show this help and exit 0.

OUTPUT NAMING
  Default          photo.jpg      -> photo-geotagged.jpg
  With --out dir   photo.jpg      -> dir/photo.jpg
  With --in-place  photo.jpg      -> photo.jpg (overwritten)

  geotager refuses to write onto an input file unless --in-place was passed,
  even if --out happens to resolve to the source directory.

OUTPUT
  A JSON array on stdout, one object per file:

  [
    {
      "file": "photo.jpg",
      "output": "photo-geotagged.jpg",
      "ok": true,
      "gps": { "lat": 48.8584, "lng": 2.2945 },
      "bytesIdenticalOutsideLocation": true,
      "sameLength": true
    }
  ]

  A file that could not be written has "ok": false and an "error" object with
  a stable "code", and no "output" key. It was left untouched.

EXIT CODES
  0   Every file was written.
  1   At least one file could not be written. Those files are unchanged.
  2   Usage error, including a missing or out-of-range --lat/--lng.
  3   No input files matched.

EXAMPLES
  geotager set photo.jpg --lat 48.8584 --lng 2.2945
  geotager set photo.jpg --lat 48.8584 --lng 2.2945 --alt 33
  geotager set '*.jpg' --lat -33.8688 --lng 151.2093 --out ./tagged
  geotager set photo.jpg --lat 48.8584 --lng 2.2945 --in-place
  geotager set '**/*.heic' --lat 35.6762 --lng 139.6503 --dry-run`;

export const AIDE_STRIP = `geotager strip — remove the GPS location from files.

USAGE
  geotager strip <files...> [options]

OPTIONS
      --all-metadata  Remove every metadata block, not just the location.
                      Pixels are untouched; the image is never re-encoded.
                      Not supported on every format; "geotager read" reports
                      this per file as can.removeAllMetadata.
  -o, --out <dir>   Write results into <dir>, keeping each original filename.
                    The directory is created if it does not exist.
      --in-place    Overwrite the originals. Without this flag, and without
                    --out, a new file is written next to each original.
      --suffix <s>  Suffix for the new filename. Default: -no-location
                    (or -no-metadata with --all-metadata)
      --no-suffix   Use the original filename unchanged. Requires --out.
      --all         Include files whose extension is not a known media type.
  -n, --dry-run     Report what would be written, write nothing.
  -q, --quiet       Suppress the summary on stderr.
  -h, --help        Show this help and exit 0.

WHAT IS REMOVED
  Every place the file stores the location, not just the main one. A HEIC can
  carry a second copy attached to its thumbnail; a video stores it in several
  places at once. If a copy survives in a form this tool cannot remove, the
  file is REFUSED rather than returned looking clean. Handing back a file the
  user believes is scrubbed is the one failure this tool will not produce.

  Date, camera, exposure and the rest are kept unless --all-metadata is given.

OUTPUT NAMING
  Default          photo.jpg      -> photo-no-location.jpg
  With --out dir   photo.jpg      -> dir/photo.jpg
  With --in-place  photo.jpg      -> photo.jpg (overwritten)

OUTPUT
  A JSON array on stdout, one object per file:

  [
    {
      "file": "photo.jpg",
      "output": "photo-no-location.jpg",
      "ok": true,
      "gps": null,
      "bytesIdenticalOutsideLocation": true,
      "sameLength": true
    }
  ]

  "gps": null on success is the point: the produced file was re-read and no
  location was found in it.

EXIT CODES
  0   Every file was stripped.
  1   At least one file could not be stripped. Those files are unchanged.
  2   Usage error.
  3   No input files matched.

EXAMPLES
  geotager strip photo.jpg
  geotager strip '*.jpg' --out ./clean
  geotager strip '**/*' --all --in-place
  geotager strip photo.jpg --all-metadata`;
