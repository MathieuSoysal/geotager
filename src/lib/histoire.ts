/**
 * Dates, asked of whatever knows them.
 *
 * Three places need them: the sitemap's `lastmod`, and the publication and
 * update dates each guide declares. A build timestamp would change on every
 * deployment without a line having moved, and Google only reads `lastmod` if it
 * is "consistently and verifiably accurate".
 *
 * So the history is queried. And if nobody can answer, on a shallow clone, a
 * build image without git, or a file not yet committed, no date is written. An
 * absence is honest; an invented date is not.
 *
 * This module only runs at build time: it is imported by routes and `.astro`
 * components, whose frontmatter runs under Node and never reaches the browser.
 */
import { execFileSync } from 'node:child_process';

const EST_UNE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A git command whose failure means "I do not know", never an exception. */
function git(args: string[]): string[] {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** The day these files last really changed, or null. */
export function derniereMaj(chemins: string[]): string | null {
  const [ligne] = git(['log', '-1', '--format=%cs', '--', ...chemins]);
  return ligne && EST_UNE_DATE.test(ligne) ? ligne : null;
}

/**
 * The day the first of these files appeared, or null.
 *
 * `--diff-filter=A` keeps only commits that add a file, and `--reverse` returns
 * them oldest first, so the first line is the page's birth. Without the filter
 * we would get the first commit touching these paths in reverse order, which is
 * the same thing as `derniereMaj`, and a publication date equal to the
 * modification date tells nobody anything.
 */
export function premierAjout(chemins: string[]): string | null {
  const [ligne] = git(['log', '--diff-filter=A', '--format=%cs', '--reverse', '--', ...chemins]);
  return ligne && EST_UNE_DATE.test(ligne) ? ligne : null;
}
