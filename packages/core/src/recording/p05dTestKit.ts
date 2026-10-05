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
 * P05d red-session test kit (issue #854, resume without materialization).
 *
 * Fixtures use real session journals and the production read counters.
 * Cursor-boot accessors retain explicit failures until resume and checkpoint
 * results implement that contract.
 *
 * Every behavioral test pairs its bounded-memory assertion with a counter
 * aliveness assertion so a never-fired counter cannot make a "bounded"
 * peak of 0 pass vacuously (the shellPtyMemory heap-snapshot lesson).
 */

import { expect } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionDiscovery } from './SessionDiscovery.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import {
  type ContinueTarget,
  type SessionRecordingServiceConfig,
  type SessionSummary,
} from './types.js';
import {
  type ResumeError,
  type ResumeRequest,
  type ResumeResult,
} from './resumeSession.js';
import {
  type ForkError,
  type ForkResult,
  type SessionTransitionServiceOptions,
} from './SessionTransitionService.js';
import type { JournalCursor } from './journalCursor.js';
import type { IContent } from '../services/history/IContent.js';

// ---------------------------------------------------------------------------
// Calibration constants (shellPtyMemory style: documented regimes)
// ---------------------------------------------------------------------------

/** Behavioral-correctness size: exact contents verified via oracle paths. */
export const SMALL_N = 40;
/**
 * Boundedness probe: 100x SMALL_N of plain content with no compression, so
 * any whole-context buffering shows up as peak = N.
 */
export const LARGE_N = 4000;
/** Streaming page/window budget the whole command must stay under. */
export const PAGE_BOUND = 256;

export const PROJECT_HASH = 'p05d-project-hash';

// ---------------------------------------------------------------------------
// Proposed journalCounters.ts surface (temporary test-kit copy)
// ---------------------------------------------------------------------------

export { createRowCounters } from './journalCounters.js';
export type {
  JournalReadCounters,
  JournalReadStats,
  RowCounters,
} from './journalCounters.js';
import type { JournalReadCounters } from './journalCounters.js';

export function withCounters<T extends object>(
  base: T,
  counters: JournalReadCounters,
): T {
  return { ...base, counters };
}

export function transitionOptions(
  counters: JournalReadCounters,
): SessionTransitionServiceOptions {
  return withCounters<SessionTransitionServiceOptions>({}, counters);
}

// ---------------------------------------------------------------------------
// Proposed bounded-discovery surface (temporary test-kit copy)
// ---------------------------------------------------------------------------

export type {
  BoundedDiscoveryOptions,
  BoundedContinueTargets,
} from './SessionDiscovery.js';
import type {
  BoundedDiscoveryOptions,
  BoundedContinueTargets,
} from './SessionDiscovery.js';

export function callBoundedDiscovery(
  chatsDir: string,
  projectHash: string,
  options: BoundedDiscoveryOptions = {},
): Promise<BoundedContinueTargets> {
  return SessionDiscovery.listContinueTargetsDetailedBounded(
    chatsDir,
    projectHash,
    options,
  );
}

// ---------------------------------------------------------------------------
// Proposed cursor-boot accessors (temporary test-kit copy)
// ---------------------------------------------------------------------------

export interface ResumeCursorBoot {
  readonly cursor: JournalCursor;
  readonly lastSeq: number;
  streamRows(): AsyncIterable<IContent>;
}

/** Extract the cursor boot from a ResumeResult; precise red when missing. */
export function bootOf(
  result: ResumeResult | ResumeError,
  label = 'resume',
): ResumeCursorBoot {
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.error}`);
  }
  const boot = (result as { boot?: ResumeCursorBoot }).boot;
  if (boot === undefined) {
    throw new Error(
      'P05d red: ResumeResult.boot (cursor boot) does not exist yet',
    );
  }
  return boot;
}

/** Extract the cursor boot from a ForkResult; precise red when missing. */
export function forkBootOf(
  result: ForkResult | ForkError,
  label = 'fork',
): ResumeCursorBoot {
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.error}`);
  }
  const boot = (result as { boot?: ResumeCursorBoot }).boot;
  if (boot === undefined) {
    throw new Error(
      'P05d red: ForkResult.boot (cursor boot) does not exist yet',
    );
  }
  return boot;
}

/** Assert a result carries no materialized history array (the P05d ban). */
export function expectNoHistoryField(result: object): void {
  expect('history' in result).toBe(false);
}

/** Drain a boot's rows oldest-first, as the CLI boot path would. */
export async function collectRows(boot: ResumeCursorBoot): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of boot.streamRows()) {
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Fixture builders (real journals on disk)
// ---------------------------------------------------------------------------

export interface RecordedSession {
  sessionId: string;
  filePath: string;
  contents: IContent[];
  checkpoints: Array<{
    checkpointId: string;
    name: string;
    sequence: number;
  }>;
}

/** Alternating-speaker plain text rows; no tool groups, no compression. */
export function buildContents(count: number, prefix = ''): IContent[] {
  return Array.from({ length: count }, (_unused, index: number) => ({
    speaker: index % 2 === 0 ? ('human' as const) : ('ai' as const),
    blocks: [{ type: 'text' as const, text: `${prefix}row-${index}` }],
  }));
}

export interface RecordedSessionSpec {
  rows?: number;
  name?: string;
  /** Checkpoint name; created after `checkpointAfter` rows (default: all). */
  checkpoint?: string;
  checkpointAfter?: number;
  provider?: string;
  model?: string;
  sessionId?: string;
  projectHash?: string;
}

/** Record a real session journal, optionally named, optionally checkpointed. */
export async function createRecordedSession(
  chatsDir: string,
  spec: RecordedSessionSpec = {},
): Promise<RecordedSession> {
  const sessionId = spec.sessionId ?? crypto.randomUUID();
  const config: SessionRecordingServiceConfig = {
    sessionId,
    projectHash: spec.projectHash ?? PROJECT_HASH,
    chatsDir,
    workspaceDirs: ['/test/workspace'],
    provider: spec.provider ?? 'anthropic',
    model: spec.model ?? 'claude-4',
  };
  const service = new SessionRecordingService(config);
  const total = spec.rows ?? 2;
  const checkpointAfter = spec.checkpointAfter ?? total;
  const checkpoints: RecordedSession['checkpoints'] = [];
  const contents = buildContents(total);
  const recordSlice = (from: number, to: number): void => {
    for (let index = from; index < to; index += 1) {
      service.recordContent(contents[index]);
    }
  };
  recordSlice(0, checkpointAfter);
  if (spec.checkpoint !== undefined) {
    checkpoints.push(await service.createCheckpoint(spec.checkpoint));
  }
  recordSlice(checkpointAfter, total);
  if (spec.name !== undefined) {
    await service.setSessionName(spec.name);
  }
  await service.flush();
  const filePath = service.getFilePath();
  if (filePath === null) {
    throw new Error('session file was not materialized');
  }
  await service.dispose();
  return { sessionId, filePath, contents, checkpoints };
}

export interface RawJournalSpec {
  sessionId?: string;
  rows?: number;
  kind?: 'subagent';
  projectHash?: string;
  provider?: string;
  model?: string;
}

/**
 * Hand-written v:1 journal (legacy shape): `session_start` without `kind`
 * unless requested, no `session_named`/`session_metadata`, content rows
 * only. Also used for empty (rows 0) and subagent-child fixtures.
 */
export async function writeRawJournal(
  chatsDir: string,
  spec: RawJournalSpec = {},
): Promise<RecordedSession> {
  const sessionId = spec.sessionId ?? crypto.randomUUID();
  const filePath = path.join(chatsDir, `session-${sessionId}.jsonl`);
  const contents = buildContents(spec.rows ?? 2);
  const sessionStart = {
    v: 1,
    seq: 1,
    ts: new Date().toISOString(),
    type: 'session_start',
    payload: {
      sessionId,
      projectHash: spec.projectHash ?? PROJECT_HASH,
      startTime: new Date().toISOString(),
      provider: spec.provider ?? 'anthropic',
      model: spec.model ?? 'claude-4',
      ...(spec.kind === undefined ? {} : { kind: spec.kind }),
    },
  };
  const lines = [JSON.stringify(sessionStart)];
  contents.forEach((content, index: number) => {
    lines.push(
      JSON.stringify({
        v: 1,
        seq: index + 2,
        ts: new Date().toISOString(),
        type: 'content',
        payload: { content },
      }),
    );
  });
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf-8');
  return { sessionId, filePath, contents, checkpoints: [] };
}

/**
 * Corrupt a journal in place: splice one unparseable line after the header
 * and strip the final newline so the tail is a crash-torn partial record.
 * Replay stays ok with warnings; discovery still lists the session.
 */
export async function corruptMidFile(filePath: string): Promise<void> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const trimmed = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
  const lines = trimmed.split('\n');
  lines.splice(1, 0, '{"v":1,"seq":999,"ts":"garbage","type":"content"');
  await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
}

/** Duplicate one content line's seq so replay reports sequenceCorrupt. */
export async function duplicateSeqLine(filePath: string): Promise<void> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const lines = raw.trimEnd().split('\n');
  const victim = JSON.parse(lines[2]) as { seq: number };
  const source = JSON.parse(lines[1]) as { seq: number };
  victim.seq = source.seq;
  lines[2] = JSON.stringify(victim);
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf-8');
}

/** Pin a file's mtime so newest-first ordering is deterministic. */
export async function pinMtime(
  filePath: string,
  epochMs: number,
): Promise<void> {
  await fs.utimes(filePath, new Date(epochMs), new Date(epochMs));
}

/**
 * Build a checkpoint ContinueTarget for a recorded session, matching the
 * shape folded by listContinueTargetsDetailed today.
 */
export async function checkpointTarget(
  session: RecordedSession,
  info: { checkpointId: string; name: string; sequence: number },
): Promise<Extract<ContinueTarget, { kind: 'checkpoint' }>> {
  const stat = await fs.stat(session.filePath);
  const summary: SessionSummary = {
    sessionId: session.sessionId,
    filePath: session.filePath,
    projectHash: PROJECT_HASH,
    startTime: new Date(stat.mtimeMs).toISOString(),
    lastModified: stat.mtime,
    fileSize: stat.size,
    provider: 'anthropic',
    model: 'claude-4',
    kind: 'main',
  };
  return {
    kind: 'checkpoint',
    source: summary,
    checkpointId: info.checkpointId,
    checkpointName: info.name,
    sequence: info.sequence,
  };
}

/** Temp dir under the OS tmp with a unique name (existing suite pattern). */
export async function makeTempChatsDir(): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'p05d-red-'));
  const chatsDir = path.join(base, 'chats');
  await fs.mkdir(chatsDir, { recursive: true });
  return chatsDir;
}

export type { ResumeRequest };
