/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { ProviderSourceEnforcer } from '../provider-source-enforcement.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  diskSource,
  digest,
  rowText,
  sourceRootSetup,
} from '../../core/__tests__/support/prompt-envelope-source-test-helpers.js';

const root = sourceRootSetup();
const limits = {
  completionBudget: 128,
  limit: 4000,
  marginAdjustedLimit: 3015,
  compressionThreshold: 2064,
};

async function enforcerSetup() {
  const disk = await diskSource(root(), 64);
  const historyTokens = 6000;
  const enforcer = new ProviderSourceEnforcer({
    limits,
    estimate: async () => {
      let complete = 0;
      for await (const row of disk.source.openReader())
        complete += Buffer.byteLength(JSON.stringify(row));
      return complete;
    },
    getHistoryTokens: () => historyTokens,
  });
  return { ...disk, enforcer };
}

describe('bounded source enforcement foundation', () => {
  it('uses the complete repeatable disk projection and does not substitute a pending suffix', async () => {
    const setup = await enforcerSetup();
    try {
      const expected = createHash('sha256');
      for (let index = 0; index < 64; index++)
        expected.update(
          JSON.stringify({
            speaker: 'human',
            blocks: [{ type: 'text', text: rowText(index) }],
          }),
        );
      const projection = await setup.enforcer.assess('initial');
      expect(projection.projected - projection.requestTokens).toBe(128);
      expect(projection.requestTokens).toBeGreaterThan(4000);
      expect(projection.next).toBe('density');
      const after = await setup.enforcer.assess('post-density-optimization');
      expect(after.projected).toBe(projection.projected);
      expect(after.next).toBe('compression');
      expect(setup.state.pulled).toBe(128);
      expect(await digest(setup.source)).toBe(expected.digest('hex'));
      expect(setup.state.closed).toBe(0);
    } finally {
      await setup.source.close();
    }
  });

  it('rejects a closed borrowed owner with a stage-aware full projection failure', async () => {
    const setup = await enforcerSetup();
    await setup.source.close();
    await expect(
      setup.enforcer.assess('post-retry-compression'),
    ).rejects.toThrow(
      'Token projection failed at post-retry-compression stage during provider-content hard-limit enforcement',
    );
    expect(setup.state.active).toBe(0);
  });
});

function scalarEnforcer(tokens: number): ProviderSourceEnforcer {
  return new ProviderSourceEnforcer({
    limits,
    estimate: async () => tokens,
    getHistoryTokens: () => 6000,
  });
}

describe('source scalar escalation policy', () => {
  it('uses the effective completion-adjusted threshold for initial and density stages', async () => {
    const enforcer = scalarEnforcer(limits.compressionThreshold - 128);
    expect((await enforcer.assess('initial')).next).toBe('send');
    expect((await enforcer.assess('post-density-optimization')).next).toBe(
      'send',
    );
    const above = scalarEnforcer(limits.compressionThreshold - 127);
    expect((await above.assess('initial')).next).toBe('density');
    expect((await above.assess('post-density-optimization')).next).toBe(
      'compression',
    );
  });

  it('accepts compression at the safety-adjusted limit without reserving completion twice', async () => {
    const enforcer = scalarEnforcer(limits.marginAdjustedLimit - 128);
    expect(
      (
        await enforcer.assess(
          'post-compression',
          5000,
          PerformCompressionResult.COMPRESSED,
        )
      ).next,
    ).toBe('send');
    expect((await enforcer.assess('post-retry-compression')).next).toBe('send');
    expect((await enforcer.assess('post-truncation')).next).toBe('send');
  });

  it('retries only an ineffective completed compression, then targets the full-envelope deficit', async () => {
    const enforcer = scalarEnforcer(4700);
    const first = await enforcer.assess(
      'post-compression',
      5000,
      PerformCompressionResult.COMPRESSED,
    );
    expect(first.next).toBe('retry-compression');
    expect(first.historyTarget).toBeUndefined();
    const retry = await enforcer.assess('post-retry-compression');
    expect(retry.next).toBe('fallback');
    expect(retry.historyTarget).toBe(6000 - (retry.projected - 3015));
    expect((await enforcer.assess('post-truncation')).next).toBe(
      'tool-responses',
    );
    expect((await enforcer.assess('post-tool-response-truncation')).next).toBe(
      'overflow',
    );
  });

  it.each([
    PerformCompressionResult.NOOP,
    PerformCompressionResult.FAILED,
    PerformCompressionResult.SKIPPED_COOLDOWN,
  ])(
    'does not invent an ineffective retry after non-completed result %s',
    async (result) => {
      const decision = await scalarEnforcer(4700).assess(
        'post-compression',
        5000,
        result,
      );
      expect(decision.next).toBe('fallback');
      expect(decision.historyTarget).toBeGreaterThan(0);
    },
  );

  it('skips the additional attempt at the unchanged five-percent reduction threshold', async () => {
    const decision = await scalarEnforcer(4622).assess(
      'post-compression',
      5000,
      PerformCompressionResult.COMPRESSED,
    );
    expect(decision.projected).toBe(4750);
    expect(decision.next).toBe('fallback');
  });
});
