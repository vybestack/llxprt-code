/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { createSourceCompressionCallback } from '../source-compression-callback.js';
import { SourceCandidate } from '../source-candidate.js';
import { ContextOverflowError } from '../contextOverflowError.js';
import type { FallbackTransactionOutcome } from '../providerFallbackTransaction.js';
import { sourceRootSetup } from '../../core/__tests__/support/prompt-envelope-source-test-helpers.js';
import { processorFixture } from '../../core/__tests__/support/streamprocessor-source-fixture.js';

const defaultLimits = {
  completionBudget: 100,
  limit: 4000,
  marginAdjustedLimit: 3000,
  compressionThreshold: 2000,
};

function rowsOf(...texts: string[]): ProviderRequestSelection {
  const rows: IContent[] = texts.map((text) => ({
    speaker: 'human',
    blocks: [{ type: 'text', text }],
  }));
  return {
    count: rows.length,
    async *openReader() {
      for (const row of rows) yield row;
    },
    close: () => undefined,
  };
}

/** Each estimate consumes the next measurement; stage effects record their order. */
function callbackHarness(
  measurements: number[],
  options: {
    fallback?: FallbackTransactionOutcome;
    replacement?: ProviderRequestSelection;
  } = {},
) {
  const stages: string[] = [];
  const warnings: unknown[] = [];
  const queue = [...measurements];
  const replacement = options.replacement ?? rowsOf('compressed');
  const candidate = new SourceCandidate<ProviderRequestSelection>(
    rowsOf('old a', 'old b'),
    async () => {
      const next = queue.shift();
      if (next === undefined) throw new Error('unexpected extra estimate');
      return next;
    },
    async () => replacement,
    { read: async () => [], replace: () => undefined },
  );
  const callback = createSourceCompressionCallback({
    candidate,
    defaultLimits,
    pendingRecoverable: true,
    getHistoryTokens: () => 6000,
    stageActions: () => ({
      optimizeDensity: async () => void stages.push('density'),
      compress: async () => {
        stages.push('compress');
        return PerformCompressionResult.COMPRESSED;
      },
      replaceSource: () => {
        stages.push('replace');
        return candidate.replace();
      },
      fallback: async (target) => {
        stages.push(`fallback:${target}`);
        return options.fallback ?? { truncationApplied: true };
      },
      truncateToolResponses: async () => {
        stages.push('tools');
        return { replacedCount: 0 };
      },
      warn: () => stages.push('warn'),
    }),
    warn: (_message, error) => warnings.push(error),
  });
  return { callback, candidate, stages, warnings };
}

async function textsOf(rows: ProviderRequestSelection): Promise<string[]> {
  const texts: string[] = [];
  for await (const row of rows.openReader()) {
    texts.push(
      row.blocks
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join(''),
    );
  }
  return texts;
}

describe('provider-triggered compression over the source candidate', () => {
  it('runs the source stages against the guard budget and returns the replacement rows', async () => {
    // Guard estimate 5000 vs candidate estimate 4000 leaves 1000 of envelope
    // overhead, so the effective limit is 3000 - 1000 = 2000.
    const { callback, stages } = callbackHarness([4000, 4000, 1500]);
    const rows = await callback({
      estimatedTokens: 5000,
      contextLimit: 3000,
    });
    expect(stages).toStrictEqual(['density', 'replace']);
    expect(await textsOf(rows)).toStrictEqual(['compressed']);
  });

  it('uses the enforcer limits when the provider supplies no guard facts', async () => {
    const { callback, stages } = callbackHarness([1900]);
    const rows = await callback();
    expect(stages).toStrictEqual([]);
    expect(await textsOf(rows)).toStrictEqual(['old a', 'old b']);
  });

  it('escalates through fallback and tool truncation, then rejects with the structured overflow', async () => {
    const { callback, stages, warnings } = callbackHarness([
      4000, 4000, 4000, 3900, 3900, 3900, 3900,
    ]);
    const outcome = callback({ estimatedTokens: 4000, contextLimit: 3000 });
    await expect(outcome).rejects.toBeInstanceOf(ContextOverflowError);
    expect(
      stages.map((stage) => stage.replace(/^fallback:.*/, 'fallback')),
    ).toStrictEqual([
      'density',
      'replace',
      'compress',
      'replace',
      'compress',
      'replace',
      'fallback',
      'replace',
      'tools',
      'replace',
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toBeInstanceOf(ContextOverflowError);
  });

  it('surfaces a compensated fallback failure in the structured overflow', async () => {
    const { callback } = callbackHarness(
      [4000, 4000, 4000, 3900, 3900, 3900, 3900],
      {
        fallback: {
          truncationApplied: false,
          truncationFailure: new Error('candidate rejected and rolled back'),
        },
      },
    );
    await expect(
      callback({ estimatedTokens: 4000, contextLimit: 3000 }),
    ).rejects.toThrow('candidate rejected and rolled back');
  });
});

describe('source enforcement owns the provider callback lifecycle', () => {
  const root = sourceRootSetup();

  async function lifecycleFixture() {
    const setup = await processorFixture(
      root(),
      'http://127.0.0.1:1/v1',
      false,
      4,
    );
    const attached: unknown[] = [];
    const { provider } = setup;
    Object.defineProperty(provider, 'setCompressionCallback', {
      value: (callback: unknown) => {
        attached.push(callback);
      },
    });
    const rows = rowsOf('a');
    const pending = { read: async () => [], replace: () => undefined };
    return { setup, attached, provider, rows, pending };
  }

  it('leaves the callback attached after success until the caller clears it', async () => {
    const { setup, attached, provider, rows, pending } =
      await lifecycleFixture();
    await setup.compression.enforceProviderSource(
      provider,
      'cb-success',
      rows,
      async () => 10,
      async () => rows,
      true,
      pending,
    );
    expect(attached).toHaveLength(1);
    expect(typeof attached[0]).toBe('function');
    setup.compression.clearProviderCompressionCallback(provider);
    expect(attached).toHaveLength(2);
    expect(attached[1]).toBeNull();
    setup.history.dispose();
    await setup.config.dispose();
  });

  it.each([
    ['an enforcement error', () => new Error('projection failed')],
    ['an abort', () => new DOMException('aborted', 'AbortError')],
  ])(
    'clears the callback when %s rejects enforcement',
    async (_name, failure) => {
      const { setup, attached, provider, rows, pending } =
        await lifecycleFixture();
      await expect(
        setup.compression.enforceProviderSource(
          provider,
          'cb-failure',
          rows,
          async () => {
            throw failure();
          },
          async () => rows,
          true,
          pending,
        ),
      ).rejects.toBeDefined();
      expect(attached[attached.length - 1]).toBeNull();
      setup.history.dispose();
      await setup.config.dispose();
    },
  );
});
