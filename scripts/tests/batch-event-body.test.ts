/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeBodyFile } from '../../packages/test-utils/src/body-evidence-writer.js';
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
import { visitBatch } from '../../packages/core/src/services/history/batch-event-test-helpers.js';

function acceptedRow(index: number): ReturnType<typeof providerFarFixtureRow> {
  const row = providerFarFixtureRow(index);
  return row.blocks.length === 0
    ? {
        ...row,
        speaker: 'human',
        blocks: [{ type: 'text', text: `accepted-${index}` }],
      }
    : row;
}
async function compare(size: number): Promise<void> {
  await withBatchFixture(async ({ history }) => {
    let observed = 0;
    history.once('contentBatchAdded', (values) => {
      expect(values.length).toBe(size);
      observed = visitBatch(values, (row) => {
        const expected = acceptedRow(observed++);
        expect(row.speaker).toBe(expected.speaker);
        expect(row.blocks).toStrictEqual(expected.blocks);
      });
    });
    const batch = Array.from({ length: size }, (_, index) =>
      acceptedRow(index),
    );
    await history.addBatch(batch, undefined, { streamPublication: true });
    expect(observed).toBe(size);
    const logger = new DebugLogger('test:batch-event-body');
    const expectedRows = buildProviderContent(
      buildCuratedHistory(
        logger,
        Array.from({ length: size }, (_, index) => acceptedRow(index)),
        false,
      ),
      providerPendingFixture(),
      logger,
    );
    const actualRows = await recomposeFixture(
      history,
      providerPendingFixture(),
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
        const expected = await captureCuratedBody(
          provider,
          expectedRows,
          caching,
        );
        expect(actual).toBe(expected);
        const output = process.env.BATCH_EVENT_BODY_OUTPUT;
        if (output !== undefined) {
          mkdirSync(output, { recursive: true });
          const name = `${provider}-${size}-${caching}`;
          await writeBodyFile(join(output, `${name}-actual.json`), actual);
          await writeBodyFile(join(output, `${name}-expected.json`), expected);
        }
      }
    }
    await history.waitForCommit();
  });
}
describe('batch cursor publication preserves complete provider bodies and retries', () => {
  it.each([512, 8192])(
    'preserves every accepted row in %i-row BODYs',
    async (size) => {
      await expect(compare(size)).resolves.toBeUndefined();
    },
    180000,
  );
});
