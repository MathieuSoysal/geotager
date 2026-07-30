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
  /*
   * HTML compression is disabled, and that is not a retreat from being light.
   *
   * It does not reduce end-of-line whitespace: it removes it. In a paragraph
   * written across several lines, which is all the prose in this repository, a
   * line break followed by an inline tag produced "collez-la avec<kbd>Ctrl</kbd>",
   * "transmis à un<a>Web Worker</a>", "<code>GPSLatitudeRef</code>vaut « N »".
   * The last two were on the home page, shipped for months: the bug throws
   * nothing, breaks nothing, and shows only when reading the page.
   *
   * The cost, measured over sixteen pages: 29 KB raw, 4.9 KB once compressed by
   * the host, about 300 bytes per page. The gain: the words are separated.
   *
   * `false` rather than `true`, even though `true` would today preserve those
   * spaces: `true` is not this version's default, which means it names a
   * compressor, and a compressor can become more zealous between versions.
   * `false` names the absence of one, and an absence does not change behaviour.
   * The check in `check-build.mjs` remains the judge: it refuses a word stuck
   * to its tag whatever the reason.
   */
  compressHTML: false,
  vite: {
    build: { target: 'es2022' },
    worker: { format: 'es' },
  },
});
