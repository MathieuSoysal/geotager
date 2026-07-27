/**
 * Registers the known containers, once.
 *
 * Registration happens here explicitly rather than as an import side effect in
 * each format module, because a bundler is free to drop a module it believes
 * unused, which would make a format disappear from the tool silently.
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
