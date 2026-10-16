/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import type { RowDraft } from './rowDraft.js';
import { JournalStore } from './journalStore.js';
import {
  FLATNESS_BOUND_BYTES,
  IN_FLIGHT_BOUND_BYTES,
} from './__tests__/support/compactionMemory.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const ROWS = 40_000;
const SAMPLES = 4;
const RUN_MS = 170_000;
/** Ids per period: a call row, a response row, then rows with no id. */
const SMALL_PERIOD = 10;
const LARGE_PERIOD = 5;

function idCount(period: number): number {
  return ROWS / period;
}

/**
 * A tool-heavy history: in every `period` rows the first calls an id and the
 * second answers it, so the id facts of each id come from two rows.
 */
function* history(period: number): Generator<RowDraft> {
  for (let index = 0; index < ROWS; index++) {
    const pair = Math.floor(index / period);
    const slot = index % period;
    yield draftRow({
      text: `row ${index}`,
      calls: slot === 0 ? [`call_${pair}_abcdefghijklmnop`] : [],
      responses: slot === 1 ? [`call_${pair}_abcdefghijklmnop`] : [],
    });
  }
}

interface RebuildRun {
  /** The largest settled growth over the baseline while the rebuild ran. */
  readonly growth: number;
  readonly fileBytes: number;
}

describe('id fact batch memory over a 40,000-row rebuild (design 4.6)', () => {
  const directory = useTempDir('journal-idbatch-memory-');
  const open: JournalStore[] = [];
  afterEach(async () => {
    for (const store of open.splice(0)) await store.close();
  });

  async function replaceAll(
    name: string,
    rows: Iterable<RowDraft> | AsyncIterable<RowDraft>,
  ): Promise<string> {
    const file = path.join(directory(), name);
    const store = await JournalStore.create(file, storeDeps());
    open.push(store);
    await store.commit([{ kind: 'replace', rows }]);
    return file;
  }

  async function measuredRebuild(
    name: string,
    period: number,
  ): Promise<RebuildRun> {
    // One unwatched rebuild first, so caches and compiled code are warm.
    await replaceAll(`${name}.warm`, history(period));
    const baseline = await settledHeap();
    const series: number[] = [];
    const every = ROWS / SAMPLES;
    async function* watched(): AsyncGenerator<RowDraft> {
      let seen = 0;
      for (const draft of history(period)) {
        seen += 1;
        if (seen % every === 0) series.push((await settledHeap()) - baseline);
        yield draft;
      }
    }
    const file = await replaceAll(name, watched());
    series.push((await settledHeap()) - baseline);
    return {
      growth: Math.max(...series),
      fileBytes: (await fsp.stat(file)).size,
    };
  }

  it(
    'holds one bounded chunk of id facts, not the facts of every id, and the growth does not scale with the id count',
    async () => {
      expect(idCount(SMALL_PERIOD)).toBeGreaterThanOrEqual(4_000);
      const small = await measuredRebuild('small.llxj', SMALL_PERIOD);
      const large = await measuredRebuild('large.llxj', LARGE_PERIOD);
      process.stderr.write(
        `idbatch growth: ${idCount(SMALL_PERIOD)} ids ${small.growth} B (file ${small.fileBytes}), ${idCount(LARGE_PERIOD)} ids ${large.growth} B (file ${large.fileBytes})\n`,
      );
      expect(small.growth).toBeLessThan(IN_FLIGHT_BOUND_BYTES);
      expect(large.growth).toBeLessThan(IN_FLIGHT_BOUND_BYTES);
      expect(Math.abs(large.growth - small.growth)).toBeLessThan(
        FLATNESS_BOUND_BYTES,
      );
    },
    RUN_MS,
  );
});
