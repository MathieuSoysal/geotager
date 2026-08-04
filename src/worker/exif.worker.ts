/// <reference lib="webworker" />
/**
 * Worker de métadonnées.
 *
 * Tout le travail binaire vit dans `@geotager/core` : ce fichier ne fait plus
 * que traduire le protocole de messages du navigateur en appels au moteur, et
 * retraduire les résultats. Le thread principal, lui, ne fait que passer des
 * octets et afficher ce qui revient — tout ce qui coûte est de ce côté-ci.
 *
 * Le moteur a été extrait d'ici, et ce n'était pas un rangement. Tant qu'il
 * vivait dans ce fichier, aucun test ne pouvait l'atteindre : `engine.test.ts`
 * n'importe pas un module qui tire `self` et le protocole de messages. C'est
 * très exactement ainsi qu'un contrôle qui refusait TOUTES les vidéos avait été
 * livré au vert — voir le commentaire de `verifierVideo` dans le moteur. Ce qui
 * reste ici est ce qu'un test ne peut de toute façon pas exécuter, et rien de
 * plus.
 *
 * Aucune requête réseau n'est émise depuis ce fichier ni depuis le moteur, et
 * il n'en émettra jamais — c'est vérifiable dans le dépôt public.
 */
import { ExifError, appliquer, lire } from '@geotager/core';
import type { FromWorker, ToWorker } from '@geotager/core';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  void (async () => {
    if (msg.type === 'read') {
      try {
        const payload = await lire(msg.id, msg.name, new Uint8Array(msg.buffer));
        post({ type: 'read:ok', payload });
      } catch (e) {
        const err = e instanceof ExifError ? e : null;
        post({
          type: 'read:fail',
          id: msg.id,
          name: msg.name,
          code: err?.code ?? 'ERREUR_INATTENDUE',
          message: err?.message ?? "Ce fichier n'a pas pu être lu.",
        });
      }
      return;
    }
    if (msg.type === 'apply') {
      const payload = await appliquer(
        msg.id,
        msg.name,
        new Uint8Array(msg.buffer),
        msg.operation,
      );
      if (payload.ok) {
        post({ type: 'apply:done', payload }, [payload.bytes.buffer]);
      } else {
        post({ type: 'apply:done', payload });
      }
    }
  })();
});

function post(message: FromWorker, transfer: Transferable[] = []): void {
  ctx.postMessage(message, transfer);
}
