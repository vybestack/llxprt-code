/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { installFixtureCandidate } from '../../packages/agents/src/compression/__tests__/provider-fallback-candidate-fixture.js';
import { writeBodyFile } from '../lib/body-evidence-writer.js';
import { describe, it, expect } from 'bun:test';

import { join } from 'node:path';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { exactTokenizer } from '../../packages/core/src/services/history/chronology-rollback-test-helpers.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import { buildCuratedHistory } from '../../packages/core/src/services/history/historyCuration.js';
import {
  invalidateResponsesStatefulChain,
  type IContent,
} from '../../packages/core/src/services/history/IContent.js';
import {
  providerFarFixtureRow,
  providerPendingFixture,
} from '../../packages/core/src/services/history/provider-curated-test-helpers.js';
import { ProviderContentEnforcer } from '../../packages/agents/src/compression/providerContentEnforcement.js';
import { buildRuntimeContext } from '../../packages/agents/src/core/__tests__/chatSession-density-helpers.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';
import { createTruncationStub } from '../../packages/agents/src/compression/toolResultTruncator.js';

const logger = new DebugLogger('test:fallback-body');
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

function fallbackOracle(
  size: number,
  accepted: boolean,
  pending: IContent[],
): IContent[] {
  const raw = accepted
    ? invalidateResponsesStatefulChain([
        providerFarFixtureRow(0),
        providerFarFixtureRow(2),
      ])
    : Array.from({ length: size }, (_, index) => providerFarFixtureRow(index));
  const response = pending[0].blocks[0];
  if (response.type !== 'tool_response') throw new Error('Invalid fixture');
  const oraclePending = accepted
    ? pending
    : [
        { ...pending[0], blocks: [createTruncationStub(response, 1)] },
        pending[1],
      ];
  const oracleRaw = accepted ? raw : raw.filter((row) => row.blocks.length > 0);
  return buildProviderContent(
    buildCuratedHistory(logger, oracleRaw, false),
    oraclePending,
    logger,
  );
}

async function verifyFallbackBody(
  size: number,
  provider: string,
  caching: boolean,
  accepted: boolean,
): Promise<void> {
  await withSuffixFixture(
    size,
    async (history) => {
      history.setTokenizerFactory(exactTokenizer());
      const pending = providerPendingFixture();
      let attempted = false;
      const candidate: IContent[] = [
        providerFarFixtureRow(0),
        providerFarFixtureRow(2),
      ];
      const expectedRows = fallbackOracle(size, accepted, pending);
      const enforcer = new ProviderContentEnforcer({
        historyService: history,
        runtimeContext: buildRuntimeContext(history, {
          contextLimit: 30000,
          compressionThreshold: 0.8,
        }),
        generationConfig: { maxOutputTokens: 100 },
        providerRuntimeNullable: undefined,
        logger,
        ensureDensityOptimized: async () => {},
        performCompression: async () => {
          throw new Error('provider failed');
        },
        performFallbackCompression: async (_promptId, install) => {
          await installFixtureCandidate(install, candidate);
          attempted = true;
          return accepted;
        },
        getPromptTokenBaseline: () => 123,
        resetPromptTokenBaseline: () => {},
        restorePromptTokenBaseline: () => {},
        estimateFinalizedPromptTokens: async (contents) =>
          contents.length + (attempted ? 0 : 200000),
      });
      const actualRows = await enforcer.enforce(
        { contents: pending, pendingContents: pending },
        'fallback-body',
      );
      const actual = await captureCuratedBody(
        provider,
        actualRows,
        caching,
        provider === 'openai-responses',
      );
      const expected = await captureCuratedBody(
        provider,
        expectedRows,
        caching,
      );
      const output = process.env.FALLBACK_BODY_OUTPUT;
      if (output !== undefined) {
        const name = `fallback-${provider}-${size}-${caching}-${accepted}`;
        await writeBodyFile(join(output, name + '-actual.json'), actual);
        await writeBodyFile(join(output, name + '-expected.json'), expected);
      }
      expect(actual).toBe(expected);
      if (provider === 'anthropic' && caching)
        expect(actual).toContain('cache_control');
    },
    2048,
    providerFarFixtureRow,
  );
}

describe('provider bytes after installed fallback success or rejection', () => {
  it.each(cases)(
    'preserves %i rows %s caching=%s accepted=%s',
    verifyFallbackBody,
    600000,
  );
});
