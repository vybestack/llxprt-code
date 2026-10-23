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
 * - Real journal recorders writing native files in temp directories
 * - Fresh native journal reads for round-trip validation
 * - No spy/mock verification patterns
 *
 * These tests are expected to fail against the Phase 12 stub implementation.
 */

import {
  assertDefined,
  assertNotNull,
} from '@vybestack/llxprt-code-test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import type { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { HistoryService } from '../services/history/HistoryService.js';
import { type IContent } from '../services/history/IContent.js';
import { LocalMediaStore } from '../storage/local-media-store.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { readJournalSnapshot } from './__tests__/support/journalSnapshot.js';
import { JournalRecordingService } from './journalRecordingService.js';
import type { SessionRecordingServiceConfig } from './types.js';

function textOf(content: IContent): string {
  return content.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

const extraHistories: HistoryService[] = [];

const PROJECT_HASH = 'project-hash-recording-integration';

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

interface FreshHarness {
  tempDir: string;
  chatsDir: string;
  recordingService: JournalRecordingService;
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

  const recordingService = JournalRecordingService.create(
    makeConfig(chatsDir, {
      sessionId: `recording-int-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    }),
  );
  const integration = new RecordingIntegration(recordingService);
  const historyService = new HistoryService({});
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
    await historyService.dispose();
    await recordingService.dispose();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

let tempDir: string;

let chatsDir: string;

let recordingService: JournalRecordingService;

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

    it(
      'replay metadata reflects latest provider switch and directories change',
      r06,
    );
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

    it(
      'property: compression boundary leaves one summary plus post items',
      r18,
    );

    it('property: replacing history routes events to latest history only', r21);

    it('property: dispose drops all post-dispose events', r22);

    it(
      'property: file path remains stable across multiple flush segments',
      r23,
    );

    it('property: large random text survives replay unchanged', r24);
  });
});

async function r01(): Promise<void> {
  await integration.subscribeToJournal(historyService);
  historyService.add(textContent('user-1'));
  historyService.add(textContent('ai-1', 'ai'));
  await integration.flushAtTurnBoundary();

  const filePath = recordingService.getFilePath();
  expect(filePath).toBeTruthy();

  const replay = await readJournalSnapshot(filePath!, PROJECT_HASH);
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
  const replay = await readJournalSnapshot(filePath, PROJECT_HASH);
  const content = replay.history.find((_entry, index) => index === 0);
  const block = content?.blocks.find((_entry, index) => index === 0);
  assertDefined(block, 'Expected replayed media block');
  if (block.type !== 'media') throw new Error('Expected replayed media');

  await mediaStore.close();
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
  const replay = await readJournalSnapshot(filePath, PROJECT_HASH);

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
  await mediaStore.close();
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

  const replay = await readJournalSnapshot(
    recordingService.getFilePath()!,
    PROJECT_HASH,
  );
  expect(replay.history).toHaveLength(2);
  expect(textOf(replay.history[0])).toBe('summary');
  expect(textOf(replay.history[1])).toBe('new-1');
}

async function r06(): Promise<void> {
  await integration.subscribeToJournal(historyService);
  integration.recordProviderSwitch('openai', 'gpt-5');
  integration.recordDirectoriesChanged(['/x', '/y']);
  historyService.add(textContent('materialize'));
  await integration.flushAtTurnBoundary();

  const replay = await readJournalSnapshot(
    recordingService.getFilePath()!,
    PROJECT_HASH,
  );
  expect(replay.metadata.provider).toBe('openai');
  expect(replay.metadata.model).toBe('gpt-5');
  expect(replay.metadata.workspaceDirs).toStrictEqual(['/x', '/y']);
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

  const replay = await readJournalSnapshot(
    recordingService.getFilePath()!,
    PROJECT_HASH,
  );
  const replayText = textOf(replay.history[0]);
  expect(replayText.length).toBe(80_000);
}

async function r11(): Promise<void> {
  await integration.subscribeToJournal(historyService);
  for (let i = 0; i < 50; i++) {
    historyService.add(textContent(`rapid-${i}`));
  }
  await integration.flushAtTurnBoundary();

  const replay = await readJournalSnapshot(
    recordingService.getFilePath()!,
    PROJECT_HASH,
  );
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
          const replay = await readJournalSnapshot(
            harness.recordingService.getFilePath()!,
            PROJECT_HASH,
          );
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
          const replay = await readJournalSnapshot(
            harness.recordingService.getFilePath()!,
            PROJECT_HASH,
          );
          const replayed = replay.history.map((content) => textOf(content));
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

          const replay = await readJournalSnapshot(
            harness.recordingService.getFilePath()!,
            PROJECT_HASH,
          );
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

          const replay = await readJournalSnapshot(
            harness.recordingService.getFilePath()!,
            PROJECT_HASH,
          );
          expect(replay.metadata.workspaceDirs).toStrictEqual(directories);
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
          const replay = await readJournalSnapshot(
            harness.recordingService.getFilePath()!,
            PROJECT_HASH,
          );
          expect(replay.history.map(textOf)).toStrictEqual([
            'summary',
            ...postMessages,
          ]);
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
          const secondHistory = new HistoryService({});
          extraHistories.push(secondHistory);

          await harness.integration.subscribeToJournal(harness.historyService);
          await harness.integration.subscribeToJournal(secondHistory);

          for (const message of messages) {
            harness.historyService.add(textContent(`old-${message}`));
            secondHistory.add(textContent(`new-${message}`));
          }

          await harness.integration.flushAtTurnBoundary();
          const replay = await readJournalSnapshot(
            harness.recordingService.getFilePath()!,
            PROJECT_HASH,
          );
          const texts = replay.history.map((content) => textOf(content));
          expect(texts).toStrictEqual(
            messages.map((message) => `new-${message}`),
          );
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

          const replay = await readJournalSnapshot(
            harness.recordingService.getFilePath()!,
            PROJECT_HASH,
          );
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

          const replay = await readJournalSnapshot(
            harness.recordingService.getFilePath()!,
            PROJECT_HASH,
          );
          const replayed = textOf(replay.history[0]);
          expect(replayed).toBe(text);
        });
      },
    ),
    { numRuns: 6 },
  );
}

async function beforeEachRecordingReplay(): Promise<void> {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recording-int-test-'));
  chatsDir = path.join(tempDir, 'chats');
  await fs.mkdir(chatsDir, { recursive: true });

  recordingService = JournalRecordingService.create(makeConfig(chatsDir));
  integration = new RecordingIntegration(recordingService);
  historyService = new HistoryService({});
  emitter = historyEmitter(historyService);
}

async function afterEachRecordingReplay(): Promise<void> {
  await integration.dispose();
  await historyService.dispose();
  for (const item of extraHistories.splice(0)) await item.dispose();
  await recordingService.dispose();
  await fs.rm(tempDir, { recursive: true, force: true });
}
