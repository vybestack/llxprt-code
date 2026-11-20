/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import {
  dumpBytes,
  dumpCase,
  randomHistory,
  type DumpCase,
} from './support/messageTableHistories.js';

const FIXTURE = new URL('./fixtures/dump-golden.json', import.meta.url)
  .pathname;
const CASES = 600;

interface GoldenEntry extends DumpCase {
  readonly sha256: string;
  readonly length: number;
}

async function entryFor(seed: number): Promise<GoldenEntry> {
  const shape = dumpCase(seed);
  const bytes = await dumpBytes(randomHistory(seed), shape.policy, shape.model);
  return {
    ...shape,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    length: Buffer.byteLength(bytes),
  };
}

async function allEntries(): Promise<GoldenEntry[]> {
  const entries: GoldenEntry[] = [];
  for (let seed = 0; seed < CASES; seed++) entries.push(await entryFor(seed));
  return entries;
}

/**
 * The fixture holds the /dump bytes (hash and length) the table produced
 * before it was indexed, for seeded histories with duplicate ids, orphans,
 * displaced and unanswered calls. Regenerating it is only for an intended
 * change of the dump format: `MESSAGE_TABLE_GOLDEN_UPDATE=1`.
 */
describe('/dump bytes of the Anthropic message table', () => {
  it('equal the recorded bytes for every seeded history', async () => {
    const entries = await allEntries();
    if (process.env['MESSAGE_TABLE_GOLDEN_UPDATE'] === '1') {
      if (process.env['CI'] !== undefined)
        throw new Error('Refusing to rewrite the golden fixture in CI');
      writeFileSync(FIXTURE, `${JSON.stringify(entries, null, 1)}\n`);
    }
    const recorded: GoldenEntry[] = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    expect(recorded).toHaveLength(CASES);
    const differing = entries
      .filter((entry, index) => entry.sha256 !== recorded[index].sha256)
      .map((entry) => entry.seed);
    expect(differing).toStrictEqual([]);
  }, 180_000);

  it('come from histories that differ and reach the repair paths', async () => {
    const recorded: GoldenEntry[] = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    expect(new Set(recorded.map((entry) => entry.sha256)).size).toBe(CASES);
    let interrupted = 0;
    let continuations = 0;
    for (let seed = 0; seed < CASES; seed++) {
      const shape = dumpCase(seed);
      const bytes = await dumpBytes(
        randomHistory(seed),
        shape.policy,
        shape.model,
      );
      if (bytes.includes('[tool execution interrupted]')) interrupted++;
      if (bytes.includes('Continue the conversation')) continuations++;
    }
    expect(interrupted).toBeGreaterThan(CASES / 4);
    expect(continuations).toBeGreaterThan(0);
  }, 180_000);
});
