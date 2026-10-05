import { observeHistorySynchronouslyForTest } from '../../packages/core/src/test-utils/synchronous-history-test-observation.js';
import { forbidHistoryMaterializationForTest } from '../../packages/core/src/test-utils/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import { HistoryService } from '../../packages/core/src/services/history/HistoryService.js';
import { withSuffixFixture } from '../../packages/core/src/services/history/history-suffix-test-helpers.js';
import {
  providerFarFixtureRow,
  providerPendingFixture,
} from '../../packages/core/src/services/history/provider-curated-test-helpers.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import { recomposeFixture } from '../../packages/agents/src/compression/__tests__/provider-curated-recomposition-helpers.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';

class CursorOnlyHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(
      this,
      'eager provider send preparation',
    );
  }
}

describe('journal materialization guard', () => {
  it('CursorOnlyHistory rejects journal eager materialization', () => {
    const history = new CursorOnlyHistory();

    try {
      expect(() => observeHistorySynchronouslyForTest(history)).toThrow(
        'eager provider send preparation',
      );
    } finally {
      history.dispose();
    }
  });
});
const logger = new DebugLogger('test:provider-curated-body');

async function verifyBody(
  size: number,
  provider: string,
  caching: boolean,
): Promise<{ readonly actual: string; readonly expected: string }> {
  return withSuffixFixture(
    size,
    async (history) => {
      const pending = providerPendingFixture();
      const input = Array.from({ length: size }, (_, index) =>
        providerFarFixtureRow(index),
      );
      const oracle = buildProviderContent(
        input.filter((row) => row.speaker !== 'ai' || row.blocks.length > 0),
        pending,
        logger,
      );
      const recomposed = await recomposeFixture(history, pending);
      const actual = await captureCuratedBody(
        provider,
        recomposed,
        caching,
        provider === 'openai-responses',
      );
      const expected = await captureCuratedBody(provider, oracle, caching);
      const output = process.env.PROVIDER_CURATED_BODY_OUTPUT;
      if (output) {
        const name = `${provider}-${size}-${caching}`;
        writeFileSync(join(output, `${name}-actual.json`), actual);
        writeFileSync(join(output, `${name}-expected.json`), expected);
      }
      return { actual, expected };
    },
    2048,
    providerFarFixtureRow,
    undefined,
    (options) => new CursorOnlyHistory(options),
  );
}

const bodyCases: Array<[number, string, boolean]> = [];
for (const size of [512, 8192])
  for (const provider of ['openai-responses', 'anthropic', 'gemini'])
    for (const caching of [false, true])
      bodyCases.push([size, provider, caching]);

describe('real provider bodies from invoked curated recomposition', () => {
  it.each(bodyCases)(
    'preserves %i-row %s tool/media bytes with caching %s',
    async (size, provider, caching) => {
      const { actual, expected } = await verifyBody(size, provider, caching);
      expect(actual).toBe(expected);
      if (caching && provider === 'anthropic')
        expect(actual).toContain('"cache_control"');
    },
    120_000,
  );
});
