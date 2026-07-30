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
  vite: {
    build: { target: 'es2022' },
    worker: { format: 'es' },
  },
});
