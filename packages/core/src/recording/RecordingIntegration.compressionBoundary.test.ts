import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { JournalResumeBoot, resumePointOf } from './journalResume.js';
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

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { HistoryService } from '../services/history/HistoryService.js';
import { type IContent } from '../services/history/IContent.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { JournalRecordingService } from './journalRecordingService.js';
import type { SessionRecordingServiceConfig } from './types.js';
import {
  journalRows,
  journalGroups,
  type RecordedJournalGroup,
} from './__tests__/support/journal-read-test-helpers.js';
import { MUTATION } from '../journal/recordKinds.js';

const PROJECT_HASH = 'project-hash-compression-boundary';
const SESSION_ID = 'compression-boundary-session-0001';

interface RecordedHistory {
  readonly history: IContent[];
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

function readEvents(filePath: string): Promise<RecordedJournalGroup[]> {
  return journalGroups(filePath);
}
function recordedContents(events: readonly RecordedJournalGroup[]): IContent[] {
  return events
    .filter((event) => event.trailer.mutation === MUTATION.append)
    .flatMap((event) => event.rows);
}
function recordedFingerprints(
  events: readonly RecordedJournalGroup[],
): string[] {
  return recordedContents(events).map((content) => JSON.stringify(content));
}
function countReplacements(events: readonly RecordedJournalGroup[]): number {
  return events.filter((event) => event.trailer.mutation === MUTATION.replace)
    .length;
}
/**
 * Replace history wholesale the way the hard-limit truncation fallback and the
 * provider-content restore do: snapshot, `clear()`, re-`add()`. Runs outside
 * any compression window, which is exactly what makes it a duplicate source.
 */
async function rebuildHistoryInPlace(
  historyService: HistoryService,
): Promise<void> {
  await historyService.replaceAll(
    await Array.fromAsync(historyService.streamRawHistory()),
  );
}

/** Run a compression cycle whose rebuild happens under the compression lock. */
async function compressUnderLock(
  historyService: HistoryService,
  summaryText: string,
): Promise<void> {
  historyService.startCompression();
  const itemsCompressed = historyService.length();
  const summary = textContent(summaryText, 'ai');
  await historyService.replaceAll([summary]);
  historyService.endCompression(summary, itemsCompressed);
}

interface RecordingHarness {
  readonly tempDir: string;
  readonly chatsDir: string;
  readonly recordingService: JournalRecordingService;
  readonly integration: RecordingIntegration;
  readonly historyService: HistoryService;
}

async function createHarness(): Promise<RecordingHarness> {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'recording-compression-boundary-'),
  );
  const chatsDir = path.join(tempDir, 'chats');
  await fs.mkdir(chatsDir, { recursive: true });
  const recordingService = JournalRecordingService.create(makeConfig(chatsDir));
  const integration = new RecordingIntegration(recordingService);
  const historyService = new HistoryService({});
  await integration.subscribeToJournal(historyService);
  return {
    tempDir,
    chatsDir,
    recordingService,
    integration,
    historyService,
  };
}

let harness: RecordingHarness;

async function flushAndReadEvents(): Promise<RecordedJournalGroup[]> {
  await harness.integration.flushAtTurnBoundary();
  const filePath = harness.recordingService.getFilePath();
  expect(filePath).not.toBeNull();
  return readEvents(filePath ?? '');
}

async function flushAndReplay(): Promise<RecordedHistory> {
  await harness.integration.flushAtTurnBoundary();
  const filePath = harness.recordingService.getFilePath();
  expect(filePath).not.toBeNull();
  return { history: await journalRows(filePath ?? '') };
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

describe('RecordingIntegration duplicate content guard @issue:3132', () => {
  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.integration.dispose();
    await harness.recordingService.dispose();
    await harness.historyService.dispose();
    await fs.rm(harness.tempDir, { recursive: true, force: true });
  });

  it(
    'records a wholesale history rebuild exactly once',
    testRecordingCompressionBoundary01,
  );

  it(
    'records a compression between turns without duplicating content',
    testRecordingCompressionBoundary02,
  );

  it(
    'keeps content that arrives mid-compression in history without duplicating records',
    testRecordingCompressionBoundary03,
  );

  it(
    'records a truncation-fallback rebuild that follows a compression mid-turn exactly once',
    testRecordingCompressionBoundary04,
  );

  it(
    'records a retried turn crossing a compression boundary without duplicating the original',
    testRecordingCompressionBoundary05,
  );

  it(
    'records content whose chronology marker is reused by a different payload',
    testRecordingCompressionBoundary06,
  );

  it(
    'does not re-record history that is already in the recording when a resumed session rebuilds',
    testRecordingCompressionBoundary07,
  );

  it(
    'records content that carries no chronology marker',
    testRecordingCompressionBoundary08,
  );

  it(
    'records content from a replacement HistoryService whose chronology restarts',
    testRecordingCompressionBoundary09,
  );

  it(
    'does not re-record earlier content when the same HistoryService is re-subscribed',
    testRecordingCompressionBoundary10,
  );

  it(
    'does not append resumed content again when a rebuild reassigns turn IDs',
    testRecordingCompressionBoundary11,
  );

  it(
    'does not re-record seeded disk history when live history is empty at subscribe time',
    testRecordingCompressionBoundary12,
  );

  it(
    'does not re-record an unstamped disk snapshot when its history is rebuilt',
    testRecordingCompressionBoundary13,
  );
});

async function testRecordingCompressionBoundary01(): Promise<void> {
  const turn = recordToolTurn('rebuild');

  await rebuildHistoryInPlace(harness.historyService);

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
  await collectRowsForAssertions(
    harness.historyService.streamRawHistory(),
    async (contentsForAssertions) => {
      const live = contentsForAssertions;
      expect(hasNoDuplicates(collectToolCallIds(live))).toBe(true);
      expect(hasNoDuplicates(collectToolResponseCallIds(live))).toBe(true);
    },
  );
}

async function testRecordingCompressionBoundary02(): Promise<void> {
  harness.historyService.add(textContent('turn-1-user'));
  harness.historyService.add(textContent('turn-1-ai', 'ai'));

  await compressUnderLock(harness.historyService, 'between-turns-summary');

  harness.historyService.add(textContent('turn-2-user'));

  const events = await flushAndReadEvents();
  expect(textsOf(recordedContents(events))).toStrictEqual([
    'turn-1-user',
    'turn-1-ai',
    'turn-2-user',
  ]);
  expect(hasNoDuplicates(recordedFingerprints(events))).toBe(true);
  expect(countReplacements(events)).toBe(1);
}

async function testRecordingCompressionBoundary03(): Promise<void> {
  harness.historyService.add(textContent('mid-1-user'));
  harness.historyService.add(textContent('mid-2-ai', 'ai'));

  // Real ordering: the compression rebuild is queued first, then a stream
  // add that arrived while the lock was held is flushed behind it.
  harness.historyService.startCompression();
  const snapshot = await Array.fromAsync(
    harness.historyService.streamRawHistory(),
  );
  await harness.historyService.replaceAll([
    textContent('mid-turn-summary', 'ai'),
  ]);
  harness.historyService.add(textContent('mid-arrival', 'ai'));
  harness.historyService.endCompression(
    textContent('mid-turn-summary', 'ai'),
    snapshot.length,
  );
  await collectRowsForAssertions(
    harness.historyService.streamRawHistory(),
    async (contentsForAssertions) => {
      const live = contentsForAssertions;
      expect(
        textsOf(live).filter((text) => text === 'mid-arrival'),
      ).toHaveLength(1);

      const events = await flushAndReadEvents();
      expect(hasNoDuplicates(recordedFingerprints(events))).toBe(true);
      expect(countReplacements(events)).toBe(1);
    },
  );
}

async function testRecordingCompressionBoundary04(): Promise<void> {
  const turn = recordToolTurn('fallback');

  // The hard-limit path compresses, then rebuilds again outside the lock.
  await compressUnderLock(harness.historyService, 'fallback-summary');
  await rebuildHistoryInPlace(harness.historyService);

  const events = await flushAndReadEvents();
  expect(recordedContents(events)).toHaveLength(turn.length);
  expect(hasNoDuplicates(recordedFingerprints(events))).toBe(true);

  const replay = await flushAndReplay();
  expect(hasNoDuplicates(collectToolResponseCallIds(replay.history))).toBe(
    true,
  );
}

async function testRecordingCompressionBoundary05(): Promise<void> {
  recordToolTurn('retry');

  await compressUnderLock(harness.historyService, 'retry-summary');
  // The retry re-enforces the context window, which rebuilds history.
  await rebuildHistoryInPlace(harness.historyService);

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
  await collectRowsForAssertions(
    harness.historyService.streamRawHistory(),
    async (contentsForAssertions) => {
      const live = contentsForAssertions;
      expect(hasNoDuplicates(collectToolCallIds(live))).toBe(true);
      expect(hasNoDuplicates(collectToolResponseCallIds(live))).toBe(true);
    },
  );
}

async function testRecordingCompressionBoundary06(): Promise<void> {
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
}

async function testRecordingCompressionBoundary07(): Promise<void> {
  recordToolTurn('resumed');
  await harness.integration.flushAtTurnBoundary();
  const filePath = harness.recordingService.getFilePath();
  expect(filePath).not.toBeNull();
  const sessionPath = filePath ?? '';

  await harness.integration.dispose();
  await harness.recordingService.dispose();

  const replayed = { history: await journalRows(sessionPath) };
  const recordsBeforeResume = replayed.history.length;

  // Resume: append to the same file, restore the replayed history, then
  // subscribe. A later rebuild must not append the restored entries again.
  const resumedRecording = await JournalRecordingService.open(
    makeConfig(harness.chatsDir),
    sessionPath,
  );
  const resumedIntegration = new RecordingIntegration(resumedRecording);
  const resumedHistory = new HistoryService();
  await resumedHistory.adoptResumeBoot(
    resumedRecording,
    new JournalResumeBoot(
      resumedRecording,
      await resumePointOf(resumedRecording),
    ),
  );
  await resumedIntegration.subscribeToJournal(resumedHistory);

  try {
    await compressUnderLock(resumedHistory, 'resumed-summary');
    await rebuildHistoryInPlace(resumedHistory);
    resumedHistory.add(textContent('post-resume-user'));

    await resumedIntegration.flushAtTurnBoundary();
    const events = await readEvents(sessionPath);
    expect(hasNoDuplicates(recordedFingerprints(events))).toBe(true);
    expect(recordedContents(events)).toHaveLength(recordsBeforeResume + 1);
    expect(textsOf(recordedContents(events))).toContain('post-resume-user');
  } finally {
    await resumedIntegration.dispose();
    await resumedRecording.dispose();
    await resumedHistory.dispose();
  }
}

async function testRecordingCompressionBoundary08(): Promise<void> {
  harness.historyService.add(textContent('no-marker-1'));
  harness.historyService.add(textContent('no-marker-2'));

  const events = await flushAndReadEvents();
  expect(textsOf(recordedContents(events))).toStrictEqual([
    'no-marker-1',
    'no-marker-2',
  ]);
}

async function testRecordingCompressionBoundary09(): Promise<void> {
  const replacementService = new HistoryService({});
  await harness.integration.subscribeToJournal(replacementService);

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
    await replacementService.dispose();
  }
}

async function testRecordingCompressionBoundary10(): Promise<void> {
  harness.historyService.add(textContent('before-resubscribe'));

  await harness.integration.subscribeToJournal(harness.historyService);

  await rebuildHistoryInPlace(harness.historyService);
  harness.historyService.add(textContent('after-resubscribe'));

  const events = await flushAndReadEvents();
  expect(textsOf(recordedContents(events))).toStrictEqual([
    'before-resubscribe',
    'after-resubscribe',
  ]);
}

interface ResumedSession {
  readonly recording: JournalRecordingService;
  readonly integration: RecordingIntegration;
  readonly history: HistoryService;
}

/**
 * Closes the harness session, then resumes the same recording file the way a
 * resumed session does: the journal is seeded from disk rather than from a
 * live history array.
 */
async function resumeHarnessSession(
  sessionPath: string,
): Promise<{ resumed: ResumedSession; replayed: RecordedHistory }> {
  await harness.integration.dispose();
  await harness.recordingService.dispose();

  const replayed = { history: await journalRows(sessionPath) };
  const recording = await JournalRecordingService.open(
    makeConfig(harness.chatsDir),
    sessionPath,
  );
  const integration = new RecordingIntegration(recording);
  const history = new HistoryService();
  await history.adoptResumeBoot(
    recording,
    new JournalResumeBoot(recording, await resumePointOf(recording)),
  );
  await integration.subscribeToJournal(history);
  return { resumed: { recording, integration, history }, replayed };
}

async function closeResumedSession(resumed: ResumedSession): Promise<void> {
  await resumed.integration.dispose();
  await resumed.recording.dispose();
  await resumed.history.dispose();
}

async function liveTexts(history: HistoryService): Promise<string[]> {
  let texts: string[] = [];
  await collectRowsForAssertions(
    history.streamRawHistory(),
    (contentsForAssertions) => {
      texts = textsOf(contentsForAssertions);
    },
  );
  return texts;
}

async function testRecordingCompressionBoundary11(): Promise<void> {
  harness.historyService.add({
    ...textContent('resumed message'),
    metadata: { turnId: 'original-turn-id' },
  });
  await harness.integration.flushAtTurnBoundary();
  let original: IContent | undefined;
  await collectRowsForAssertions(
    harness.historyService.streamRawHistory(),
    (contentsForAssertions) => {
      expect(contentsForAssertions).toHaveLength(1);
      original = contentsForAssertions[0];
    },
  );
  if (original === undefined) throw new Error('Expected the recorded row');

  // The rebuild hands the same payload back under a different turn ID.
  await harness.historyService.replaceAll([
    {
      ...original,
      metadata: {
        turnId: 'replacement-turn-id',
        chronology: original.metadata?.chronology,
      },
    },
  ]);

  const events = await flushAndReadEvents();
  expect(textsOf(recordedContents(events))).toStrictEqual(['resumed message']);
  expect(await liveTexts(harness.historyService)).toStrictEqual([
    'resumed message',
  ]);
}

async function testRecordingCompressionBoundary12(): Promise<void> {
  harness.historyService.add({
    ...textContent('disk-only resumed message'),
    metadata: { turnId: 'disk-turn' },
  });
  await harness.integration.flushAtTurnBoundary();
  const sessionPath = harness.recordingService.getFilePath();
  expect(sessionPath).not.toBeNull();

  const { resumed, replayed } = await resumeHarnessSession(sessionPath ?? '');
  try {
    // No row was added through this service: the journal holds the disk
    // history on its own, so the rebuild below has nothing new to record.
    expect(await liveTexts(resumed.history)).toStrictEqual([
      'disk-only resumed message',
    ]);
    const diskRow = replayed.history[0];
    await resumed.history.replaceAll([
      {
        ...diskRow,
        metadata: {
          turnId: 'rebuilt-turn',
          chronology: diskRow.metadata?.chronology,
        },
      },
    ]);
    await resumed.integration.flushAtTurnBoundary();

    const events = await readEvents(sessionPath ?? '');
    expect(textsOf(recordedContents(events))).toStrictEqual([
      'disk-only resumed message',
    ]);
  } finally {
    await closeResumedSession(resumed);
  }
}

async function testRecordingCompressionBoundary13(): Promise<void> {
  const snapshot = textContent('unstamped disk snapshot');
  await (await harness.recordingService.session()).append([snapshot]);
  await harness.recordingService.flush();
  const sessionPath = harness.recordingService.getFilePath();
  expect(sessionPath).not.toBeNull();

  const { resumed, replayed } = await resumeHarnessSession(sessionPath ?? '');
  try {
    // Rebuilding with the unstamped disk snapshot must not add it to the
    // history again, while a genuinely new message with identical text is
    // still recorded. A journal rebuild that has to stamp the snapshot
    // rewrites it inside one committed replace transaction, so the resolved
    // (replayed) history is what shows whether a duplicate exists.
    await resumed.history.replaceAll([replayed.history[0]]);
    resumed.history.add(textContent('unstamped disk snapshot'));
    await resumed.integration.flushAtTurnBoundary();

    const replay = { history: await journalRows(sessionPath ?? '') };
    expect(textsOf(replay.history)).toStrictEqual([
      'unstamped disk snapshot',
      'unstamped disk snapshot',
    ]);
  } finally {
    await closeResumedSession(resumed);
  }
}
