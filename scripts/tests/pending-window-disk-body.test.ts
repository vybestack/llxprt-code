/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import { buildCuratedHistory } from '../../packages/core/src/services/history/historyCuration.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import {
  invalidateResponsesStatefulChain,
  type IContent,
} from '../../packages/core/src/services/history/IContent.js';
import {
  withPendingFixture,
  pendingCaller,
  type PendingFixture,
} from '../../packages/agents/src/compression/__tests__/pending-window-disk-helpers.js';
import { middleoutRow } from '../../packages/agents/src/compression/__tests__/middleout-disk-helpers.js';
import { providerPendingFixture } from '../../packages/core/src/services/history/provider-curated-test-helpers.js';
import { PendingContextWindowEnforcer } from '../../packages/agents/src/compression/pendingContextWindowEnforcement.js';
import { runDiskProviderFallback } from '../../packages/agents/src/compression/diskProviderFallback.js';
import { buildCompressionMetadata } from '../../packages/agents/src/compression/compressionContextBuilder.js';
import { TopDownTruncationStrategy } from '../../packages/agents/src/compression/TopDownTruncationStrategy.js';
import { PerformCompressionResult } from '../../packages/core/src/core/turn.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';
const logger = new DebugLogger('test:pending-window-body');
const cases = [512, 8192].flatMap((size) =>
  ['anthropic', 'openai-responses', 'gemini'].flatMap((provider) =>
    [false, true].flatMap((caching) =>
      [false, true].map((accepted): [number, string, boolean, boolean] => [
        size,
        provider,
        caching,
        accepted,
      ]),
    ),
  ),
);

function enforcerFor(
  fixture: PendingFixture,
  accepted: boolean,
): PendingContextWindowEnforcer {
  const { history, setup } = fixture;
  let attempted = false;
  let baseline: number | null = 123;
  return new PendingContextWindowEnforcer({
    historyService: history,
    logger,
    ineffectiveCompressionReductionThreshold: 0.05,
    getContextLimits: () => ({
      limit: 30000,
      marginAdjustedLimit: 29000,
      completionBudget: 100,
    }),
    computeProjectedTokens: () =>
      attempted ? 1 : history.getTotalTokens() + 200000,
    ensureDensityOptimized: async () => {},
    performCompression: async () => PerformCompressionResult.FAILED,
    performFallbackCompression: async (prompt, install, targetTokenCount) => {
      const result = await runDiskProviderFallback(
        install,
        prompt,
        setup.runtime,
        history,
        async () => ({
          provider: setup.transport,
          runtime: setup.runtime.providerRuntime,
        }),
        undefined,
        undefined,
        logger,
        { targetTokenCount },
      );
      attempted = true;
      return accepted && result.outcome === 'applied';
    },
    getLastPromptTokenCount: () => baseline,
    restoreLastPromptTokenCount: (value) => {
      baseline = value;
    },
    resetLastPromptTokenCount: () => {
      baseline = null;
    },
    setSuppressDensityDirty: () => {},
    recordCompressionFailure: () => {},
    getRuntimeModel: () => 'test-model',
    estimateBlockTokensAsync: async () => 1,
  });
}
async function oracle(
  size: number,
  fixture: PendingFixture,
  callers: IContent[],
  queued: IContent,
  pending: IContent[],
  accepted: boolean,
): Promise<IContent[]> {
  const { history, setup } = fixture;
  const raw = [
    ...Array.from({ length: size }, (_, index) => middleoutRow(index)),
    ...callers,
  ];
  const curated = buildCuratedHistory(logger, raw, false);
  const metadata = await buildCompressionMetadata(
    'oracle',
    setup.runtime,
    history,
    async () => ({
      provider: setup.transport,
      runtime: setup.runtime.providerRuntime,
    }),
    undefined,
    undefined,
    logger,
    { targetTokenCount: 0 },
  );
  const legacy = await new TopDownTruncationStrategy().compress({
    ...metadata,
    history: curated,
  });
  if (legacy.kind !== 'applied')
    throw new Error('Expected legacy pending-window truncation');
  return buildProviderContent(
    buildCuratedHistory(
      logger,
      [
        ...(accepted
          ? invalidateResponsesStatefulChain(legacy.newHistory)
          : curated),
        queued,
      ],
      false,
    ),
    pending,
    logger,
  );
}
async function compareBytes(
  provider: string,
  caching: boolean,
  actualRows: IContent[],
  expectedRows: IContent[],
  name: string,
): Promise<number> {
  const actualResponse: IContent[] = [];
  const expectedResponse: IContent[] = [];
  const actual = await captureCuratedBody(
    provider,
    actualRows,
    caching,
    true,
    true,
    actualResponse,
  );
  const expected = await captureCuratedBody(
    provider,
    expectedRows,
    caching,
    false,
    false,
    expectedResponse,
  );
  expect(actual).toBe(expected);
  expect(JSON.stringify(actualResponse)).toBe(JSON.stringify(expectedResponse));
  expect(
    actualResponse
      .flatMap((row) => row.blocks)
      .some((block) => block.type === 'text' && block.text.length > 0),
  ).toBe(true);
  if (provider === 'anthropic' && caching)
    expect(actual).toContain('cache_control');
  const output = process.env.PENDING_WINDOW_BODY_OUTPUT;
  if (output !== undefined) {
    mkdirSync(output, { recursive: true });
    for (const [suffix, value] of [
      ['actual', actual],
      ['expected', expected],
      ['response-actual', JSON.stringify(actualResponse)],
      ['response-expected', JSON.stringify(expectedResponse)],
    ])
      writeFileSync(join(output, name + '-' + suffix + '.json'), value);
  }
  return actual.length;
}
async function verify(
  size: number,
  provider: string,
  caching: boolean,
  accepted: boolean,
): Promise<number> {
  return withPendingFixture(size, async (fixture) => {
    const { history, recorder, pauseWriter, releaseWriter } = fixture;
    pauseWriter();
    const callers = [pendingCaller(0), pendingCaller(1)];
    history.add(callers[0]);
    history.add(callers[1]);
    const pending = providerPendingFixture();
    const queued = pendingCaller(2);
    const expected = await oracle(
      size,
      fixture,
      callers,
      queued,
      pending,
      accepted,
    );
    history.startCompression();
    history.add(queued);
    await enforcerFor(fixture, accepted).enforce(600, 'pending-window-body');
    history.endCompression();
    releaseWriter();
    await recorder.flush();
    const actual: IContent[] = [];
    for await (const row of history.getCuratedForProviderStream(pending))
      actual.push(row);
    return compareBytes(
      provider,
      caching,
      actual,
      expected,
      `pending-${provider}-${size}-${caching}-${accepted}`,
    );
  });
}
describe('pending-window disk transport BODY bytes', () => {
  it.each(cases)(
    'matches %i rows %s cache=%s accepted=%s with exact retries',
    async (size, provider, caching, accepted) => {
      expect(await verify(size, provider, caching, accepted)).toBeGreaterThan(
        0,
      );
    },
    600000,
  );
});
