import { normalizedRows } from '../../../__tests__/support/frozenWire/normalizedRows.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  CURRENT_BASE_URL,
  CURRENT_MODEL,
  wireHistory,
} from './support/wireBuilderCorpus.js';
import {
  cachedOracle,
  describeDifference,
  emittedCandidate,
  type CacheSettings,
  type WireSettings,
} from './support/wireBuilderHarness.js';
import { settingsFor } from './support/wireBuilderSettings.js';
import { aiText, answerRow, callRow, text } from './support/wireBuilderRows.js';

const CACHES: readonly CacheSettings[] = [
  {},
  { ttl: '5m' },
  { ttl: '1h', mediaPurge: true },
  { ttl: '1h', contextPrefix: 'be careful' },
  { contextPrefix: 'be careful' },
];

const PLAIN: WireSettings = {
  reasoningEnabled: false,
  currentModel: CURRENT_MODEL,
  currentBaseURL: CURRENT_BASE_URL,
};

describe('writeTableMessages', () => {
  it('writes the bytes of the array route for seeded histories under every cache setting', async () => {
    const found: string[] = [];
    for (let seed = 0; seed < 60; seed++) {
      for (const cache of CACHES) {
        const rows = await normalizedRows(wireHistory(seed));
        const settings = settingsFor(seed);
        const expected = cachedOracle(rows, settings, cache).json;
        const actual = await emittedCandidate(rows, settings, cache);
        const difference = describeDifference(expected, actual);
        if (difference !== undefined) {
          found.push(`seed ${seed} ${JSON.stringify(cache)}: ${difference}`);
        }
      }
    }
    expect(found).toStrictEqual([]);
  });

  it('writes text that spans several chunks, with characters JSON escapes', async () => {
    const big = `${'wide \u{1F600} \u2028 "quoted" \\ '.repeat(20000)}\u0007end`;
    const rows = [text(big), aiText(big), text('last')];
    const expected = cachedOracle(rows, PLAIN, { ttl: '5m' }).json;
    const actual = await emittedCandidate(rows, PLAIN, { ttl: '5m' });
    expect(expected.length).toBeGreaterThan(500_000);
    expect(describeDifference(expected, actual)).toBeUndefined();
  });

  it('writes a string message as a string and a block message as an array', async () => {
    const actual = await emittedCandidate(
      [text('hello'), callRow('a'), answerRow('a'), aiText('done')],
      PLAIN,
      {},
    );
    const messages: Array<{ role: string; content: unknown }> =
      JSON.parse(actual);
    expect(messages.map((m) => [m.role, typeof m.content])).toStrictEqual([
      ['user', 'string'],
      ['assistant', 'object'],
      ['user', 'object'],
      ['assistant', 'string'],
    ]);
    expect(Array.isArray(messages[1].content)).toBe(true);
  });
});
