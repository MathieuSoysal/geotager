/**
 * The application manifest, once per language.
 *
 * Two URLs, one `id`. That is what allows installing the tool under its French
 * name from `/fr/` and its English name from `/` without the system seeing two
 * applications: an installation's identity is `id` and nothing else. It is "/"
 * and it will never change; changing it would orphan every existing
 * installation, which would receive no further update and could not be replaced
 * either.
 *
 * The words come from the dictionary, as everywhere else: the manifest does not
 * reinvent a second wording of the title and description, which would drift
 * from the `head` at the first edit.
 *
 * Every address is relative to the origin. The build check requires it, and
 * this is the one file on the site where an icon hosted elsewhere would go
 * unnoticed.
 */
import type { Langue } from './i18n/types.ts';
import { DICOS } from './i18n/index.ts';

/** The application background: cold-start splash screen and title bar. */
export const FOND = '#17161b';

export function manifeste(langue: Langue): string {
  const T = DICOS[langue];
  return JSON.stringify(
    {
      id: '/',
      name: T.meta.titre,
      short_name: 'Geotager',
      description: T.meta.description,
      lang: T.htmlLang,
      dir: 'ltr',
      /* This language's page, and the shared scope: a French installation stays
         free to reach the English root. */
      start_url: T.base,
      scope: '/',
      display: 'standalone',
      display_override: ['standalone', 'minimal-ui', 'browser'],
      orientation: 'any',
      background_color: FOND,
      theme_color: FOND,
      categories: ['photo', 'utilities', 'productivity'],
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        /* A separate entry rather than a double `purpose` on the same image:
           the system crops a maskable icon by up to 20% on each side, and the
           same image would then be served cropped where it must not be. */
        {
          src: '/icons/icon-512-maskable.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
        { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      ],
    },
    null,
    2,
  );
}
