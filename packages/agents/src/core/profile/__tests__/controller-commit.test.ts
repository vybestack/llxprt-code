/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { commitCandidate } from '../controllerCommit.js';
import { ProfileController } from '../profileController.js';
import {
  FakeBinding,
  makeDeps,
  releaseAndAwait,
  seedMyLb,
  standardProvADocument,
} from './controllerTestFakes.js';

describe('profile commit ownership', () => {
  it('preserves the cancelled outcome when candidate disposal throws synchronously', async () => {
    const harness = makeDeps();
    const abort = new AbortController();
    let disposals = 0;
    harness.deps.boundary = {
      withSafeBoundary: async (fn) => ({
        status: 'committed',
        value: await fn(),
      }),
    };
    harness.deps.runtimeFactory = {
      build: async () => {
        abort.abort();
        return {
          bindingId: 'throwing-dispose',
          configFingerprint: 'candidate',
          [Symbol.asyncDispose](): Promise<void> {
            disposals += 1;
            throw new Error('synchronous cleanup failure');
          },
        };
      },
    };
    const outcome = await commitCandidate(
      { status: 'unconfigured' },
      {
        document: standardProvADocument('m1'),
        identity: { kind: 'draft' },
        commandKind: 'startup',
        baseRevision: 0,
        nextRevision: 1,
      },
      { kind: 'startup', provider: 'prov-a', expectedRevision: 0 },
      harness.deps,
      undefined,
      () => false,
      () => {},
      abort.signal,
    );
    expect(outcome.result).toStrictEqual({
      kind: 'cancelled',
      reason: 'execute cancelled',
      revision: 0,
    });
    expect(disposals).toStrictEqual(1);
  });

  it('leaves the prior runtime owning a reused binding when health transfer fails', async () => {
    const harness = makeDeps();
    seedMyLb(harness.repo);
    const controller = new ProfileController(harness.deps);
    await releaseAndAwait(
      harness,
      controller.execute({
        kind: 'startup',
        profileName: 'mylb',
        expectedRevision: 0,
      }),
    );
    const prior = controller.getRuntime();
    if (prior === undefined) throw new Error('expected prior runtime');
    const binding = prior.getBinding();
    if (!(binding instanceof FakeBinding))
      throw new Error('expected fake binding');
    const health = spyOn(prior, 'getHealth').mockImplementation(() => {
      throw new Error('health unavailable');
    });
    try {
      expect(
        await releaseAndAwait(
          harness,
          controller.execute({
            kind: 'load',
            name: 'mylb',
            expectedRevision: 1,
          }),
        ),
      ).toStrictEqual({
        kind: 'failed',
        error: 'runtime swap failed',
        revision: 1,
      });
      expect(binding.disposeCount).toStrictEqual(0);
      await controller.dispose();
      expect(binding.disposeCount).toStrictEqual(1);
    } finally {
      health.mockRestore();
    }
  });
});
