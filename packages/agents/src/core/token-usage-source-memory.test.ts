/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { estimateTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import type { TokenCountFn } from './tokenUsageRequestShape.js';
import { nativeRequestFixture } from './__tests__/support/native-request-fixture.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { RequestShapeTracker } from './tokenUsageRequestShape.js';
import {
  fallbackCount,
  retainedShapeEntries,
  sourceTextUnit,
  shapePending,
} from './__tests__/support/token-usage-source-fixture.js';

// Start collection outside the observed pull's promise continuation, whose
// native execution stack can otherwise keep its last iterator result alive.
function settled(): Promise<number> {
  return new Promise((resolve) => {
    setTimeout(() => {
      Bun.gc(true);
      resolve(settledHeap());
    }, 0);
  });
}
// JSC can keep a just-finished async generator, and the last yielded row,
// alive across a few collections (stack and continuation roots drain lazily).
// Keep collecting while any observed reader or row is still reachable, bounded
// so a genuinely retained reader or row (the traps hold them strongly) still
// reports live and fails the gate.
async function settledReleasingReaders(facts: Census): Promise<number> {
  let bytes = await settled();
  for (
    let round = 0;
    round < 32 && live(facts.readers) + live(facts.rows) > 0;
    round++
  ) {
    bytes = await settled();
  }
  return bytes;
}
// The previously yielded row can outlive the first few collections the same
// way (the finished pull's continuation drains lazily). A sample point may
// legitimately see only the current row, so keep collecting while more than
// one row is reachable, bounded so rows that are genuinely retained (the rows
// trap holds every one) still report live and fail the gate.
async function settledReleasingRows(facts: Census): Promise<number> {
  let bytes = await settled();
  for (let round = 0; round < 32 && live(facts.rows) > 1; round++) {
    bytes = await settled();
  }
  return bytes;
}
function live<T extends object>(references: Array<WeakRef<T>>): number {
  return references.filter((reference) => reference.deref() !== undefined)
    .length;
}
function blockText(block: IContent['blocks'][number]): string {
  return block.type === 'text' ? block.text : '';
}
function memoryRow(index: number, large: boolean): IContent {
  const chars = large && index === 63 ? 10 * 1024 * 1024 + 17 : 160 * 1024;
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [
      {
        type: 'text',
        text:
          `${index}:` +
          sourceTextUnit.repeat(Math.ceil(chars / sourceTextUnit.length)),
      },
    ],
    metadata: { id: `memory-${index}` },
  };
}
type ShapeTrap = 'none' | 'rows' | 'serialized' | 'reader';
interface Census {
  trap: ShapeTrap;
  originals: Array<WeakRef<IContent>>;
  rows: Array<WeakRef<IContent>>;
  readers: Array<WeakRef<object>>;
  retainedRows: IContent[];
  retainedSerialized: string[];
  retainedReaders: Array<AsyncGenerator<IContent, void, unknown>>;
  samples: Array<{ bytes: number; activeTextBytes: number; liveRows: number }>;
}
function census(trap: ShapeTrap): Census {
  return {
    trap,
    originals: [],
    rows: [],
    readers: [],
    retainedRows: [],
    retainedSerialized: [],
    retainedReaders: [],
    samples: [],
  };
}
class ObservedReader implements AsyncGenerator<IContent, void, unknown> {
  private index = 0;
  private pending: IteratorResult<IContent, void> | undefined;
  constructor(
    private reader: AsyncGenerator<IContent, void, unknown> | undefined,
    private readonly facts: Census,
  ) {}
  [Symbol.asyncIterator](): AsyncGenerator<IContent, void, unknown> {
    return this;
  }
  async [Symbol.asyncDispose](): Promise<void> {
    await this.return();
  }
  next(): Promise<IteratorResult<IContent, void>> {
    if (this.reader === undefined)
      return Promise.resolve({ done: true, value: undefined });
    return this.reader.next().then((next) => this.take(next));
  }
  private take(
    next: IteratorResult<IContent, void>,
  ): IteratorResult<IContent, void> | Promise<IteratorResult<IContent, void>> {
    if (next.done === true) {
      this.reader = undefined;
      return next;
    }
    this.facts.rows.push(new WeakRef(next.value));
    if (this.facts.trap === 'rows') this.facts.retainedRows.push(next.value);
    this.pending = next;
    return this.samplePull(++this.index);
  }
  private samplePull(
    index: number,
  ): IteratorResult<IContent, void> | Promise<IteratorResult<IContent, void>> {
    if (index % 16 !== 0) return this.finishPull();
    const next = this.pending;
    if (next === undefined || next.done === true)
      throw new Error('Missing sample row');
    const activeTextBytes = next.value.blocks.reduce(
      (sum, block) => sum + (block.type === 'text' ? 2 * block.text.length : 0),
      0,
    );
    return this.sample(activeTextBytes);
  }
  private sample(
    activeTextBytes: number,
  ): Promise<IteratorResult<IContent, void>> {
    return settledReleasingRows(this.facts).then((bytes) => {
      this.facts.samples.push({
        bytes,
        activeTextBytes,
        liveRows: live(this.facts.rows),
      });
      return this.finishPull();
    });
  }
  private finishPull(): IteratorResult<IContent, void> {
    const next = this.pending;
    this.pending = undefined;
    if (next === undefined) throw new Error('Missing observed pull');
    return next;
  }
  return(): Promise<IteratorResult<IContent, void>> {
    const reader = this.reader;
    this.reader = undefined;
    return reader === undefined
      ? Promise.resolve({ done: true, value: undefined })
      : reader.return();
  }
  throw(error?: unknown): Promise<IteratorResult<IContent, void>> {
    const reader = this.reader;
    this.reader = undefined;
    return reader === undefined ? Promise.reject(error) : reader.throw(error);
  }
}
function observed(
  snapshot: ProviderRequestRows,
  facts: Census,
): ProviderRequestRows {
  return {
    count: snapshot.count,
    readAt: (index, signal) => snapshot.readAt(index, signal),
    openReader(signal): AsyncGenerator<IContent, void, unknown> {
      const reader = snapshot.openReader(signal);
      const observer = new ObservedReader(reader, facts);
      facts.readers.push(new WeakRef(reader), new WeakRef(observer));
      return observer;
    },
  };
}
async function makeSnapshot(
  large: boolean,
  facts: Census,
  ownership: RowOwnership,
) {
  return nativeRequestFixture(
    {
      async *[Symbol.asyncIterator](): AsyncGenerator<IContent, void, unknown> {
        for (let index = 0; index < 64; index++) {
          const row = memoryRow(index, large);
          facts.originals.push(new WeakRef(row));
          yield row;
        }
      },
    },
    [shapePending(0)],
    { ownership },
  );
}
async function trapReader(
  snapshot: ProviderRequestRows,
  facts: Census,
): Promise<void> {
  if (facts.trap !== 'reader') return;
  const reader = snapshot.openReader();
  facts.readers.push(new WeakRef(reader));
  facts.retainedReaders.push(reader);
  for (let index = 0; index < 64; index++) await reader.next();
}
function receipt(
  large: boolean,
  baseline: number,
  after: number,
  memory: RequestShapeTracker,
  facts: Census,
  control: WeakRef<object>,
) {
  return {
    large,
    baseline,
    settled: after,
    delta: after - baseline,
    liveOriginals: live(facts.originals),
    liveReadRows: live(facts.rows),
    retainedRowIds: facts.rows.flatMap((reference) => {
      const row = reference.deref();
      return row === undefined ? [] : [row.metadata?.id];
    }),
    liveReaders: live(facts.readers),
    controlLive: control.deref() !== undefined,
    retainedReaders: facts.retainedReaders.length,
    retainedRows: facts.retainedRows.length,
    retainedSerialized: facts.retainedSerialized.length,
    measurementCount: retainedShapeEntries(memory),
    samples: facts.samples.map((sample) => ({
      ...sample,
      overhead: sample.bytes - baseline - sample.activeTextBytes,
    })),
  };
}
// The measured sends run the source path (snapshot spool, reader, chunked
// estimation); warm that same path so its one-time initialisation is not
// counted as per-send growth.
async function warmSourcePath(
  large: boolean,
  estimate: TokenCountFn,
): Promise<void> {
  const facts = census('none');
  const ownership = new RowOwnership();
  const snapshot = await makeSnapshot(large, facts, ownership);
  const source = observed(snapshot, facts);
  try {
    const memory = new RequestShapeTracker();
    for (let send = 0; send < 2; send++)
      await memory.recordSourceRequestShape({
        requestRows: source,
        tools: [],
        instructionsText: 'memory instructions',
        countTokens: estimate,
      });
  } finally {
    await snapshot.close();
  }
}
async function measure(
  large: boolean,
  tokenizer: string,
  estimate: TokenCountFn,
  trap: ShapeTrap = 'none',
) {
  const facts = census(trap);
  const control = new WeakRef(Object.freeze({ control: true }));
  const memory = new RequestShapeTracker();
  await warmSourcePath(large, estimate);
  const baseline = await settled();
  const ownership = new RowOwnership();
  const snapshot = await makeSnapshot(large, facts, ownership);
  const source = observed(snapshot, facts);
  const countTokens = (text: string): number => {
    if (facts.trap === 'serialized') facts.retainedSerialized.push(text);
    return estimate(text);
  };
  try {
    for (let send = 0; send < 2; send++) {
      const shape = await memory.recordSourceRequestShape({
        requestRows: source,
        tools: [],
        instructionsText: 'memory instructions',
        countTokens,
      });
      expect(shape.historyTokens).toBeGreaterThan(0);
      expect(shape.prefixFingerprintChanged).toBe(send === 0 ? null : false);
    }
    await trapReader(snapshot, facts);
    const result = {
      ...receipt(
        large,
        baseline,
        await settledReleasingReaders(facts),
        memory,
        facts,
        control,
      ),
      ownership: ownership.snapshot(),
      tokenizer,
    };
    expect(result.controlLive).toBe(false);
    expect(result.liveOriginals).toBe(0);
    expect(result.liveReadRows).toBe(0);
    expect(result.measurementCount).toBe(0);
    expect(result.delta).toBeLessThan(1_048_576);
    expect(result.liveReaders).toBe(0);
    expect(result.retainedSerialized).toBe(0);
    for (const sample of result.samples) {
      expect(sample.liveRows).toBeLessThanOrEqual(1);
      expect(sample.overhead).toBeLessThan(1_048_576);
    }
    return result;
  } finally {
    for (const reader of facts.retainedReaders) await reader.return();
    await snapshot.close();
  }
}
describe('bounded disk shape release', () => {
  it.each([
    { large: false, tokenizer: 'fallback', estimate: fallbackCount },
    { large: true, tokenizer: 'fallback', estimate: fallbackCount },
    { large: false, tokenizer: 'tiktoken', estimate: estimateTokens },
    { large: true, tokenizer: 'tiktoken', estimate: estimateTokens },
  ])(
    'releases readers and row serialization below strict 1 MiB, $tokenizer / large=$large',
    async ({ large, tokenizer, estimate }) => {
      const warm = new RequestShapeTracker();
      warm.recordRequestShape({
        requestContents: [memoryRow(0, false)],
        tools: [],
        instructionsText: undefined,
        countTokens: estimate,
      });
      // The tiktoken wasm heap grows once to its high-water mark for the first
      // >10 MiB string and never shrinks; warm it so the gate measures
      // retention rather than that one-time allocation.
      if (large) estimate(memoryRow(63, true).blocks.map(blockText).join(''));
      expect((await measure(large, tokenizer, estimate)).measurementCount).toBe(
        0,
      );
    },
    120000,
  );
});
describe('bounded disk shape release traps', () => {
  const estimate = fallbackCount;
  it.each(['rows', 'serialized', 'reader'] as const)(
    'trap: deliberately retained %s fail the release gates',
    async (trap) => {
      await expect(measure(false, 'fallback', estimate, trap)).rejects.toThrow(
        'expect(received)',
      );
    },
    120000,
  );
});

async function drainObserved(reader: ObservedReader): Promise<void> {
  for await (const row of reader) void row;
}

describe('row observation lifetime', () => {
  it.each([64, 128])(
    'releases %i observed rows while a completed observer stays reachable',
    async (count) => {
      const facts = census('none');
      const observer = new ObservedReader(
        (async function* (): AsyncGenerator<IContent, void, unknown> {
          for (let index = 0; index < count; index++)
            yield memoryRow(index, false);
        })(),
        facts,
      );
      await drainObserved(observer);
      await settledReleasingReaders(facts);
      expect(live(facts.rows)).toBe(0);
      expect(await observer.next()).toStrictEqual({
        done: true,
        value: undefined,
      });
    },
    120000,
  );
  it.each([64, 128])(
    'still sees all %i rows strongly owned by a retaining observer',
    async (count) => {
      const facts = census('rows');
      const observer = new ObservedReader(
        (async function* (): AsyncGenerator<IContent, void, unknown> {
          for (let index = 0; index < count; index++)
            yield memoryRow(index, false);
        })(),
        facts,
      );
      await drainObserved(observer);
      await settledReleasingReaders(facts);
      expect(live(facts.rows)).toBe(count);
      expect(facts.retainedRows).toHaveLength(count);
      expect(await observer.next()).toStrictEqual({
        done: true,
        value: undefined,
      });
    },
    120000,
  );
});
