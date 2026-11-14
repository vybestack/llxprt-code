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
import { SessionDiscovery } from '../../SessionDiscovery.js';
import { type ContinueTarget, type SessionSummary } from '../../types.js';
import type { ResumeRequest } from '../../resumeSession.js';
import { type SessionTransitionServiceOptions } from '../../SessionTransitionService.js';
import type { IContent } from '../../../services/history/IContent.js';

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

export { createRowCounters } from '../../journalCounters.js';
export type {
  JournalReadCounters,
  JournalReadStats,
  RowCounters,
} from '../../journalCounters.js';
import type { JournalReadCounters } from '../../journalCounters.js';

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
} from '../../SessionDiscovery.js';
import type {
  BoundedDiscoveryOptions,
  BoundedContinueTargets,
} from '../../SessionDiscovery.js';

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

/** Assert a result carries no materialized history array (the P05d ban). */
export function expectNoHistoryField(result: object): void {
  expect('history' in result).toBe(false);
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
