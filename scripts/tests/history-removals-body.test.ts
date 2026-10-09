/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeBodyFile } from '../lib/body-evidence-writer.js';
import { describe, expect, it } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import { buildCuratedHistory } from '../../packages/core/src/services/history/historyCuration.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import {
  providerFarFixtureRow,
  providerPendingFixture,
} from '../../packages/core/src/services/history/provider-curated-test-helpers.js';
import { withBatchFixture } from '../../packages/core/src/services/history/addbatch-stream-test-helpers.js';
import { recomposeFixture } from '../../packages/agents/src/compression/__tests__/provider-curated-recomposition-helpers.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';

function acceptedRow(index: number): IContent {
  const row = providerFarFixtureRow(index);
  return row.blocks.length === 0
    ? {
        ...row,
        speaker: 'human',
        blocks: [{ type: 'text', text: `accepted-${index}` }],
      }
    : row;
}

async function compareBodies(
  size: number,
  phase: string,
  actualRows: readonly IContent[],
  expected: readonly IContent[],
): Promise<void> {
  const logger = new DebugLogger('test:history-removals-body-oracle');
  const expectedRows = buildProviderContent(
    buildCuratedHistory(logger, expected, false),
    providerPendingFixture(),
    logger,
  );
  for (const provider of ['anthropic', 'openai-responses', 'gemini']) {
    for (const caching of [false, true]) {
      const actual = await captureCuratedBody(
        provider,
        actualRows,
        caching,
        true,
        true,
      );
      const oracle = await captureCuratedBody(provider, expectedRows, caching);
      expect(actual).toBe(oracle);
      if (provider === 'anthropic' && caching)
        expect(actual).toContain('"cache_control"');
      const output = process.env.REMOVAL_BODY_OUTPUT;
      if (output !== undefined) {
        mkdirSync(output, { recursive: true });
        const name = `${provider}-${size}-${phase}-${caching}`;
        await writeBodyFile(join(output, `${name}-actual.json`), actual);
        await writeBodyFile(join(output, `${name}-expected.json`), oracle);
      }
    }
  }
}

async function compare(size: number): Promise<void> {
  await withBatchFixture(async ({ history, owners }) => {
    const input = Array.from({ length: size }, (_, index) =>
      acceptedRow(index),
    );
    await history.addBatch(input, undefined, { streamPublication: true });
    expect(await history.pop()).toStrictEqual(input[size - 1]);
    expect(await history.removeLastIfMatches(input[size - 2])).toBe(true);
    await compareBodies(
      size,
      'removed',
      await recomposeFixture(history, providerPendingFixture()),
      Array.from({ length: size - 2 }, (_, index) => acceptedRow(index)),
    );
    history.clear();
    await history.addBatch(
      [acceptedRow(size), acceptedRow(size + 1)],
      undefined,
      { streamPublication: true },
    );
    await compareBodies(
      size,
      'cleared',
      await recomposeFixture(history, providerPendingFixture()),
      [acceptedRow(size), acceptedRow(size + 1)],
    );
    await history.waitForCommit();
    expect(owners.snapshot().liveRows).toBe(0);
  });
}

describe('history removal provider BODY pairs', () => {
  it.each([512, 8192])(
    'preserves provider bytes after pop, matching removal and clear over %i rows',
    async (size) => {
      const comparing = compare(size);
      await comparing;
      await expect(comparing).resolves.toBeUndefined();
    },
    180000,
  );
});
