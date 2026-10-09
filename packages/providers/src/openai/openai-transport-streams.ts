/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Readable } from 'node:stream';

export async function* readRequestBody(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array, void> {
  const reader = body.getReader();
  let complete = false;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        complete = true;
        return;
      }
      yield result.value;
    }
  } finally {
    try {
      if (!complete) await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}

export function responseBody(source: Readable): ReadableStream<Uint8Array> {
  const reader = Readable.toWeb(source).getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      try {
        const result = await reader.read();
        if (result.done) {
          reader.releaseLock();
          controller.close();
          return;
        }
        const chunk: unknown = result.value;
        if (!(chunk instanceof Uint8Array)) {
          throw new Error('OpenAI response stream requires byte chunks');
        }
        controller.enqueue(chunk);
      } catch (error) {
        try {
          await reader.cancel(error);
        } finally {
          reader.releaseLock();
          controller.error(error);
        }
      }
    },
    async cancel(reason: unknown): Promise<void> {
      try {
        await reader.cancel(reason);
      } finally {
        reader.releaseLock();
      }
    },
  });
}
