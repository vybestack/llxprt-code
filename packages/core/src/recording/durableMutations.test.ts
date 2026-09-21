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
 * RED session for P05b1 (implementation-plan.md §6): durable mutations as
 * journal ops. Every live history mutation must have a durable journal
 * operation, and the journal format is EXTENDED with three append-only event
 * kinds so the previously lossy or unjournalled mutations reproduce exactly:
 *
 *   density_mutation   — chronology seqs removed outright, plus each
 *                        replacement as {replacedSeq, replacement} where the
 *                        replacement inherits the replaced marker.
 *   synthetic_insert   — the inserted IContent, its own chronology seq, and
 *                        the anchor entry's chronology seq.
 *   compression_detail — the destroyed span (fromSeq, toSeq) + item count;
 *                        content suppression unchanged, payload has no
 *                        content.
 *
 * Pinned write-side API (assumed surface, named for the green session):
 *
 *   SessionRecordingService.recordDensityChange(payload: DensityMutationPayload)
 *   SessionRecordingService.recordSyntheticInsert(payload: SyntheticInsertPayload)
 *   SessionRecordingService.recordCompressionDetail(payload: CompressionDetailPayload)
 *
 * each appending one envelope via enqueue and returning the SessionRecordLine,
 * or null when inactive (recordSessionFork payload-object style).
 *
 * Pinned read-side behavior: JournalResolver (and ReplayEngine) fold the new
 * kinds — density replacement swaps the survivor row at the original content
 * envelope in place; removed seqs drop survivor rows; a synthetic insert adds
 * a row attributed to its own envelope at the anchor position even when fold
 * order stops matching envelope order; a compression detail changes no rows
 * (whole-history replacement stays with `compressed`) and a malformed detail
 * is skipped and counted like any malformed event. Legacy journals without
 * the new kinds replay with today's documented divergence.
 *
 * The oracle is the LIVE MODEL PROJECTION, not the replay engine alone: the
 * equivalence tests apply the same mutation script to a real HistoryService
 * and to a journal driven through the durable ops, then compare resolved rows
 * and the P03 membership spans against the live service. Tests-only in the
 * red session; the failures below are the contract the green session implements.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionRecordingService } from './SessionRecordingService.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { JournalResolver } from './journalResolver.js';
import { replaySession } from './ReplayEngine.js';
import type { SessionRecordingServiceConfig } from './types.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type {
  ChronologyMarker,
  IContent,
} from '../services/history/IContent.js';
import type { RemovedInteriorSpan } from '../services/history/historyEventTypes.js';
import {
  type DensityResult,
  type DensityResultMetadata,
} from '../core/compression/types.js';

const TS = '2026-01-01T00:00:00.000Z';
const PROJECT_HASH = 'p05b1-durable-hash';

// ---------------------------------------------------------------------------
// Event-kind names pinned by this session (not in SessionEventType yet).
// ---------------------------------------------------------------------------

const DENSITY_KIND = 'density_mutation';
const SYNTHETIC_KIND = 'synthetic_insert';
const COMPRESSION_DETAIL_KIND = 'compression_detail';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

function summaryFor(text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { chronologyReplaced: { fromSeq: 1, toSeq: 3, itemCount: 3 } },
  };
}

function makeContent(text: string, speaker: IContent['speaker']): IContent {
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

function textOf(content: IContent): string {
  return content.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

function chronOf(content: IContent): number {
  const seq = content.metadata?.chronology?.seq;
  if (seq === undefined) {
    throw new Error('fixture expected a chronology marker');
  }
  return seq;
}

/** One projected row: the two things membership equivalence is about. */
interface ProjectedRow {
  readonly chron: number;
  readonly text: string;
}

function projectLive(history: readonly IContent[]): ProjectedRow[] {
  return history.map((content) => ({
    chron: chronOf(content),
    text: textOf(content),
  }));
}

function makeDensityMetadata(): DensityResultMetadata {
  return {
    readWritePairsPruned: 0,
    fileDeduplicationsPruned: 0,
    recencyPruned: 0,
  };
}

function makeDensityResult(
  removals: readonly number[],
  replacements: ReadonlyMap<number, IContent> = new Map(),
): DensityResult {
  return { removals, replacements, metadata: makeDensityMetadata() };
}

// ---------------------------------------------------------------------------
// Journal line parsing (envelopes are read back as unknown and narrowed)
// ---------------------------------------------------------------------------

interface ParsedEnvelope {
  readonly seq: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

function payloadContentOf(payload: Record<string, unknown>): IContent | null {
  const content = payload['content'];
  if (!isRecord(content)) return null;
  const speaker = content['speaker'];
  if (speaker !== 'human' && speaker !== 'ai' && speaker !== 'tool') {
    return null;
  }
  if (!Array.isArray(content['blocks'])) return null;
  return content as unknown as IContent;
}

/** The chronology marker seq of a row-carrying envelope, or null. */
function rowChronOf(envelope: ParsedEnvelope): number | null {
  if (envelope.type !== 'content' && envelope.type !== SYNTHETIC_KIND)
    return null;
  const chron = payloadContentOf(envelope.payload)?.metadata?.chronology?.seq;
  return chron ?? null;
}

/** chronology-seq → envelope-seq map for every row-carrying line in the file. */
async function rowEnvelopeMap(filePath: string): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  for (const envelope of await readEnvelopes(filePath)) {
    const chron = rowChronOf(envelope);
    if (chron !== null) {
      map.set(chron, envelope.seq);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Hand-built journals for the read-side (resolver) tests
// ---------------------------------------------------------------------------

interface AppendedRef {
  readonly seq: number;
}

class MutationJournalBuilder {
  private seq = 0;
  private chron = 0;

  constructor(private readonly filePath: string) {}

  async start(): Promise<void> {
    await this.append('session_start', {
      sessionId: 'p05b1-durable-test-000001',
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

  /** density_mutation: removed chronology seqs + per-replacement records. */
  async density(
    removedSeqs: readonly number[],
    replacements: ReadonlyArray<{
      replacedSeq: number;
      replacement: IContent;
    }>,
  ): Promise<AppendedRef> {
    return this.append(DENSITY_KIND, { removedSeqs, replacements });
  }

  /** synthetic_insert: inserted IContent + its marker + the anchor marker. */
  async syntheticInsert(
    content: IContent,
    chronologySeq: number,
    afterSeq: number,
  ): Promise<AppendedRef> {
    return this.append(SYNTHETIC_KIND, {
      content,
      chronologySeq,
      afterSeq,
    });
  }

  /** compression_detail: destroyed span + count; no content, by design. */
  async compressionDetail(
    fromSeq: number,
    toSeq: number,
    itemsCompressed: number,
  ): Promise<AppendedRef> {
    return this.append(COMPRESSION_DETAIL_KIND, {
      fromSeq,
      toSeq,
      itemsCompressed,
    });
  }

  async compressed(
    summary: IContent,
    itemsCompressed: number,
  ): Promise<AppendedRef> {
    return this.append('compressed', { summary, itemsCompressed });
  }

  async rewind(itemsRemoved: number, cutSeq?: number): Promise<AppendedRef> {
    return this.append(
      'rewind',
      cutSeq === undefined ? { itemsRemoved } : { itemsRemoved, cutSeq },
    );
  }

  /** Append a raw payload under a given kind (malformed-record fixtures). */
  async rawEvent(type: string, payload: unknown): Promise<AppendedRef> {
    return this.append(type, payload);
  }

  private async append(type: string, payload: unknown): Promise<AppendedRef> {
    this.seq += 1;
    const line = JSON.stringify({ v: 1, seq: this.seq, ts: TS, type, payload });
    await fs.appendFile(this.filePath, `${line}\n`, 'utf8');
    return { seq: this.seq };
  }
}

interface ResolvedJournal {
  readonly rows: ReadonlyArray<{
    readonly chron: number | null;
    readonly text: string;
    readonly seq: number;
    readonly rowIndex: number;
  }>;
  readonly survivorSeqs: ReadonlySet<number>;
  readonly resolvedRowCount: number;
  readonly skippedRecordCount: number;
}

async function collectResolverRows(filePath: string): Promise<ResolvedJournal> {
  const resolver = await JournalResolver.open(filePath);
  try {
    const rows: Array<{
      chron: number | null;
      text: string;
      seq: number;
      rowIndex: number;
    }> = [];
    const survivorSeqs = new Set<number>();
    for await (const row of resolver.resolve()) {
      rows.push({
        chron: row.content.metadata?.chronology?.seq ?? null,
        text: textOf(row.content),
        seq: row.seq,
        rowIndex: row.rowIndex,
      });
      survivorSeqs.add(row.seq);
    }
    const stats = resolver.stats();
    return {
      rows,
      survivorSeqs,
      resolvedRowCount: stats.resolvedRowCount,
      skippedRecordCount: stats.skippedRecordCount,
    };
  } finally {
    await resolver.close();
  }
}

interface DensityReplacementFixture {
  readonly replacedSeq: number;
  readonly replacement: IContent;
}

/**
 * The live-model projection oracle for hand-built journals: the reference fold
 * of the same mutation script over the projected rows, in the test where the
 * mutation is written down.
 */
function projectDensityMutation(
  rows: readonly ProjectedRow[],
  removedSeqs: readonly number[],
  replacements: readonly DensityReplacementFixture[],
): ProjectedRow[] {
  const removed = new Set<number>(removedSeqs);
  const replacementBySeq = new Map<number, string>(
    replacements.map((entry) => [entry.replacedSeq, textOf(entry.replacement)]),
  );
  return rows.flatMap((row) => {
    const replacementText = replacementBySeq.get(row.chron);
    if (replacementText !== undefined) {
      return [{ chron: row.chron, text: replacementText }];
    }
    return removed.has(row.chron) ? [] : [row];
  });
}

function expectProjectedRowsEqual(
  actual: readonly ProjectedRow[],
  expected: readonly ProjectedRow[],
): void {
  expect(actual.map((row) => row.chron)).toStrictEqual(
    expected.map((row) => row.chron),
  );
  expect(actual.map((row) => row.text)).toStrictEqual(
    expected.map((row) => row.text),
  );
}

type ReplayOk = Extract<
  Awaited<ReturnType<typeof replaySession>>,
  { ok: true }
>;

function requireReplaySuccess(
  result: Awaited<ReturnType<typeof replaySession>>,
): asserts result is ReplayOk {
  if (!result.ok) {
    throw new Error(`Expected replay success: ${result.error}`);
  }
}

function projectedFromContents(contents: readonly IContent[]): ProjectedRow[] {
  return contents.map((content) => ({
    chron: chronOf(content),
    text: textOf(content),
  }));
}

function toProjected(resolved: {
  readonly rows: ReadonlyArray<{ chron: number | null; text: string }>;
}): ProjectedRow[] {
  return resolved.rows.map((row) => ({
    chron: row.chron ?? -1,
    text: row.text,
  }));
}

// ---------------------------------------------------------------------------
// Live session harness for the equivalence tests (real services, real files)
// ---------------------------------------------------------------------------

interface LiveSession {
  readonly history: HistoryService;
  readonly recording: SessionRecordingService;
}

function makeRecordingConfig(chatsDir: string): SessionRecordingServiceConfig {
  return {
    sessionId: crypto.randomUUID(),
    projectHash: PROJECT_HASH,
    chatsDir,
    workspaceDirs: ['/test/workspace'],
    provider: 'anthropic',
    model: 'claude-4',
  };
}

function startLiveSession(chatsDir: string): LiveSession {
  const recording = new SessionRecordingService(makeRecordingConfig(chatsDir));
  const history = new HistoryService();
  new RecordingIntegration(recording).subscribeToHistory(history);
  return { history, recording };
}

/** The recorder materializes its own file name; tests read through it. */
function materializedPath(recording: SessionRecordingService): string {
  const filePath = recording.getFilePath();
  if (filePath === null) {
    throw new Error('recording never materialized a session file');
  }
  return filePath;
}

async function addLiveRows(
  session: LiveSession,
  contents: readonly IContent[],
): Promise<void> {
  for (const content of contents) {
    session.history.add(content);
  }
  await session.history.waitForTokenUpdates();
  await session.recording.flush();
}

/** Flush, dispose the recording, then resolve the durable journal. */
async function resolveLiveJournal(
  session: LiveSession,
): Promise<ResolvedJournal> {
  const filePath = materializedPath(session.recording);
  await session.recording.dispose();
  return collectResolverRows(filePath);
}

/** Expand inclusive spans into the union of their chronology seqs. */
function expandSpans(spans: readonly RemovedInteriorSpan[]): Set<number> {
  const seqs = new Set<number>();
  for (const span of spans) {
    for (let seq = span.start; seq <= span.end; seq += 1) {
      seqs.add(seq);
    }
  }
  return seqs;
}

/**
 * Every chronology seq the live service reports as removed from the interior
 * (P03 membership spans) must be absent from the resolved survivor rows. The
 * density-replaced reason is exempt: the original entry is destroyed but its
 * journal envelope keeps carrying the replacement, so it is a survivor.
 */
async function expectLiveSpansResolved(
  session: LiveSession,
  resolved: { readonly rows: ReadonlyArray<{ seq: number }> },
): Promise<void> {
  const survivorSeqs = new Set(resolved.rows.map((row) => row.seq));
  const envelopeByChron = await rowEnvelopeMap(
    materializedPath(session.recording),
  );
  const replacedSeqs = new Set<number>();
  const removedSpans: RemovedInteriorSpan[] = [];
  for (const span of session.history.getContextRange().removedInterior) {
    if (span.reason === 'density-replaced') {
      replacedSeqs.add(span.start);
    } else {
      removedSpans.push(span);
    }
  }
  for (const chron of expandSpans(removedSpans)) {
    const envelope = envelopeByChron.get(chron);
    if (envelope === undefined) {
      throw new Error(`no journal envelope carries chronology seq ${chron}`);
    }
    expect(survivorSeqs.has(envelope)).toBe(false);
  }
  for (const chron of replacedSeqs) {
    const envelope = envelopeByChron.get(chron);
    if (envelope === undefined) {
      throw new Error(`no journal envelope carries chronology seq ${chron}`);
    }
    expect(survivorSeqs.has(envelope)).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Durable mutations @plan:PLAN-20260917-ISSUE854.P05 @requirement:G2', () => {
  let tempDir = '';
  let journalPath = '';
  let chatsDir = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'durable-mutations-'));
    journalPath = path.join(tempDir, 'session-under-test.jsonl');
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // WRITE side — the durable-mutation recorder API appends exact envelopes.
  // RED today: the methods do not exist on SessionRecordingService.
  // -------------------------------------------------------------------------

  it('recordDensityChange appends a density_mutation envelope carrying removed seqs and replacement records', async () => {
    const recording = new SessionRecordingService(
      makeRecordingConfig(chatsDir),
    );
    recording.recordContent(marked('human', 'A', 1));
    await recording.flush();
    const sessionFile = materializedPath(recording);
    const bytesBefore = await fs.readFile(sessionFile, 'utf8');

    const line = recording.recordDensityChange({
      removedSeqs: [2],
      replacements: [
        { replacedSeq: 3, replacement: marked('ai', 'C-dense', 3) },
      ],
    });
    await recording.flush();
    await recording.dispose();

    // Append-only: every byte written before the density event is untouched.
    const bytesAfter = await fs.readFile(sessionFile, 'utf8');
    expect(bytesAfter.startsWith(bytesBefore)).toBe(true);

    const envelopes = await readEnvelopes(sessionFile);
    const density = envelopes[envelopes.length - 1];
    expect(density.type).toBe(DENSITY_KIND);
    expect(density.seq).toBe(3);
    expect(density.payload['removedSeqs']).toStrictEqual([2]);
    expect(density.payload['replacements']).toStrictEqual([
      { replacedSeq: 3, replacement: marked('ai', 'C-dense', 3) },
    ]);
    expect(line).not.toBeNull();
    if (line === null) {
      throw new Error('recordDensityChange returned null while active');
    }
    expect(line.seq).toBe(density.seq);
  });

  it('recordSyntheticInsert appends a synthetic_insert envelope with the inserted content, its marker, and the anchor', async () => {
    const recording = new SessionRecordingService(
      makeRecordingConfig(chatsDir),
    );
    const inserted = marked('tool', 'synthetic response', 4);
    recording.recordContent(marked('human', 'A', 1));
    recording.recordContent(marked('ai', 'B', 2));

    recording.recordSyntheticInsert({
      content: inserted,
      chronologySeq: 4,
      afterSeq: 2,
    });
    await recording.flush();
    await recording.dispose();

    const envelopes = await readEnvelopes(materializedPath(recording));
    const insert = envelopes[envelopes.length - 1];
    expect(insert.type).toBe(SYNTHETIC_KIND);
    expect(Object.keys(insert.payload).sort()).toStrictEqual([
      'afterSeq',
      'chronologySeq',
      'content',
    ]);
    expect(insert.payload['chronologySeq']).toBe(4);
    expect(insert.payload['afterSeq']).toBe(2);
    expect(payloadContentOf(insert.payload)).toStrictEqual(inserted);
  });

  it('recordCompressionDetail appends a compression_detail envelope whose payload carries only the destroyed span and count — no content', async () => {
    const recording = new SessionRecordingService(
      makeRecordingConfig(chatsDir),
    );
    recording.recordContent(marked('human', 'A', 1));

    recording.recordCompressionDetail({
      fromSeq: 1,
      toSeq: 3,
      itemsCompressed: 3,
    });
    await recording.flush();
    await recording.dispose();

    const envelopes = await readEnvelopes(materializedPath(recording));
    const detail = envelopes[envelopes.length - 1];
    expect(detail.type).toBe(COMPRESSION_DETAIL_KIND);
    // Content suppression unchanged: the detail record carries scalars only.
    expect(Object.keys(detail.payload).sort()).toStrictEqual([
      'fromSeq',
      'itemsCompressed',
      'toSeq',
    ]);
    expect(detail.payload['fromSeq']).toBe(1);
    expect(detail.payload['toSeq']).toBe(3);
    expect(detail.payload['itemsCompressed']).toBe(3);
  });

  it('returns null from every durable-mutation recorder when recording is inactive', async () => {
    const recording = new SessionRecordingService(
      makeRecordingConfig(chatsDir),
    );
    await recording.dispose();

    expect(
      recording.recordDensityChange({ removedSeqs: [1], replacements: [] }),
    ).toBeNull();
    expect(
      recording.recordSyntheticInsert({
        content: marked('tool', 'S', 2),
        chronologySeq: 2,
        afterSeq: 1,
      }),
    ).toBeNull();
    expect(
      recording.recordCompressionDetail({
        fromSeq: 1,
        toSeq: 1,
        itemsCompressed: 1,
      }),
    ).toBeNull();
  });

  // -------------------------------------------------------------------------
  // READ side — resolver folds of the new kinds, oracle = live-model
  // projection. RED today: unknown event kinds never touch history, so the
  // rows resolve as if the mutation never happened.
  // -------------------------------------------------------------------------

  it('resolves a density_mutation by swapping the replacement in place at the original envelope and dropping removed rows', async () => {
    const builder = new MutationJournalBuilder(journalPath);
    await builder.start();
    const a = await builder.content('human', 'A');
    await builder.content('ai', 'B');
    const c = await builder.content('ai', 'C');
    const replacements: DensityReplacementFixture[] = [
      { replacedSeq: 3, replacement: marked('ai', 'C-dense', 3) },
    ];
    await builder.density([2], replacements);

    const baseRows: ProjectedRow[] = [
      { chron: 1, text: 'A' },
      { chron: 2, text: 'B' },
      { chron: 3, text: 'C' },
    ];
    // Oracle: the live-model projection of the same mutation, projected in
    // this test — not the journal-only rows and not the replay engine.
    const live = projectDensityMutation(baseRows, [2], replacements);
    const resolved = await collectResolverRows(journalPath);

    expectProjectedRowsEqual(toProjected(resolved), live);
    expect(toProjected(resolved)).not.toStrictEqual(baseRows);
    // The replacement is attributed to the original content envelope.
    expect(resolved.rows[1]?.seq).toBe(c.seq);
    expect(resolved.rows[1]?.rowIndex).toBe(0);
    expect(resolved.rows[0]?.seq).toBe(a.seq);
  });

  it('folds a count rewind over the density-mutated survivor set', async () => {
    const builder = new MutationJournalBuilder(journalPath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.content('ai', 'B');
    await builder.content('ai', 'C');
    await builder.density([2], []);
    await builder.rewind(1);

    const baseRows: ProjectedRow[] = [
      { chron: 1, text: 'A' },
      { chron: 2, text: 'B' },
      { chron: 3, text: 'C' },
    ];
    // Live: density left [A, C]; the rewind removed the last survivor (C).
    const live = projectDensityMutation(baseRows, [2], []).slice(0, -1);
    const resolved = await collectResolverRows(journalPath);

    expect(resolved.rows).toHaveLength(1);
    expectProjectedRowsEqual(toProjected(resolved), live);
  });

  it('resolves a synthetic_insert as a row attributed to its own envelope at the anchor position', async () => {
    const builder = new MutationJournalBuilder(journalPath);
    await builder.start();
    const a = await builder.content('human', 'A');
    await builder.content('ai', 'B');
    const c = await builder.content('ai', 'C');
    const insert = await builder.syntheticInsert(marked('tool', 'S', 4), 4, 2);

    const resolved = await collectResolverRows(journalPath);
    const texts = resolved.rows.map((row) => row.text);
    const chrons = resolved.rows.map((row) => row.chron);

    // Live projection after the insert: [A, B, S, C] — S lands immediately
    // after its anchor (chron 2), one position past envelope order.
    expect(texts).toStrictEqual(['A', 'B', 'S', 'C']);
    expect(chrons).toStrictEqual([1, 2, 4, 3]);
    // The inserted row carries its OWN envelope, not its anchor's.
    expect(resolved.rows[2]?.seq).toBe(insert.seq);
    expect(resolved.rows[2]?.rowIndex).toBe(0);
    expect(resolved.rows[0]?.seq).toBe(a.seq);
    expect(resolved.rows[3]?.seq).toBe(c.seq);
    expect(resolved.resolvedRowCount).toBe(4);
  });

  it('keeps fold order over envelope order when a synthetic_insert anchors earlier than its append position', async () => {
    const builder = new MutationJournalBuilder(journalPath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.content('ai', 'B');
    await builder.content('ai', 'C');
    // validateAndFix can splice anywhere: S appended last (envelope 5) but
    // anchored after A (chron 1), so live order is [A, S, B, C].
    await builder.syntheticInsert(marked('tool', 'S', 4), 4, 1);

    const resolved = await collectResolverRows(journalPath);
    const texts = resolved.rows.map((row) => row.text);
    const chrons = resolved.rows.map((row) => row.chron);

    expect(texts).toStrictEqual(['A', 'S', 'B', 'C']);
    expect(chrons).toStrictEqual([1, 4, 2, 3]);
    expect(resolved.rows[1]?.seq).toBe(5);
  });

  it('resolves compression_detail consistently with existing compressed semantics', async () => {
    const builder = new MutationJournalBuilder(journalPath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.content('ai', 'B');
    await builder.content('ai', 'C');
    await builder.compressionDetail(1, 3, 3);
    const comp = await builder.compressed(summaryFor('rolled up'), 3);

    const resolved = await collectResolverRows(journalPath);
    const engine = await replaySession(journalPath, PROJECT_HASH);

    // The detail record pins membership; the rows still resolve exactly as a
    // bare `compressed` event resolves (whole-history replacement).
    expect(resolved.rows.map((row) => row.text)).toStrictEqual(['rolled up']);
    expect(resolved.rows[0]?.seq).toBe(comp.seq);
    requireReplaySuccess(engine);
    expect(engine.history.map(textOf)).toStrictEqual(['rolled up']);
  });

  it('skips and counts a malformed compression_detail record without corrupting rows', async () => {
    const builder = new MutationJournalBuilder(journalPath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.compressionDetail(1, 3, 3);
    // Missing toSeq: malformed under the pinned payload shape.
    await builder.rawEvent(COMPRESSION_DETAIL_KIND, {
      fromSeq: 1,
      itemsCompressed: 2,
    });
    await builder.compressed(summaryFor('kept'), 3);

    const resolved = await collectResolverRows(journalPath);

    expect(resolved.rows.map((row) => row.text)).toStrictEqual(['kept']);
    expect(resolved.skippedRecordCount).toBe(1);
  });

  it('replays a legacy density-diverged journal with the documented divergence (no new behavior)', async () => {
    const builder = new MutationJournalBuilder(journalPath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.content('ai', 'B');
    await builder.content('ai', 'C');
    // No density event: a legacy file. Live density removed B, the journal
    // never learned, so replay keeps B — the documented divergence.

    const resolved = await collectResolverRows(journalPath);
    const engine = await replaySession(journalPath, PROJECT_HASH);

    const baseRows: ProjectedRow[] = [
      { chron: 1, text: 'A' },
      { chron: 2, text: 'B' },
      { chron: 3, text: 'C' },
    ];
    // The live-model projection of the same mutation (density removed B).
    const liveDensity = projectDensityMutation(baseRows, [2], []);
    expect(resolved.rows).toHaveLength(3);
    expectProjectedRowsEqual(toProjected(resolved), baseRows);
    expect(toProjected(resolved)).not.toStrictEqual(liveDensity);
    requireReplaySuccess(engine);
    expectProjectedRowsEqual(projectedFromContents(engine.history), baseRows);
  });

  it('reproduces a pop exactly through the existing cutSeq rewind machinery', async () => {
    // Durable mapping pinned for pop()/removeLastIfMatches(): a rewind of one
    // item cut at the popped row's chronology marker. Existing kinds already
    // carry enough detail, so this holds today and must keep holding.
    const builder = new MutationJournalBuilder(journalPath);
    await builder.start();
    await builder.content('human', 'A');
    await builder.content('ai', 'B');
    await builder.content('ai', 'C');
    await builder.rewind(1, 3);

    const resolved = await collectResolverRows(journalPath);
    const engine = await replaySession(journalPath, PROJECT_HASH);

    const baseRows: ProjectedRow[] = [
      { chron: 1, text: 'A' },
      { chron: 2, text: 'B' },
      { chron: 3, text: 'C' },
    ];
    // Live projection after the pop: everything but the popped last row.
    const livePop = baseRows.slice(0, -1);
    expect(resolved.rows).toHaveLength(2);
    expectProjectedRowsEqual(toProjected(resolved), livePop);
    requireReplaySuccess(engine);
    expectProjectedRowsEqual(projectedFromContents(engine.history), livePop);
  });

  // -------------------------------------------------------------------------
  // EQUIVALENCE harness — the same mutation script applied to a real
  // HistoryService and to a journal through the durable ops. RED today at the
  // missing recorder methods.
  // -------------------------------------------------------------------------

  it('density removal: journal through recordDensityChange resolves to the live projection with matching membership spans', async () => {
    const session = startLiveSession(chatsDir);
    await addLiveRows(session, [
      makeContent('A', 'human'),
      makeContent('B', 'ai'),
      makeContent('C', 'ai'),
    ]);
    const chronsBefore = projectLive(session.history.getAll()).map(
      (row) => row.chron,
    );

    await session.history.applyDensityResult(makeDensityResult([1]));

    const live = projectLive(session.history.getAll());
    expect(live).toStrictEqual([
      { chron: 1, text: 'A' },
      { chron: 3, text: 'C' },
    ]);

    session.recording.recordDensityChange({
      removedSeqs: [chronsBefore[1]],
      replacements: [],
    });

    const resolved = await resolveLiveJournal(session);
    expectProjectedRowsEqual(toProjected(resolved), live);
    await expectLiveSpansResolved(session, resolved);
  });

  it('density replacement: the journal reproduces the replacement row under the inherited marker', async () => {
    const session = startLiveSession(chatsDir);
    await addLiveRows(session, [
      makeContent('A', 'human'),
      makeContent('B', 'ai'),
      makeContent('C', 'ai'),
    ]);

    await session.history.applyDensityResult(
      makeDensityResult([], new Map([[1, makeContent('B-dense', 'ai')]])),
    );

    const live = projectLive(session.history.getAll());
    expect(live).toStrictEqual([
      { chron: 1, text: 'A' },
      { chron: 2, text: 'B-dense' },
      { chron: 3, text: 'C' },
    ]);
    const replacement = session.history.getAll()[1];

    session.recording.recordDensityChange({
      removedSeqs: [],
      replacements: [{ replacedSeq: 2, replacement }],
    });

    const resolved = await resolveLiveJournal(session);
    expectProjectedRowsEqual(toProjected(resolved), live);
    await expectLiveSpansResolved(session, resolved);
  });

  it('synthetic insert: journal through recordSyntheticInsert resolves to the live validateAndFix projection', async () => {
    const session = startLiveSession(chatsDir);
    await addLiveRows(session, [
      makeContent('Q1', 'human'),
      toolCallContent('call-7', 'working'),
    ]);

    session.history.validateAndFix();
    const live = projectLive(session.history.getAll());
    expect(live).toHaveLength(3);
    const synthetic = session.history.getAll()[2];

    session.recording.recordSyntheticInsert({
      content: synthetic,
      chronologySeq: chronOf(synthetic),
      afterSeq: 2,
    });

    const resolved = await resolveLiveJournal(session);
    expectProjectedRowsEqual(toProjected(resolved), live);

    // The inserted row is attributed to its own envelope, not the anchor's.
    const envelopeByChron = await rowEnvelopeMap(
      session.recording.getFilePath() as string,
    );
    const insertedEnvelope = resolved.rows[2]?.seq;
    expect(envelopeByChron.get(chronOf(synthetic))).toBe(insertedEnvelope);
    expect(insertedEnvelope).not.toBe(envelopeByChron.get(2));
  });

  it('combined script: density removal, synthetic insert, and prefix rewind resolve to the live projection', async () => {
    const session = startLiveSession(chatsDir);
    await addLiveRows(session, [
      makeContent('A', 'human'),
      toolCallContent('call-9', 'B'),
      makeContent('C', 'ai'),
      makeContent('D', 'human'),
    ]);
    const chronsBefore = projectLive(session.history.getAll()).map(
      (row) => row.chron,
    );

    await session.history.applyDensityResult(makeDensityResult([2]));
    session.history.validateAndFix();

    const afterInsert = session.history.getAll();
    const synthetic = afterInsert[2];
    expect(textOf(synthetic)).not.toBe('C');

    session.recording.recordDensityChange({
      removedSeqs: [chronsBefore[2]],
      replacements: [],
    });
    session.recording.recordSyntheticInsert({
      content: synthetic,
      chronologySeq: chronOf(synthetic),
      afterSeq: chronsBefore[1],
    });

    // Live prefix rewind (durable op: the existing cutSeq rewind).
    const remaining = [...afterInsert.slice(0, -1)];
    await session.history.replaceAll(remaining);
    session.recording.recordRewind(1, chronsBefore[3]);

    const live = projectLive(session.history.getAll());
    expect(live.map((row) => row.text)).toStrictEqual([
      'A',
      'B',
      textOf(synthetic),
    ]);

    const resolved = await resolveLiveJournal(session);
    expect(resolved.rows.map((row) => row.text)).toStrictEqual([
      'A',
      'B',
      textOf(synthetic),
    ]);
    expect(resolved.rows.map((row) => row.chron)).toStrictEqual(
      live.map((row) => row.chron),
    );
    await expectLiveSpansResolved(session, resolved);
  });
});
