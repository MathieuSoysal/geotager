/** Le manifeste français. Même `id` que l'anglais : une seule application. */
import type { APIRoute } from 'astro';
import { manifeste } from '../../lib/manifeste.ts';

export const GET: APIRoute = () =>
  new Response(manifeste('fr'), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  });
