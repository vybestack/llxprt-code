/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { BoundedJsonStream } from './boundedJsonBody.js';
import { historyMutationFailure } from '@vybestack/llxprt-code-core/services/history/historyMutationEffects.js';

export interface ChatHttpBody {
  readonly byteLength: number;
  openStream(): Pick<BoundedJsonStream, 'stream'> & {
    dispose(): void | Promise<void>;
  };
}

export async function withChatHttpBody<T>(
  body: ChatHttpBody,
  consume: (
    stream: ReadableStream<Uint8Array>,
    byteLength: number,
  ) => Promise<T>,
): Promise<T> {
  const handle = body.openStream();
  let result: T;
  try {
    result = await consume(handle.stream, body.byteLength);
  } catch (error) {
    try {
      await handle.dispose();
    } catch (cleanup) {
      throw historyMutationFailure(error, [cleanup]);
    }
    throw error;
  }
  await handle.dispose();
  return result;
}
