/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  BoundedJsonBody,
  type BoundedJsonStream,
  DEFAULT_HTTP_JSON_ENVELOPE_BYTES,
  DEFAULT_STREAMING_JSON_CHUNK_BYTES,
} from './boundedJsonBody.js';

export async function* jsonValueBytes(
  value: unknown,
): AsyncIterable<Uint8Array> {
  const body = new BoundedJsonBody(value, {
    maxChunkBytes: DEFAULT_STREAMING_JSON_CHUNK_BYTES,
    maxEnvelopeBytes: DEFAULT_HTTP_JSON_ENVELOPE_BYTES,
  });
  const handle = body.createStreamHandle();
  const reader = handle.stream.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return;
      yield next.value;
    }
  } finally {
    await handle.dispose();
    reader.releaseLock();
    await body.dispose();
  }
}

export class ProgressiveJsonBody {
  private disposed = false;
  private readonly handles = new Set<BoundedJsonStream>();

  private bytes: (() => AsyncIterable<Uint8Array>) | undefined;

  constructor(bytes: () => AsyncIterable<Uint8Array>) {
    this.bytes = bytes;
  }

  private openIterator(): AsyncIterator<Uint8Array> {
    const bytes = this.bytes;
    if (bytes === undefined) throw new Error('JSON request body was disposed');
    return bytes()[Symbol.asyncIterator]();
  }

  createStreamHandle(): BoundedJsonStream {
    if (this.disposed) throw new Error('JSON request body was disposed');
    let iterator: AsyncIterator<Uint8Array> | undefined = this.openIterator();
    let total = 0;
    let stopped = false;
    let closing: Promise<void> | undefined;
    const close = async (): Promise<void> => {
      stopped = true;
      closing ??= (async () => {
        try {
          await iterator?.return?.();
        } finally {
          iterator = undefined;
          this.handles.delete(handle);
        }
      })();
      return closing;
    };
    const source = new ReadableStream<Uint8Array>(
      {
        async pull(controller): Promise<void> {
          try {
            if (iterator === undefined) return;
            const next = await iterator.next();
            if (stopped) return;
            if (next.done === true) {
              await close();
              controller.close();
              return;
            }
            total += next.value.byteLength;
            if (total > DEFAULT_HTTP_JSON_ENVELOPE_BYTES) {
              throw new RangeError('JSON request envelope exceeds byte limit');
            }
            controller.enqueue(next.value);
          } catch (error) {
            try {
              await close();
            } catch (cleanupError) {
              controller.error(new AggregateError([error, cleanupError]));
              return;
            }
            controller.error(error);
          }
        },
        cancel: close,
      },
      { highWaterMark: 0 },
    );
    const reader = source.getReader();
    const dispose = async (reason?: unknown): Promise<void> => {
      if (!stopped) await reader.cancel(reason);
      await close();
    };
    const stream = new ReadableStream<Uint8Array>(
      {
        async pull(controller): Promise<void> {
          try {
            const next = await reader.read();
            if (next.done) controller.close();
            else controller.enqueue(next.value);
          } catch (error) {
            controller.error(error);
          }
        },
        cancel: dispose,
      },
      { highWaterMark: 0 },
    );
    const handle = { stream, dispose };
    this.handles.add(handle);
    return handle;
  }

  async dispose(reason?: unknown): Promise<void> {
    this.disposed = true;
    this.bytes = undefined;
    await Promise.all(
      [...this.handles].map((handle) => handle.dispose(reason)),
    );
  }
}
