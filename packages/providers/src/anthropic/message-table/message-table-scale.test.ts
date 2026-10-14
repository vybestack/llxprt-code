/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { DumpScratch } from '../../utils/dumpScratch.js';
import {
  SCALE_SCENARIOS,
  dumpBytes,
  type ScaleScenario,
} from './__tests__/support/messageTableHistories.js';
import {
  countStorageOperations,
  type StorageCounts,
} from './__tests__/support/storageCounter.js';
import { FINISH_SCENARIOS } from './__tests__/support/finishHistories.js';
import { cachedCandidate } from './__tests__/support/wireBuilderHarness.js';

const SMALL = 60;
const LARGE = SMALL * 4;

/** Storage operations of the whole /dump conversion at `units` units of work. */
async function operationsAt(
  scenario: ScaleScenario,
  units: number,
): Promise<StorageCounts> {
  const history = scenario.build(units);
  return countStorageOperations(() => dumpBytes(history));
}

function ratio(large: StorageCounts, small: StorageCounts): number {
  return large.total / small.total;
}

describe('message table storage operations grow linearly with rows', () => {
  for (const scenario of SCALE_SCENARIOS) {
    it(`${scenario.name}: 4x the rows costs about 4x the operations (${scenario.stressed})`, async () => {
      const small = await operationsAt(scenario, SMALL);
      const large = await operationsAt(scenario, LARGE);
      const growth = ratio(large, small);
      // Linear is 4; a table that scans per message would be near 16.
      expect({
        scenario: scenario.name,
        small: small.total,
        large: large.total,
        growth: Math.round(growth * 100) / 100,
        ok: growth > 3 && growth < 5,
      }).toMatchObject({ ok: true });
    }, 180_000);
  }
});

/** Storage operations of the wire build, the table passes and the cache controls. */
async function wireOperationsAt(
  scenario: ScaleScenario,
  units: number,
): Promise<StorageCounts> {
  const history = scenario.build(units);
  return countStorageOperations(() =>
    cachedCandidate(
      history,
      { reasoningEnabled: true, currentModel: 'claude-sonnet-4' },
      { ttl: '5m', mediaPurge: true, contextPrefix: 'rules' },
    ),
  );
}

describe('the passes after the table passes grow linearly with rows', () => {
  for (const scenario of FINISH_SCENARIOS) {
    it(`${scenario.name}: 4x the rows costs about 4x the operations (${scenario.stressed})`, async () => {
      const small = await wireOperationsAt(scenario, SMALL);
      const large = await wireOperationsAt(scenario, LARGE);
      const growth = ratio(large, small);
      expect({
        scenario: scenario.name,
        small: small.total,
        large: large.total,
        growth: Math.round(growth * 100) / 100,
        ok: growth > 3 && growth < 5,
      }).toMatchObject({ ok: true });
    }, 180_000);
  }
});

describe('the measurement method', () => {
  it('reads a per-record scan as quadratic, so a quadratic table cannot pass', async () => {
    async function scanning(units: number): Promise<StorageCounts> {
      const store = new DumpScratch<number>();
      try {
        for (let index = 0; index < units; index++) store.append(index);
        return await countStorageOperations(async () => {
          for (let index = 0; index < units; index++)
            for (let before = 0; before <= index; before++) store.read(before);
        });
      } finally {
        store.close();
      }
    }
    const growth = ratio(await scanning(LARGE), await scanning(SMALL));
    expect(growth).toBeGreaterThan(12);
  });

  it('counts the storage reads and writes the conversion makes', async () => {
    const counts = await operationsAt(SCALE_SCENARIOS[0], 5);
    expect(counts.tableReads).toBeGreaterThan(0);
    expect(counts.tableWrites).toBeGreaterThan(0);
  });
});

describe('the wire build opens no storage per message', () => {
  /** Scratch stores a wire build opens, counted by the closes it makes. */
  async function scratchStoresAt(units: number): Promise<number> {
    const closes = spyOn(DumpScratch.prototype, 'close');
    try {
      await wireOperationsAt(SCALE_SCENARIOS[0], units);
      return closes.mock.calls.length;
    } finally {
      closes.mockRestore();
    }
  }

  it('answered calls cost the same number of scratch stores at 4x the rows', async () => {
    // A scratch store is a directory and two files; one per assistant message
    // made a long history spend most of its time creating and removing them.
    const small = await scratchStoresAt(SMALL);
    const large = await scratchStoresAt(LARGE);
    expect({ small, large }).toStrictEqual({ small, large: small });
  });
});
