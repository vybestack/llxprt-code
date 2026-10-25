/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  countingAccess,
  type HeadReads,
} from './__tests__/support/countingAccess.js';
import {
  copyDeps,
  growAfterCheckpoint,
  populatedSource,
} from './__tests__/support/copyFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { compactionCopy } from './versionTransfer.js';
import { trackPinnedAccess } from './__tests__/support/pinnedAccess.js';

const accessOf = trackPinnedAccess();

const FEW = 100;
const MANY = 400;
/** A linear copy reads 4 times as much for 4 times the checkpoints; the slack is the fixed part and the depth of the tries. */
const LINEAR_RATIO_LIMIT = 4.5;
/**
 * With rows between the checkpoints a version also reaches the row tree, the
 * id facts and the relocation trie, and 400 checkpoints have a state map one
 * level deeper than 100, so the work of a copy that does constant work per
 * distinct record grows by up to 4 times 1.5. A copy that redoes the map for
 * every version grows by 16.
 */
const FULL_COPY_RATIO_LIMIT = 8;
const ROWS_BETWEEN_CHECKPOINTS = 2;

interface CopyWork {
  /** Heads of every kind read from the source. */
  readonly headReads: number;
  /** Heads of `VALUE` and `ITNODE` records read from the source: the state map's keys, values and nodes. */
  readonly stateReads: number;
  /** Records of every kind written to the new file, trailers included. */
  readonly written: number;
  /** `VALUE` and `ITNODE` records written to the new file. */
  readonly stateWritten: number;
  /** Lookups of the relocation index that found an earlier copy. */
  readonly memoHits: number;
  readonly versions: number;
}

describe('compaction copy cost with growing checkpoint counts (design 4.8 several versions, 4.11)', () => {
  const directory = useTempDir('journal-state-scaling-');

  /**
   * Every checkpoint is a key of the state map of every later version, so a
   * copy that reads or rebuilds the whole map for each version does work
   * proportional to the square of the count. The work is counted in records,
   * not in seconds.
   */
  async function copyWork(
    checkpoints: number,
    rowsBetween: number,
  ): Promise<CopyWork> {
    const source = await populatedSource(
      path.join(directory(), `source-${checkpoints}-${rowsBetween}.llxj`),
    );
    for (let index = 0; index < checkpoints; index++) {
      await growAfterCheckpoint(source, `k${index}`, rowsBetween);
    }
    const current = source.published;
    if (current === undefined) throw new Error('nothing is published');
    const reads: HeadReads = new Map();
    const result = await compactionCopy(
      countingAccess(await accessOf(source), reads),
      current,
      path.join(directory(), `compacted-${checkpoints}-${rowsBetween}.llxj`),
      copyDeps(),
    );
    await source.close();
    const { copied } = result.stats;
    return {
      headReads: [...reads.values()].reduce((sum, count) => sum + count, 0),
      stateReads: (reads.get('VALUE') ?? 0) + (reads.get('ITNODE') ?? 0),
      written: Object.values(copied).reduce((sum, count) => sum + count, 0),
      stateWritten: copied.VALUE + copied.ITNODE,
      memoHits: result.stats.memoHits,
      versions: result.versions.length,
    };
  }

  it('reads and writes state records in proportion to the checkpoints, not to their square', async () => {
    // No rows between checkpoints: the rows and facts of every version are the same, so what grows is the state map.
    const few = await copyWork(FEW, 0);
    const many = await copyWork(MANY, 0);
    expect(few.versions).toBe(FEW + 1);
    expect(many.versions).toBe(MANY + 1);
    expect(many.stateReads / few.stateReads).toBeLessThanOrEqual(
      LINEAR_RATIO_LIMIT,
    );
    expect(many.stateWritten / few.stateWritten).toBeLessThanOrEqual(
      LINEAR_RATIO_LIMIT,
    );
  }, 150_000);

  it('does work per distinct record over the whole compaction copy, rows and facts included', async () => {
    const few = await copyWork(FEW, ROWS_BETWEEN_CHECKPOINTS);
    const many = await copyWork(MANY, ROWS_BETWEEN_CHECKPOINTS);
    expect(few.versions).toBe(FEW + 1);
    expect(many.versions).toBe(MANY + 1);
    expect(many.headReads / few.headReads).toBeLessThanOrEqual(
      FULL_COPY_RATIO_LIMIT,
    );
    expect(many.written / few.written).toBeLessThanOrEqual(
      FULL_COPY_RATIO_LIMIT,
    );
    expect(many.memoHits / few.memoHits).toBeLessThanOrEqual(
      FULL_COPY_RATIO_LIMIT,
    );
  }, 150_000);
});
