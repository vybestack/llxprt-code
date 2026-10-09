/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeBodyFile } from '../lib/body-evidence-writer.js';
import { describe, expect, it } from 'bun:test';

import { join } from 'node:path';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  oneshotRow,
  OneshotDiskHistory,
} from '../../packages/agents/src/compression/__tests__/oneshot-disk-helpers.js';
import { invokedSummaryBodies } from './oneshot-summary-body-helpers.js';
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
      const output = process.env.ONESHOT_DISK_BODY_OUTPUT;
      if (output !== undefined) {
        const name = `invoked-summary-${provider}-${size}-${caching}`;
        await writeBodyFile(join(output, name + '-actual.json'), result.actual);
        await writeBodyFile(
          join(output, name + '-expected.json'),
          result.expected,
        );
        await writeBodyFile(
          join(output, name + '-after-actual.json'),
          result.afterActual,
        );
        await writeBodyFile(
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
    oneshotRow,
    undefined,
    (options) => new OneshotDiskHistory(options),
  );
}
describe('BODY BYTES through the real invoked one-shot summary provider', () => {
  it.each(cases)(
    'preserves independent %i-row %s summary BODY and retry bytes with caching %s',
    async (size, provider, caching) => {
      expect(await pair(size, provider, caching)).toBeGreaterThan(0);
    },
    180_000,
  );
});
