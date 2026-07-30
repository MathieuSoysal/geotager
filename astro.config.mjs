// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://geotager.app',
  output: 'static',
  // Les feuilles inlinées deviendraient des <style> que la politique de sécurité
  // du contenu bloque, faute de 'unsafe-inline'. On les garde en fichiers.
  //
  // `preserve` produit les fichiers tels qu'ils sont rangés dans les sources.
  // Les deux pages ne bougent pas — `index.astro` donnait déjà `index.html` —
  // mais la page d'erreur française sort en `fr/404.html` au lieu de
  // `fr/404/index.html`. C'est le seul nom que l'hébergeur va chercher quand une
  // adresse ne mène nulle part : sous l'autre forme, elle ne serait jamais
  // servie.
  build: { inlineStylesheets: 'never', format: 'preserve' },
  /*
   * La compression du HTML est DÉSACTIVÉE, et ce n'est pas un renoncement à la
   * légèreté.
   *
   * Elle ne réduit pas l'espace en fin de ligne : elle le SUPPRIME. Dans un
   * paragraphe écrit sur plusieurs lignes — c'est-à-dire dans toute la prose de
   * ce dépôt — un retour à la ligne suivi d'une balise en ligne donnait
   * « collez-la avec<kbd>Ctrl</kbd> », « transmis à un<a>Web Worker</a> »,
   * « <code>GPSLatitudeRef</code>vaut « N » ». Les deux derniers étaient sur la
   * page d'accueil, livrés depuis des mois : le défaut ne lève rien, ne casse
   * rien, et ne se voit qu'en lisant la page.
   *
   * Ce que cela coûte, mesuré sur seize pages : 29 Ko bruts, 4,9 Ko une fois
   * compressé par l'hébergeur — environ 300 octets par page. Ce que cela
   * rapporte : les mots sont séparés.
   *
   * `false` plutôt que `true`, alors que `true` suffirait aujourd'hui à
   * préserver ces espaces-là : `true` n'est pas le défaut de cette version, ce
   * qui veut dire qu'il désigne un compresseur, et qu'un compresseur peut
   * devenir plus zélé d'une version à l'autre. `false` désigne l'absence de
   * compresseur, et l'absence ne change pas de comportement. Le contrôle
   * §3 bis de `check-build.mjs` reste le juge : il refuse un mot collé à sa
   * balise quelle que soit la raison — réglage, mise à jour, ou espace oublié
   * à la main.
   */
  compressHTML: false,
  vite: {
    build: { target: 'es2022' },
    worker: { format: 'es' },
  },
});
