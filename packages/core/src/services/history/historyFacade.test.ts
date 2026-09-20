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
 * @plan PLAN-20260917-ISSUE854.P05b3
 * @requirement G6, G2
 *
 * Facade behavior tests for P05b3 (implementation-plan.md §6): delete
 * `HistoryServiceCore.history: IContent[]` and make HistoryService a facade
 * over the journal (issue-854-design.md §5c). The journal is the system of
 * record; reads fold the journal through JournalCursor → JournalResolver;
 * the only standing state is O(1) (context-floor offset, tail offset, last
 * chronology seq, token-estimate counter, capped compression-summary pointer
 * window). There is no in-memory array path anywhere, including bare
 * construction.
 *
 * Pinned facade API:
 *
 *   new HistoryService()                            // bare: creates its own
 *                                                   // temp-file-backed journal
 *                                                   // store — no array fallback
 *   new HistoryService({ recording: recorder })     // injected journal store
 *   history.attachJournal(recorder)                 // late attach (the
 *                                                   // foreground CLI builds
 *                                                   // history before recording)
 *   history.journalPath(): string | null            // file backing the store
 *   history.waitForCommit(): Promise<void>          // resolves once every
 *                                                   // mutation enqueued so far
 *                                                   // has a durable commit ack
 *
 * Everything else keeps its current name and shape: getAll(), getCurated(),
 * getWithinTokenLimit(), getContextRange(), the contextRangeChanged /
 * contentAdded / tokensUpdated events, and every mutation method (add, pop,
 * clear, replaceAll, applyDensityResult, validateAndFix, summarizeOldHistory).
 * Their postcondition is "journal appended (awaitable commit ack) + observers
 * notified".
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import type { ContextRange } from './historyEventTypes.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { JournalResolver } from '../../recording/journalResolver.js';
import type { ResolvedEntry } from '../../recording/journalResolver.js';
import type { DensityResult } from '../../core/compression/types.js';

const PROJECT_HASH = 'p05b3-facade-hash';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function textContent(speaker: 'human' | 'ai', text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function toolCallContent(callId: string, text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [
      { type: 'text', text },
      { type: 'tool_call', id: callId, name: 'runner', parameters: { q: 1 } },
    ],
  };
}

function toolResponseContent(callId: string): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId,
        toolName: 'runner',
        result: { ok: true },
      },
    ],
  };
}

function textOf(content: IContent): string {
  return content.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

function chronOf(content: IContent): number | null {
  return content.metadata?.chronology?.seq ?? null;
}

interface ProjectedRow {
  readonly speaker: IContent['speaker'];
  readonly text: string;
  readonly chron: number | null;
}

function project(contents: readonly IContent[]): ProjectedRow[] {
  return contents.map((content) => ({
    speaker: content.speaker,
    text: textOf(content),
    chron: chronOf(content),
  }));
}

function projectFold(entries: readonly ResolvedEntry[]): ProjectedRow[] {
  return project(entries.map((entry) => entry.content));
}

async function foldJournal(filePath: string): Promise<ResolvedEntry[]> {
  const resolver = await JournalResolver.open(filePath);
  try {
    const entries: ResolvedEntry[] = [];
    for await (const entry of resolver.resolve()) {
      entries.push(entry);
    }
    return entries;
  } finally {
    await resolver.close();
  }
}

describe('HistoryService facade (P05b3)', () => {
  let tempDir = '';

  /**
   * Register the temp-dir lifecycle hooks. Called as the first statement of
   * each nested describe (the useChatsDir pattern from
   * rewindChronology.integration.test.ts).
   */
  function useTempChatsDir(): () => string {
    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'p05b3-facade-'));
    });
    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });
    return () => tempDir;
  }

  function makeRecorder(id: string): SessionRecordingService {
    return new SessionRecordingService({
      sessionId: `p05b3-facade-${id}`,
      projectHash: PROJECT_HASH,
      chatsDir: tempDir,
      workspaceDirs: [tempDir],
      provider: 'test-provider',
      model: 'test-model',
    });
  }

  /**
   * Settle loop for the retention property: JSC's conservative stack scan can
   * pin a payload for one full GC cycle, so poll instead of asserting on a
   * fixed cycle count. A service that actually retains the payloads in any
   * live structure never sees deref() turn undefined, however long we poll.
   */
  async function gcUntilReleased(
    probes: ReadonlyArray<WeakRef<object>>,
  ): Promise<boolean> {
    for (let cycle = 0; cycle < 10; cycle += 1) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      Bun.gc(true);
      if (probes.every((ref) => ref.deref() === undefined)) {
        return true;
      }
    }
    return probes.every((ref) => ref.deref() === undefined);
  }

  // ---------------------------------------------------------------------------
  // A.1 — Construction: injected journal store, bare temp-file store
  // ---------------------------------------------------------------------------

  describe('HistoryService facade construction (P05b3)', () => {
    useTempChatsDir();

    it('accepts an injected journal store and exposes the facade surface', () => {
      const recorder = makeRecorder('injected');
      const service = new HistoryService({ recording: recorder });

      expect(service.journalPath()).toBeNull();
      expect(typeof service.waitForCommit).toBe('function');
      expect(typeof service.attachJournal).toBe('function');
    });

    it('attaches a journal store after construction (foreground wiring order)', async () => {
      const service = new HistoryService();
      const recorder = makeRecorder('late-attach');

      service.attachJournal(recorder);
      service.add(textContent('human', 'hello'));
      service.add(textContent('ai', 'hi'));
      await service.waitForCommit();

      const rows = await foldJournal(service.journalPath() as string);
      expect(projectFold(rows)).toStrictEqual(project(service.getAll()));
    });

    it('creates its own temp-file store when constructed bare (no array path)', async () => {
      const service = new HistoryService();
      service.add(textContent('human', 'first'));
      service.add(textContent('ai', 'second'));
      await service.waitForCommit();

      const journalPath = service.journalPath();
      expect(journalPath).not.toBeNull();
      expect(journalPath?.startsWith(os.tmpdir())).toBe(true);

      // The store is a real journal: the resolver fold of its file reproduces
      // the live projection. There is no in-memory array backing these reads.
      const rows = await foldJournal(journalPath as string);
      expect(projectFold(rows)).toStrictEqual(project(service.getAll()));
      expect(rows).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // A.2 — Read APIs keep their names and shapes (transient materialization)
  // ---------------------------------------------------------------------------

  describe('HistoryService facade read APIs (P05b3)', () => {
    useTempChatsDir();

    it('add → getAll round-trips with the current shape', async () => {
      const service = new HistoryService({ recording: makeRecorder('reads') });
      service.add(textContent('human', 'one'));
      service.add(textContent('ai', 'two'));
      service.add(toolCallContent('call-reads', 'running'));
      await service.waitForCommit();

      const all = service.getAll();
      expect(all).toHaveLength(3);
      expect(all[0]?.speaker).toBe('human');
      expect(textOf(all[1])).toBe('two');
      expect(all).not.toBe(service.getAll());
    });

    it('getCurated() keeps its name and shape and drops empty AI rows', async () => {
      const service = new HistoryService({
        recording: makeRecorder('curated'),
      });
      service.add(textContent('human', 'question'));
      service.add({ speaker: 'ai', blocks: [] });
      service.add(textContent('ai', 'answer'));
      await service.waitForCommit();

      const curated = service.getCurated();
      expect(curated).toHaveLength(2);
      expect(textOf(curated[0])).toBe('question');
      expect(textOf(curated[1])).toBe('answer');
      expect(() => JSON.stringify(curated)).not.toThrow();
    });

    it('getWithinTokenLimit() keeps its most-recent-window shape', async () => {
      const service = new HistoryService({ recording: makeRecorder('window') });
      service.add(textContent('human', 'one'));
      service.add(textContent('ai', 'two'));
      service.add(textContent('human', 'three'));
      await service.waitForCommit();

      const window = service.getWithinTokenLimit(25, () => 10);
      expect(window.map(textOf)).toStrictEqual(['two', 'three']);
    });
  });

  // ---------------------------------------------------------------------------
  // A.3 — Standing-state law: no retained payload copies, with and without
  // compression boundaries (retention property, criterion 2)
  // ---------------------------------------------------------------------------

  describe('HistoryService facade retention property (P05b3)', () => {
    useTempChatsDir();

    it('releases early-turn payloads after N adds with no compression', async () => {
      const service = new HistoryService();
      const probes: Array<WeakRef<IContent>> = [];
      for (let index = 0; index < 500; index += 1) {
        const content: IContent = {
          speaker: 'human',
          blocks: [
            { type: 'text', text: `turn-${index}-${'payload'.repeat(40)}` },
          ],
        };
        if (index < 10) {
          probes.push(new WeakRef(content));
        }
        service.add(content);
      }
      await service.waitForTokenUpdates();
      // Settle: every enqueued mutation has a durable commit ack before the
      // retention polling starts.
      await service.waitForCommit();

      const released = await gcUntilReleased(probes);
      expect(released).toBe(true);
    }, 30000);

    it('releases early-turn payloads across many compression boundaries', async () => {
      const service = new HistoryService();
      const probes: Array<WeakRef<IContent>> = [];
      let compressions = 0;
      for (let index = 0; index < 500; index += 1) {
        const content: IContent = {
          speaker: 'ai',
          blocks: [
            {
              type: 'text',
              text: `compressed-turn-${index}-${'x'.repeat(40)}`,
            },
          ],
        };
        if (index < 10) {
          probes.push(new WeakRef(content));
        }
        service.add(content);
        if ((index + 1) % 50 === 0) {
          compressions += 1;
          await service.summarizeOldHistory(
            3,
            async (oldContents: IContent[]) =>
              textContent(
                'ai',
                `summary-${compressions}-${oldContents.length}`,
              ),
          );
        }
      }
      await service.waitForTokenUpdates();
      // Settle: every enqueued mutation has a durable commit ack before the
      // retention polling starts.
      await service.waitForCommit();
      expect(compressions).toBe(10);

      const released = await gcUntilReleased(probes);
      expect(released).toBe(true);
    }, 30000);
  });

  // ---------------------------------------------------------------------------
  // A.4 — Mutation durability: every mutation reaches the journal; the resolver
  // fold of the store's file equals getAll() (engine-parity oracle)
  // ---------------------------------------------------------------------------

  describe('HistoryService facade mutation durability (P05b3)', () => {
    useTempChatsDir();

    it('lands add, pop, density, synthetic-insert, and clear in the journal', async () => {
      const recorder = makeRecorder('durable');
      const service = new HistoryService({ recording: recorder });

      service.add(textContent('human', 'u1'));
      service.add(textContent('ai', 'a1'));
      service.add(toolCallContent('call-1', 'running'));
      service.add(toolResponseContent('call-1'));

      // Rewind-style removal of the last row…
      const popped = service.pop();
      expect(textOf(popped as IContent)).toBe('');

      // …which leaves call-1 orphaned for the synthetic-insert path.
      service.validateAndFix();

      // Density mutation: remove row 0 outright, replace row 1 in place.
      const replacement = textContent('ai', 'a1-compact');
      const density: DensityResult = {
        removals: [0],
        replacements: new Map<number, IContent>([[1, replacement]]),
        metadata: {
          readWritePairsPruned: 0,
          fileDeduplicationsPruned: 0,
          recencyPruned: 0,
        },
      };
      await service.applyDensityResult(density);

      // The density replacement and the synthetic insert are durable BEFORE
      // the clear: the resolver fold of the journal carries both. (Reconciled
      // during the green session: the original assertions read these rows from
      // the POST-clear fold, which cannot carry them — clear truncates the
      // fold, as this test's own oracle line and the zero-entry clear test
      // require. Asserting them pre-clear keeps the intent: the mutations are
      // in the journal, not just in memory.)
      await service.waitForCommit();
      const preClear = await foldJournal(service.journalPath() as string);
      expect(preClear.map((entry) => textOf(entry.content))).toContain(
        'a1-compact',
      );
      expect(
        preClear.filter((entry) => entry.content.metadata?.synthetic === true),
      ).toHaveLength(1);

      // Clear reaches the journal as a durable op, then the session continues.
      service.clear();
      service.add(textContent('human', 'u2'));
      service.add(textContent('ai', 'a2'));
      await service.waitForCommit();

      const journalPath = service.journalPath();
      expect(journalPath).not.toBeNull();
      const rows = await foldJournal(journalPath as string);
      expect(projectFold(rows)).toStrictEqual(project(service.getAll()));
    }, 20000);

    it('lands replaceAll in the journal (compression-style whole replacement)', async () => {
      const service = new HistoryService({
        recording: makeRecorder('replace'),
      });
      service.add(textContent('human', 'one'));
      service.add(textContent('ai', 'two'));
      await service.waitForCommit();

      const summary = textContent('ai', 'summary of two');
      await service.replaceAll([summary]);
      await service.waitForCommit();

      const rows = await foldJournal(service.journalPath() as string);
      expect(projectFold(rows)).toStrictEqual(project(service.getAll()));
      expect(project(service.getAll())).toStrictEqual([
        {
          speaker: 'ai',
          text: 'summary of two',
          chron: summary.metadata?.chronology?.seq ?? null,
        },
      ]);
    }, 20000);
  });

  // ---------------------------------------------------------------------------
  // A.5 — contextRange()/contextRangeChanged unchanged, including the P03
  // first-add fix (preservation pins: the exact outcomes of
  // contextRange.test.ts must survive the flip)
  // ---------------------------------------------------------------------------

  describe('HistoryService facade context-range events (P05b3)', () => {
    useTempChatsDir();

    function seqOfPositionFromEnd(
      service: HistoryService,
      positionFromEnd: number,
    ): number {
      const entries = service.getRecent(positionFromEnd + 1);
      const index = entries.length - 1 - positionFromEnd;
      const entry = index >= 0 ? entries[index] : undefined;
      const seq = entry?.metadata?.chronology?.seq;
      if (seq === undefined) {
        throw new Error('expected a chronology seq');
      }
      return seq;
    }

    it('reports the boundary of the curated history after adds', async () => {
      const service = new HistoryService({
        recording: makeRecorder('range-boundary'),
      });
      for (const text of ['one', 'two', 'three', 'four', 'five']) {
        service.add(textContent('human', text));
      }
      await service.waitForTokenUpdates();
      const range = service.getContextRange();
      expect(range.totalEntries).toBe(5);
      expect(range.firstSeq).toBe(seqOfPositionFromEnd(service, 4));
      expect(range.lastSeq).toBe(seqOfPositionFromEnd(service, 0));
    });

    it('emits contextRangeChanged once for the first entry and once per boundary-moving commit after', async () => {
      const service = new HistoryService({
        recording: makeRecorder('range-events'),
      });
      const events: ContextRange[] = [];
      service.on('contextRangeChanged', (range) => {
        events.push(range);
      });
      service.add(textContent('human', 'one'));
      service.add(textContent('ai', 'two'));
      service.add(textContent('human', 'three'));

      // P03 first-add fix: the empty→first transition emits exactly once,
      // naming the first entry's seq; follow-up single adds stay silent.
      expect(events).toHaveLength(1);
      expect(events[0]?.firstSeq).toBe(seqOfPositionFromEnd(service, 2));
      expect(events[0]?.lastSeq).toBe(seqOfPositionFromEnd(service, 2));
      expect(events[0]?.totalEntries).toBe(1);
      expect(events[0]?.removedInterior).toStrictEqual([]);
      expect(events[0]?.approximate).toBe(false);

      await service.transformAll((contents) => [
        {
          speaker: 'ai' as const,
          blocks: [{ type: 'text' as const, text: 'summary of three' }],
          metadata: {
            chronology: { seq: 99, userTurn: 1, step: 1, recordedAt: 0 },
            chronologyReplaced: { fromSeq: 1, toSeq: 3, itemCount: 3 },
          },
        },
        ...contents.slice(3),
      ]);
      expect(events).toHaveLength(2);
      expect(events[1]?.totalEntries).toBe(1);
      expect(events[1]?.firstSeq).toBe(99);
      expect(events[1]?.lastSeq).toBe(99);
      expect(events[1]?.removedInterior).toStrictEqual([
        { start: 1, end: 3, reason: 'compressed' },
      ]);
      expect(events[1]?.approximate).toBe(false);
    });

    it('emits on clear with a zero-entry range', async () => {
      const service = new HistoryService({
        recording: makeRecorder('range-clear'),
      });
      service.add(textContent('human', 'one'));
      service.add(textContent('ai', 'two'));
      const clearedFirst = seqOfPositionFromEnd(service, 1);
      const clearedLast = seqOfPositionFromEnd(service, 0);
      const events: ContextRange[] = [];
      service.on('contextRangeChanged', (range) => {
        events.push(range);
      });
      service.clear();
      expect(events).toHaveLength(1);
      expect(events[0]).toStrictEqual({
        firstSeq: 0,
        lastSeq: 0,
        totalEntries: 0,
        removedInterior: [
          {
            start: clearedFirst,
            end: clearedLast,
            reason: 'cleared',
          },
        ],
        approximate: false,
      });
    });
  });
});
