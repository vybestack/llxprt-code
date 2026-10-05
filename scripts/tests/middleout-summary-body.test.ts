/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withSuffixFixture } from '../../packages/core/src/services/history/history-suffix-test-helpers.js';
import {
  middleoutRow,
  MiddleoutDiskHistory,
} from '../../packages/agents/src/compression/__tests__/middleout-disk-helpers.js';
import { invokedSummaryBodies } from './middleout-summary-body-helpers.js';
const cases: Array<[number, string, boolean]> = [];
for (const size of [512, 8192])
  for (const provider of ['anthropic', 'openai-responses', 'gemini'])
    for (const caching of [false, true]) cases.push([size, provider, caching]);
async function pair(
  size: number,
  provider: string,
  caching: boolean,
): Promise<number> {
  return withSuffixFixture(
    size,
    async (history) => {
      const result = await invokedSummaryBodies(
        history,
        size,
        provider,
        caching,
      );
      const output = process.env.MIDDLEOUT_DISK_BODY_OUTPUT;
      if (output !== undefined) {
        const name = `invoked-summary-${provider}-${size}-${caching}`;
        writeFileSync(join(output, name + '-actual.json'), result.actual);
        writeFileSync(join(output, name + '-expected.json'), result.expected);
        writeFileSync(
          join(output, name + '-after-actual.json'),
          result.afterActual,
        );
        writeFileSync(
          join(output, name + '-after-expected.json'),
          result.afterExpected,
        );
      }
      expect(result.actual).toBe(result.expected);
      expect(result.afterActual).toBe(result.afterExpected);
      expect(result.attempts).toBe(2);
      return result.actual.length;
    },
    2048,
    middleoutRow,
    undefined,
    (options) => new MiddleoutDiskHistory(options),
  );
}
describe('BODY BYTES through the real invoked middle-out summary provider', () => {
  it.each(cases)(
    'preserves independent %i-row %s summary BODY and retry bytes with caching %s',
    async (size, provider, caching) => {
      expect(await pair(size, provider, caching)).toBeGreaterThan(0);
    },
    180_000,
  );
});
