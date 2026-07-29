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

      /*
       * Receiving a photo from the system share sheet.
       *
       * `POST` as `multipart/form-data`: the only form the API accepts for
       * files. There is nonetheless no server to receive it; the service worker
       * intercepts it, keeps the bytes in memory, and passes them to the page
       * that follows. Nothing is written to disk, not even briefly. See
       * `sw-modele.js`.
       *
       * Images only. The tool accepts videos in the picker, since taking the
       * file and explaining beats refusing it without a word, but registering
       * in the video share menu would be volunteering for work we cannot do.
       */
      share_target: {
        action: `${T.base}partager`,
        method: 'POST',
        enctype: 'multipart/form-data',
        params: {
          files: [
            {
              name: 'photos',
              accept: [
                'image/*',
                'image/jpeg',
                'image/png',
                'image/webp',
                'image/heic',
                'image/heif',
                'image/avif',
                'image/tiff',
              ],
            },
          ],
        },
      },

      /*
       * "Open with". Simpler and cleaner than sharing: the system hands over a
       * file handle directly, with no request and no form body, so there is
       * nothing to keep between two moments.
       *
       * `single-client`: one window receives the whole batch, instead of
       * opening one per photo.
       */
      file_handlers: [
        {
          action: T.base,
          accept: {
            'image/jpeg': ['.jpg', '.jpeg'],
            'image/png': ['.png'],
            'image/webp': ['.webp'],
            'image/heic': ['.heic'],
            'image/heif': ['.heif'],
            'image/avif': ['.avif'],
            'image/tiff': ['.tif', '.tiff'],
          },
          launch_type: 'single-client',
        },
      ],
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
