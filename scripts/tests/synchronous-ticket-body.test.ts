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
import { withSynchronousFixture } from '../../packages/core/src/services/history/synchronous-ticket-test-helpers.js';
import { recomposeFixture } from '../../packages/agents/src/compression/__tests__/provider-curated-recomposition-helpers.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';

function acceptedRow(index: number, oversized: boolean): IContent {
  const row = providerFarFixtureRow(index);
  if (oversized)
    return {
      ...row,
      speaker: 'human',
      blocks: [
        { type: 'text', text: `oversized:${'x'.repeat(9 * 1024 * 1024 + 17)}` },
      ],
    };
  return row.blocks.length === 0
    ? {
        ...row,
        speaker: 'human',
        blocks: [{ type: 'text', text: `accepted-${index}` }],
      }
    : row;
}

async function compare(size: number, oversized: boolean): Promise<void> {
  await withSynchronousFixture(async ({ history }) => {
    for (let index = 0; index < size; index++)
      history.add(acceptedRow(index, oversized));
    await history.waitForCommit();
    await history.waitForTokenUpdates();
    const logger = new DebugLogger('test:synchronous-ticket-body');
    const expectedRows = buildProviderContent(
      buildCuratedHistory(
        logger,
        Array.from({ length: size }, (_, index) =>
          acceptedRow(index, oversized),
        ),
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
        const output = process.env.SYNC_TICKET_BODY_OUTPUT;
        if (output !== undefined) {
          mkdirSync(output, { recursive: true });
          const name = `${provider}-${size}-${oversized}-${caching}`;
          await writeBodyFile(join(output, `${name}-actual.json`), actual);
          await writeBodyFile(join(output, `${name}-expected.json`), expected);
        }
      }
    }
  });
}

describe('synchronous value tickets preserve provider BODYs and retries', () => {
  it.each([512, 8192])(
    'preserves complete %i-row BODYs',
    async (size) => {
      await expect(compare(size, false)).resolves.toBeUndefined();
    },
    180_000,
  );
  it('preserves a complete greater-than-nine-MiB value in every BODY', async () => {
    await expect(compare(1, true)).resolves.toBeUndefined();
  }, 180_000);
});
