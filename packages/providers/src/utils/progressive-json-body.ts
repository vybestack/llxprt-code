/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  BoundedJsonBody,
  type BoundedJsonStream,
  DEFAULT_HTTP_JSON_ENVELOPE_BYTES,
  DEFAULT_STREAMING_JSON_CHUNK_BYTES,
} from './boundedJsonBody.js';

/** The byte length `jsonValueBytes(value)` yields, without streaming it. */
export function jsonValueByteLength(value: unknown): number {
  return new BoundedJsonBody(value, {
    maxChunkBytes: DEFAULT_STREAMING_JSON_CHUNK_BYTES,
    maxEnvelopeBytes: DEFAULT_HTTP_JSON_ENVELOPE_BYTES,
  }).byteLength;
}

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

/** Fails when a body overruns its declared length, or ends short of it. */
function assertServedLength(
  served: number,
  declared: number | undefined,
  finished: boolean,
): void {
  if (declared === undefined) return;
  if (served > declared || (finished && served !== declared)) {
    throw new Error(
      `Request body served ${served} bytes but declared ${declared}`,
    );
  }
}

export class ProgressiveJsonBody {
  private disposed = false;
  private readonly handles = new Set<BoundedJsonStream>();

  private bytes: (() => AsyncIterable<Uint8Array>) | undefined;

  /**
   * `byteLength` is the length the caller declares to the transport. A stream
   * that ends having served a different number of bytes fails, so a wrong
   * Content-Length cannot go out silently.
   */
  constructor(
    bytes: () => AsyncIterable<Uint8Array>,
    readonly byteLength?: number,
  ) {
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
    const declared = this.byteLength;
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
              assertServedLength(total, declared, true);
              await close();
              controller.close();
              return;
            }
            total += next.value.byteLength;
            assertServedLength(total, declared, false);
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
