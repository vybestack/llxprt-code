/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  countO200kBaseTokens,
  createO200kBaseEncoderResolver,
  loadTiktokenModule,
  type TiktokenModuleLoader,
} from './o200kBaseCounter.js';

/**
 * A loader whose outcome the test decides: each call to `load` consumes the
 * next scripted outcome, and a deferred one stays pending until released.
 */
type LoaderOutcome = 'succeed' | Error;

function scriptedLoader(...outcomes: readonly LoaderOutcome[]): {
  readonly loader: TiktokenModuleLoader;
  readonly attempts: () => number;
} {
  let attempts = 0;
  return {
    loader: async () => {
      const outcome = outcomes[attempts] ?? outcomes[outcomes.length - 1];
      attempts += 1;
      if (outcome instanceof Error) {
        throw outcome;
      }
      return loadTiktokenModule();
    },
    attempts: () => attempts,
  };
}

function gatedFailingLoader(failure: Error): {
  readonly loader: TiktokenModuleLoader;
  readonly fail: () => void;
} {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    loader: async () => {
      await gate;
      throw failure;
    },
    fail: release,
  };
}

describe('createO200kBaseEncoderResolver failure handling', () => {
  it('surfaces one failed initialization to every concurrent caller', async () => {
    const failure = new Error('wasm initialization failed');
    const { loader, fail } = gatedFailingLoader(failure);
    const resolveEncoder = createO200kBaseEncoderResolver(loader);

    const callers = [resolveEncoder(), resolveEncoder(), resolveEncoder()];
    fail();
    const settled = await Promise.allSettled(callers);

    expect(settled.map((outcome) => outcome.status)).toStrictEqual([
      'rejected',
      'rejected',
      'rejected',
    ]);
    for (const outcome of settled) {
      expect(outcome.status === 'rejected' && outcome.reason).toBe(failure);
    }
  });

  it('initializes again on a later call after a failed initialization', async () => {
    const { loader, attempts } = scriptedLoader(
      new Error('transient wasm failure'),
      'succeed',
    );
    const resolveEncoder = createO200kBaseEncoderResolver(loader);

    await expect(resolveEncoder()).rejects.toThrow('transient wasm failure');
    const encoder = await resolveEncoder();

    expect(countO200kBaseTokens(encoder, 'hello world')).toBeGreaterThan(0);
    expect(attempts()).toBe(2);
  });

  it('reports each failure to its own caller rather than replaying the first one', async () => {
    const { loader } = scriptedLoader(
      new Error('first failure'),
      new Error('second failure'),
    );
    const resolveEncoder = createO200kBaseEncoderResolver(loader);

    await expect(resolveEncoder()).rejects.toThrow('first failure');
    await expect(resolveEncoder()).rejects.toThrow('second failure');
  });

  it('keeps one encoder after a successful initialization', async () => {
    const { loader, attempts } = scriptedLoader('succeed');
    const resolveEncoder = createO200kBaseEncoderResolver(loader);

    const first = await resolveEncoder();
    const second = await resolveEncoder();

    expect(second).toBe(first);
    expect(attempts()).toBe(1);
  });

  it('keeps the recovered encoder after an earlier failed initialization', async () => {
    const { loader, attempts } = scriptedLoader(
      new Error('transient wasm failure'),
      'succeed',
    );
    const resolveEncoder = createO200kBaseEncoderResolver(loader);

    await expect(resolveEncoder()).rejects.toThrow('transient wasm failure');
    const recovered = await resolveEncoder();
    const reused = await resolveEncoder();

    expect(reused).toBe(recovered);
    expect(attempts()).toBe(2);
  });
});
