/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeBodyFile } from '../../packages/test-utils/src/body-evidence-writer.js';
import { describe, expect, it } from 'bun:test';

import { join } from 'node:path';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { buildCuratedHistory } from '../../packages/core/src/services/history/historyCuration.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import {
  invalidateResponsesStatefulChain,
  type IContent,
} from '../../packages/core/src/services/history/IContent.js';
import type { HistoryService } from '../../packages/core/src/services/history/HistoryService.js';
import { providerFarFixtureRow } from '../../packages/core/src/services/history/__tests__/support/provider-curated-test-helpers.js';
import { enforceWithHandler } from '../../packages/agents/src/compression/__tests__/support/enforce-with-handler.js';
import { runDiskProviderFallback } from '../../packages/agents/src/compression/diskProviderFallback.js';
import { buildCompressionMetadata } from '../../packages/agents/src/compression/compressionContextBuilder.js';
import { TruncationArrayOracle } from './support/truncation-array-oracle.js';
import { middleoutSetup } from '../../packages/agents/src/compression/__tests__/middleout-disk-helpers.js';
import { PerformCompressionResult } from '../../packages/core/src/core/turn.js';
import { createTruncationStub } from '../../packages/agents/src/compression/toolResultTruncator.js';
import { captureCuratedBody } from './provider-curated-body-gemini.js';
import {
  heavyPendingFixture,
  toolBlockTokens,
  untrimmedFarCallTokens,
  weightedTokenizer,
} from './heavy-far-response-support.js';

const logger = new DebugLogger('test:actual-hardlimit-body');
const cases = [65].flatMap((size) =>
  [false, true].map((accepted): [number, boolean] => [size, accepted]),
);
type Setup = ReturnType<typeof middleoutSetup>;

async function oracle(
  size: number,
  history: HistoryService,
  setup: Setup,
  pending: IContent[],
  accepted: boolean,
): Promise<IContent[]> {
  const raw = Array.from({ length: size }, (_, index) =>
    providerFarFixtureRow(index),
  );
  const { runtime, transport } = setup;
  const metadata = await buildCompressionMetadata(
    'oracle',
    runtime,
    history,
    async () => ({
      provider: transport,
      runtime: runtime.providerRuntime,
      invocation: runtime.prepareProviderInvocation(transport.name),
    }),
    undefined,
    undefined,
    logger,
    { targetTokenCount: 0 },
  );
  const legacy = await new TruncationArrayOracle().compress({
    ...metadata,
    history: buildCuratedHistory(logger, raw, false),
    estimateTokens: async (rows) => rows.length,
  });
  if (legacy.kind !== 'applied') throw new Error('Expected legacy truncation');
  const response = pending[0].blocks[0];
  if (response.type !== 'tool_response')
    throw new Error('Invalid pending fixture');
  const expectedPending = accepted
    ? pending
    : [
        {
          ...pending[0],
          blocks: [
            createTruncationStub(
              response,
              await toolBlockTokens(history, response),
            ),
          ],
        },
        pending[1],
      ];
  const expectedRaw = accepted
    ? invalidateResponsesStatefulChain(legacy.newHistory)
    : raw.filter((row) => row.blocks.length > 0);
  return buildProviderContent(
    buildCuratedHistory(logger, expectedRaw, false),
    expectedPending,
    logger,
  );
}

function enforceFor(
  history: HistoryService,
  setup: Setup,
  accepted: boolean,
  pending: IContent[],
): Promise<IContent[]> {
  const { runtime, transport } = setup;
  let attempted = false;
  return enforceWithHandler({
    history,
    runtimeContext: runtime,
    generationConfig: { maxOutputTokens: 100 },
    pending,
    promptId: 'actual-hardlimit-body',
    performCompression: async () => PerformCompressionResult.FAILED,
    fallbackDeps: {
      performFallbackCompression: async (prompt, install, targetTokenCount) => {
        const result = await runDiskProviderFallback(
          install,
          prompt,
          runtime,
          history,
          async () => ({
            provider: transport,
            runtime: runtime.providerRuntime,
          }),
          undefined,
          undefined,
          logger,
          { targetTokenCount },
        );
        attempted = true;
        return accepted && result.outcome === 'applied';
      },
      getPromptTokenBaseline: () => 123,
    },
    // An accepted candidate fits once installed; a rejected one only fits
    // after last-resort tool-response truncation.
    estimateRows: async (rows) => {
      if (!accepted)
        return rows.length + (await untrimmedFarCallTokens(history, rows));
      return rows.length + (attempted ? 0 : history.getTotalTokens() + 200000);
    },
  });
}
async function verify(size: number, accepted: boolean): Promise<void> {
  await withSuffixFixture(
    size,
    async (history) => {
      const setup = middleoutSetup(history, undefined, undefined, {
        contextLimit: 30000,
        compressionThreshold: 0.8,
      });
      // The setup installs the exact tokenizer; the far response needs weight.
      history.setTokenizerFactory(weightedTokenizer());
      history.syncTotalTokens(
        await history.estimateTokensForContents(history.streamRawHistory()),
      );
      await history.waitForTokenUpdates();
      const pending = heavyPendingFixture();
      const expectedRows = await oracle(
        size,
        history,
        setup,
        pending,
        accepted,
      );
      const actualRows = await enforceFor(history, setup, accepted, pending);
      // Enforcement depends on size and acceptance, not the transport or cache
      // setting. Reuse its output while checking every transport combination.
      for (const provider of ['anthropic', 'openai-responses', 'gemini'])
        for (const caching of [false, true])
          await verifyTransport(
            size,
            provider,
            caching,
            accepted,
            actualRows,
            expectedRows,
          );
    },
    2048,
    providerFarFixtureRow,
  );
}
async function verifyTransport(
  size: number,
  provider: string,
  caching: boolean,
  accepted: boolean,
  actualRows: IContent[],
  expectedRows: IContent[],
): Promise<void> {
  const actualResponse: IContent[] = [];
  const expectedResponse: IContent[] = [];
  const actual = await captureCuratedBody(
    provider,
    structuredClone(actualRows),
    caching,
    true,
    true,
    actualResponse,
  );
  const expected = await captureCuratedBody(
    provider,
    structuredClone(expectedRows),
    caching,
    false,
    false,
    expectedResponse,
  );
  expect(JSON.stringify(actualResponse)).toBe(JSON.stringify(expectedResponse));
  expect(
    actualResponse
      .flatMap((row) => row.blocks)
      .some((block) => block.type === 'text' && block.text.length > 0),
  ).toBe(true);
  const output = process.env.PROVIDER_HARDLIMIT_BODY_OUTPUT;
  if (output !== undefined) {
    const name = `hardlimit-${provider}-${size}-${caching}-${accepted}`;
    await writeBodyFile(join(output, name + '-actual.json'), actual);
    await writeBodyFile(join(output, name + '-expected.json'), expected);
    await writeBodyFile(
      join(output, name + '-response-actual.json'),
      JSON.stringify(actualResponse),
    );
    await writeBodyFile(
      join(output, name + '-response-expected.json'),
      JSON.stringify(expectedResponse),
    );
  }
  expect(actual).toBe(expected);
  if (provider === 'anthropic' && caching)
    expect(actual).toContain('cache_control');
}

describe('actual disk hard-limit transport bytes', () => {
  it.each(cases)(
    'preserves %i rows accepted=%s across all transports and cache settings with identical retries',
    verify,
    600000,
  );
});
