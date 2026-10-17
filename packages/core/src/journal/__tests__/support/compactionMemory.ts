/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep, heapSize } from 'bun:jsc';
import {
  median,
  SETTLED_WINDOW_BYTES,
  settledHeap,
} from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { DEFAULT_BATCH_BYTES } from '../../groupAppender.js';
import { ID_NODE_CACHE_BYTES } from '../../idTrieCache.js';
import type { JournalStore } from '../../journalStore.js';
import { iterateRowEntries } from '../../rowTreeReader.js';
import {
  compactionCopy,
  type CopiedVersion,
  type CopyObserver,
  type CopyResult,
} from '../../versionCopy.js';
import {
  copyDepsWithoutEventLog,
  growAfterCheckpoint,
  mapContentsAt,
  populatedSource,
} from './copyFixtures.js';
import { accessOf } from './pinnedAccess.js';

const MIB = 1024 * 1024;

/** Allowance for allocator and collector jitter in a settled heap reading. */
const JITTER_SLACK_BYTES = 512 * 1024;

/**
 * Check (i), retained memory: the settled heap after the copy stays within
 * this of the heap before it, at every checkpoint count.
 */
export const RETAINED_BOUND_BYTES = 1 * MIB;

/** Checks (i) and (ii) are flat: the growth at the smallest and largest counts differs by less than this. */
export const FLATNESS_BOUND_BYTES = JITTER_SLACK_BYTES;

/** The id, meta and state caches of the store and the source cache of the copy. */
const NODE_CACHES_IN_A_COPY = 4;

/**
 * Check (ii), in-flight memory: while the copy runs, the settled heap stays
 * within the group appender's pending batch, the node caches at their caps
 * and the jitter allowance. The batch is the largest part and is capped, so
 * this does not depend on the checkpoint count.
 */
export const IN_FLIGHT_BOUND_BYTES =
  DEFAULT_BATCH_BYTES +
  NODE_CACHES_IN_A_COPY * ID_NODE_CACHE_BYTES +
  JITTER_SLACK_BYTES;

/** Rows appended after each checkpoint, so the history grows with the checkpoint count. */
export const ROWS_PER_CHECKPOINT = 2;

/** About this many heap samples are taken during one copy. */
const SAMPLES_PER_COPY = 40;

/** Settled readings whose median is the baseline and the final value. */
const MEDIAN_READINGS = 3;

/**
 * A settled growth below this means the baseline still held collectable
 * garbage, so the measurement is wrong rather than the copy being lean.
 */
const NEGATIVE_GROWTH_LIMIT_BYTES = -256 * 1024;

function nextTurn(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Consecutive collections the heap must stay level through to count as settled.
 * JavaScriptCore drops compiled code blocks only after they have gone unused
 * through several full collections, and that can take a megabyte off the heap
 * after a long run of readings that agree with each other. Two matching
 * readings in a row therefore prove nothing about the baseline.
 */
const LEVEL_ROUNDS = 8;

/** Upper bound on collections for one settled reading. */
const MAX_ROUNDS = 80;

/**
 * One reading of the heap after repeated full collections, each preceded by a
 * trip to the event loop, until the last `LEVEL_ROUNDS` readings span less than
 * the settle window. A heap that is still moving when the rounds run out fails
 * the test instead of returning an unsettled number.
 */
async function strictSettledHeap(label: string): Promise<number> {
  const readings: number[] = [];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    await nextTurn();
    gcAndSweep();
    readings.push(heapSize());
    const recent = readings.slice(-LEVEL_ROUNDS);
    if (
      recent.length === LEVEL_ROUNDS &&
      Math.max(...recent) - Math.min(...recent) < SETTLED_WINDOW_BYTES
    ) {
      return readings[readings.length - 1];
    }
  }
  throw new Error(
    `the heap did not settle within ${MAX_ROUNDS} rounds (${label}); last readings ${readings.slice(-LEVEL_ROUNDS).join(', ')} bytes`,
  );
}

/**
 * How long compiled code that nothing runs any more takes to be dropped.
 * JavaScriptCore drops it in two waves, measured at about 5 s (several MiB:
 * the fixture builders and the start-up code) and about 15 s (about 1.2 MiB)
 * after the last run, with nothing further through 100 s, whatever the number
 * of collections in between. The wait has to end after the second wave: when
 * it ended at 12 s the wave landed in one of the measured copies, took a
 * megabyte off the heap there, and was read as a copy that gives memory back
 * (a different copy on each run).
 */
const IDLE_CODE_AGE_OUT_MS = 20_000;

/** The heap must then stay level for this long, so a drop that is still coming fails the wait. */
const LEVEL_FOR_MS = 2_000;

/** Longest the age-out may take before the heap counts as still moving. */
const AGE_OUT_LIMIT_MS = 40_000;

const AGE_OUT_POLL_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Call after every source is built and before the first measured copy. Waits
 * out the age at which idle compiled code is dropped, collecting all the time,
 * then until the heap has been level for a further stretch. Fails the test if
 * the heap keeps moving past the limit.
 */
export async function ageOutIdleCode(): Promise<void> {
  const started = Date.now();
  let levelSince = started;
  let levelReading = Number.NaN;
  for (;;) {
    await sleep(AGE_OUT_POLL_MS);
    gcAndSweep();
    const reading = heapSize();
    const now = Date.now();
    if (Math.abs(reading - levelReading) >= SETTLED_WINDOW_BYTES) {
      levelReading = reading;
      levelSince = now;
    }
    if (
      now - started >= IDLE_CODE_AGE_OUT_MS &&
      now - levelSince >= LEVEL_FOR_MS
    ) {
      return;
    }
    if (now - started >= AGE_OUT_LIMIT_MS) {
      throw new Error(
        `the heap was still moving ${AGE_OUT_LIMIT_MS} ms after the sources were built (reading ${reading} bytes, level since ${now - levelSince} ms ago)`,
      );
    }
  }
}

/** Median of settled readings: one reading can sit on allocator jitter, the median of three does not. */
export async function medianSettledHeap(label: string): Promise<number> {
  const readings: number[] = [];
  for (let index = 0; index < MEDIAN_READINGS; index++) {
    readings.push(await strictSettledHeap(label));
  }
  return median(readings);
}

/** A session with `checkpoints` checkpoints, each followed by `ROWS_PER_CHECKPOINT` small rows. */
export async function sessionWithCheckpoints(
  file: string,
  checkpoints: number,
): Promise<JournalStore> {
  const store = await populatedSource(file);
  for (let index = 0; index < checkpoints; index++) {
    await growAfterCheckpoint(store, `k${index}`, ROWS_PER_CHECKPOINT);
  }
  return store;
}

/** What a copier that builds every version in memory holds for one version. */
interface VersionBuilder {
  readonly state: Map<string, string>;
  readonly labels: number[];
  readonly owners: number[];
}

/**
 * The trap: the real copier, watched by an observer that does what a copier
 * with one builder per version would do. After each version is written it
 * reads that version's state map and every row of its row tree from the
 * source and keeps them. The copy's own work is unchanged, so any heap this
 * adds is the cost of holding per-version state.
 */
export class PerVersionBuilders {
  private readonly builders: VersionBuilder[] = [];

  constructor(private readonly source: JournalStore) {}

  get held(): number {
    return this.builders.length;
  }

  async collect(copied: CopiedVersion): Promise<void> {
    const read = await this.source.openRead();
    try {
      const version = await this.source.readVersion(copied.sourceOffset);
      const labels: number[] = [];
      const owners: number[] = [];
      for await (const entry of iterateRowEntries(read.access, {
        offset: version.roots.rowRoot,
        rows: version.rows,
      })) {
        labels.push(Number(entry.label));
        owners.push(entry.owner);
      }
      this.builders.push({
        state: await mapContentsAt(read.access, version.roots.stateRoot),
        labels,
        owners,
      });
    } finally {
      read.close();
    }
  }
}

/** One copy with nothing measured, so the one-time costs of a first copy are paid before the measured ones. */
export async function warmCompaction(
  source: JournalStore,
  target: string,
): Promise<CopyResult> {
  const current = source.published;
  if (current === undefined) throw new Error('nothing is published');
  return compactionCopy(
    await accessOf(source),
    current,
    target,
    copyDepsWithoutEventLog(),
  );
}

export interface CompactionMeasurement {
  readonly checkpoints: number;
  readonly versions: number;
  readonly rows: number;
  /** Largest single settled reading above the settled heap before the copy, in bytes. */
  readonly peakGrowth: number;
  /**
   * Median of the settled readings in the second half of the copy, with the
   * reading after the last version, in bytes. A retention that grows with the
   * versions is in every one of these readings; one reading of allocator
   * jitter is not.
   */
  readonly settledGrowth: number;
  /** Check (i): median of three settled readings after the copy, above the baseline, in bytes. */
  readonly finalGrowth: number;
  readonly samples: number;
  readonly series: readonly number[];
  /** Versions the trap held when the copy ended; 0 without a trap. */
  readonly held: number;
  readonly result: CopyResult;
}

/**
 * Compacts `source` into `target` and reports the heap growth of the copy.
 * The heap is sampled after a full collection each time the copy has written a
 * few more versions, so a sample counts only what is still reachable then.
 */
export async function measureCompaction(
  source: JournalStore,
  target: string,
  trap?: PerVersionBuilders,
): Promise<CompactionMeasurement> {
  const current = source.published;
  if (current === undefined) throw new Error('nothing is published');
  const every = Math.max(1, Math.floor(current.rows / SAMPLES_PER_COPY));
  // The source is already built, so its fixture garbage is collected here.
  const before = await medianSettledHeap('before the copy');
  let peak = 0;
  let samples = 0;
  const series: number[] = [];
  let written = 0;
  const observer: CopyObserver = async (copied) => {
    if (trap !== undefined) await trap.collect(copied);
    written += 1;
    if (written % every === 0) {
      const growth = (await settledHeap()) - before;
      series.push(growth);
      peak = Math.max(peak, growth);
      samples += 1;
    }
  };
  const result = await compactionCopy(
    await accessOf(source),
    current,
    target,
    copyDepsWithoutEventLog(),
    observer,
  );
  const finalGrowth = (await medianSettledHeap('after the copy')) - before;
  const readings = [...series, finalGrowth];
  const settledGrowth = median(readings.slice(Math.floor(readings.length / 2)));
  if (
    finalGrowth < NEGATIVE_GROWTH_LIMIT_BYTES ||
    settledGrowth < NEGATIVE_GROWTH_LIMIT_BYTES
  ) {
    throw new Error(
      `negative settled growth (final ${finalGrowth}, settled ${settledGrowth} bytes, limit ${NEGATIVE_GROWTH_LIMIT_BYTES}): the baseline still held collectable garbage`,
    );
  }
  return {
    checkpoints: result.versions.length - 1,
    versions: result.versions.length,
    rows: current.rows,
    peakGrowth: Math.max(peak, finalGrowth),
    finalGrowth,
    settledGrowth,
    samples,
    series,
    held: trap?.held ?? 0,
    result,
  };
}
