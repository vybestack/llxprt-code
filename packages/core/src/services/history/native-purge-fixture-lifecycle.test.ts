/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withNativePurgeFixture } from './__tests__/support/native-purge-fixture.js';

async function releaseFailureOf(primary?: Error): Promise<{
  readonly error: unknown;
  readonly releaseFailure: Error | undefined;
}> {
  let releaseFailure: Error | undefined;
  const result = await withNativePurgeFixture(async ({ history, store }) => {
    const reference = await store.admit({
      bytes: new Uint8Array([3]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    await history.addBatch([{ speaker: 'human', blocks: [reference] }]);
    releaseFailure = store.releaseFailure;
    store.rejectedId = reference.contentId;
    if (primary !== undefined) throw primary;
  }).then(
    () => ({ closed: true }),
    (error: unknown) => ({ error }),
  );
  expect(result).toHaveProperty('error');
  if (!('error' in result)) throw new Error('Expected fixture failure');
  expect(releaseFailure).toBeInstanceOf(Error);
  return { error: result.error, releaseFailure };
}

describe('native purge fixture error retirement', () => {
  it('preserves the action error when all resource releases succeed', async () => {
    const primary = new Error('purge action failed');
    await expect(
      withNativePurgeFixture(async () => {
        throw primary;
      }),
    ).rejects.toBe(primary);
  });

  it('preserves a sole physical cleanup failure without wrapping it', async () => {
    const { error, releaseFailure } = await releaseFailureOf();
    expect(error).toBe(releaseFailure);
  });

  it('preserves action and physical cleanup failures in execution order', async () => {
    const primary = new Error('purge action failed');
    const { error, releaseFailure } = await releaseFailureOf(primary);
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError))
      throw new Error('Expected action and cleanup aggregate');
    expect(error.errors).toStrictEqual([primary, releaseFailure]);
    expect(error.errors[0]).toBe(primary);
    expect(error.errors[1]).toBe(releaseFailure);
    expect(error.cause).toBe(primary);
  });
});
