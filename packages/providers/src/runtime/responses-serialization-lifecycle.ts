/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export type SerializationSettlement<T> =
  | { readonly status: 'fulfilled'; readonly value: T }
  | { readonly status: 'rejected'; readonly reason: unknown };

export async function withSerializationCleanup<T>(
  run: () => Promise<T>,
  cleanup: () => void | Promise<void>,
): Promise<T> {
  const outcome = await run().then<
    SerializationSettlement<T>,
    SerializationSettlement<T>
  >(
    (value) => ({ status: 'fulfilled', value }),
    (reason: unknown) => ({ status: 'rejected', reason }),
  );
  try {
    await cleanup();
  } catch (error) {
    if (outcome.status === 'rejected' && outcome.reason !== error)
      throw new AggregateError(
        [outcome.reason, error],
        'Serialization and cleanup failed',
      );
    throw error;
  }
  if (outcome.status === 'rejected') throw outcome.reason;
  return outcome.value;
}

export type ResponsesSerializationCleanup =
  | { readonly status: 'fulfilled' }
  | { readonly status: 'rejected'; readonly reason: unknown };

export interface ResponsesSerialization<T> extends Promise<T> {
  /** Always settles as data; failures remain observable even after request abort. */
  readonly cleanup: Promise<ResponsesSerializationCleanup>;
}

export function cancellableSerialization<T>(
  run: () => Promise<T>,
  dispose: (value: T) => Promise<void>,
  signal?: AbortSignal,
): ResponsesSerialization<T> {
  let rejectAbort = (_reason: unknown): void => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = (): void => {
    rejectAbort(signal?.reason);
  };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted === true) abort();
  const work = run().then(async (value) => {
    if (signal?.aborted === true) {
      return withSerializationCleanup<T>(
        () => Promise.reject(signal.reason),
        () => dispose(value),
      );
    }
    return value;
  });
  const result = signal === undefined ? work : Promise.race([work, aborted]);
  const cleanup = work
    .then<ResponsesSerializationCleanup, ResponsesSerializationCleanup>(
      () => ({ status: 'fulfilled' }),
      (reason: unknown) =>
        signal?.aborted === true && reason === signal.reason
          ? { status: 'fulfilled' }
          : { status: 'rejected', reason },
    )
    .then((outcome) => {
      signal?.removeEventListener('abort', abort);
      return outcome;
    });
  return Object.assign(result, { cleanup });
}
