/**
 * Les dates, demandées à ce qui les SAIT.
 *
 * Trois endroits en ont besoin : le `lastmod` du plan du site, et les dates de
 * publication et de mise à jour que chaque guide déclare. Un horodatage de
 * build changerait à chaque déploiement sans qu'une ligne ait bougé — Google
 * ne lit `lastmod` que s'il est « consistently and verifiably accurate », et
 * une date de publication qui rajeunit à chaque déploiement est simplement
 * fausse.
 *
 * On interroge donc l'historique. Et si personne ne peut répondre — clone
 * superficiel, image de build sans git, fichier pas encore committé — on
 * n'écrit pas la date. Une absence est honnête ; une date inventée ne l'est
 * pas. C'est la règle posée par Q-046, ici tenue pour les guides aussi.
 *
 * Ce module ne s'exécute qu'au build : il est importé par des routes et des
 * composants `.astro`, dont le code d'en-tête tourne sous Node et ne part
 * jamais au navigateur.
 */
import { execFileSync } from 'node:child_process';

const EST_UNE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Une commande git dont l'échec vaut « je ne sais pas », jamais une exception. */
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

/** Le jour du dernier changement réel de ces fichiers, ou null. */
export function derniereMaj(chemins: string[]): string | null {
  const [ligne] = git(['log', '-1', '--format=%cs', '--', ...chemins]);
  return ligne && EST_UNE_DATE.test(ligne) ? ligne : null;
}

/**
 * Le jour où le premier de ces fichiers est apparu, ou null.
 *
 * `--diff-filter=A` ne retient que les commits qui AJOUTENT un fichier, et
 * `--reverse` les rend du plus ancien au plus récent : la première ligne est
 * donc la naissance de la page. Sans le filtre, on obtiendrait le premier
 * commit touchant ces chemins dans l'ordre inverse, ce qui est la même chose
 * que `derniereMaj` — et une date de publication égale à la date de
 * modification n'apprend rien à personne.
 */
export function premierAjout(chemins: string[]): string | null {
  const [ligne] = git(['log', '--diff-filter=A', '--format=%cs', '--reverse', '--', ...chemins]);
  return ligne && EST_UNE_DATE.test(ligne) ? ligne : null;
}
