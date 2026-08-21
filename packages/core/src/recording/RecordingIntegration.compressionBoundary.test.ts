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
 * @issue #3132
 *
 * A session recording must never contain the same content record twice.
 * Production rebuilds history wholesale by calling `HistoryService.clear()`
 * and re-`add()`ing the retained entries; each re-`add()` emits
 * `contentAdded`, and `ReplayEngine` pushes every `content` record, so an
 * unguarded rebuild replays into doubled history on resume.
 *
 * Real HistoryService, real SessionRecordingService writing JSONL into a
 * temp dir, real ReplayEngine. Assertions are on the recorded file, the
 * replayed history, and the live history only.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { HistoryService } from '../services/history/HistoryService.js';
import { type IContent } from '../services/history/IContent.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { replaySession } from './ReplayEngine.js';
import {
  type SessionRecordingServiceConfig,
  type ReplayResult,
} from './types.js';

const PROJECT_HASH = 'project-hash-compression-boundary';
const SESSION_ID = 'compression-boundary-session-0001';

type ReplayOkResult = Extract<ReplayResult, { ok: true }>;

function assertReplayOk(
  result: ReplayResult,
): asserts result is ReplayOkResult {
  expect(result.ok).toBe(true);
}

interface JsonlEvent {
  readonly type: string;
  readonly payload: unknown;
}

function isJsonlEvent(value: unknown): value is JsonlEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function isContentPayload(value: unknown): value is { content: IContent } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const content = (value as { content?: unknown }).content;
  return (
    typeof content === 'object' &&
    content !== null &&
    Array.isArray((content as { blocks?: unknown }).blocks)
  );
}

function makeConfig(chatsDir: string): SessionRecordingServiceConfig {
  return {
    sessionId: SESSION_ID,
    projectHash: PROJECT_HASH,
    chatsDir,
    workspaceDirs: ['/workspace/project'],
    provider: 'anthropic',
    model: 'claude-4',
  };
}

function textContent(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function toolCallContent(toolName: string): IContent {
  return {
    speaker: 'ai',
    blocks: [
      { type: 'text', text: `call ${toolName}` },
      {
        type: 'tool_call',
        id: `call_${toolName}`,
        name: toolName,
        parameters: {},
      },
    ],
  };
}

function toolResponseContent(toolName: string): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: `call_${toolName}`,
        toolName,
        result: { ok: true },
      },
    ],
  };
}

/** The text of every text block, in order. */
function textsOf(contents: readonly IContent[]): string[] {
  const texts: string[] = [];
  for (const content of contents) {
    for (const block of content.blocks) {
      if (block.type === 'text') {
        texts.push(block.text);
      }
    }
  }
  return texts;
}

function collectToolCallIds(contents: readonly IContent[]): string[] {
  const ids: string[] = [];
  for (const content of contents) {
    for (const block of content.blocks) {
      if (block.type === 'tool_call') {
        ids.push(block.id);
      }
    }
  }
  return ids;
}

function collectToolResponseCallIds(contents: readonly IContent[]): string[] {
  const ids: string[] = [];
  for (const content of contents) {
    for (const block of content.blocks) {
      if (block.type === 'tool_response') {
        ids.push(block.callId);
      }
    }
  }
  return ids;
}

function hasNoDuplicates(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

async function readEvents(filePath: string): Promise<JsonlEvent[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  if (raw.trim() === '') {
    return [];
  }
  const events: JsonlEvent[] = [];
  for (const line of raw.trim().split('\n')) {
    const parsed: unknown = JSON.parse(line);
    if (isJsonlEvent(parsed)) {
      events.push(parsed);
    }
  }
  return events;
}

/** The `IContent` of every `content` record in the file, in written order. */
function recordedContents(events: readonly JsonlEvent[]): IContent[] {
  const contents: IContent[] = [];
  for (const event of events) {
    if (event.type === 'content' && isContentPayload(event.payload)) {
      contents.push(event.payload.content);
    }
  }
  return contents;
}

/** Serialized form of each recorded content, for byte-identity comparison. */
function recordedFingerprints(events: readonly JsonlEvent[]): string[] {
  return recordedContents(events).map((content) => JSON.stringify(content));
}

function countType(events: readonly JsonlEvent[], type: string): number {
  return events.filter((event) => event.type === type).length;
}

/**
 * Replace history wholesale the way the hard-limit truncation fallback and the
 * provider-content restore do: snapshot, `clear()`, re-`add()`. Runs outside
 * any compression window, which is exactly what makes it a duplicate source.
 */
function rebuildHistoryInPlace(historyService: HistoryService): void {
  const snapshot = historyService.getCurated();
  historyService.clear();
  for (const content of snapshot) {
    historyService.add(content);
  }
}

/** Run a compression cycle whose rebuild happens under the compression lock. */
function compressUnderLock(
  historyService: HistoryService,
  summaryText: string,
): void {
  historyService.startCompression();
  const snapshot = historyService.getCurated();
  const itemsCompressed = snapshot.length;
  historyService.clear();
  for (const content of snapshot) {
    historyService.add(content);
  }
  historyService.endCompression(
    textContent(summaryText, 'ai'),
    itemsCompressed,
  );
}

interface RecordingHarness {
  readonly tempDir: string;
  readonly chatsDir: string;
  readonly recordingService: SessionRecordingService;
  readonly integration: RecordingIntegration;
  readonly historyService: HistoryService;
}

async function createHarness(): Promise<RecordingHarness> {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'recording-compression-boundary-'),
  );
  const chatsDir = path.join(tempDir, 'chats');
  await fs.mkdir(chatsDir, { recursive: true });
  const recordingService = new SessionRecordingService(makeConfig(chatsDir));
  const integration = new RecordingIntegration(recordingService);
  const historyService = new HistoryService();
  integration.subscribeToHistory(historyService);
  return {
    tempDir,
    chatsDir,
    recordingService,
    integration,
    historyService,
  };
}

describe('RecordingIntegration duplicate content guard @issue:3132', () => {
  let harness: RecordingHarness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    harness.integration.dispose();
    await harness.recordingService.dispose();
    await fs.rm(harness.tempDir, { recursive: true, force: true });
  });

  async function flushAndReadEvents(): Promise<JsonlEvent[]> {
    await harness.integration.flushAtTurnBoundary();
    const filePath = harness.recordingService.getFilePath();
    expect(filePath).not.toBeNull();
    return readEvents(filePath ?? '');
  }

  async function flushAndReplay(): Promise<ReplayOkResult> {
    await harness.integration.flushAtTurnBoundary();
    const filePath = harness.recordingService.getFilePath();
    expect(filePath).not.toBeNull();
    const replay = await replaySession(filePath ?? '', PROJECT_HASH);
    assertReplayOk(replay);
    return replay;
  }

  function recordToolTurn(label: string): IContent[] {
    const turn = [
      textContent(`${label}-user`),
      toolCallContent(`${label}-alpha`),
      toolResponseContent(`${label}-alpha`),
      toolCallContent(`${label}-beta`),
      toolResponseContent(`${label}-beta`),
    ];
    for (const content of turn) {
      harness.historyService.add(content);
    }
    return turn;
  }

  it('records a wholesale history rebuild exactly once', async () => {
    const turn = recordToolTurn('rebuild');

    rebuildHistoryInPlace(harness.historyService);

    const events = await flushAndReadEvents();
    expect(recordedContents(events)).toHaveLength(turn.length);
    expect(hasNoDuplicates(recordedFingerprints(events))).toBe(true);

    const replay = await flushAndReplay();
    expect(collectToolCallIds(replay.history)).toStrictEqual([
      'call_rebuild-alpha',
      'call_rebuild-beta',
    ]);
    expect(collectToolResponseCallIds(replay.history)).toStrictEqual([
      'call_rebuild-alpha',
      'call_rebuild-beta',
    ]);

    const live = harness.historyService.getAll();
    expect(hasNoDuplicates(collectToolCallIds(live))).toBe(true);
    expect(hasNoDuplicates(collectToolResponseCallIds(live))).toBe(true);
  });

  it('records a compression between turns without duplicating content', async () => {
    harness.historyService.add(textContent('turn-1-user'));
    harness.historyService.add(textContent('turn-1-ai', 'ai'));

    compressUnderLock(harness.historyService, 'between-turns-summary');

    harness.historyService.add(textContent('turn-2-user'));

    const events = await flushAndReadEvents();
    expect(textsOf(recordedContents(events))).toStrictEqual([
      'turn-1-user',
      'turn-1-ai',
      'turn-2-user',
    ]);
    expect(hasNoDuplicates(recordedFingerprints(events))).toBe(true);
    expect(countType(events, 'compressed')).toBe(1);
  });

  it('keeps content that arrives mid-compression in history without duplicating records', async () => {
    harness.historyService.add(textContent('mid-1-user'));
    harness.historyService.add(textContent('mid-2-ai', 'ai'));

    // Real ordering: the compression rebuild is queued first, then a stream
    // add that arrived while the lock was held is flushed behind it.
    harness.historyService.startCompression();
    const snapshot = harness.historyService.getCurated();
    harness.historyService.clear();
    for (const content of snapshot) {
      harness.historyService.add(content);
    }
    harness.historyService.add(textContent('mid-arrival', 'ai'));
    harness.historyService.endCompression(
      textContent('mid-turn-summary', 'ai'),
      snapshot.length,
    );

    const live = harness.historyService.getAll();
    expect(textsOf(live).filter((text) => text === 'mid-arrival')).toHaveLength(
      1,
    );

    const events = await flushAndReadEvents();
    expect(hasNoDuplicates(recordedFingerprints(events))).toBe(true);
    expect(countType(events, 'compressed')).toBe(1);
  });

  it('records a truncation-fallback rebuild that follows a compression mid-turn exactly once', async () => {
    const turn = recordToolTurn('fallback');

    // The hard-limit path compresses, then rebuilds again outside the lock.
    compressUnderLock(harness.historyService, 'fallback-summary');
    rebuildHistoryInPlace(harness.historyService);

    const events = await flushAndReadEvents();
    expect(recordedContents(events)).toHaveLength(turn.length);
    expect(hasNoDuplicates(recordedFingerprints(events))).toBe(true);

    const replay = await flushAndReplay();
    expect(hasNoDuplicates(collectToolResponseCallIds(replay.history))).toBe(
      true,
    );
  });

  it('records a retried turn crossing a compression boundary without duplicating the original', async () => {
    recordToolTurn('retry');

    compressUnderLock(harness.historyService, 'retry-summary');
    // The retry re-enforces the context window, which rebuilds history.
    rebuildHistoryInPlace(harness.historyService);

    // The retried attempt then contributes genuinely new content.
    harness.historyService.add(toolCallContent('retry-gamma'));
    harness.historyService.add(toolResponseContent('retry-gamma'));

    const events = await flushAndReadEvents();
    expect(hasNoDuplicates(recordedFingerprints(events))).toBe(true);
    expect(collectToolCallIds(recordedContents(events))).toStrictEqual([
      'call_retry-alpha',
      'call_retry-beta',
      'call_retry-gamma',
    ]);

    const replay = await flushAndReplay();
    expect(hasNoDuplicates(collectToolResponseCallIds(replay.history))).toBe(
      true,
    );

    const live = harness.historyService.getAll();
    expect(hasNoDuplicates(collectToolCallIds(live))).toBe(true);
    expect(hasNoDuplicates(collectToolResponseCallIds(live))).toBe(true);
  });

  it('records content whose chronology marker is reused by a different payload', async () => {
    const original = toolCallContent('inherit');
    harness.historyService.add(original);

    // Density optimization and merge both hand a DIFFERENT payload an existing
    // chronology marker. Identity alone must not suppress it.
    const replacement: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'condensed replacement' }],
      metadata: { ...original.metadata },
    };
    harness.historyService.add(replacement);

    const events = await flushAndReadEvents();
    const contents = recordedContents(events);
    expect(contents).toHaveLength(2);
    expect(textsOf(contents)).toContain('condensed replacement');
  });

  it('does not re-record history that is already in the recording when a resumed session rebuilds', async () => {
    recordToolTurn('resumed');
    await harness.integration.flushAtTurnBoundary();
    const filePath = harness.recordingService.getFilePath();
    expect(filePath).not.toBeNull();
    const sessionPath = filePath ?? '';

    harness.integration.dispose();
    await harness.recordingService.dispose();

    const replayed = await replaySession(sessionPath, PROJECT_HASH);
    assertReplayOk(replayed);
    const recordsBeforeResume = replayed.history.length;

    // Resume: append to the same file, restore the replayed history, then
    // subscribe. A later rebuild must not append the restored entries again.
    const resumedRecording = new SessionRecordingService(
      makeConfig(harness.chatsDir),
    );
    resumedRecording.initializeForResume(sessionPath, replayed.lastSeq);
    const resumedIntegration = new RecordingIntegration(resumedRecording);
    const resumedHistory = new HistoryService();
    await resumedHistory.replaceAll(replayed.history);
    resumedIntegration.subscribeToHistory(resumedHistory);

    try {
      compressUnderLock(resumedHistory, 'resumed-summary');
      rebuildHistoryInPlace(resumedHistory);
      resumedHistory.add(textContent('post-resume-user'));

      await resumedIntegration.flushAtTurnBoundary();
      const events = await readEvents(sessionPath);
      expect(hasNoDuplicates(recordedFingerprints(events))).toBe(true);
      expect(recordedContents(events)).toHaveLength(recordsBeforeResume + 1);
      expect(textsOf(recordedContents(events))).toContain('post-resume-user');
    } finally {
      resumedIntegration.dispose();
      await resumedRecording.dispose();
      resumedHistory.dispose();
    }
  });

  it('records content that carries no chronology marker', async () => {
    harness.historyService.emit('contentAdded', textContent('no-marker-1'));
    harness.historyService.emit('contentAdded', textContent('no-marker-2'));

    const events = await flushAndReadEvents();
    expect(textsOf(recordedContents(events))).toStrictEqual([
      'no-marker-1',
      'no-marker-2',
    ]);
  });

  it('records content from a replacement HistoryService whose chronology restarts', async () => {
    const replacementService = new HistoryService();
    harness.integration.subscribeToHistory(replacementService);

    try {
      // Fresh service: seqs restart at 1 and would collide with the harness
      // service's seqs, so identity cannot rest on the seq alone.
      replacementService.add(textContent('replacement-1'));
      replacementService.add(textContent('replacement-2', 'ai'));

      const events = await flushAndReadEvents();
      expect(textsOf(recordedContents(events))).toStrictEqual([
        'replacement-1',
        'replacement-2',
      ]);
    } finally {
      replacementService.dispose();
    }
  });

  it('does not re-record earlier content when the same HistoryService is re-subscribed', async () => {
    harness.historyService.add(textContent('before-resubscribe'));

    harness.integration.unsubscribeFromHistory();
    harness.integration.subscribeToHistory(harness.historyService);

    rebuildHistoryInPlace(harness.historyService);
    harness.historyService.add(textContent('after-resubscribe'));

    const events = await flushAndReadEvents();
    expect(textsOf(recordedContents(events))).toStrictEqual([
      'before-resubscribe',
      'after-resubscribe',
    ]);
  });
});
