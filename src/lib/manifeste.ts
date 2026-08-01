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
import { DICOS, LANGUES } from './i18n/index.ts';

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
       * Naming itself, so the page can ask the browser whether the application
       * is already installed instead of inferring it from silence. See
       * `getInstalledRelatedApps` in `ui/app.ts`.
       *
       * Both manifests are listed, and that is not decorative symmetry: an
       * installation remembers the address of the manifest it was made from.
       * Installed from `/fr/`, it would not be recognised by an English page
       * that announced only its own.
       *
       * `prefer_related_applications` stays absent and must: set to true, the
       * installability criterion stops being met, no prompt is ever fired, and
       * the install button disappears everywhere without a word. The build
       * check refuses its return.
       */
      related_applications: LANGUES.map((l) => ({
        platform: 'webapp',
        url: `${DICOS[l].base}manifest.webmanifest`,
      })),

      /*
       * Receiving a photo from the system share sheet.
       *
       * `POST` as `multipart/form-data`: the only form the API accepts for
       * files. There is nonetheless no server to receive it; the service worker
       * intercepts it, keeps the bytes in memory, and passes them to the page
       * that follows. Nothing is written to disk, not even briefly. See
       * `sw-modele.js`.
       *
       * Videos have been here since all four cells of their row opened. They
       * were absent while no operation was offered for them: registering in the
       * share menu for a format you cannot handle is volunteering for work you
       * cannot do, to somebody who did not ask.
       *
       * `image/*` stays and has no counterpart opposite: sharing must remain
       * strictly wider than "Open with", for the reason explained below.
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
                'video/quicktime',
                'video/mp4',
              ],
            },
          ],
        },
      },

      /*
       * Which window receives an "Open with".
       *
       * `launch_handler.client_mode` is the standardised member, and it decides.
       * The early File Handling `launch_type`, written here until V1.4, meant
       * the same thing in only one browser and nothing read it elsewhere, so
       * the promise that one window receives the whole batch was written
       * without being kept. Two declarations that can contradict each other are
       * no better than one, so only this one is kept.
       *
       * `focus-existing`: the already-open window receives the batch without
       * being renavigated. That is what leaves it the photos it already held; a
       * reload would erase them, and nobody asked for that.
       */
      launch_handler: { client_mode: 'focus-existing' },

      /*
       * "Open with". Simpler than sharing: the system hands over a file handle
       * directly, with no request and no form body, so there is nothing to keep
       * between two moments. The batch is added to whatever the window already
       * held; see `charger` in `ui/app.ts`.
       *
       * The same formats as sharing, minus two. A GIF has nowhere to put a
       * location, so the engine files it under "no location possible", and a
       * camera raw file, DNG, NEF or CR2, must receive nothing at all.
       * Registering for those would be volunteering for work we cannot do.
       *
       * Videos arrived here with their "add" column. The test requires it both
       * ways: a format the table can give a location to but which was missing
       * here would stay invisible in the system's "Open with" menu, with
       * nothing to flag it.
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
            'video/quicktime': ['.mov'],
            'video/mp4': ['.mp4', '.m4v'],
          },
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
