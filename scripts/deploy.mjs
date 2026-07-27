/**
 * Garde-fou de déploiement.
 *
 * Le §7.7 bis notait « rien dans le dépôt ne protège de ce réglage », et
 * Q-038 l'a vérifié : la « Version command » du tableau de bord avait été
 * passée à `npx wrangler deploy`, si bien qu'une poussée sur une branche de
 * travail a mis en ligne, sur le domaine public, du code d'une PR ouverte et
 * non relue. Un réglage de tableau de bord ne laisse aucune trace dans le
 * dépôt, et une confirmation datée dit ce qui a été vu un jour, pas ce qui
 * tient.
 *
 * Ce script remet la décision dans le dépôt : c'est LUI qui choisit entre
 * publier une version et promouvoir en production, à partir de la branche
 * construite. Il échoue plutôt que de deviner.
 *
 * Pour qu'il protège quoi que ce soit, les DEUX commandes du tableau de bord
 * — « Deploy command » et « Version command » — doivent valoir `npm run
 * deploy`. Tant que ce n'est pas fait, le réglage reste le seul maître, et
 * c'est exactement ce que Q-038 reproche.
 */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const BRANCHE_DE_PRODUCTION = 'main';

/**
 * Ce qu'il faut faire de cette branche-là.
 *
 * Fonction pure, pour que la décision soit éprouvable sans rien déployer :
 * un garde-fou qu'aucun test n'exerce est un ornement.
 *
 * Rend `null` quand la branche est inconnue. Le doute vaut refus — c'est la
 * règle du projet, et elle vaut ici comme ailleurs.
 */
export function commandePour(branche) {
  const nom = (branche ?? '').trim();
  if (!nom) return null;
  return nom === BRANCHE_DE_PRODUCTION
    ? ['wrangler', 'deploy']
    : ['wrangler', 'versions', 'upload'];
}

// N'agit que lancé directement, jamais quand un test l'importe.
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
