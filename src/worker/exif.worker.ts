/// <reference lib="webworker" />
/**
 * Metadata worker.
 *
 * All the binary work lives in `@geotager/core`: this file only translates the
 * browser's message protocol into engine calls and translates the results back.
 * The main thread does nothing but pass bytes and display what comes back.
 *
 * The engine was extracted from here, and that was not tidying. While it lived
 * in this file no test could reach it: `engine.test.ts` does not import a
 * module that pulls in `self` and the message protocol. That is exactly how a
 * check that refused every video shipped green. What remains here is what a
 * test could not execute anyway, and nothing more.
 *
 * No network request is made from this file or from the engine, and none ever
 * will be, which is checkable in the public repository.
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
