/**
 * The text the « Onboard your agent » button puts in the clipboard.
 *
 * It is addressed to a machine, so it is English on both language versions:
 * the agents people paste it into read English, and the document it designates
 * exists in English only. The words *around* the gesture — the button, the
 * confirmation — are the user's and live in the dictionaries.
 *
 * Two rules keep this text honest. It must point at
 * `/agent-setup/prompt.md`, which that document itself names as the only
 * authoritative version; and its summary must stand on its own, because an
 * agent that cannot fetch will act on nothing else. Nothing here may promise
 * more than `public/agent-setup/prompt.md` does — when the two drift, that
 * file wins, and this one follows.
 *
 * The end-to-end test imports this constant and compares it to what a real
 * click put in a real clipboard: a value copied into a test is a value that
 * eventually diverges from the one that ships.
 */
export const INVITE_AGENT = `Onboard yourself to Geotager, the tool that reads, writes and removes the GPS location stored inside photo and video files, and verifies every write byte by byte.

Fetch https://geotager.app/agent-setup/prompt.md and follow it: it is the authoritative version of these instructions. The short form:

- You can run shell commands: use the CLI, with no install step.
    npx geotager read photo.jpg
    npx geotager set photo.jpg --lat 48.8584 --lng 2.2945
    npx geotager strip photo.jpg
  JSON comes back on stdout, and originals are never overwritten by default.
- You can only write text back to the user: hand them a pre-filled link such as
  https://geotager.app/?lat=48.8584&lng=2.2945 — they drop their photo on it,
  and the file never leaves their device.
- You are writing an application: npm install @geotager/core, then import
  readGps, setGps and stripGps. Bytes in, bytes out, no network.

Two rules. Never overwrite an original file unless the user explicitly asked
for it, and never guess coordinates: a wrong location written into a photo is
worse than none.
`;
