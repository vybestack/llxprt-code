/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @plan PLAN-20260917-ISSUE854.P05
 * @requirement G2, G4
 *
 * Behavioral tests for JournalResolver, the interval-list fold over the
 * session journal (implementation-plan.md §6 P05a): an events-only prepass
 * maintains survivor seq intervals + interval-first offsets, rewind removes
 * the suffix from the cut, `compressed` and `semantic_media_purge` replace
 * the whole history, and only survivor rows are decoded on the second pass.
 *
 * The eager ReplayEngine (`replaySession`) is the behavioral oracle: on every
 * generated journal the resolver's resolved row sequence must equal the
 * engine's replayed history for the same file. This is the RED session — the
 * tests pin the contract that the P05a green session implements.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { JournalResolver } from './journalResolver.js';
import { replaySession } from './ReplayEngine.js';
import type {
  JournalResolverOptions,
  ResolvedEntry,
  ResolverFileHandle,
  ResolverIo,
  ResolverStats,
} from './journalResolver.js';
import type { SessionEventType } from './types.js';
import type {
  ChronologyMarker,
  IContent,
} from '../services/history/IContent.js';

const TS = '2026-01-01T00:00:00.000Z';
const PROJECT_HASH = 'p05a-resolver-hash';
const CHUNK = 64 * 1024;

interface AppendedRef {
  /** Envelope seq of the appended event (dense, never reused). */
  readonly seq: number;
  /** Byte offset of the appended line. */
  readonly offset: number;
  /** Byte length of the appended line including its terminator. */
  readonly length: number;
  /** Chronology marker seq carried by content rows (0 for non-content). */
  readonly chron: number;
}

function chronMarker(seq: number): ChronologyMarker {
  return { seq, userTurn: 1, step: seq, recordedAt: 0 };
}

function marked(
  speaker: IContent['speaker'],
  text: string,
  seq: number,
): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
    metadata: { chronology: chronMarker(seq) },
  };
}

function withChron(content: IContent, seq: number): IContent {
  return {
    ...content,
    metadata: { ...content.metadata, chronology: chronMarker(seq) },
  };
}

function summaryFor(text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { chronologyReplaced: { fromSeq: 1, toSeq: 2, itemCount: 2 } },
  };
}

function callContent(callId: string): IContent {
  return {
    speaker: 'ai',
    blocks: [
      { type: 'tool_call', id: callId, name: 'runner', parameters: { q: 1 } },
    ],
  };
}

function responseContent(callId: string, result: string): IContent {
  return {
    speaker: 'tool',
    blocks: [{ type: 'tool_response', callId, toolName: 'runner', result }],
  };
}

function textOf(content: IContent): string {
  return content.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

/** Declared boolean return keeps array predicates any-free while red. */
function hasToolCallBlock(content: IContent): boolean {
  return content.blocks.some((block) => block.type === 'tool_call');
}

function envelopeJson(
  seq: number,
  type: SessionEventType,
  payload: unknown,
): string {
  return JSON.stringify({ v: 1, seq, ts: TS, type, payload });
}

/**
 * Appends adversarial journals envelope by envelope. Envelope seqs are dense
 * and never reused; content rows carry dense chronology markers exactly the
 * way the live recording path stamps them, so `cutSeq` rewinds reference the
 * chronology space while intervals fold over the envelope seq space.
 */
class JournalBuilder {
  private seq = 0;
  private offset = 0;
  private chron = 0;

  constructor(private readonly filePath: string) {}

  async start(): Promise<void> {
    await this.append('session_start', {
      sessionId: 'p05a-resolver-test-000001',
      projectHash: PROJECT_HASH,
      workspaceDirs: ['/home/user/project'],
      provider: 'anthropic',
      model: 'claude-4',
      startTime: TS,
    });
  }

  async content(
    speaker: IContent['speaker'],
    text: string,
  ): Promise<AppendedRef> {
    this.chron += 1;
    return this.append('content', {
      content: marked(speaker, text, this.chron),
    });
  }

  async rawContent(content: IContent): Promise<AppendedRef> {
    this.chron += 1;
    return this.append('content', { content: withChron(content, this.chron) });
  }

  async rewind(itemsRemoved: number, cutSeq?: number): Promise<AppendedRef> {
    return this.append(
      'rewind',
      cutSeq === undefined ? { itemsRemoved } : { itemsRemoved, cutSeq },
    );
  }

  async compressed(
    summary: IContent,
    itemsCompressed: number,
  ): Promise<AppendedRef> {
    return this.append('compressed', { summary, itemsCompressed });
  }

  async purge(
    history: readonly IContent[],
    frontier: { readonly contentIndex: number; readonly blockIndex: number },
  ): Promise<AppendedRef> {
    return this.append('semantic_media_purge', { history, frontier });
  }

  async sessionEvent(message: string): Promise<void> {
    await this.append('session_event', { severity: 'info', message });
  }

  /** A complete, newline-terminated line that fails to parse mid-file. */
  async corruptMidFileLine(): Promise<void> {
    await this.writeRawLine(
      `{"v":1,"seq":${this.seq + 1},"ts":"${TS}","type":"content","paylo`,
    );
  }

  /** An unterminated partial line a crash mid-append would leave behind. */
  async tornTail(text: string): Promise<void> {
    const line = envelopeJson(this.seq + 1, 'content', {
      content: marked('human', text, this.chron + 1),
    });
    await fs.appendFile(
      this.filePath,
      line.slice(0, Math.floor(line.length / 2)),
      'utf8',
    );
  }

  async rawLine(line: string): Promise<void> {
    await this.writeRawLine(line);
  }

  private async writeRawLine(line: string): Promise<void> {
    await fs.appendFile(this.filePath, `${line}\n`, 'utf8');
    this.offset += Buffer.byteLength(line, 'utf8') + 1;
  }

  private async append(
    type: SessionEventType,
    payload: unknown,
  ): Promise<AppendedRef> {
    this.seq += 1;
    const line = envelopeJson(this.seq, type, payload);
    const at = this.offset;
    await this.writeRawLine(line);
    return {
      seq: this.seq,
      offset: at,
      length: Buffer.byteLength(line, 'utf8') + 1,
      chron: this.chron,
    };
  }
}

/** append A,B,C → rewind(cut after A) → append D,E → rewind(count 1) → append F. */
interface ChainRefs {
  readonly a: AppendedRef;
  readonly b: AppendedRef;
  readonly c: AppendedRef;
  readonly d: AppendedRef;
  readonly e: AppendedRef;
  readonly f: AppendedRef;
}

async function buildAdversarialChain(
  builder: JournalBuilder,
): Promise<ChainRefs> {
  await builder.start();
  const a = await builder.content('human', 'A');
  const b = await builder.content('ai', 'B');
  const c = await builder.content('ai', 'C');
  await builder.rewind(2, b.chron); // cut after A: first removed item is B
  const d = await builder.content('human', 'D');
  const e = await builder.content('ai', 'E');
  await builder.rewind(1); // count-only: removes E, keeps A and D
  const f = await builder.content('ai', 'F');
  return { a, b, c, d, e, f };
}

/** The eager ReplayEngine on the same file is the behavioral oracle. */
async function engineHistoryFor(journalPath: string): Promise<IContent[]> {
  const result = await replaySession(journalPath, PROJECT_HASH);
  if (!result.ok) {
    throw new Error(`engine replay failed: ${result.error}`);
  }
  return result.history;
}

async function expectRowsMatchEngine(
  rows: readonly ResolvedEntry[],
  journalPath: string,
): Promise<void> {
  expect(rows.map((row) => row.content)).toStrictEqual(
    await engineHistoryFor(journalPath),
  );
}

async function collectRows(
  resolver: JournalResolver,
): Promise<ResolvedEntry[]> {
  const rows: ResolvedEntry[] = [];
  for await (const row of resolver.resolve()) {
    rows.push(row);
  }
  return rows;
}

function intervalSeqSet(stats: ResolverStats): Set<number> {
  const seqs = new Set<number>();
  for (const interval of stats.intervals) {
    for (let seq = interval.fromSeq; seq <= interval.toSeq; seq += 1) {
      seqs.add(seq);
    }
  }
  return seqs;
}

/**
 * Counting fs wrapper for the I/O contract test: every open and read the
 * resolver performs through the injected surface is tallied, so the two-pass
 * in-context region bound (each region read at most twice, chunked) is
 * observable without touching internals.
 */
function countingIo(): {
  io: ResolverIo;
  counters: { open: number; read: number; stat: number };
} {
  const counters = { open: 0, read: 0, stat: 0 };
  const io: ResolverIo = {
    open: async (path, flags) => {
      counters.open += 1;
      const handle = await fs.open(path, flags);
      let closed = false;
      const tracked: ResolverFileHandle = {
        stat: async () => {
          counters.stat += 1;
          return { size: (await handle.stat()).size };
        },
        read: async (buffer, offset, length, position) => {
          counters.read += 1;
          return handle.read(buffer, offset, length, position);
        },
        close: async () => {
          if (closed) return;
          closed = true;
          await handle.close();
        },
      };
      return tracked;
    },
  };
  return { io, counters };
}

describe('JournalResolver @plan:PLAN-20260917-ISSUE854.P05 @requirement:G2,G4', () => {
  let tempDir = '';
  let filePath = '';
  let opened: JournalResolver[] = [];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'journal-resolver-test-'),
    );
    filePath = path.join(tempDir, 'session-under-test.jsonl');
    opened = [];
  });

  afterEach(async () => {
    for (const resolver of opened.splice(0).reverse()) {
      await resolver.close().catch(() => undefined);
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function openResolver(
    options: JournalResolverOptions = {},
  ): Promise<JournalResolver> {
    const resolver = await JournalResolver.open(filePath, options);
    opened.push(resolver);
    return resolver;
  }

  it('resolves an adversarial rewind/reappend chain to the engine history', async () => {
    const refs = await buildAdversarialChain(new JournalBuilder(filePath));
    const rows = await collectRows(await openResolver());

    expect(rows.map((row) => textOf(row.content))).toStrictEqual([
      'A',
      'D',
      'F',
    ]);
    expect(rows.map((row) => row.seq)).toStrictEqual([
      refs.a.seq,
      refs.d.seq,
      refs.f.seq,
    ]);
    await expectRowsMatchEngine(rows, filePath);
  });

  it('books the adversarial chain as three singleton survivor intervals', async () => {
    const refs = await buildAdversarialChain(new JournalBuilder(filePath));
    const resolver = await openResolver();
    const rows = await collectRows(resolver);
    const stats = resolver.stats();

    expect(stats.intervals).toStrictEqual([
      {
        fromSeq: refs.a.seq,
        toSeq: refs.a.seq,
        firstOffset: refs.a.offset,
        rowCount: 1,
      },
      {
        fromSeq: refs.d.seq,
        toSeq: refs.d.seq,
        firstOffset: refs.d.offset,
        rowCount: 1,
      },
      {
        fromSeq: refs.f.seq,
        toSeq: refs.f.seq,
        firstOffset: refs.f.offset,
        rowCount: 1,
      },
    ]);
    expect(stats.resolvedRowCount).toBe(3);
    const removedSeqs = [refs.b.seq, refs.c.seq, refs.e.seq];
    expect(rows.some((row) => removedSeqs.includes(row.seq))).toBe(false);
  });

  it('resolves rewind-after-compression to the engine history', async () => {
    const builder = new JournalBuilder(filePath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.content('ai', 'B');
    const comp = await builder.compressed(summaryFor('summary of A and B'), 2);
    await builder.content('human', 'H1'); // preserved head row
    const h2 = await builder.content('ai', 'H2');
    await builder.rewind(1, h2.chron); // cut H2, summary and head survive

    const resolver = await openResolver();
    const rows = await collectRows(resolver);

    expect(rows.map((row) => textOf(row.content))).toStrictEqual([
      'summary of A and B',
      'H1',
    ]);
    expect(rows[0].seq).toBe(comp.seq);
    await expectRowsMatchEngine(rows, filePath);
  });

  it('treats compressed as whole-history replacement with a surviving head', async () => {
    const builder = new JournalBuilder(filePath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.content('ai', 'B');
    await builder.content('ai', 'C');
    const comp = await builder.compressed(summaryFor('rolled up'), 3);
    const h1 = await builder.content('human', 'H1');
    const h2 = await builder.content('ai', 'H2');

    const resolver = await openResolver();
    const rows = await collectRows(resolver);
    const stats = resolver.stats();

    expect(rows.map((row) => textOf(row.content))).toStrictEqual([
      'rolled up',
      'H1',
      'H2',
    ]);
    expect(intervalSeqSet(stats)).toStrictEqual(
      new Set([comp.seq, h1.seq, h2.seq]),
    );
    expect(stats.resolvedRowCount).toBe(3);
    await expectRowsMatchEngine(rows, filePath);
  });

  it('applies count-only rewinds over the dense journal seq space', async () => {
    const builder = new JournalBuilder(filePath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.content('ai', 'B');
    await builder.content('ai', 'C');
    await builder.content('human', 'D');
    await builder.rewind(2); // no cutSeq anywhere in the journal
    await builder.content('ai', 'E');

    const rows = await collectRows(await openResolver());

    expect(rows.map((row) => textOf(row.content))).toStrictEqual([
      'A',
      'B',
      'E',
    ]);
    await expectRowsMatchEngine(rows, filePath);
  });

  it('empties the resolved history when a rewind count exceeds the survivors', async () => {
    const builder = new JournalBuilder(filePath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.content('ai', 'B');
    await builder.rewind(5);

    const resolver = await openResolver();
    const rows = await collectRows(resolver);
    const stats = resolver.stats();

    expect(rows).toStrictEqual([]);
    expect(stats.intervals).toStrictEqual([]);
    expect(stats.resolvedRowCount).toBe(0);
    await expectRowsMatchEngine(rows, filePath);
  });

  it('expands semantic_media_purge into the engine-equivalent row sequence', async () => {
    const builder = new JournalBuilder(filePath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.content('ai', 'B');
    await builder.content('ai', 'C');
    const replacement = [
      marked('human', 'A-clean', 1),
      marked('ai', 'C-clean', 3),
    ];
    const purge = await builder.purge(replacement, {
      contentIndex: 1,
      blockIndex: 0,
    });

    const resolver = await openResolver();
    const rows = await collectRows(resolver);

    expect(rows.map((row) => textOf(row.content))).toStrictEqual([
      'A-clean',
      'C-clean',
    ]);
    expect(rows.map((row) => row.seq)).toStrictEqual([purge.seq, purge.seq]);
    expect(rows.map((row) => row.rowIndex)).toStrictEqual([0, 1]);
    expect(rows.every((row) => row.offset === purge.offset)).toBe(true);
    await expectRowsMatchEngine(rows, filePath);
  });

  it('keeps duplicate callId group pairs as distinct resolved rows', async () => {
    const builder = new JournalBuilder(filePath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.rawContent(callContent('call-1'));
    await builder.rawContent(responseContent('call-1', 'one'));
    await builder.content('human', 'B');
    await builder.rawContent(callContent('call-1')); // duplicate callId
    await builder.sessionEvent('between pair halves');
    await builder.rawContent(responseContent('call-1', 'two'));
    await builder.content('human', 'C');

    const resolver = await openResolver();
    const rows = await collectRows(resolver);

    expect(rows).toHaveLength(7);
    const callRows = rows.filter((row) => hasToolCallBlock(row.content));
    expect(callRows).toHaveLength(2);
    expect(callRows[0].seq).not.toBe(callRows[1].seq);
    await expectRowsMatchEngine(rows, filePath);
  });

  it('skips a malformed mid-file record exactly like the engine', async () => {
    const builder = new JournalBuilder(filePath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.corruptMidFileLine();
    await builder.content('human', 'B');

    const resolver = await openResolver();
    const rows = await collectRows(resolver);

    expect(rows.map((row) => textOf(row.content))).toStrictEqual(['A', 'B']);
    expect(resolver.stats().skippedRecordCount).toBe(1);
    await expectRowsMatchEngine(rows, filePath);
  });

  it('ignores a crash-torn tail like the engine does', async () => {
    const builder = new JournalBuilder(filePath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.content('ai', 'B');
    await builder.tornTail('C');

    const resolver = await openResolver();
    const rows = await collectRows(resolver);

    expect(rows.map((row) => textOf(row.content))).toStrictEqual(['A', 'B']);
    expect(resolver.stats().skippedRecordCount).toBe(0);
    await expectRowsMatchEngine(rows, filePath);
  });

  it('rejects an unsupported recording version like the engine', async () => {
    const builder = new JournalBuilder(filePath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.rawLine(
      JSON.stringify({
        v: 99,
        seq: 3,
        ts: TS,
        type: 'content',
        payload: { content: marked('ai', 'X', 2) },
      }),
    );

    const engine = await replaySession(filePath, PROJECT_HASH);
    expect(engine.ok).toBe(false);
    if (engine.ok) {
      throw new Error('engine unexpectedly replayed a v99 journal');
    }
    expect(engine.error).toMatch(/Unsupported recording version 99/);

    const resolver = await openResolver();
    await expect(collectRows(resolver)).rejects.toThrow(
      /Unsupported recording version 99/,
    );
  });

  it('retains no decoded payloads after full iteration while the resolver lives on', async () => {
    const builder = new JournalBuilder(filePath);
    await builder.start();
    for (let i = 0; i < 12; i += 1) {
      await builder.content('human', `pre-${i} ${'x'.repeat(1200)}`);
    }
    await builder.compressed(summaryFor('mid-session summary'), 12);
    for (let i = 0; i < 12; i += 1) {
      await builder.content('ai', `post-${i} ${'y'.repeat(1200)}`);
    }

    const resolver = await openResolver();
    const probeRefs = await (async () => {
      const refs: Array<WeakRef<object>> = [];
      let index = 0;
      for await (const row of resolver.resolve()) {
        index += 1;
        if (index % 2 === 0) {
          refs.push(new WeakRef<object>(row.content));
        }
      }
      return refs;
    })();

    expect(probeRefs.length).toBeGreaterThanOrEqual(6);

    // JSC's conservative stack scan can strand a decoded pointer in a stale
    // stack slot, which pins the payload for one full GC cycle (the collection
    // that also relocates the object), and under the larger heap a combined
    // test run builds the release can need several suspend+gc cycles to become
    // observable. Poll instead of asserting on a fixed cycle count: a resolver
    // that actually retained a payload in any live structure would never see
    // deref() turn undefined, however long we poll.
    for (let cycle = 0; cycle < 10; cycle += 1) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      Bun.gc(true);
      if (probeRefs.every((ref) => ref.deref() === undefined)) {
        break;
      }
    }
    for (const ref of probeRefs) {
      expect(ref.deref()).toBeUndefined();
    }

    // The resolver object is still alive here and still serves bookkeeping,
    // so only interval+offset state can have survived the iteration.
    expect(resolver.stats().resolvedRowCount).toBe(13);
    await resolver.close();
  });

  it('bounds file reads to two chunked passes through the counting wrapper', async () => {
    const builder = new JournalBuilder(filePath);
    await builder.start();
    for (let i = 0; i < 24; i += 1) {
      await builder.content('human', `row-${i} ${'z'.repeat(400)}`);
    }

    const { io, counters } = countingIo();
    const resolver = await openResolver({ chunkBytes: CHUNK, io });
    const rows = await collectRows(resolver);

    expect(rows).toHaveLength(24);
    expect(counters.open).toBe(1);
    const { size } = await fs.stat(filePath);
    const regions = Math.ceil(size / CHUNK);
    // Two passes (events-only prepass + survivor decode), each reading every
    // region at most once in chunks; the +2 slack covers torn-tail scans.
    expect(counters.read).toBeLessThanOrEqual(2 * regions + 2);
  });

  it('keeps survivor interval bookkeeping consistent with the resolved rows', async () => {
    const refs = await buildAdversarialChain(new JournalBuilder(filePath));
    const resolver = await openResolver();
    const rows = await collectRows(resolver);
    const stats = resolver.stats();

    const intervals = stats.intervals;
    for (let i = 1; i < intervals.length; i += 1) {
      expect(intervals[i].fromSeq).toBeGreaterThan(intervals[i - 1].toSeq);
      expect(intervals[i].firstOffset).toBeGreaterThan(
        intervals[i - 1].firstOffset,
      );
    }
    const offsetsBySeq = new Map<number, number>(
      rows.map((row) => [row.seq, row.offset] as const),
    );
    let counted = 0;
    for (const interval of intervals) {
      expect(interval.rowCount).toBe(interval.toSeq - interval.fromSeq + 1);
      expect(offsetsBySeq.get(interval.fromSeq)).toBe(interval.firstOffset);
      counted += interval.rowCount;
    }
    expect(counted).toBe(stats.resolvedRowCount);
    expect(stats.resolvedRowCount).toBe(rows.length);
    expect(intervalSeqSet(stats)).toStrictEqual(
      new Set(rows.map((row) => row.seq)),
    );
    expect(intervals[0]).toStrictEqual({
      fromSeq: refs.a.seq,
      toSeq: refs.a.seq,
      firstOffset: refs.a.offset,
      rowCount: 1,
    });
  });

  it('accounts purge-expanded rows in interval rowCount', async () => {
    const builder = new JournalBuilder(filePath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.content('ai', 'B');
    const purge = await builder.purge(
      [marked('human', 'clean-A', 1), marked('ai', 'clean-B', 2)],
      { contentIndex: 1, blockIndex: 0 },
    );

    const resolver = await openResolver();
    const rows = await collectRows(resolver);
    const stats = resolver.stats();

    expect(rows).toHaveLength(2);
    expect(stats.intervals).toStrictEqual([
      {
        fromSeq: purge.seq,
        toSeq: purge.seq,
        firstOffset: purge.offset,
        rowCount: 2,
      },
    ]);
    expect(stats.resolvedRowCount).toBe(2);
    await expectRowsMatchEngine(rows, filePath);
  });
});
