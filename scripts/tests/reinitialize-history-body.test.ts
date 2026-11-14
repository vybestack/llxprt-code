/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeBodyFile } from '../../packages/test-utils/src/body-evidence-writer.js';
import { describe, expect, it } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { accountingRow } from '../../packages/core/src/services/history/__tests__/support/token-accounting-stream-test-helpers.js';
import { withReinitializeHistory } from '../../packages/agents/src/core/__tests__/support/reinitialize-history-test-helpers.js';
import { captureCuratedBody } from './provider-curated-body-gemini.js';

async function bodyPairs(size: number): Promise<void> {
  await withReinitializeHistory(size, async (client) => {
    const expectedRows = Array.from({ length: size }, (_, index) =>
      accountingRow(index),
    );
    for (const provider of ['anthropic', 'openai-responses', 'gemini']) {
      for (const caching of [false, true]) {
        const expected = await captureCuratedBody(
          provider,
          expectedRows,
          caching,
        );
        const actual = await captureCuratedBody(
          provider,
          client.streamHistory(),
          caching,
          true,
          true,
        );
        const output = process.env.REINITIALIZE_HISTORY_BODY_OUTPUT;
        if (output !== undefined) {
          mkdirSync(output, { recursive: true });
          const prefix = `${provider}-${size}-${caching}`;
          await writeBodyFile(
            join(output, `${prefix}-expected.json`),
            expected,
          );
          await writeBodyFile(join(output, `${prefix}-actual.json`), actual);
        }
        expect(actual).toBe(expected);
      }
    }
  });
}

describe('active-client disk transfer provider BODY bytes', () => {
  it.each([65])(
    'preserves %i-row bytes and retry bodies with all three converters',
    bodyPairs,
    180000,
  );
});
