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
 * @requirement G2
 *
 * RED session for P05b2 (implementation-plan.md §6): the awaitable commit
 * protocol. Today the recorder is fire-and-forget: `enqueue` returns
 * immediately, the only durability await is the coarse `flush()`, write
 * failures are logged and swallowed into lifecycle state (pending queue
 * cleared), and the queue bound defaults to MAX_SAFE_INTEGER with a
 * synchronous throw when exceeded. This session pins the contract that
 * replaces those mechanics:
 *
 *   append = commit point. Once the bytes of a record are on disk the record
 *   is committed; nothing may roll it back. A per-record awaitable ack
 *   carries a monotone watermark {seq, byteOffset}. The pending queue is
 *   bounded by default (backpressure instead of throw/discard), explicit
 *   Infinity is the only opt-out, and write failures reject the pending
 *   commit with the underlying error, poison the recorder for subsequent
 *   commits, and never silently diverge. A post-append observer failure
 *   surfaces on the observer channel and never rolls back committed bytes.
 *   The legacy publication-error rollback path (prepareContentBatch
 *   rollback / RecordingIntegration batch rollback) dies with the history
 *   array in P05b3; the commit protocol itself has no rollback.
 *
 * Pinned write-side API (assumed surface, named for the green session):
 *
 *   SessionRecordingService.commit(
 *     type: SessionEventType,
 *     payload: unknown,
 *   ): Promise<CommitWatermark>
 *   SessionRecordingService.waitForCommit(
 *     line: SessionRecordLine,
 *   ): Promise<CommitWatermark>
 *
 *   interface CommitWatermark {
 *     readonly seq: number;        // envelope seq of the committed record
 *     readonly byteOffset: number; // exclusive end byte offset of that
 *                                  // record in the journal at commit time
 *   }
 *
 *   export const DEFAULT_MAX_QUEUE_BYTES: number // finite; replaces the
 *     // `?? Number.MAX_SAFE_INTEGER` default (SessionRecordingService
 *     // constructor). Infinity is the only explicit opt-out.
 *
 *   config.io?: RecordingWriterIo — injectable write seam mirroring
 *   JournalResolverOptions.io, at minimum:
 *
 *   interface RecordingWriterIo {
 *     appendFile(
 *       filePath: string,
 *       data: string,
 *       encoding: 'utf8',
 *     ): Promise<void>;
 *   }
 *
 * Tests-only in the red session: no production code is refactored. The
 * failures below are the contract the green session implements. Because the
 * commit API does not exist yet, most tests fail at the first `commit` /
 * `waitForCommit` call; the failure of each test is the behavior it pins.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionRecordingService } from './SessionRecordingService.js';
import * as sessionRecordingServiceModule from './SessionRecordingService.js';
import { JournalResolver, type ResolvedEntry } from './journalResolver.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { SessionPersistenceService } from '../storage/SessionPersistenceService.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import type { IContent } from '../services/history/IContent.js';
import type { SessionRecordingServiceConfig } from './types.js';

const PROJECT_HASH = 'commit-protocol-hash';

// ---------------------------------------------------------------------------
// Assumed API — pinned locally until the green session lands the real types
// (same pattern as the P05b1 red session's event-kind names).
// ---------------------------------------------------------------------------

/** Ack returned when a record's bytes are durably on disk. */
interface CommitWatermark {
  readonly seq: number;
  readonly byteOffset: number;
}

/** Injectable write seam over the service's appendFile callsite. */
interface RecordingWriterIo {
  appendFile(filePath: string, data: string, encoding: 'utf8'): Promise<void>;
}

/** Assumed config extension: the writer seam rides alongside today's config. */
type CommitProtocolConfig = SessionRecordingServiceConfig & {
  readonly io?: RecordingWriterIo;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeContent(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
  };
}

function makeConfig(
  chatsDir: string,
  overrides: Partial<CommitProtocolConfig> = {},
): CommitProtocolConfig {
  return {
    sessionId: crypto.randomUUID(),
    projectHash: PROJECT_HASH,
    chatsDir,
    workspaceDirs: ['/test/workspace'],
    provider: 'anthropic',
    model: 'claude-4',
    ...overrides,
  };
}

/** The recorder materializes its own file name; tests read through it. */
function materializedPath(recording: SessionRecordingService): string {
  const filePath = recording.getFilePath();
  if (filePath === null) {
    throw new Error('recording never materialized a session file');
  }
  return filePath;
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errnoError(code: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`injected ${code}`);
  error.code = code;
  return error;
}

async function captureFailure(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected operation to fail');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface ParsedEnvelope {
  readonly seq: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

function parseEnvelopeLine(line: string): ParsedEnvelope | null {
  if (line.trim() === '') return null;
  const parsed: unknown = JSON.parse(line);
  if (!isRecord(parsed)) return null;
  const seq = parsed['seq'];
  const type = parsed['type'];
  const payload = parsed['payload'];
  if (typeof seq !== 'number' || typeof type !== 'string') return null;
  if (!isRecord(payload)) return null;
  return { seq, type, payload };
}

async function readEnvelopes(filePath: string): Promise<ParsedEnvelope[]> {
  const raw = await fs.readFile(filePath, 'utf8');
  const envelopes: ParsedEnvelope[] = [];
  for (const line of raw.split('\n')) {
    const parsed = parseEnvelopeLine(line);
    if (parsed !== null) {
      envelopes.push(parsed);
    }
  }
  return envelopes;
}

function payloadTextOf(envelope: ParsedEnvelope): string | null {
  const content = envelope.payload['content'];
  if (!isRecord(content)) return null;
  const blocks = content['blocks'];
  if (!Array.isArray(blocks)) return null;
  let text = '';
  for (const block of blocks) {
    if (
      isRecord(block) &&
      block['type'] === 'text' &&
      typeof block['text'] === 'string'
    ) {
      text += block['text'];
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// Injected writer — the assumed `config.io` seam. In the red session the
// config field does not exist yet and is ignored by the constructor; the
// tests then fail one call earlier, at the missing commit API.
// ---------------------------------------------------------------------------

interface AppendCall {
  readonly filePath: string;
  readonly data: string;
}

type AppendBehavior = (call: AppendCall, callIndex: number) => Promise<void>;

class InjectedWriter {
  readonly calls: AppendCall[] = [];

  constructor(private readonly behavior: AppendBehavior) {}

  readonly io: RecordingWriterIo = {
    appendFile: (filePath: string, data: string, _encoding: 'utf8') => {
      const callIndex = this.calls.length;
      this.calls.push({ filePath, data });
      return this.behavior({ filePath, data }, callIndex);
    },
  };
}

const passthrough: AppendBehavior = async (call) => {
  await fs.appendFile(call.filePath, call.data, 'utf8');
};

function passthroughWithDelay(delayMs: number): AppendBehavior {
  return async (call) => {
    await sleep(delayMs);
    await fs.appendFile(call.filePath, call.data, 'utf8');
  };
}

/** `successfulAppends` real appends, then every call fails with `code`. */
function passthroughThenFail(
  code: string,
  successfulAppends: number,
): AppendBehavior {
  return async (call, callIndex) => {
    if (callIndex < successfulAppends) {
      await fs.appendFile(call.filePath, call.data, 'utf8');
      return;
    }
    throw errnoError(code);
  };
}

function alwaysFail(code: string): AppendBehavior {
  return () => Promise.reject(errnoError(code));
}

/** Holds every append until released, then lets the real fs proceed. */
class AppendGate {
  private released = false;
  private readonly waiters: Array<() => void> = [];

  hold(): Promise<void> {
    if (this.released) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    this.released = true;
    for (const release of this.waiters.splice(0)) {
      release();
    }
  }
}

function gatedPassthrough(gate: AppendGate): AppendBehavior {
  return async (call) => {
    await gate.hold();
    await fs.appendFile(call.filePath, call.data, 'utf8');
  };
}

/**
 * Persistence fake for the observer-channel test: save() calls are held so a
 * test can fail them after the journal append has committed. Same shape as
 * RecordingIntegration.lifecycle.test.ts's ControlledPersistenceService.
 */
type ControlledSave = {
  readonly history: readonly IContent[];
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
};

class ControlledPersistenceService extends SessionPersistenceService {
  private readonly saves: ControlledSave[] = [];

  override save(history: IContent[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.saves.push({ history, resolve, reject });
    });
  }

  getSave(index: number): {
    readonly resolve: () => void;
    readonly reject: (error: unknown) => void;
  } {
    const save = this.saves[index] as ControlledSave | undefined;
    if (save === undefined) {
      throw new Error(`Persistence save ${index} was never scheduled`);
    }
    return save;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Awaitable commit protocol @plan:PLAN-20260917-ISSUE854.P05 @requirement:G2', () => {
  let tempDir = '';
  let chatsDir = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'commit-protocol-'));
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Pin 1 — commit ack watermarks.
  // -------------------------------------------------------------------------

  it('commit resolves with a watermark: seq equals the envelope seq and byteOffset equals the file size at ack time', async () => {
    const recording = new SessionRecordingService(
      makeConfig(chatsDir, { io: new InjectedWriter(passthrough).io }),
    );
    const watermark: CommitWatermark = await recording.commit('content', {
      content: makeContent('acked'),
    });

    const sessionFile = materializedPath(recording);
    const stat = await fs.stat(sessionFile);
    expect(watermark.byteOffset).toBe(stat.size);

    const envelopes = await readEnvelopes(sessionFile);
    const last = envelopes[envelopes.length - 1];
    expect(last.type).toBe('content');
    expect(last.seq).toBe(watermark.seq);
    expect(payloadTextOf(last)).toBe('acked');
    await recording.dispose();
  });

  it('watermarks are monotone: an earlier record ack resolves no later than a later record ack', async () => {
    const recording = new SessionRecordingService(
      makeConfig(chatsDir, { io: new InjectedWriter(passthrough).io }),
    );
    const resolutionOrder: string[] = [];
    const firstCommit = recording
      .commit('content', { content: makeContent('first') })
      .then((watermark: CommitWatermark) => {
        resolutionOrder.push('first');
        return watermark;
      });
    const secondCommit = recording
      .commit('content', { content: makeContent('second') })
      .then((watermark: CommitWatermark) => {
        resolutionOrder.push('second');
        return watermark;
      });

    const firstWatermark = await firstCommit;
    // Observed at the first ack's resumption (cb2 is attached to
    // secondCommit before any await, so past that resumption 'second' is
    // unavoidably pushed and the ordering is no longer observable): the
    // later record's ack must still be pending — monotone ack order.
    expect(resolutionOrder).toStrictEqual(['first']);
    const secondWatermark = await secondCommit;

    expect(secondWatermark.seq).toBeGreaterThan(firstWatermark.seq);
    expect(secondWatermark.byteOffset).toBeGreaterThan(
      firstWatermark.byteOffset,
    );
    await recording.dispose();
  });

  it('waitForCommit awaits durability of an already-enqueued line and leaves nothing pending', async () => {
    const recording = new SessionRecordingService(
      makeConfig(chatsDir, { io: new InjectedWriter(passthrough).io }),
    );
    const line = recording.enqueue('content', {
      content: makeContent('queued'),
    });
    if (line === null) {
      throw new Error('enqueue returned null while recording was active');
    }

    const watermark = await recording.waitForCommit(line);

    const sessionFile = materializedPath(recording);
    const stat = await fs.stat(sessionFile);
    expect(watermark.seq).toBe(line.seq);
    expect(watermark.byteOffset).toBe(stat.size);
    expect(recording.getPendingRecordCount()).toBe(0);
    expect(recording.getPendingByteCount()).toBe(0);
    await recording.dispose();
  });

  // -------------------------------------------------------------------------
  // Pin 2 — bounded queue with backpressure; explicit Infinity opt-out.
  // -------------------------------------------------------------------------

  it('commits beyond maxQueueBytes apply backpressure: they await instead of throwing or dropping', async () => {
    const gate = new AppendGate();
    const recording = new SessionRecordingService(
      makeConfig(chatsDir, {
        io: new InjectedWriter(gatedPassthrough(gate)).io,
        // session_start + three short content records overflow this bound.
        maxQueueBytes: 512,
      }),
    );
    const rejections: unknown[] = [];
    const commits = ['r1', 'r2', 'r3'].map((text) => {
      const pending = recording.commit('content', {
        content: makeContent(text),
      });
      void pending.catch((error: unknown) => {
        rejections.push(error);
      });
      return pending;
    });

    // Any overflow beyond the 512-byte bound must hold (backpressure), not
    // throw (today's reserveQueueBytes behavior) and not discard.
    await sleep(25);
    expect(rejections).toStrictEqual([]);

    gate.release();
    const watermarks = await Promise.all(commits);
    expect(watermarks).toHaveLength(3);

    const envelopes = await readEnvelopes(materializedPath(recording));
    expect(envelopes.map((envelope) => envelope.type)).toStrictEqual([
      'session_start',
      'content',
      'content',
      'content',
    ]);
    expect(envelopes.map((envelope) => payloadTextOf(envelope))).toStrictEqual([
      null,
      'r1',
      'r2',
      'r3',
    ]);
    expect(rejections).toStrictEqual([]);
    await recording.dispose();
  });

  it('maxQueueBytes: Infinity explicitly opts out of the bound: a long gated backlog is admitted and written exactly once', async () => {
    const gate = new AppendGate();
    const recording = new SessionRecordingService(
      makeConfig(chatsDir, {
        io: new InjectedWriter(gatedPassthrough(gate)).io,
        maxQueueBytes: Infinity,
      }),
    );
    const rejections: unknown[] = [];
    const texts = Array.from({ length: 200 }, (_v, index) => `r${index}`);
    const commits = texts.map((text) => {
      const pending = recording.commit('content', {
        content: makeContent(text),
      });
      void pending.catch((error: unknown) => {
        rejections.push(error);
      });
      return pending;
    });

    await sleep(25);
    expect(rejections).toStrictEqual([]);

    gate.release();
    await Promise.all(commits);

    const envelopes = await readEnvelopes(materializedPath(recording));
    expect(envelopes).toHaveLength(201);
    const writtenTexts = envelopes
      .map((envelope) => payloadTextOf(envelope))
      .filter((text) => text !== null);
    expect(new Set(writtenTexts).size).toBe(200);
    expect(writtenTexts).toStrictEqual(texts);
    expect(rejections).toStrictEqual([]);
    await recording.dispose();
  });

  // -------------------------------------------------------------------------
  // Pin 3 — fail fast: injected write errors reject the commit loudly.
  // -------------------------------------------------------------------------

  it('injected ENOSPC rejects the pending commit with the underlying error and poisons subsequent commits', async () => {
    const recording = new SessionRecordingService(
      makeConfig(chatsDir, {
        io: new InjectedWriter(passthroughThenFail('ENOSPC', 1)).io,
      }),
    );
    const first = await recording.commit('content', {
      content: makeContent('survives'),
    });
    expect(first.byteOffset).toBeGreaterThan(0);

    const secondFailure = await captureFailure(
      recording.commit('content', { content: makeContent('dies') }),
    );
    expect(secondFailure).toBeInstanceOf(Error);
    expect((secondFailure as NodeJS.ErrnoException).code).toBe('ENOSPC');
    expect(recording.isActive()).toBe(false);

    // Poisoned state: subsequent commits reject loudly, never silently
    // "succeed" while diverging from disk.
    const thirdFailure = await captureFailure(
      recording.commit('content', { content: makeContent('after') }),
    );
    expect((thirdFailure as NodeJS.ErrnoException).code).toBe('ENOSPC');
    await recording.dispose();
  });

  it('injected EACCES surfaces its code on the commit rejection', async () => {
    const recording = new SessionRecordingService(
      makeConfig(chatsDir, { io: new InjectedWriter(alwaysFail('EACCES')).io }),
    );
    const failure = await captureFailure(
      recording.commit('content', { content: makeContent('denied') }),
    );
    expect((failure as NodeJS.ErrnoException).code).toBe('EACCES');
    expect(recording.isActive()).toBe(false);
    await recording.dispose();
  });

  it('injected ENOENT surfaces its code on the commit rejection', async () => {
    const recording = new SessionRecordingService(
      makeConfig(chatsDir, { io: new InjectedWriter(alwaysFail('ENOENT')).io }),
    );
    const failure = await captureFailure(
      recording.commit('content', { content: makeContent('vanished') }),
    );
    expect((failure as NodeJS.ErrnoException).code).toBe('ENOENT');
    expect(recording.isActive()).toBe(false);
    await recording.dispose();
  });

  it('a failed append leaves the bytes before the failure point byte-identical (append-only preserved)', async () => {
    const recording = new SessionRecordingService(
      makeConfig(chatsDir, {
        io: new InjectedWriter(passthroughThenFail('ENOSPC', 1)).io,
      }),
    );
    const watermark = await recording.commit('content', {
      content: makeContent('kept'),
    });
    const sessionFile = materializedPath(recording);
    const before = await fs.readFile(sessionFile, 'utf8');
    expect(Buffer.byteLength(before, 'utf8')).toBe(watermark.byteOffset);

    const failure = await captureFailure(
      recording.commit('content', { content: makeContent('lost') }),
    );
    expect((failure as NodeJS.ErrnoException).code).toBe('ENOSPC');

    const after = await fs.readFile(sessionFile, 'utf8');
    expect(after).toBe(before);
    const stat = await fs.stat(sessionFile);
    expect(stat.size).toBe(watermark.byteOffset);
    await recording.dispose();
  });

  // -------------------------------------------------------------------------
  // Pin 4 — slow disk: in-order acks, no interleaving corruption.
  // -------------------------------------------------------------------------

  it('delayed writes deliver acks in seq order and the journal stays line-intact', async () => {
    const recording = new SessionRecordingService(
      makeConfig(chatsDir, {
        io: new InjectedWriter(passthroughWithDelay(10)).io,
      }),
    );
    const ackOrder: number[] = [];
    const commits = [1, 2, 3, 4, 5].map((index) =>
      recording
        .commit('content', { content: makeContent(`slow-${index}`) })
        .then((watermark: CommitWatermark) => {
          ackOrder.push(watermark.seq);
          return watermark;
        }),
    );
    const watermarks = await Promise.all(commits);

    expect(ackOrder).toStrictEqual(
      watermarks.map((watermark) => watermark.seq),
    );
    const sortedSeqs = [...watermarks.map((w) => w.seq)].sort(
      (left, right) => left - right,
    );
    expect(watermarks.map((w) => w.seq)).toStrictEqual(sortedSeqs);

    const envelopes = await readEnvelopes(materializedPath(recording));
    expect(envelopes.map((envelope) => envelope.seq)).toStrictEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(envelopes[0].type).toBe('session_start');
    for (let index = 1; index < envelopes.length; index += 1) {
      expect(payloadTextOf(envelopes[index])).toBe(`slow-${index}`);
    }
    await recording.dispose();
  });

  // -------------------------------------------------------------------------
  // Pin 5 — failure AFTER the append: observer channel, never the commit.
  // -------------------------------------------------------------------------

  it('an observer failing after the append neither rolls back the journal nor rejects the resolved commit', async () => {
    const recording = new SessionRecordingService(makeConfig(chatsDir));
    const persistence = new ControlledPersistenceService(
      new Storage(path.join(tempDir, 'persist-store')),
      'commit-protocol-observer',
    );
    const history = new HistoryService();
    const integration = new RecordingIntegration(recording, persistence);
    integration.subscribeToHistory(history);

    // Append committed, ack resolved.
    const watermark: CommitWatermark = await recording.commit('content', {
      content: makeContent('committed-before-observer'),
    });
    const sessionFile = materializedPath(recording);
    const bytesAtAck = await fs.readFile(sessionFile, 'utf8');

    // Observer chain: contentAdded fires recordContent + persistence save.
    history.add(makeContent('observed'));
    await history.waitForTokenUpdates();
    await recording.flush();
    const bytesWithObservedRow = await fs.readFile(sessionFile, 'utf8');
    expect(bytesWithObservedRow.startsWith(bytesAtAck)).toBe(true);

    // The observer fails AFTER the append committed.
    persistence.getSave(0).reject(new Error('observer persistence exploded'));

    const boundaryFailure = await captureFailure(
      integration.flushAtTurnBoundary(),
    );
    expect(boundaryFailure).toBeInstanceOf(Error);
    expect((boundaryFailure as Error).message).toContain(
      'observer persistence exploded',
    );

    // The journal is NOT rolled back and the ack is unaffected.
    const bytesAfterObserverFailure = await fs.readFile(sessionFile, 'utf8');
    expect(bytesAfterObserverFailure).toBe(bytesWithObservedRow);
    expect(watermark.byteOffset).toBeLessThanOrEqual(
      Buffer.byteLength(bytesAfterObserverFailure, 'utf8'),
    );
    await integration.dispose();
    await recording.dispose();
  });

  // -------------------------------------------------------------------------
  // Pin 6 — concurrent queued commits under a slow disk.
  // -------------------------------------------------------------------------

  it('eight concurrent commits under a slow disk all resolve with exactly-once, monotone watermarks', async () => {
    const recording = new SessionRecordingService(
      makeConfig(chatsDir, {
        io: new InjectedWriter(passthroughWithDelay(5)).io,
      }),
    );
    const watermarks = await Promise.all(
      Array.from({ length: 8 }, (_v, index) =>
        recording.commit('content', { content: makeContent(`c${index}`) }),
      ),
    );

    const seqs = watermarks.map((watermark) => watermark.seq);
    expect([...seqs].sort((left, right) => left - right)).toStrictEqual(seqs);
    expect(new Set(seqs).size).toBe(8);

    const byteOffsets = watermarks.map((watermark) => watermark.byteOffset);
    expect([...byteOffsets].sort((left, right) => left - right)).toStrictEqual(
      byteOffsets,
    );
    expect(new Set(byteOffsets).size).toBe(8);

    const envelopes = await readEnvelopes(materializedPath(recording));
    expect(envelopes).toHaveLength(9);
    expect(envelopes.map((envelope) => envelope.seq)).toStrictEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    const texts = envelopes
      .map((envelope) => payloadTextOf(envelope))
      .filter((text) => text !== null);
    expect(new Set(texts).size).toBe(8);
    await recording.dispose();
  });

  // -------------------------------------------------------------------------
  // Pin 7 — read-your-write: a fresh resolver sees committed rows at once.
  // -------------------------------------------------------------------------

  it('immediately after a commit ack a fresh JournalResolver resolves the committed rows at the acked offsets', async () => {
    const recording = new SessionRecordingService(
      makeConfig(chatsDir, { io: new InjectedWriter(passthrough).io }),
    );
    const firstWatermark: CommitWatermark = await recording.commit('content', {
      content: makeContent('resolved-a'),
    });
    const secondWatermark: CommitWatermark = await recording.commit('content', {
      content: makeContent('resolved-b'),
    });

    const resolver = await JournalResolver.open(materializedPath(recording));
    const rows: ResolvedEntry[] = [];
    try {
      for await (const row of resolver.resolve()) {
        rows.push(row);
      }
    } finally {
      await resolver.close();
    }

    expect(rows.map((row) => row.seq)).toStrictEqual([
      firstWatermark.seq,
      secondWatermark.seq,
    ]);
    expect(rows[0].offset + rows[0].length).toBe(firstWatermark.byteOffset);
    expect(rows[1].offset + rows[1].length).toBe(secondWatermark.byteOffset);
    await recording.dispose();
  });

  // -------------------------------------------------------------------------
  // Pin 8 — the default queue bound is a real finite constant.
  // -------------------------------------------------------------------------

  it('DEFAULT_MAX_QUEUE_BYTES is exported, finite, and strictly smaller than MAX_SAFE_INTEGER', () => {
    const candidate: unknown =
      sessionRecordingServiceModule.DEFAULT_MAX_QUEUE_BYTES;
    expect(typeof candidate).toBe('number');
    expect(Number.isSafeInteger(candidate)).toBe(true);
    expect(candidate).toBeGreaterThan(0);
    expect(candidate).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});
