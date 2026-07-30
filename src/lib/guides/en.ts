/**
 * The English guides. The shape is imposed by `types.ts`.
 *
 * Two budgets govern the strings below, and both are enforced by
 * `check-build.mjs` rather than by good intentions: 49 characters for `titre`
 * — the shell adds « — Geotager », and the rendered title is capped at 60 —
 * and 155 for `description`. Past either cap a search engine truncates the
 * sentence and picks the cut itself.
 *
 * Unlike the interface, this prose may name the format. The ban on jargon in
 * `i18n/en.ts` protects someone walking through the tool with a photo they
 * care about; a guide is read by someone who came looking for the word.
 */
import type { Guides } from './types.ts';

export const guidesEn: Guides = {
  sommaire: {
    segment: 'guides',
    titre: 'Photo location guides',
    h1: 'Guides: the location stored in a photo',
    description:
      'Plain guides to reading, changing, adding and removing the GPS location stored inside a photo — on any device, without uploading the file.',
  },

  fiches: {
    modifier: {
      segment: 'change-photo-location',
      titre: 'How to change a photo’s GPS location',
      h1: 'How to change the GPS location of a photo',
      description:
        'Replace the GPS coordinates stored in a JPEG, HEIC, PNG, WebP or TIFF photo, in your browser, without re-encoding the image or uploading it.',
      resume:
        'Replace or correct the coordinates a photo already carries, without touching a single pixel.',
    },

    verifier: {
      segment: 'check-photo-location',
      titre: 'How to check where a photo was taken',
      h1: 'How to check the GPS location of a photo',
      description:
        'See whether a photo carries a location, and read the exact coordinates — on Windows, macOS, iPhone, Android, or in your browser with nothing installed.',
      resume:
        'Find out whether a photo carries a location at all, and read the exact coordinates it holds.',
    },

    supprimer: {
      segment: 'remove-photo-location',
      titre: 'How to remove a photo’s GPS location',
      h1: 'How to remove the GPS location from a photo',
      description:
        'Strip the GPS coordinates from a photo before you send or publish it, and check that no copy of the location survives anywhere in the file.',
      resume:
        'Take the location out before you publish or send, and confirm no copy of it survives.',
    },

    ajouter: {
      segment: 'add-location-to-photo',
      titre: 'How to add a GPS location to a photo',
      h1: 'How to add a location to a photo that has none',
      description:
        'Give a place to a scan, a screenshot or a photo shot with location switched off — and know in advance which files will accept one and which will not.',
      resume:
        'Give a place to a scan, a screenshot, or a photo taken with location switched off.',
    },

    iphone: {
      segment: 'iphone-photo-location',
      titre: 'Change a photo’s location on iPhone',
      h1: 'Change or remove a photo’s location on iPhone',
      description:
        'What Adjust Location in the Photos app really changes, why the location can come back, and how to edit the HEIC file itself so the change travels with it.',
      resume:
        'What the Photos app actually changes, and how to edit the file itself so the change travels with it.',
    },

    reseaux: {
      segment: 'social-networks-photo-location',
      titre: 'Which apps remove a photo’s location?',
      h1: 'Which apps remove a photo’s location, and which pass it on',
      description:
        'Most social networks drop the location because they re-encode your photo. That is a side effect, not a promise — and sending it as a file bypasses it.',
      resume:
        'Why “they strip it anyway” is a side effect rather than a promise, and where it stops being true.',
    },
  },
};
