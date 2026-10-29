/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { appendBodyEvidence } from '../../packages/test-utils/src/body-evidence-writer.js';
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';

import { admitDeferredHistorySource } from '../../packages/agents/src/core/deferredHistorySource.js';
import { buildAgent } from '../../packages/agents/src/api/__tests__/helpers/agentHarness.js';
import { capturedAgentClient } from '../../packages/agents/src/api/__tests__/helpers/agent-client-observation.js';
import { captureCompressionBody } from './support/compression-value-openai-body.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import { withValueTransformFixture } from '../../packages/core/src/services/history/transform-value-test-helpers.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import type { AgentClientContract } from '../../packages/core/src/core/clientContract.js';
import type { LocalMediaStore } from '../../packages/core/src/storage/local-media-store.js';
import type { HistoryService } from '../../packages/core/src/services/history/HistoryService.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';

async function* bodyInput(
  size: number,
  bytes: number,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++) yield suffixRow(index, bytes);
}

async function compareBodies(
  history: HistoryService,
  size: number,
  bytes: number,
): Promise<number> {
  const pending: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'next' }] },
  ];
  const oracleRows = Array.from({ length: size }, (_, index) =>
    suffixRow(index, bytes),
  );
  const independent = buildProviderContent(
    oracleRows,
    pending,
    new DebugLogger('test:transform-value-body'),
  );
  let compared = 0;
  for (const provider of [
    'openai',
    'anthropic',
    'openai-responses',
    'gemini',
  ]) {
    for (const caching of [false, true]) {
      const actual = await captureCompressionBody(
        provider,
        history.getCuratedForProviderStream(pending),
        caching,
        true,
        true,
      );
      const oracle = await captureCompressionBody(
        provider,
        independent,
        caching,
      );
      const output = process.env.TRANSFORM_BODY_OUTPUT;
      if (output !== undefined)
        await appendBodyEvidence(
          output,
          {
            size,
            bytes,
            provider,
            caching,
            bodyBytes: Buffer.byteLength(actual),
            sha256: createHash('sha256').update(actual).digest('hex'),
          },
          actual,
          oracle,
        );
      expect(actual).toBe(oracle);
      expect(actual).toContain(`${size - 1}:${'x'.repeat(bytes)}`);

      compared++;
    }
  }
  return compared;
}

function requireMediaStore(client: AgentClientContract): LocalMediaStore {
  if (client.mediaStore === undefined) throw new Error('Missing media store');
  return client.mediaStore;
}

async function verifyBody(size: number, bytes: number): Promise<number> {
  const { agent, cleanup } = await buildAgent('plain-text.jsonl');
  try {
    return await withValueTransformFixture(async ({ history, owners }) => {
      const release = await admitDeferredHistorySource(
        history,
        bodyInput(size, bytes),
        requireMediaStore(capturedAgentClient(agent)),
        { ownership: owners },
        'fake-model',
      );
      try {
        return await compareBodies(history, size, bytes);
      } finally {
        await release();
      }
    });
  } finally {
    await cleanup();
  }
}

describe('deferred transform complete provider BODY', () => {
  for (const size of [65]) {
    it(`matches all four provider BODYs with cache and retry at ${size}`, async () => {
      expect(await verifyBody(size, 2048)).toBe(8);
    }, 180_000);
  }
  it('keeps the complete oversized valid input in every provider BODY', async () => {
    expect(await verifyBody(1, 9 * 1024 * 1024 + 1)).toBe(8);
  }, 180_000);
});
