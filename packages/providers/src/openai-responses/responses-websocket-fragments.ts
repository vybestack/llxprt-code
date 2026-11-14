/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import {
  DEFAULT_HTTP_JSON_ENVELOPE_BYTES,
  envelopeTooLargeError,
} from '../utils/boundedJsonBody.js';
import type { TransportSocket } from './openAIResponsesWebSocketTransport.js';
import { ResponsesWebSocketFragmentError } from './responses-websocket-socket.js';

async function whileConnected<T>(
  socket: TransportSocket,
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (signal?.aborted === true) throw createAbortError(signal.reason);
  if (socket.readyState !== socket.OPEN)
    throw new ResponsesWebSocketFragmentError('socket closed during message');
  let rejectInterrupted: (error: Error) => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectInterrupted = reject;
  });
  const detachClose = socket.onClose((info) =>
    rejectInterrupted(
      new ResponsesWebSocketFragmentError(
        `socket closed during message (${info.code ?? 'unknown'})`,
      ),
    ),
  );
  const detachError = socket.onError(() =>
    rejectInterrupted(
      new ResponsesWebSocketFragmentError('socket error during message'),
    ),
  );
  const abort = (): void => rejectInterrupted(createAbortError(signal?.reason));
  signal?.addEventListener('abort', abort, { once: true });
  try {
    return await Promise.race([operation(), interrupted]);
  } finally {
    detachClose();
    detachError();
    signal?.removeEventListener('abort', abort);
  }
}

export async function sendWebSocketFragments(
  socket: TransportSocket,
  chunks: AsyncIterable<Uint8Array>,
  byteLength: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0)
    throw new RangeError(
      'WebSocket frame byte length must be a non-negative safe integer',
    );
  if (byteLength > DEFAULT_HTTP_JSON_ENVELOPE_BYTES)
    throw envelopeTooLargeError(DEFAULT_HTTP_JSON_ENVELOPE_BYTES, byteLength);
  const iterator = chunks[Symbol.asyncIterator]();
  let finished = false;
  try {
    let sent = 0;
    for (;;) {
      const next = await whileConnected(socket, signal, () => iterator.next());
      if (signal?.aborted === true) throw createAbortError(signal.reason);
      if (next.done === true) break;
      sent += next.value.byteLength;
      if (sent > byteLength)
        throw new ResponsesWebSocketFragmentError(
          `byte count exceeds declared length ${byteLength} (${sent} bytes)`,
        );
      await whileConnected(socket, signal, () =>
        socket.sendFragment(next.value, false),
      );
    }
    if (sent !== byteLength)
      throw new ResponsesWebSocketFragmentError(
        `byte count differs from declared length ${byteLength} (${sent} bytes)`,
      );
    await whileConnected(socket, signal, () =>
      socket.sendFragment(new Uint8Array(0), true),
    );
    finished = true;
  } catch (error) {
    socket.terminate();
    throw error;
  } finally {
    if (!finished) await iterator.return?.();
  }
}
