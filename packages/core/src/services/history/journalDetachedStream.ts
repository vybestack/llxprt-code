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
