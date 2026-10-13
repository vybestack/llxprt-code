/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { cleanupFailedAdoption } from '../fromConfig-cleanup.js';
import {
  createSessionClientEngineFixture,
  engineGate,
} from './helpers/session-client-engine-fixture.js';

describe('adoption cleanup with explicit close operations', () => {
  it('joins client closure before runtime closure and preserves independent failures', async () => {
    const fixture = await createSessionClientEngineFixture();
    const entered = engineGate();
    const release = engineGate();
    const primary = new Error('adoption failed');
    const runtimeFailure = new Error('runtime release failed');
    let settled = false;
    const result = cleanupFailedAdoption(
      primary,
      async () => {
        entered.release();
        await release.promise;
        await fixture.handle.cleanup();
        throw new AggregateError([primary, runtimeFailure]);
      },
      undefined,
      () => fixture.media.dispose(),
      () => fixture.owner.dispose(),
    ).catch((error: unknown) => {
      settled = true;
      return error;
    });
    try {
      await entered.promise;
      expect(settled).toBe(false);
      expect(() => fixture.owner.refreshAuth()).toThrow('disposed');
      release.release();
      const error = await result;
      if (!(error instanceof AggregateError))
        throw new Error('Expected joined cleanup failures');
      expect(error.errors).toStrictEqual([primary, runtimeFailure]);
    } finally {
      release.release();
      await result;
      await fixture.cleanup();
    }
  });
});
