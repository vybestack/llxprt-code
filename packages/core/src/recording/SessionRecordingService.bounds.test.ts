/**
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Retention behaviour of the session recording queue (issue #2852).
 *
 * The queue must be released by draining, never by dropping. The session file
 * is the durable transcript, so an overflowing queue may not silently stop
 * recording or discard buffered records.
 *
 * Since PLAN-20260917-ISSUE854.P05b2, the queue byte bound is admission
 * control for awaitable commits (`commit`/`waitForCommit`): overflow applies
 * backpressure (the caller awaits drain room) instead of the legacy
 * synchronous throw, explicit `Infinity` opts out, and nothing pended or
 * retained is ever dropped. The default bound is the finite
 * DEFAULT_MAX_QUEUE_BYTES. These tests were reconciled to that contract
 * without weakening their original invariants: construction still rejects
 * invalid bounds before retaining the session header, an exact byte
 * reservation is still admitted, records held by backpressure reserve no
 * queue state and land exactly once after the gate releases, and a content
 * batch still preflights before any state change.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type IContent } from '../services/history/IContent.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { type CommitWatermark, type RecordingWriterIo } from './types.js';

const created: string[] = [];
const services: SessionRecordingService[] = [];
const gates: AppendGate[] = [];

function createService(): SessionRecordingService {
  const chatsDir = mkdtempSync(path.join(tmpdir(), 'llxprt-recording-'));
  created.push(chatsDir);
  const service = new SessionRecordingService({
    sessionId: 'bounded-recording',
    projectHash: 'project',
    chatsDir,
    workspaceDirs: [chatsDir],
    cwd: chatsDir,
    provider: 'test',
    model: 'test',
  });
  services.push(service);
  return service;
}

function readRecords(service: SessionRecordingService): unknown[] {
  const filePath = service.getFilePath();
  if (filePath === null) {
    return [];
  }
  return readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

function makeContent(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface RecordedLine {
  readonly seq: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

function readLines(service: SessionRecordingService): RecordedLine[] {
  const lines: RecordedLine[] = [];
  for (const parsed of readRecords(service)) {
    if (!isRecord(parsed)) {
      throw new Error('journal line is not a JSON object');
    }
    const { seq, type, payload } = parsed;
    if (
      typeof seq !== 'number' ||
      typeof type !== 'string' ||
      !isRecord(payload)
    ) {
      throw new Error('journal line envelope is malformed');
    }
    lines.push({ seq, type, payload });
  }
  return lines;
}

/** Concatenated text of a content record's text blocks, or null if absent. */
function contentText(line: RecordedLine): string | null {
  const content = line.payload['content'];
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

function gatedWriterIo(gate: AppendGate): RecordingWriterIo {
  return {
    appendFile: (filePath: string, data: string, encoding: 'utf8') =>
      gate.hold().then(() => appendFile(filePath, data, encoding)),
  };
}

type Settlement = 'resolved' | 'rejected';

/**
 * Observe a commit's settlement without leaving rejections unhandled; the
 * returned promise never rejects, so a mid-test assertion failure cannot
 * cascade into unhandled-rejection noise.
 */
function trackSettlement(
  commit: Promise<CommitWatermark>,
  outcomes: Settlement[],
): Promise<CommitWatermark | null> {
  return commit.then(
    (watermark: CommitWatermark) => {
      outcomes.push('resolved');
      return watermark;
    },
    () => {
      outcomes.push('rejected');
      return null;
    },
  );
}

function requireWatermarks(
  watermarks: Array<CommitWatermark | null>,
): CommitWatermark[] {
  const settled: CommitWatermark[] = [];
  for (const watermark of watermarks) {
    if (watermark === null) {
      throw new Error('a commit rejected where it must have resolved');
    }
    settled.push(watermark);
  }
  return settled;
}

describe('SessionRecordingService queue retention', () => {
  afterEach(async () => {
    // Release held writers first so disposing a service whose drain is still
    // gated cannot hang this cleanup, then dispose. Both happen here rather
    // than at the end of each test body, so an assertion failure cannot leak
    // a recording service, a gate, or a temp dir.
    for (const gate of gates.splice(0)) {
      gate.release();
    }
    for (const service of services.splice(0)) {
      await service.dispose();
    }
    for (const dir of created.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes every record even when far more are produced than the high-water mark', async () => {
    const service = createService();
    const total = 10_000;

    for (let index = 0; index < total; index += 1) {
      service.recordContent({
        speaker: 'ai',
        blocks: [{ type: 'text', text: `record-${index}` }],
      });
    }

    await service.flush();

    const records = readRecords(service) as Array<{ type: string }>;
    expect({
      active: service.isActive(),
      contentRecords: records.filter((record) => record.type === 'content')
        .length,
    }).toStrictEqual({ active: true, contentRecords: total });
  });

  it('keeps recording active after producing far more than the high-water mark', async () => {
    const service = createService();

    for (let index = 0; index < 20_000; index += 1) {
      service.recordProviderSwitch(`provider-${index}`, 'x'.repeat(64));
    }

    expect(service.isActive()).toBe(true);
  });

  it('releases the pending queue once the drain completes', async () => {
    const service = createService();

    for (let index = 0; index < 500; index += 1) {
      service.recordContent({
        speaker: 'ai',
        blocks: [{ type: 'text', text: `record-${index}` }],
      });
    }
    expect(service.getPendingRecordCount()).toBeGreaterThan(0);

    await service.flush();

    expect({
      pendingRecords: service.getPendingRecordCount(),
      pendingBytes: service.getPendingByteCount(),
    }).toStrictEqual({ pendingRecords: 0, pendingBytes: 0 });
  });

  it('preserves buffered pre-content records once content materialises the file', async () => {
    const service = createService();

    for (let index = 0; index < 5_000; index += 1) {
      service.recordProviderSwitch(`provider-${index}`, 'model');
    }
    service.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'hello' }],
    });

    await service.flush();

    const records = readRecords(service) as Array<{ type: string }>;
    const switches = records.filter(
      (record) => record.type === 'provider_switch',
    );
    expect(switches).toHaveLength(5_000);
  });

  it('rejects an invalid queue byte bound at construction before retaining the session header', () => {
    // @plan PLAN-20260917-ISSUE854.P05b2 — the legacy synchronous throw on
    // queue-bound overflow is gone (backpressure instead), but construction
    // still rejects bounds that are neither a non-negative safe integer nor
    // Infinity, before the session_start header is retained. A zero-byte
    // bound is now an ordinary finite bound and is admitted (pinned by the
    // next test).
    const chatsDir = mkdtempSync(path.join(tmpdir(), 'llxprt-recording-zero-'));
    created.push(chatsDir);

    expect(
      () =>
        new SessionRecordingService({
          sessionId: 'zero-bound',
          projectHash: 'project',
          chatsDir,
          workspaceDirs: [chatsDir],
          provider: 'test',
          model: 'test',
          maxQueueBytes: -1,
        }),
    ).toThrow(/queue byte limit/);

    expect(
      () =>
        new SessionRecordingService({
          sessionId: 'zero-bound',
          projectHash: 'project',
          chatsDir,
          workspaceDirs: [chatsDir],
          provider: 'test',
          model: 'test',
          maxQueueBytes: 1.5,
        }),
    ).toThrow(/queue byte limit/);
  });

  it('admits a zero-byte queue bound and holds overflow on backpressure without dropping records', async () => {
    // @plan PLAN-20260917-ISSUE854.P05b2 — a zero-byte bound no longer
    // rejects construction: it is an ordinary finite bound, and overflow
    // applies backpressure instead of throwing. Every record must still land
    // exactly once — a regression that discards on overflow fails the
    // journal assertions below.
    const gate = new AppendGate();
    gates.push(gate);
    const chatsDir = mkdtempSync(
      path.join(tmpdir(), 'llxprt-recording-zero-bp-'),
    );
    created.push(chatsDir);
    const bounded = new SessionRecordingService({
      sessionId: 'zero-bound-backpressure',
      projectHash: 'project',
      chatsDir,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      io: gatedWriterIo(gate),
      maxQueueBytes: 0,
    });
    services.push(bounded);

    const outcomes: Settlement[] = [];
    const commits = ['r1', 'r2', 'r3'].map((text) =>
      trackSettlement(
        bounded.commit('content', { content: makeContent(text) }),
        outcomes,
      ),
    );

    // Overflow on a zero-byte bound is pure backpressure: nothing settles
    // (no throw, no ack) while the writer is held.
    await sleep(25);
    expect(outcomes).toStrictEqual([]);

    gate.release();
    const settled = requireWatermarks(await Promise.all(commits));
    expect(settled).toHaveLength(3);

    const lines = readLines(bounded);
    expect(lines.map((line) => line.type)).toStrictEqual([
      'session_start',
      'content',
      'content',
      'content',
    ]);
    expect(lines.map((line) => contentText(line))).toStrictEqual([
      null,
      'r1',
      'r2',
      'r3',
    ]);
    expect(outcomes).toStrictEqual(['resolved', 'resolved', 'resolved']);
    expect({
      pendingRecords: bounded.getPendingRecordCount(),
      pendingBytes: bounded.getPendingByteCount(),
    }).toStrictEqual({ pendingRecords: 0, pendingBytes: 0 });
  });

  it('accepts an exact queue-byte reservation and holds one byte over on backpressure without dropping retained records', async () => {
    // @plan PLAN-20260917-ISSUE854.P05b2 — the bound is admission control
    // for awaitable commits: an exact reservation is admitted immediately;
    // one byte over is held (backpressure, never the legacy throw) until the
    // in-flight drain frees room, and the held record reserves no queue
    // state while it waits. Nothing retained or pended is ever dropped.
    const gate = new AppendGate();
    gates.push(gate);

    const probeDir = mkdtempSync(
      path.join(tmpdir(), 'llxprt-recording-probe-'),
    );
    created.push(probeDir);
    const probe = new SessionRecordingService({
      sessionId: 'bounded-recording',
      projectHash: 'project',
      chatsDir: probeDir,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    probe.recordProviderSwitch('bounded-provider', 'bounded-model');
    const exactBytes = probe.getPendingByteCount();
    await probe.dispose();

    const makeBounded = (
      suffix: string,
      maxQueueBytes: number,
    ): SessionRecordingService => {
      const dir = mkdtempSync(
        path.join(tmpdir(), `llxprt-recording-${suffix}-`),
      );
      created.push(dir);
      const service = new SessionRecordingService({
        sessionId: 'bounded-recording',
        projectHash: 'project',
        chatsDir: dir,
        workspaceDirs: [],
        provider: 'test',
        model: 'test',
        io: gatedWriterIo(gate),
        maxQueueBytes,
      });
      services.push(service);
      return service;
    };

    const exact = makeBounded('exact', exactBytes);
    const over = makeBounded('over', exactBytes - 1);

    const outcomes: Settlement[] = [];
    const exactCommit = trackSettlement(
      exact.commit('provider_switch', {
        provider: 'bounded-provider',
        model: 'bounded-model',
      }),
      outcomes,
    );
    // On a fresh recorder the first commit over the bound is still admitted:
    // nothing can drain yet, so holding it would deadlock. The NEXT commit —
    // the one that cannot fit while a drain is in flight — is the one held.
    const overFirst = trackSettlement(
      over.commit('provider_switch', {
        provider: 'bounded-provider',
        model: 'bounded-model',
      }),
      outcomes,
    );
    const overSecond = trackSettlement(
      over.commit('provider_switch', {
        provider: 'bounded-provider',
        model: 'bounded-model',
      }),
      outcomes,
    );

    // The gated drain keeps the recorder busy, so the one-byte-over commit
    // is held: it settles neither way and reserves no bytes beyond the
    // already-admitted records.
    await sleep(25);
    expect(outcomes).toStrictEqual([]);
    expect(exact.getPendingByteCount()).toBe(exactBytes);
    expect(over.getPendingRecordCount()).toBe(2);
    expect(over.getPendingByteCount()).toBe(exactBytes);

    gate.release();
    const [exactWatermark, overFirstWatermark, overSecondWatermark] =
      requireWatermarks(
        await Promise.all([exactCommit, overFirst, overSecond]),
      );

    // Exact reservation: admitted, landed exactly once, and its ack points
    // at the full journal size.
    const exactFile = exact.getFilePath();
    if (exactFile === null) {
      throw new Error('exact reservation never materialized a session file');
    }
    const exactLines = readLines(exact);
    expect(exactLines.map((line) => line.type)).toStrictEqual([
      'session_start',
      'provider_switch',
    ]);
    expect(exactLines[1].payload['provider']).toBe('bounded-provider');
    expect(exactWatermark.byteOffset).toBe(
      Buffer.byteLength(readFileSync(exactFile, 'utf-8'), 'utf8'),
    );

    // One byte over: held, then admitted after the drain freed room — the
    // retained header and both commits all landed exactly once.
    expect(overSecondWatermark.seq).toBeGreaterThan(overFirstWatermark.seq);
    expect(overSecondWatermark.byteOffset).toBeGreaterThan(
      overFirstWatermark.byteOffset,
    );
    const overLines = readLines(over);
    expect(overLines.map((line) => line.type)).toStrictEqual([
      'session_start',
      'provider_switch',
      'provider_switch',
    ]);
    const overSwitches = overLines.filter(
      (line) => line.type === 'provider_switch',
    );
    expect(overSwitches).toHaveLength(2);
    expect(
      overSwitches.every(
        (line) => line.payload['provider'] === 'bounded-provider',
      ),
    ).toBe(true);
    expect(outcomes).toStrictEqual(['resolved', 'resolved', 'resolved']);
    expect({
      pendingRecords: over.getPendingRecordCount(),
      pendingBytes: over.getPendingByteCount(),
    }).toStrictEqual({ pendingRecords: 0, pendingBytes: 0 });
  });

  it('holds a materializing commit at admission until drain room frees, changing no recorded state while it waits', async () => {
    // @plan PLAN-20260917-ISSUE854.P05b2 — the legacy synchronous throw
    // before materialization is replaced by backpressure: a materializing
    // record over the bound is not admitted (no queue entry, no bytes
    // reserved, nothing appended for it) while the in-flight drain holds the
    // gate, and once room frees it lands exactly once. Admission of an
    // earlier commit necessarily materializes the file first — a commit
    // always gives the durability it promises a target — so the pinned
    // invariant is "the held record changes no recorded state", which still
    // fails on any regression that admits-then-drops or corrupts on overflow.
    const gate = new AppendGate();
    gates.push(gate);

    const probeDir = mkdtempSync(
      path.join(tmpdir(), 'llxprt-recording-materialize-probe-'),
    );
    created.push(probeDir);
    const probe = new SessionRecordingService({
      sessionId: 'materialize-bound',
      projectHash: 'project',
      chatsDir: probeDir,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    const headerBytes = probe.getPendingByteCount();
    probe.recordProviderSwitch('filler-provider', 'filler-model');
    const fillerBytes = probe.getPendingByteCount() - headerBytes;
    await probe.dispose();

    const boundedDir = mkdtempSync(
      path.join(tmpdir(), 'llxprt-recording-materialize-bounded-'),
    );
    created.push(boundedDir);
    const bounded = new SessionRecordingService({
      sessionId: 'materialize-bound',
      projectHash: 'project',
      chatsDir: boundedDir,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      io: gatedWriterIo(gate),
      maxQueueBytes: headerBytes + fillerBytes,
    });
    services.push(bounded);

    const outcomes: Settlement[] = [];
    const fillerCommit = trackSettlement(
      bounded.commit('provider_switch', {
        provider: 'filler-provider',
        model: 'filler-model',
      }),
      outcomes,
    );
    const contentCommit = trackSettlement(
      bounded.commit('content', {
        content: makeContent('over the retained header bound'),
      }),
      outcomes,
    );

    await sleep(25);
    expect(outcomes).toStrictEqual([]);
    // Only the admitted header + filler are pending: the held materializing
    // record reserved no queue bytes and no queue entry.
    expect(bounded.getPendingRecordCount()).toBe(2);
    expect(bounded.getPendingByteCount()).toBe(headerBytes + fillerBytes);
    // And nothing was appended for it: the gate held the only drain, so no
    // journal byte exists yet — the file itself is only created by the
    // first append.
    const boundedFile = bounded.getFilePath();
    if (boundedFile === null) {
      throw new Error('filler admission never materialized a session file');
    }
    expect(existsSync(boundedFile)).toBe(false);

    gate.release();
    requireWatermarks(await Promise.all([fillerCommit, contentCommit]));

    const lines = readLines(bounded);
    expect(lines.map((line) => line.type)).toStrictEqual([
      'session_start',
      'provider_switch',
      'content',
    ]);
    expect(contentText(lines[2])).toBe('over the retained header bound');
    expect(outcomes).toStrictEqual(['resolved', 'resolved']);
    expect({
      pendingRecords: bounded.getPendingRecordCount(),
      pendingBytes: bounded.getPendingByteCount(),
    }).toStrictEqual({ pendingRecords: 0, pendingBytes: 0 });
  });

  it('preflights the complete content batch before changing recording state', async () => {
    // @plan PLAN-20260917-ISSUE854.P05b2 — the queue byte bound no longer
    // rejects batches synchronously (it is backpressure for awaitable
    // commits); the preflight contract that remains is atomicity: preparing
    // measures and validates the whole batch without changing any state
    // (still no file, no queue entry), publish admits the whole batch at
    // once, rollback restores the exact prior state, and a batch over the
    // bound lands complete — never split, dropped, or corrupted.
    const probe = createService();
    const contents = [
      {
        speaker: 'human' as const,
        blocks: [{ type: 'text' as const, text: 'first batch item' }],
      },
      {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: 'second batch item' }],
      },
    ];
    const probeHeaderBytes = probe.getPendingByteCount();
    const prepared = probe.prepareContentBatch(contents);
    expect(probe.getPendingRecordCount()).toBe(1);
    expect(probe.getPendingByteCount()).toBe(probeHeaderBytes);
    expect(probe.getFilePath()).toBeNull();
    prepared.publish();
    const batchBytes = probe.getPendingByteCount() - probeHeaderBytes;
    prepared.rollback();
    expect(probe.getPendingRecordCount()).toBe(1);
    expect(probe.getPendingByteCount()).toBe(probeHeaderBytes);
    expect(probe.getFilePath()).toBeNull();

    const chatsDir = mkdtempSync(path.join(tmpdir(), 'llxprt-batch-bound-'));
    created.push(chatsDir);
    const headerProbe = new SessionRecordingService({
      sessionId: 'bounded-recording',
      projectHash: 'project',
      chatsDir,
      workspaceDirs: [chatsDir],
      provider: 'test',
      model: 'test',
    });
    services.push(headerProbe);
    const headerBytes = headerProbe.getPendingByteCount();
    const bounded = new SessionRecordingService({
      sessionId: 'bounded-recording',
      projectHash: 'project',
      chatsDir,
      workspaceDirs: [chatsDir],
      provider: 'test',
      model: 'test',
      maxQueueBytes: headerBytes + batchBytes - 1,
    });
    services.push(bounded);

    // Preparing a batch that exceeds the bound neither throws nor changes
    // recording state — not even materialization.
    const boundedPrepared = bounded.prepareContentBatch(contents);
    expect({
      filePath: bounded.getFilePath(),
      records: bounded.getPendingRecordCount(),
      bytes: bounded.getPendingByteCount(),
    }).toStrictEqual({ filePath: null, records: 1, bytes: headerBytes });

    // Publish admits the whole batch atomically, over the bound.
    boundedPrepared.publish();
    expect(bounded.getPendingRecordCount()).toBe(3);
    expect(bounded.getPendingByteCount()).toBe(headerBytes + batchBytes);
    expect(bounded.getFilePath()).not.toBeNull();

    // And every record lands exactly once despite the overflow.
    await bounded.flush();
    const lines = readLines(bounded);
    expect(lines.map((line) => line.type)).toStrictEqual([
      'session_start',
      'content',
      'content',
    ]);
    expect(lines.map((line) => contentText(line))).toStrictEqual([
      null,
      'first batch item',
      'second batch item',
    ]);
    expect(bounded.isActive()).toBe(true);
    expect({
      pendingRecords: bounded.getPendingRecordCount(),
      pendingBytes: bounded.getPendingByteCount(),
    }).toStrictEqual({ pendingRecords: 0, pendingBytes: 0 });
  });

  it('surfaces a background write failure after releasing every queued byte', async () => {
    const root = mkdtempSync(
      path.join(tmpdir(), 'llxprt-recording-write-fail-'),
    );

    created.push(root);
    const service = new SessionRecordingService({
      sessionId: 'write-failure',
      projectHash: 'project',
      chatsDir: root,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    services.push(service);
    service.initializeForResume(root, 0);
    service.recordProviderSwitch('next-provider', 'next-model');

    await expect(service.flush()).rejects.toBeInstanceOf(Error);
    expect(service.getPendingByteCount()).toBe(0);
    expect(service.getPendingRecordCount()).toBe(0);
  });
});
