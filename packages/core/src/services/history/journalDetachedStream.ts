/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
type Offer<T> = { readonly row: T; readonly release: () => void };

/**
 * Turns a producer that pushes rows (`put`) into rows a consumer pulls. The
 * hand-over has no buffer: `put` resolves only when the consumer asks for the
 * row after the one it was given, so the producer cannot be more than one row
 * ahead of the consumer, whatever the consumer's speed. A producer failure is
 * thrown from the pull that would have taken its next row. When the consumer
 * stops early, the producer's pending `put` rejects, so it does not wait
 * forever.
 */
export async function* pulledRows<T>(
  produce: (put: (row: T) => Promise<void>) => Promise<void>,
): AsyncGenerator<T, void, unknown> {
  let deliver: (offer: Offer<T> | undefined) => void = () => {};
  let pending = new Promise<Offer<T> | undefined>((resolve) => {
    deliver = resolve;
  });
  let outstanding: { readonly abandon: () => void } | undefined;
  let abandoned = false;
  const put = (row: T): Promise<void> =>
    new Promise<void>((release, reject) => {
      if (abandoned) {
        reject(new Error('The consumer of the rows stopped reading'));
        return;
      }
      const offer = deliver;
      outstanding = {
        abandon: () =>
          reject(new Error('The consumer of the rows stopped reading')),
      };
      offer({
        row,
        release: () => {
          outstanding = undefined;
          release();
        },
      });
    });
  let failure: { readonly error: unknown } | undefined;
  const produced = produce(put).then(
    () => deliver(undefined),
    (error: unknown) => {
      failure = { error };
      deliver(undefined);
    },
  );
  try {
    for (;;) {
      const offer = await pending;
      if (offer === undefined) break;
      // Re-armed before the row is yielded: the producer's next push comes only after release.
      pending = new Promise<Offer<T> | undefined>((resolve) => {
        deliver = resolve;
      });
      yield offer.row;
      offer.release();
    }
  } finally {
    abandoned = true;
    outstanding?.abandon();
    await produced;
  }
  if (failure !== undefined) throw failure.error;
}

/** A pull stream whose rows are pushed from outside, with the consumer started at once. */
export interface PullFeed<T, R> {
  /** Resolves when the consumer has asked for the row after this one; throws the consumer's failure if it ended. */
  put(row: T): Promise<void>;
  /** Ends the rows and resolves with what the consumer returned. */
  close(): Promise<R>;
  /** Ends the rows with `error`; the consumer sees it from its next pull. Resolves when the consumer is done. */
  abort(error: unknown): Promise<void>;
}

/**
 * Starts `consume` over a pulled stream the caller feeds with `put`. The
 * consumer is the writer of a group or the reservation of a media owner; it
 * runs as soon as the feed is made, so a producer that decides late whether it
 * needs the consumer (a prefix that has not diverged yet) can create the feed
 * at that point.
 */
export function pullFeed<T, R>(
  consume: (rows: AsyncGenerator<T, void, unknown>) => Promise<R>,
): PullFeed<T, R> {
  let end: () => void = () => {};
  let fail: (error: unknown) => void = () => {};
  const ended = new Promise<void>((resolve, reject) => {
    end = resolve;
    fail = reject;
  });
  ended.catch(() => {});
  let ready: () => void = () => {};
  const readied = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let putRow: ((row: T) => Promise<void>) | undefined;
  const rows = pulledRows<T>(async (put) => {
    putRow = put;
    ready();
    await ended;
  });
  const consuming = consume(rows);
  consuming.catch(() => {});
  const consumerEnded = consuming.then(() => {
    throw new Error('The consumer of the rows ended before taking them all');
  });
  consumerEnded.catch(() => {});
  return {
    put: async (row) => {
      await Promise.race([readied, consumerEnded]);
      await putRow?.(row);
    },
    close: () => {
      end();
      return consuming;
    },
    abort: async (error) => {
      fail(error);
      await consuming.then(
        () => undefined,
        () => undefined,
      );
    },
  };
}
