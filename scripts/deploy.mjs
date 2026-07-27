/**
 * Deployment guard rail.
 *
 * Nothing in the repository protected against the dashboard setting, and that
 * was borne out: the dashboard's "Version command" had been switched to
 * `npx wrangler deploy`, so a push to a working branch put unreviewed code from
 * an open pull request live on the public domain. A dashboard setting leaves no
 * trace in the repository, and a dated confirmation says what was seen one day,
 * not what holds.
 *
 * This script puts the decision back in the repository: it is what chooses
 * between publishing a version and promoting to production, from the branch
 * being built. It fails rather than guess.
 *
 * For it to protect anything, both dashboard commands, "Deploy command" and
 * "Version command", must be `npm run deploy`. Until that is done the setting
 * remains the only authority.
 */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const BRANCHE_DE_PRODUCTION = 'main';

/**
 * What to do with this particular branch.
 *
 * A pure function, so the decision can be tested without deploying anything: a
 * guard rail no test exercises is an ornament.
 *
 * Returns `null` when the branch is unknown. Doubt means refusal.
 */
export function commandePour(branche) {
  const nom = (branche ?? '').trim();
  if (!nom) return null;
  return nom === BRANCHE_DE_PRODUCTION
    ? ['wrangler', 'deploy']
    : ['wrangler', 'versions', 'upload'];
}

// Acts only when run directly, never when a test imports it.
const lanceDirectement =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (lanceDirectement) {
  const branche = (process.env.WORKERS_CI_BRANCH ?? '').trim();
  const commande = commandePour(branche);

  if (!commande) {
    console.error(
      'Déploiement refusé : WORKERS_CI_BRANCH est vide.\n' +
        "Ce script ne s'exécute que dans la construction Workers, qui la renseigne.",
    );
    process.exit(1);
  }

  console.log(
    branche === BRANCHE_DE_PRODUCTION
      ? `Branche « ${branche} » : promotion en production.`
      : `Branche « ${branche} » : téléversement d'une version, sans promotion.`,
  );

  const r = spawnSync('npx', commande, { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
