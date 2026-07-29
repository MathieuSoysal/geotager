/** Le manifeste anglais, servi à la racine. Voir `src/lib/manifeste.ts`. */
import type { APIRoute } from 'astro';
import { manifeste } from '../lib/manifeste.ts';

export const GET: APIRoute = () =>
  new Response(manifeste('en'), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  });
