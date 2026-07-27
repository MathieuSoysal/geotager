// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://geotager.app',
  output: 'static',
  // Les feuilles inlinées deviendraient des <style> que la politique de sécurité
  // du contenu bloque, faute de 'unsafe-inline'. On les garde en fichiers.
  build: { inlineStylesheets: 'never' },
  vite: {
    build: { target: 'es2022' },
    worker: { format: 'es' },
  },
});
