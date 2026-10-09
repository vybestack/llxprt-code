/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spyOn } from 'bun:test';
import { projectionGate } from './projection-ownership-fixture.js';

export function observeDiskBody(): {
  readonly state: {
    attempts: number;
    chunks: number;
    bytes: number;
    active: number;
  };
  readonly first: ReturnType<typeof projectionGate>;
  readonly resume: ReturnType<typeof projectionGate>;
  readonly last: ReturnType<typeof projectionGate>;
  restore(): void;
} {
  const fetch = globalThis.fetch;
  const state = { attempts: 0, chunks: 0, bytes: 0, active: 0 };
  const first = projectionGate();
  const resume = projectionGate();
  const last = projectionGate();
  const observed = Object.assign(
    async (...[input, init]: Parameters<typeof fetch>): Promise<Response> => {
      if (!(init?.body instanceof ReadableStream))
        throw new Error('Expected real streaming HTTP BODY');
      state.attempts++;
      state.active++;
      const reader = init.body.getReader();
      let closed = false;
      const close = (): void => {
        if (closed) return;
        closed = true;
        state.active--;
        reader.releaseLock();
      };
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(controller): Promise<void> {
            try {
              const next = await reader.read();
              if (next.done) {
                close();
                last.release();
                controller.close();
                return;
              }
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
          async cancel(reason): Promise<void> {
            try {
              await reader.cancel(reason);
            } finally {
              close();
            }
          },
        },
        { highWaterMark: 0 },
      );
      return fetch(input, { ...init, body });
    },
    { preconnect: fetch.preconnect },
  );
  const spy = spyOn(globalThis, 'fetch').mockImplementation(observed);
  return { state, first, resume, last, restore: () => spy.mockRestore() };
}
