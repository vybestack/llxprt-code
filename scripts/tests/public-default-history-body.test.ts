/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { accountingRow } from '../../packages/core/src/services/history/token-accounting-stream-test-helpers.js';
import { withPublicHistory } from '../../packages/agents/src/api/__tests__/helpers/public-history-fixture.js';
import { internalConfig } from '../../packages/agents/src/api/__tests__/helpers/agentHarness.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';

async function bodyPairs(size: number, active: boolean): Promise<number> {
  return withPublicHistory(size, active, async (agent, _history, reader) => {
    let comparisons = 0;
    const client = internalConfig(agent).getAgentClient();
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
          client.getHistory(),
          caching,
          true,
          true,
        );
        const output = process.env.PUBLIC_DEFAULT_BODY_OUTPUT;
        if (output !== undefined) {
          mkdirSync(output, { recursive: true });
          const prefix = `${provider}-${size}-${active}-${caching}`;
          writeFileSync(join(output, `${prefix}-expected.json`), expected);
          writeFileSync(join(output, `${prefix}-actual.json`), actual);
        }
        expect(actual).toBe(expected);
        comparisons++;
      }
    }
    expect(reader.snapshot().liveRows).toBe(0);
    return comparisons;
  });
}

for (const size of [512, 8192]) {
  describe(`public default history BODY bytes ${size}`, () => {
    it('preserves three independent provider bodies, cache modes and retries for an inactive client', async () => {
      expect(await bodyPairs(size, false)).toBe(6);
    }, 180000);
    it('preserves three independent provider bodies, cache modes and retries for an active client', async () => {
      expect(await bodyPairs(size, true)).toBe(6);
    }, 180000);
  });
}
