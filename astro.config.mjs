// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://geotager.app',
  output: 'static',
  // Inlined stylesheets would become <style> elements the content security
  // policy blocks, for want of 'unsafe-inline'. They stay as files.
  //
  // `preserve` emits files as they are laid out in the sources. The two pages
  // do not move, since `index.astro` already produced `index.html`, but the
  // French error page comes out as `fr/404.html` instead of `fr/404/index.html`.
  // That is the only name the host looks for when an address leads nowhere:
  // under the other form it would never be served.
  build: { inlineStylesheets: 'never', format: 'preserve' },
  vite: {
    build: { target: 'es2022' },
    worker: { format: 'es' },
  },
});
