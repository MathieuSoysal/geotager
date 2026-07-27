/**
 * Enregistre les conteneurs connus, une fois pour toutes.
 *
 * L'enregistrement est fait ici, explicitement, plutôt que par effet de bord à
 * l'import de chaque module : un effet de bord est exactement ce qu'un
 * empaqueteur a le droit d'élaguer quand il croit le module inutilisé. Le jour
 * où cela arriverait, le format disparaîtrait silencieusement de l'outil.
 */
import { enregistrer } from './conteneurs.ts';
import { conteneurJpeg } from './jpeg.ts';
import { conteneurIsobmff } from './isobmff.ts';
import { conteneurPng } from './png.ts';
import { conteneurRiff } from './riff.ts';

let fait = false;

export function enregistrerLesFormats(): void {
  if (fait) return;
  fait = true;
  enregistrer(conteneurJpeg);
  enregistrer(conteneurIsobmff);
  enregistrer(conteneurPng);
  enregistrer(conteneurRiff);
}

enregistrerLesFormats();
