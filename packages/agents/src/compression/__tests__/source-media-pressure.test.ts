/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RequestMediaByteOverflowError } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { ProviderSourceEnforcer } from '../provider-source-enforcement.js';
import {
  runSourceStages,
  type SourceStageActions,
} from '../source-stage-ladder.js';

function setup(compressionError?: Error) {
  let retired = false;
  let compressions = 0;
  const pressure = new RequestMediaByteOverflowError('image', 'turn', 20, 10);
  const enforcer = new ProviderSourceEnforcer({
    limits: {
      completionBudget: 0,
      limit: 1000,
      marginAdjustedLimit: 900,
      compressionThreshold: 800,
    },
    estimate: async () => {
      if (!retired) throw pressure;
      return 100;
    },
    getHistoryTokens: () => 100,
  });
  const actions: SourceStageActions = {
    optimizeDensity: async () => undefined,
    compress: async () => {
      compressions++;
      if (compressionError !== undefined) throw compressionError;
      return PerformCompressionResult.NOOP;
    },
    replaceSource: async () => undefined,
    fallback: async () => ({ truncationApplied: false }),
    truncateToolResponses: async () => ({ replacedCount: 0 }),
    relieveMediaPressure: async () => {
      retired = true;
      return true;
    },
    warn: () => undefined,
  };
  return {
    enforcer,
    actions,
    pressure,
    state: () => ({ retired, compressions }),
  };
}

describe('journal source byte-pressure recovery', () => {
  it('uses one compression attempt then sends the image-relieved source through token checks', async () => {
    const fixture = setup();
    await runSourceStages(fixture.enforcer, fixture.actions, true);
    expect(fixture.state()).toStrictEqual({ retired: true, compressions: 1 });
  });
  it('can relieve history without guessing an unrecoverable hook boundary', async () => {
    const fixture = setup();
    await runSourceStages(fixture.enforcer, fixture.actions, false);
    expect(fixture.state()).toStrictEqual({ retired: true, compressions: 0 });
  });
  it('propagates cancellation rather than replacing it with relief or context overflow', async () => {
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const fixture = setup(abort);
    await expect(
      runSourceStages(fixture.enforcer, fixture.actions, true),
    ).rejects.toBe(abort);
    expect(fixture.state()).toStrictEqual({ retired: false, compressions: 1 });
  });
});
