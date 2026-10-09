/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { projectionGate } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/projection-ownership-fixture.js';
import type { RetainedOwnerCensus } from './streamprocessor-retained-census.js';

export function observeRetainedBody(census: RetainedOwnerCensus) {
  const original = globalThis.fetch;
  const first = projectionGate();
  const resume = projectionGate();
  const last = projectionGate();
  const state = { attempts: 0, chunks: 0, bytes: 0, active: 0 };
  const observed = Object.assign(
    async (
      ...[input, init]: Parameters<typeof original>
    ): Promise<Response> => {
      if (!(init?.body instanceof ReadableStream))
        throw new Error('Expected actual source BODY');
      census.observe('http.init', init);
      census.observe('http.provider-body', init.body);
      if (process.env.ISSUE854_RETAIN_BODY_SHELLS === '1')
        census.bodyShells.push(init.body);
      const reader = init.body.getReader();
      census.observe('http.reader', reader);
      state.attempts++;
      state.active++;
      let closed = false;
      const close = (): void => {
        if (closed) return;
        closed = true;
        state.active--;
        reader.releaseLock();
      };
      const source = {
        async pull(
          controller: ReadableStreamDefaultController<Uint8Array>,
        ): Promise<void> {
          try {
            const next = await reader.read();
            if (next.done) {
              close();
              last.release();
              controller.close();
              return;
            }
            census.observe('http.chunk', next.value);
            state.chunks++;
            state.bytes += next.value.byteLength;
            first.release();
            await resume.wait;
            controller.enqueue(next.value);
          } catch (error) {
            close();
            controller.error(error);
          }
        },
        async cancel(reason: unknown): Promise<void> {
          try {
            await reader.cancel(reason);
          } finally {
            close();
          }
        },
      };
      census.observe('http.pull-closure', source.pull);
      census.observe('http.cancel-closure', source.cancel);
      const body = new ReadableStream<Uint8Array>(source, { highWaterMark: 0 });
      census.observe('http.observed-body', body);
      return original(input, { ...init, body });
    },
    { preconnect: original.preconnect },
  );
  globalThis.fetch = observed;
  return {
    first,
    resume,
    last,
    state,
    restore: (): void => {
      globalThis.fetch = original;
    },
  };
}
