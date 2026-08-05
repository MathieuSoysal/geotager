/**
 * The text the « Onboard your agent » button puts in the clipboard.
 *
 * One sentence, in English on both language versions: it is addressed to the
 * machine it gets pasted into, and the document it designates exists in
 * English only. The words *around* the gesture — the button, the confirmation
 * — are the user's and live in the dictionaries.
 *
 * It carries no summary of the instructions, deliberately.
 * `/agent-setup/prompt.md` names itself as the only version that is
 * authoritative; a summary here would be a second version, and the second
 * version is the one that goes stale. The agent is told to fetch, and the
 * fetch is the feature.
 *
 * The end-to-end test imports this constant and compares it to what a real
 * click put in a real clipboard: a value copied into a test is a value that
 * eventually diverges from the one that ships.
 */
export const INVITE_AGENT =
  'Fetch and execute the appropriate instructions to set me up for Geotager from https://geotager.app/agent-setup/prompt.md';
