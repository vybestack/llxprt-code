/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

/** Bridges default readers without relying on Node/DOM BYOB overload compatibility. */
export function toAcpReadableStream(
  input: NodeReadableStream<Uint8Array> | ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const reader = input.getReader();
  let active = true;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const result = await reader.read();
          // Cancellation can settle a pending read before its cleanup finishes.
          if (!active) return;
          if (result.done) {
            active = false;
            reader.releaseLock();
            controller.close();
          } else {
            controller.enqueue(result.value);
          }
        } catch (error) {
          if (!active) return;
          active = false;
          reader.releaseLock();
          controller.error(error);
        }
      },
      async cancel(reason) {
        active = false;
        try {
          await reader.cancel(reason);
        } finally {
          reader.releaseLock();
        }
      },
    },
    { highWaterMark: 0 },
  );
}
