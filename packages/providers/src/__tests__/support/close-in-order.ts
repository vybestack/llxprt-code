/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

export interface AsyncClosable {
  close(): void | Promise<void>;
}

/**
 * Closes each resource in the order given, awaiting every close before the
 * next starts, so a request selection or transaction settles before the
 * service it reads from. Every close runs even when an earlier one throws.
 * `failure` is the error of the guarded body, when it threw; it is kept
 * first. One error is rethrown as is, several as an AggregateError.
 */
export async function closeInOrder(
  failure: { readonly error: unknown } | undefined,
  ...resources: ReadonlyArray<AsyncClosable | undefined>
): Promise<void> {
  const cleanup: unknown[] = [];
  for (const resource of resources) {
    try {
      await resource?.close();
    } catch (error) {
      cleanup.push(error);
    }
  }
  if (cleanup.length === 0) return;
  const errors = failure === undefined ? cleanup : [failure.error, ...cleanup];
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, 'Resource close failed');
}
