/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeBodyFile } from '../../packages/test-utils/src/body-evidence-writer.js';
import { describe, expect, it } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import { buildCuratedHistory } from '../../packages/core/src/services/history/historyCuration.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import { withBatchFixture } from '../../packages/core/src/services/history/addbatch-stream-test-helpers.js';
import {
  repairRow,
  replacementFor,
} from '../../packages/core/src/services/history/tool-repair-disk-test-helpers.js';
import { recomposeFixture } from '../../packages/agents/src/compression/__tests__/provider-curated-recomposition-helpers.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';
import type {
  IContent,
  ToolResponseBlock,
} from '../../packages/core/src/services/history/IContent.js';

function oracleRows(size: number): IContent[] {
  const rows: IContent[] = [];
  for (let index = 0; index < size; index++) {
    const row = repairRow(index, size);
    rows.push(
      [0, size - 1].includes(index)
        ? {
            ...row,
            blocks: row.blocks.map((block, position) =>
              position === 2 ? replacementFor(index) : block,
            ),
          }
        : row,
    );
    if (![0, Math.floor(size / 2), size - 1].includes(index)) continue;
    const response = (callId: string, toolName: string): ToolResponseBlock => ({
      type: 'tool_response',
      callId,
      toolName,
      result: null,
      error: 'Tool call interrupted or cancelled',
      isComplete: true,
    });
    rows.push({
      speaker: 'tool',
      blocks: [
        response(`missing-${index}`, 'unknown_tool'),
        response(`missing-${index}`, 'duplicate'),
        ...(index === 0 ? [response('repeated', 'repeat')] : []),
      ],
      metadata: { synthetic: true, reason: 'orphaned_tool_call' },
    });
  }
  return rows;
}

async function compareBodies(size: number): Promise<void> {
  await withBatchFixture(async ({ history, recorder }) => {
    for (let index = 0; index < size; index++)
      await recorder.commit('content', { content: repairRow(index, size) });
    for (const index of [0, size - 1])
      expect(
        await history.replaceToolResponseBlock(index, 2, replacementFor(index)),
      ).toBe(true);
    history.validateAndFix();
    await history.waitForTokenUpdates();
    const tail: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'continue after repair' }],
        metadata: { cacheAnchor: true },
      },
    ];
    const actualRows = await recomposeFixture(history, tail);
    const logger = new DebugLogger('test:tool-repair-body');
    const expectedRows = buildProviderContent(
      buildCuratedHistory(logger, oracleRows(size), false),
      tail,
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
        const expected = await captureCuratedBody(
          provider,
          expectedRows,
          caching,
        );
        expect(actual).toBe(expected);
        if (provider === 'anthropic' && caching)
          expect(actual).toContain('"cache_control"');
        const output = process.env.TOOL_REPAIR_BODY_OUTPUT;
        if (output !== undefined) {
          mkdirSync(output, { recursive: true });
          const prefix = `${provider}-${size}-${caching}`;
          await writeBodyFile(join(output, `${prefix}-actual.json`), actual);
          await writeBodyFile(
            join(output, `${prefix}-expected.json`),
            expected,
          );
        }
      }
    }
  });
}

describe('tool replacement and validation provider BODY bytes', () => {
  it.each([512, 8192])(
    'matches independent eager fixture bytes over %i repaired rows with caching and retry',
    async (size) => {
      const comparing = compareBodies(size);
      await comparing;
      await expect(comparing).resolves.toBeUndefined();
    },
    180000,
  );
});
