/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeBodyFile } from '../lib/body-evidence-writer.js';
import { describe, expect, it } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { accountingRow } from '../../packages/core/src/services/history/token-accounting-stream-test-helpers.js';
import { withReinitializeHistory } from '../../packages/agents/src/core/reinitialize-history-test-helpers.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';

async function recordBodies(
  output: string | undefined,
  name: string,
  expected: string,
  actual: string,
): Promise<void> {
  if (output === undefined) return;
  await writeBodyFile(join(output, `${name}-expected.json`), expected);
  await writeBodyFile(join(output, `${name}-actual.json`), actual);
}

const bodyCases = ['anthropic', 'openai-responses', 'gemini'].flatMap(
  (provider) => [false, true].map((caching) => ({ provider, caching })),
);

for (const size of [512, 8192]) {
  describe(`real chat default BODY ${size}`, () => {
    it('preserves provider bytes and retries for default and false readers with all converters and cache modes', async () => {
      await withReinitializeHistory(size, async (client) => {
        const expectedRows = Array.from({ length: size }, (_, index) =>
          accountingRow(index),
        );
        const output = process.env.CHAT_DEFAULT_BODY_OUTPUT;
        if (output !== undefined) mkdirSync(output, { recursive: true });
        for (const { provider, caching } of bodyCases) {
          const expected = await captureCuratedBody(
            provider,
            expectedRows,
            caching,
          );
          for (const explicitFalse of [false, true]) {
            const chat = client.getChat();
            const source = explicitFalse
              ? chat.getHistory(false)
              : chat.getHistory();
            const actual = await captureCuratedBody(
              provider,
              source,
              caching,
              true,
              true,
            );
            await recordBodies(
              output,
              `${provider}-${size}-${caching}-${explicitFalse}`,
              expected,
              actual,
            );
            expect(actual).toBe(expected);
          }
        }
      });
    }, 180_000);
  });
}
