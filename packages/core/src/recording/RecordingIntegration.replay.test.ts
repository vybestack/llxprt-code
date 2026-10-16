/**
 * Copyright 2025 Vybestack LLC
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
 * @plan PLAN-20260211-SESSIONRECORDING.P13
 * @requirement REQ-INT-001, REQ-INT-002, REQ-INT-003, REQ-INT-004, REQ-INT-005, REQ-INT-006, REQ-INT-007
 *
 * Behavioral TDD tests for RecordingIntegration.
 *
 * Testing strategy:
 * - Real HistoryService instance
 * - Real SessionRecordingService writing JSONL files in temp directories
 * - Real ReplayEngine for round-trip validation
 * - No spy/mock verification patterns
 *
 * These tests are expected to fail against the Phase 12 stub implementation.
 */

import {
  assertDefined,
  assertNotNull,
} from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { EventEmitter } from 'node:events';

import { HistoryService } from '../services/history/HistoryService.js';
import { type IContent } from '../services/history/IContent.js';
import { LocalMediaStore } from '../storage/local-media-store.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { replaySession } from './ReplayEngine.js';
import {
  type SessionRecordingServiceConfig,
  type ReplayResult,
} from './types.js';

const PROJECT_HASH = 'project-hash-recording-integration';

type ReplayOkResult = Extract<ReplayResult, { ok: true }>;

function assertReplayOk(
  result: ReplayResult,
): asserts result is ReplayOkResult {
  expect(result.ok).toBe(true);
}

interface JsonlEvent {
  v: number;
  seq: number;
  ts: string;
  type: string;
  payload: unknown;
}

function makeConfig(
  chatsDir: string,
  overrides: Partial<SessionRecordingServiceConfig> = {},
): SessionRecordingServiceConfig {
  return {
    sessionId: overrides.sessionId ?? 'recording-int-session-0001',
    projectHash: overrides.projectHash ?? PROJECT_HASH,
    chatsDir,
    workspaceDirs: overrides.workspaceDirs ?? ['/workspace/project-a'],
    provider: overrides.provider ?? 'anthropic',
    model: overrides.model ?? 'claude-4',
  };
}

function textContent(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
  };
}

function historyEmitter(historyService: HistoryService): EventEmitter {
  return historyService;
}

async function readRecordedEvents(
  recordingService: SessionRecordingService,
): Promise<JsonlEvent[]> {
  const filePath = recordingService.getFilePath();
  if (!filePath) {
    return [];
  }

  const raw = await fs.readFile(filePath, 'utf-8');
  if (raw.trim() === '') {
    return [];
  }

  return raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as JsonlEvent);
}
interface FreshHarness {
  tempDir: string;
  chatsDir: string;
  recordingService: SessionRecordingService;
  integration: RecordingIntegration;
  historyService: HistoryService;
  emitter: EventEmitter;
}

async function withFreshHarness(
  run: (harness: FreshHarness) => Promise<void>,
): Promise<void> {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'recording-int-test-'),
  );
  const chatsDir = path.join(tempDir, 'chats');
  await fs.mkdir(chatsDir, { recursive: true });

  const recordingService = new SessionRecordingService(
    makeConfig(chatsDir, {
      sessionId: `recording-int-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    }),
  );
  const integration = new RecordingIntegration(recordingService);
  const historyService = new HistoryService();
  const emitter = historyEmitter(historyService);

  try {
    await run({
      tempDir,
      chatsDir,
      recordingService,
      integration,
      historyService,
      emitter,
    });
  } finally {
    await integration.dispose();
    await recordingService.dispose();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

let tempDir: string;

let chatsDir: string;

let recordingService: SessionRecordingService;

let integration: RecordingIntegration;

let historyService: HistoryService;

let emitter: EventEmitter;

describe('RecordingIntegration @plan:PLAN-20260211-SESSIONRECORDING.P13', () => {
  beforeEach(beforeEachRecordingReplay);

  afterEach(afterEachRecordingReplay);

  describe('Round-trip replay verification @requirement:REQ-INT-001,REQ-INT-002,REQ-INT-003,REQ-INT-007 @plan:PLAN-20260211-SESSIONRECORDING.P13', () => {
    it('replay returns expected content history length', r01);

    it('preserves legacy inline media while replaying with a media store', r02);

    it(
      'verifies reference media during replay without retaining a replay reservation',
      r03,
    );

    it(
      'replay applies compression semantics (summary + post-compression)',
      r04,
    );

    it('replay stores session_event in sessionEvents and not history', r05);

    it(
      'replay metadata reflects latest provider switch and directories change',
      r06,
    );

    it('replay eventCount equals number of lines in JSONL', r07);

    it('replay lastSeq equals final line seq', r08);
  });

  describe('Edge cases @requirement:REQ-INT-004,REQ-INT-007 @plan:PLAN-20260211-SESSIONRECORDING.P13', () => {
    it('empty session without content leaves no file on disk', r09);

    it('large content is preserved in replay', r10);

    it('rapid content additions do not lose events', r11);

    it('multiple flush boundaries continue appending to the same file', r12);
  });

  describe('Property-based behaviors @requirement:REQ-INT-001,REQ-INT-002,REQ-INT-003,REQ-INT-004,REQ-INT-005,REQ-INT-006,REQ-INT-007 @plan:PLAN-20260211-SESSIONRECORDING.P13', () => {
    it('property: arbitrary content list replays to same length', r13);

    it('property: arbitrary content list preserves emitted order', r14);

    it('property: provider/model delegate updates replay metadata', r15);

    it('property: directories delegate updates replay metadata', r16);

    it('property: session_event delegate preserves count', r17);

    it(
      'property: compression boundary leaves one summary plus post items',
      r18,
    );

    it('property: replay eventCount equals parsed JSONL line count', r19);

    it('property: replay lastSeq equals max seq in file', r20);

    it('property: replacing history routes events to latest history only', r21);

    it('property: dispose drops all post-dispose events', r22);

    it(
      'property: file path remains stable across multiple flush segments',
      r23,
    );

    it('property: large random text survives replay unchanged', r24);

    it('property: compressed itemsCompressed value is preserved', r25);
  });
});

async function r01(): Promise<void> {
  await integration.subscribeToJournal(historyService);
  historyService.add(textContent('user-1'));
  historyService.add(textContent('ai-1', 'ai'));
  await integration.flushAtTurnBoundary();

  const filePath = recordingService.getFilePath();
  expect(filePath).toBeTruthy();

  const replay = await replaySession(filePath!, PROJECT_HASH);
  assertReplayOk(replay);
  expect(replay.history).toHaveLength(2);
}

async function r02(): Promise<void> {
  const mediaStore = new LocalMediaStore({
    rootDirectory: path.join(tempDir, 'media'),
    quotaBytes: 1024,
  });
  const legacyContent: IContent = {
    speaker: 'human',
    blocks: [
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png; charset=utf-8',
        data: 'AQIDBA==',
      },
    ],
  };
  await integration.subscribeToJournal(historyService);
  historyService.add(legacyContent);
  await integration.flushAtTurnBoundary();

  const filePath = recordingService.getFilePath();
  assertNotNull(filePath, 'Expected recording path');
  const replay = await replaySession(filePath, PROJECT_HASH, {
    mediaStore,
  });
  assertReplayOk(replay);
  const content = replay.history.find((_entry, index) => index === 0);
  const block = content?.blocks.find((_entry, index) => index === 0);
  assertDefined(block, 'Expected replayed media block');
  if (block.type !== 'media') throw new Error('Expected replayed media');

  expect(block.encoding).toBe('base64');
  expect(block).toStrictEqual({
    type: 'media',
    encoding: 'base64',
    mimeType: 'image/png; charset=utf-8',
    data: 'AQIDBA==',
  });
}

async function r03(): Promise<void> {
  const mediaStore = new LocalMediaStore({
    rootDirectory: path.join(tempDir, 'reference-media'),
    quotaBytes: 1024,
  });
  const expectedBytes = new Uint8Array([1, 2, 3, 4]);
  const reference = await mediaStore.admit({
    bytes: expectedBytes,
    mimeType: 'image/png',
    semanticMetadata: {},
  });
  await integration.subscribeToJournal(historyService);
  historyService.add({
    speaker: 'human',
    blocks: [reference],
  } satisfies IContent);
  await integration.flushAtTurnBoundary();

  const filePath = recordingService.getFilePath();
  assertNotNull(filePath, 'Expected recording path');
  const replay = await replaySession(filePath, PROJECT_HASH, {
    mediaStore,
  });

  assertReplayOk(replay);
  const replayedContent = replay.history.find((_entry, index) => index === 0);
  const replayedBlock = replayedContent?.blocks.find(
    (_entry, index) => index === 0,
  );
  if (
    replayedBlock === undefined ||
    replayedBlock.type !== 'media' ||
    replayedBlock.encoding !== 'reference'
  ) {
    throw new Error('Expected replayed media reference');
  }
  const replayedBytes = await mediaStore.readVerified(replayedBlock);

  expect(replayedBlock.contentId).toBe(reference.contentId);
  expect(replayedBytes).toStrictEqual(expectedBytes);
  expect(await mediaStore.hasReservations(reference.contentId)).toBe(false);
}

async function r04(): Promise<void> {
  await integration.subscribeToJournal(historyService);
  historyService.add(textContent('old-1'));
  historyService.add(textContent('old-2'));
  historyService.startCompression();
  emitter.emit('contentAdded', textContent('re-added-should-not-record'));
  await historyService.replaceAll([textContent('summary', 'ai')]);
  historyService.endCompression(textContent('summary', 'ai'), 2);
  historyService.add(textContent('new-1'));
  await integration.flushAtTurnBoundary();

  const replay = await replaySession(
    recordingService.getFilePath()!,
    PROJECT_HASH,
  );
  assertReplayOk(replay);
  expect(replay.history).toHaveLength(2);
  expect(
    (replay.history[0].blocks[0] as { type: 'text'; text: string }).text,
  ).toBe('summary');
  expect(
    (replay.history[1].blocks[0] as { type: 'text'; text: string }).text,
  ).toBe('new-1');
}

async function r05(): Promise<void> {
  await integration.subscribeToJournal(historyService);
  integration.recordSessionEvent('info', 'Session resumed');
  historyService.add(textContent('normal-content'));
  await integration.flushAtTurnBoundary();

  const replay = await replaySession(
    recordingService.getFilePath()!,
    PROJECT_HASH,
  );
  assertReplayOk(replay);
  expect(replay.history).toHaveLength(1);
  expect(replay.sessionEvents).toHaveLength(1);
}

async function r06(): Promise<void> {
  await integration.subscribeToJournal(historyService);
  integration.recordProviderSwitch('openai', 'gpt-5');
  integration.recordDirectoriesChanged(['/x', '/y']);
  historyService.add(textContent('materialize'));
  await integration.flushAtTurnBoundary();

  const replay = await replaySession(
    recordingService.getFilePath()!,
    PROJECT_HASH,
  );
  assertReplayOk(replay);
  expect(replay.metadata.provider).toBe('openai');
  expect(replay.metadata.model).toBe('gpt-5');
  expect(replay.metadata.workspaceDirs).toStrictEqual(['/x', '/y']);
}

async function r07(): Promise<void> {
  await integration.subscribeToJournal(historyService);
  historyService.add(textContent('one'));
  historyService.add(textContent('two'));
  await integration.flushAtTurnBoundary();

  const events = await readRecordedEvents(recordingService);
  const replay = await replaySession(
    recordingService.getFilePath()!,
    PROJECT_HASH,
  );
  assertReplayOk(replay);
  expect(replay.eventCount).toBe(events.length);
}

async function r08(): Promise<void> {
  await integration.subscribeToJournal(historyService);
  historyService.add(textContent('a'));
  historyService.add(textContent('b'));
  await integration.flushAtTurnBoundary();

  const events = await readRecordedEvents(recordingService);
  const replay = await replaySession(
    recordingService.getFilePath()!,
    PROJECT_HASH,
  );
  assertReplayOk(replay);
  // At least one content event was recorded, so the last event's seq is
  // the expected final seq.
  expect(replay.lastSeq).toBe(events[events.length - 1].seq);
}

async function r09(): Promise<void> {
  await integration.flushAtTurnBoundary();
  await integration.dispose();
  expect(recordingService.getFilePath()).toBeNull();
}

async function r10(): Promise<void> {
  await integration.subscribeToJournal(historyService);
  const bigText = 'x'.repeat(80_000);
  historyService.add(textContent(bigText));
  await integration.flushAtTurnBoundary();

  const replay = await replaySession(
    recordingService.getFilePath()!,
    PROJECT_HASH,
  );
  assertReplayOk(replay);
  const replayText = (
    replay.history[0].blocks[0] as { type: 'text'; text: string }
  ).text;
  expect(replayText.length).toBe(80_000);
}

async function r11(): Promise<void> {
  await integration.subscribeToJournal(historyService);
  for (let i = 0; i < 50; i++) {
    historyService.add(textContent(`rapid-${i}`));
  }
  await integration.flushAtTurnBoundary();

  const replay = await replaySession(
    recordingService.getFilePath()!,
    PROJECT_HASH,
  );
  assertReplayOk(replay);
  expect(replay.history).toHaveLength(50);
}

async function r12(): Promise<void> {
  await integration.subscribeToJournal(historyService);

  historyService.add(textContent('batch-1'));
  await integration.flushAtTurnBoundary();
  const firstPath = recordingService.getFilePath();

  historyService.add(textContent('batch-2'));
  await integration.flushAtTurnBoundary();
  const secondPath = recordingService.getFilePath();

  expect(firstPath).toBeTruthy();
  expect(secondPath).toBe(firstPath);
}

async function r13(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
        minLength: 1,
        maxLength: 12,
      }),
      async (messages) => {
        await withFreshHarness(async (harness) => {
          await harness.integration.subscribeToJournal(harness.historyService);
          for (const message of messages) {
            harness.historyService.add(textContent(message));
          }
          await harness.integration.flushAtTurnBoundary();
          const replay = await replaySession(
            harness.recordingService.getFilePath()!,
            PROJECT_HASH,
          );
          assertReplayOk(replay);
          expect(replay.history).toHaveLength(messages.length);
        });
      },
    ),
    { numRuns: 8 },
  );
}

async function r14(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.string({ minLength: 1, maxLength: 16 }), {
        minLength: 1,
        maxLength: 10,
      }),
      async (messages) => {
        await withFreshHarness(async (harness) => {
          await harness.integration.subscribeToJournal(harness.historyService);
          for (const message of messages) {
            harness.historyService.add(textContent(message));
          }
          await harness.integration.flushAtTurnBoundary();
          const replay = await replaySession(
            harness.recordingService.getFilePath()!,
            PROJECT_HASH,
          );
          assertReplayOk(replay);
          const replayed = replay.history.map(
            (content) =>
              (content.blocks[0] as { type: 'text'; text: string }).text,
          );
          expect(replayed).toStrictEqual(messages);
        });
      },
    ),
    { numRuns: 8 },
  );
}

async function r15(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.stringMatching(/^[a-z][a-z0-9_-]{2,12}$/),
      fc.stringMatching(/^[a-z][a-z0-9._-]{2,18}$/),
      async (provider, model) => {
        await withFreshHarness(async (harness) => {
          await harness.integration.subscribeToJournal(harness.historyService);
          harness.integration.recordProviderSwitch(provider, model);
          harness.historyService.add(textContent('materialize'));
          await harness.integration.flushAtTurnBoundary();

          const replay = await replaySession(
            harness.recordingService.getFilePath()!,
            PROJECT_HASH,
          );
          assertReplayOk(replay);
          expect(replay.metadata.provider).toBe(provider);
          expect(replay.metadata.model).toBe(model);
        });
      },
    ),
    { numRuns: 8 },
  );
}

async function r16(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.stringMatching(/^\/[a-z]{1,6}$/), {
        minLength: 1,
        maxLength: 5,
      }),
      async (directories) => {
        await withFreshHarness(async (harness) => {
          await harness.integration.subscribeToJournal(harness.historyService);
          harness.integration.recordDirectoriesChanged(directories);
          harness.historyService.add(textContent('materialize'));
          await harness.integration.flushAtTurnBoundary();

          const replay = await replaySession(
            harness.recordingService.getFilePath()!,
            PROJECT_HASH,
          );
          assertReplayOk(replay);
          expect(replay.metadata.workspaceDirs).toStrictEqual(directories);
        });
      },
    ),
    { numRuns: 8 },
  );
}

async function r17(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.string({ minLength: 1, maxLength: 30 }), {
        minLength: 1,
        maxLength: 6,
      }),
      async (messages) => {
        await withFreshHarness(async (harness) => {
          await harness.integration.subscribeToJournal(harness.historyService);
          for (const message of messages) {
            harness.integration.recordSessionEvent('info', message);
          }
          harness.historyService.add(textContent('materialize'));
          await harness.integration.flushAtTurnBoundary();

          const replay = await replaySession(
            harness.recordingService.getFilePath()!,
            PROJECT_HASH,
          );
          assertReplayOk(replay);
          expect(replay.sessionEvents).toHaveLength(messages.length);
        });
      },
    ),
    { numRuns: 8 },
  );
}

async function r18(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.string({ minLength: 1, maxLength: 12 }), {
        minLength: 1,
        maxLength: 8,
      }),
      fc.array(fc.string({ minLength: 1, maxLength: 12 }), {
        minLength: 0,
        maxLength: 8,
      }),
      async (preMessages, postMessages) => {
        await withFreshHarness(async (harness) => {
          await harness.integration.subscribeToJournal(harness.historyService);

          for (const message of preMessages) {
            harness.historyService.add(textContent(message));
          }

          harness.historyService.startCompression();
          for (const message of preMessages) {
            harness.historyService.emit(
              'contentAdded',
              textContent(`readd-${message}`),
            );
          }
          await harness.historyService.replaceAll([
            textContent('summary', 'ai'),
          ]);
          harness.historyService.endCompression(
            textContent('summary', 'ai'),
            preMessages.length,
          );

          for (const message of postMessages) {
            harness.historyService.add(textContent(message));
          }

          await harness.integration.flushAtTurnBoundary();
          const replay = await replaySession(
            harness.recordingService.getFilePath()!,
            PROJECT_HASH,
          );
          assertReplayOk(replay);
          expect(replay.history).toHaveLength(1 + postMessages.length);
        });
      },
    ),
    { numRuns: 8 },
  );
}

async function r19(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.string({ minLength: 1, maxLength: 16 }), {
        minLength: 1,
        maxLength: 10,
      }),
      async (messages) => {
        await withFreshHarness(async (harness) => {
          await harness.integration.subscribeToJournal(harness.historyService);
          for (const message of messages) {
            harness.historyService.add(textContent(message));
          }
          await harness.integration.flushAtTurnBoundary();

          const events = await readRecordedEvents(harness.recordingService);
          const replay = await replaySession(
            harness.recordingService.getFilePath()!,
            PROJECT_HASH,
          );
          assertReplayOk(replay);
          expect(replay.eventCount).toBe(events.length);
        });
      },
    ),
    { numRuns: 8 },
  );
}

async function r20(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.string({ minLength: 1, maxLength: 16 }), {
        minLength: 1,
        maxLength: 10,
      }),
      async (messages) => {
        await withFreshHarness(async (harness) => {
          await harness.integration.subscribeToJournal(harness.historyService);
          for (const message of messages) {
            harness.historyService.add(textContent(message));
          }
          await harness.integration.flushAtTurnBoundary();

          const events = await readRecordedEvents(harness.recordingService);
          const maxSeq = Math.max(...events.map((event) => event.seq));
          const replay = await replaySession(
            harness.recordingService.getFilePath()!,
            PROJECT_HASH,
          );
          assertReplayOk(replay);
          expect(replay.lastSeq).toBe(maxSeq);
        });
      },
    ),
    { numRuns: 8 },
  );
}

async function r21(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.string({ minLength: 1, maxLength: 12 }), {
        minLength: 1,
        maxLength: 8,
      }),
      async (messages) => {
        await withFreshHarness(async (harness) => {
          const secondHistory = new HistoryService();

          await harness.integration.subscribeToJournal(harness.historyService);
          await harness.integration.subscribeToJournal(secondHistory);

          for (const message of messages) {
            harness.historyService.add(textContent(`old-${message}`));
            secondHistory.add(textContent(`new-${message}`));
          }

          await harness.integration.flushAtTurnBoundary();
          const replay = await replaySession(
            harness.recordingService.getFilePath()!,
            PROJECT_HASH,
          );
          assertReplayOk(replay);
          const texts = replay.history.map(
            (content) =>
              (content.blocks[0] as { type: 'text'; text: string }).text,
          );
          expect(texts.every((text) => text.startsWith('new-'))).toBe(true);
        });
      },
    ),
    { numRuns: 8 },
  );
}

async function r22(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.string({ minLength: 1, maxLength: 12 }), {
        minLength: 1,
        maxLength: 8,
      }),
      fc.array(fc.string({ minLength: 1, maxLength: 12 }), {
        minLength: 1,
        maxLength: 8,
      }),
      async (beforeDispose, afterDispose) => {
        await withFreshHarness(async (harness) => {
          await harness.integration.subscribeToJournal(harness.historyService);
          for (const message of beforeDispose) {
            harness.historyService.add(textContent(message));
          }
          await harness.integration.flushAtTurnBoundary();

          await harness.integration.dispose();
          for (const message of afterDispose) {
            harness.historyService.add(textContent(message));
          }

          const replay = await replaySession(
            harness.recordingService.getFilePath()!,
            PROJECT_HASH,
          );
          assertReplayOk(replay);
          expect(replay.history).toHaveLength(beforeDispose.length);
        });
      },
    ),
    { numRuns: 8 },
  );
}

async function r23(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.string({ minLength: 1, maxLength: 10 }), {
        minLength: 1,
        maxLength: 6,
      }),
      fc.array(fc.string({ minLength: 1, maxLength: 10 }), {
        minLength: 1,
        maxLength: 6,
      }),
      async (firstBatch, secondBatch) => {
        await withFreshHarness(async (harness) => {
          await harness.integration.subscribeToJournal(harness.historyService);

          for (const message of firstBatch) {
            harness.historyService.add(textContent(`first-${message}`));
          }
          await harness.integration.flushAtTurnBoundary();
          const firstPath = harness.recordingService.getFilePath();

          for (const message of secondBatch) {
            harness.historyService.add(textContent(`second-${message}`));
          }
          await harness.integration.flushAtTurnBoundary();
          const secondPath = harness.recordingService.getFilePath();

          expect(firstPath).toBeTruthy();
          expect(secondPath).toBe(firstPath);
        });
      },
    ),
    { numRuns: 8 },
  );
}

async function r24(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1000, maxLength: 5000 }),
      async (text) => {
        await withFreshHarness(async (harness) => {
          await harness.integration.subscribeToJournal(harness.historyService);
          harness.historyService.add(textContent(text));
          await harness.integration.flushAtTurnBoundary();

          const replay = await replaySession(
            harness.recordingService.getFilePath()!,
            PROJECT_HASH,
          );
          assertReplayOk(replay);
          const replayed = (
            replay.history[0].blocks[0] as { type: 'text'; text: string }
          ).text;
          expect(replayed).toBe(text);
        });
      },
    ),
    { numRuns: 6 },
  );
}

async function r25(): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 500 }),
      fc.string({ minLength: 1, maxLength: 24 }),
      async (itemsCompressed, summaryText) => {
        await withFreshHarness(async (harness) => {
          await harness.integration.subscribeToJournal(harness.historyService);

          for (let index = 0; index < itemsCompressed; index += 1) {
            harness.historyService.add(textContent(`baseline-${index}`));
          }
          harness.historyService.startCompression();
          await harness.historyService.replaceAll([
            textContent(summaryText, 'ai'),
          ]);
          harness.historyService.endCompression(
            textContent(summaryText, 'ai'),
            itemsCompressed,
          );
          harness.historyService.add(textContent('post-compression-item'));

          await harness.integration.flushAtTurnBoundary();

          const events = await readRecordedEvents(harness.recordingService);
          const compressedEvent = events.find(
            (event) => event.type === 'compressed',
          );
          expect(compressedEvent).toBeDefined();
          const payload = compressedEvent?.payload as {
            summary: IContent;
            itemsCompressed: number;
          };
          expect(payload.itemsCompressed).toBe(itemsCompressed);
        });
      },
    ),
    { numRuns: 8 },
  );
}

async function beforeEachRecordingReplay(): Promise<void> {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recording-int-test-'));
  chatsDir = path.join(tempDir, 'chats');
  await fs.mkdir(chatsDir, { recursive: true });

  recordingService = new SessionRecordingService(makeConfig(chatsDir));
  integration = new RecordingIntegration(recordingService);
  historyService = new HistoryService();
  emitter = historyEmitter(historyService);
}

async function afterEachRecordingReplay(): Promise<void> {
  await integration.dispose();
  await recordingService.dispose();
  await fs.rm(tempDir, { recursive: true, force: true });
}
