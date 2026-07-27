// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://geotagor.fr',
  output: 'static',
  // Inlined stylesheets would become <style> elements the content security
  // policy blocks, for want of 'unsafe-inline'. They stay as files.
  build: { inlineStylesheets: 'never' },
  vite: {
    build: { target: 'es2022' },
    worker: { format: 'es' },
  },
});
