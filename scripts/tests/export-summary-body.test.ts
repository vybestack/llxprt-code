/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeBodyFile } from '../../packages/test-utils/src/body-evidence-writer.js';
import { describe, expect, it } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { withBatchFixture } from '../../packages/core/src/services/history/addbatch-stream-test-helpers.js';
import {
  exportSummaryRow,
  seedRows,
} from '../../packages/core/src/services/history/export-summary-test-helpers.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';

async function pair(
  size: number,
  provider: string,
  caching: boolean,
): Promise<number> {
  return withBatchFixture(async ({ history, recorder }) => {
    await seedRows(recorder, size);
    const expectedRows = Array.from({ length: size - 3 }, (_, index) =>
      exportSummaryRow(index),
    );
    const responseRows: IContent[] = [];
    const expected = await captureCuratedBody(provider, expectedRows, caching);
    let actual = '';
    await history.summarizeOldHistory(3, async (source) => {
      expect(Array.isArray(source)).toBe(false);
      actual = await captureCuratedBody(
        provider,
        source,
        caching,
        true,
        true,
        responseRows,
      );
      const summary = responseRows.find((row) =>
        row.blocks.some((block) => block.type === 'text'),
      );
      if (summary === undefined)
        throw new Error('Summary model returned no text');
      return summary;
    });
    expect(actual).toBe(expected);
    const summary = responseRows.find((row) =>
      row.blocks.some((block) => block.type === 'text'),
    );
    if (summary === undefined) throw new Error('Missing published summary');
    const afterExpected = await captureCuratedBody(
      provider,
      [
        summary,
        ...[size - 3, size - 2, size - 1].map((i) => exportSummaryRow(i)),
      ],
      caching,
    );
    const afterActual = await captureCuratedBody(
      provider,
      history.streamRawHistory(),
      caching,
      true,
      true,
    );
    expect(afterActual).toBe(afterExpected);
    const output = process.env.EXPORT_SUMMARY_BODY_OUTPUT;
    if (output !== undefined) {
      mkdirSync(output, { recursive: true });
      const prefix = `${provider}-${size}-${caching}`;
      for (const [suffix, text] of [
        ['actual', actual],
        ['expected', expected],
        ['after-actual', afterActual],
        ['after-expected', afterExpected],
      ])
        await writeBodyFile(join(output, `${prefix}-${suffix}.json`), text);
    }
    return Buffer.byteLength(actual) + Buffer.byteLength(afterActual);
  });
}

describe('invoked disk summary provider BODY bytes', () => {
  it.each([512, 8192])(
    'preserves %i-row model prompt and publication bodies with caching and retry',
    async (size) => {
      for (const provider of ['anthropic', 'openai-responses', 'gemini'])
        for (const caching of [false, true])
          expect(await pair(size, provider, caching)).toBeGreaterThan(0);
    },
    180000,
  );
});
