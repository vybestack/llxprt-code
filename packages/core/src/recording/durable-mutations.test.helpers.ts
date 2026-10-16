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
import { beforeEach, afterEach, expect } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionRecordingService } from './SessionRecordingService.js';
import { JournalResolver } from './journalResolver.js';
import type { replaySession } from './ReplayEngine.js';
import type { SessionRecordingServiceConfig } from './types.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type {
  ChronologyMarker,
  IContent,
} from '../services/history/IContent.js';
import type { RemovedInteriorSpan } from '../services/history/historyEventTypes.js';
import type {
  DensityResult,
  DensityResultMetadata,
} from '../core/compression/types.js';

const TS = '2026-01-01T00:00:00.000Z';
export const PROJECT_HASH = 'p05b1-durable-hash';

// ---------------------------------------------------------------------------
// Event-kind names pinned by this session (not in SessionEventType yet).
// ---------------------------------------------------------------------------

export const DENSITY_KIND = 'density_mutation';
export const SYNTHETIC_KIND = 'synthetic_insert';
export const COMPRESSION_DETAIL_KIND = 'compression_detail';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function chronMarker(seq: number): ChronologyMarker {
  return { seq, userTurn: 1, step: seq, recordedAt: 0 };
}

export function marked(
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

export function summaryFor(text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { chronologyReplaced: { fromSeq: 1, toSeq: 3, itemCount: 3 } },
  };
}

export function makeContent(
  text: string,
  speaker: IContent['speaker'],
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

export function toolCallContent(callId: string, text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [
      { type: 'text', text },
      { type: 'tool_call', id: callId, name: 'runner', parameters: { q: 1 } },
    ],
  };
}

export function textOf(content: IContent): string {
  return content.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

export function chronOf(content: IContent): number {
  const seq = content.metadata?.chronology?.seq;
  if (seq === undefined) {
    throw new Error('fixture expected a chronology marker');
  }
  return seq;
}

/** One projected row: the two things membership equivalence is about. */
export interface ProjectedRow {
  readonly chron: number;
  readonly text: string;
}

export function projectLive(history: readonly IContent[]): ProjectedRow[] {
  return history.map((content) => ({
    chron: chronOf(content),
    text: textOf(content),
  }));
}

export function makeDensityMetadata(): DensityResultMetadata {
  return {
    readWritePairsPruned: 0,
    fileDeduplicationsPruned: 0,
    recencyPruned: 0,
  };
}

export function makeDensityResult(
  removals: readonly number[],
  replacements: ReadonlyMap<number, IContent> = new Map(),
): DensityResult {
  return { removals, replacements, metadata: makeDensityMetadata() };
}

// ---------------------------------------------------------------------------
// Journal line parsing (envelopes are read back as unknown and narrowed)
// ---------------------------------------------------------------------------

export interface ParsedEnvelope {
  readonly seq: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseEnvelopeLine(line: string): ParsedEnvelope | null {
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

export async function readEnvelopes(
  filePath: string,
): Promise<ParsedEnvelope[]> {
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

export function payloadContentOf(
  payload: Record<string, unknown>,
): IContent | null {
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
export function rowChronOf(envelope: ParsedEnvelope): number | null {
  if (envelope.type !== 'content' && envelope.type !== SYNTHETIC_KIND)
    return null;
  const chron = payloadContentOf(envelope.payload)?.metadata?.chronology?.seq;
  return chron ?? null;
}

/** chronology-seq → envelope-seq map for every row-carrying line in the file. */
export async function rowEnvelopeMap(
  filePath: string,
): Promise<Map<number, number>> {
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

export class MutationJournalBuilder {
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

export async function collectResolverRows(
  filePath: string,
): Promise<ResolvedJournal> {
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

export interface DensityReplacementFixture {
  readonly replacedSeq: number;
  readonly replacement: IContent;
}

/**
 * The live-model projection oracle for hand-built journals: the reference fold
 * of the same mutation script over the projected rows, in the test where the
 * mutation is written down.
 */
export function projectDensityMutation(
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

export function expectProjectedRowsEqual(
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

export function requireReplaySuccess(
  result: Awaited<ReturnType<typeof replaySession>>,
): asserts result is ReplayOk {
  if (!result.ok) {
    throw new Error(`Expected replay success: ${result.error}`);
  }
}

export function projectedFromContents(
  contents: readonly IContent[],
): ProjectedRow[] {
  return contents.map((content) => ({
    chron: chronOf(content),
    text: textOf(content),
  }));
}

export function toProjected(resolved: {
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

export interface LiveSession {
  readonly history: HistoryService;
  readonly recording: SessionRecordingService;
}

export function makeRecordingConfig(
  chatsDir: string,
): SessionRecordingServiceConfig {
  return {
    sessionId: crypto.randomUUID(),
    projectHash: PROJECT_HASH,
    chatsDir,
    workspaceDirs: ['/test/workspace'],
    provider: 'anthropic',
    model: 'claude-4',
  };
}

export function startLiveSession(chatsDir: string): LiveSession {
  const recording = new SessionRecordingService(makeRecordingConfig(chatsDir));
  const history = new HistoryService({ recording });
  return { history, recording };
}

/** The recorder materializes its own file name; tests read through it. */
export function materializedPath(recording: SessionRecordingService): string {
  const filePath = recording.getFilePath();
  if (filePath === null) {
    throw new Error('recording never materialized a session file');
  }
  return filePath;
}

export async function addLiveRows(
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
export async function resolveLiveJournal(
  session: LiveSession,
): Promise<ResolvedJournal> {
  const filePath = materializedPath(session.recording);
  await session.recording.dispose();
  return collectResolverRows(filePath);
}

/** Expand inclusive spans into the union of their chronology seqs. */
export function expandSpans(
  spans: readonly RemovedInteriorSpan[],
): Set<number> {
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
export async function expectLiveSpansResolved(
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

export function useDurableDirs(): {
  readonly chatsDir: string;
  readonly journalPath: string;
} {
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
  return {
    get chatsDir() {
      return chatsDir;
    },
    get journalPath() {
      return journalPath;
    },
  };
}
