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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { EventEmitter } from 'node:events';

import { HistoryService } from '../services/history/HistoryService.js';
import { type IContent } from '../services/history/IContent.js';
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
    integration.dispose();
    await recordingService.dispose();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

describe('RecordingIntegration @plan:PLAN-20260211-SESSIONRECORDING.P13', () => {
  let tempDir: string;
  let chatsDir: string;
  let recordingService: SessionRecordingService;
  let integration: RecordingIntegration;
  let historyService: HistoryService;
  let emitter: EventEmitter;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recording-int-test-'));
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    recordingService = new SessionRecordingService(makeConfig(chatsDir));
    integration = new RecordingIntegration(recordingService);
    historyService = new HistoryService();
    emitter = historyEmitter(historyService);
  });

  afterEach(async () => {
    integration.dispose();
    await recordingService.dispose();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Round-trip replay verification @requirement:REQ-INT-001,REQ-INT-002,REQ-INT-003,REQ-INT-007 @plan:PLAN-20260211-SESSIONRECORDING.P13', () => {
    it('replay returns expected content history length', async () => {
      integration.subscribeToHistory(historyService);
      emitter.emit('contentAdded', textContent('user-1'));
      emitter.emit('contentAdded', textContent('ai-1', 'ai'));
      await integration.flushAtTurnBoundary();

      const filePath = recordingService.getFilePath();
      expect(filePath).toBeTruthy();

      const replay = await replaySession(filePath!, PROJECT_HASH);
      assertReplayOk(replay);
      expect(replay.history).toHaveLength(2);
    });

    it('replay applies compression semantics (summary + post-compression)', async () => {
      integration.subscribeToHistory(historyService);
      emitter.emit('contentAdded', textContent('old-1'));
      emitter.emit('contentAdded', textContent('old-2'));
      emitter.emit('compressionStarted');
      emitter.emit('contentAdded', textContent('re-added-should-not-record'));
      emitter.emit('compressionEnded', textContent('summary', 'ai'), 2);
      emitter.emit('contentAdded', textContent('new-1'));
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
    });

    it('replay stores session_event in sessionEvents and not history', async () => {
      integration.subscribeToHistory(historyService);
      integration.recordSessionEvent('info', 'Session resumed');
      emitter.emit('contentAdded', textContent('normal-content'));
      await integration.flushAtTurnBoundary();

      const replay = await replaySession(
        recordingService.getFilePath()!,
        PROJECT_HASH,
      );
      assertReplayOk(replay);
      expect(replay.history).toHaveLength(1);
      expect(replay.sessionEvents).toHaveLength(1);
    });

    it('replay metadata reflects latest provider switch and directories change', async () => {
      integration.subscribeToHistory(historyService);
      integration.recordProviderSwitch('openai', 'gpt-5');
      integration.recordDirectoriesChanged(['/x', '/y']);
      emitter.emit('contentAdded', textContent('materialize'));
      await integration.flushAtTurnBoundary();

      const replay = await replaySession(
        recordingService.getFilePath()!,
        PROJECT_HASH,
      );
      assertReplayOk(replay);
      expect(replay.metadata.provider).toBe('openai');
      expect(replay.metadata.model).toBe('gpt-5');
      expect(replay.metadata.workspaceDirs).toStrictEqual(['/x', '/y']);
    });

    it('replay eventCount equals number of lines in JSONL', async () => {
      integration.subscribeToHistory(historyService);
      emitter.emit('contentAdded', textContent('one'));
      emitter.emit('contentAdded', textContent('two'));
      await integration.flushAtTurnBoundary();

      const events = await readRecordedEvents(recordingService);
      const replay = await replaySession(
        recordingService.getFilePath()!,
        PROJECT_HASH,
      );
      assertReplayOk(replay);
      expect(replay.eventCount).toBe(events.length);
    });

    it('replay lastSeq equals final line seq', async () => {
      integration.subscribeToHistory(historyService);
      emitter.emit('contentAdded', textContent('a'));
      emitter.emit('contentAdded', textContent('b'));
      await integration.flushAtTurnBoundary();

      const events = await readRecordedEvents(recordingService);
      const replay = await replaySession(
        recordingService.getFilePath()!,
        PROJECT_HASH,
      );
      assertReplayOk(replay);
      const lastSeq = events[events.length - 1]?.seq ?? 0;
      expect(replay.lastSeq).toBe(lastSeq);
    });
  });

  describe('Edge cases @requirement:REQ-INT-004,REQ-INT-007 @plan:PLAN-20260211-SESSIONRECORDING.P13', () => {
    it('empty session without content leaves no file on disk', async () => {
      await integration.flushAtTurnBoundary();
      integration.dispose();
      expect(recordingService.getFilePath()).toBeNull();
    });

    it('large content is preserved in replay', async () => {
      integration.subscribeToHistory(historyService);
      const bigText = 'x'.repeat(80_000);
      emitter.emit('contentAdded', textContent(bigText));
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
    });

    it('rapid content additions do not lose events', async () => {
      integration.subscribeToHistory(historyService);
      for (let i = 0; i < 50; i++) {
        emitter.emit('contentAdded', textContent(`rapid-${i}`));
      }
      await integration.flushAtTurnBoundary();

      const replay = await replaySession(
        recordingService.getFilePath()!,
        PROJECT_HASH,
      );
      assertReplayOk(replay);
      expect(replay.history).toHaveLength(50);
    });

    it('multiple flush boundaries continue appending to the same file', async () => {
      integration.subscribeToHistory(historyService);

      emitter.emit('contentAdded', textContent('batch-1'));
      await integration.flushAtTurnBoundary();
      const firstPath = recordingService.getFilePath();

      emitter.emit('contentAdded', textContent('batch-2'));
      await integration.flushAtTurnBoundary();
      const secondPath = recordingService.getFilePath();

      expect(firstPath).toBeTruthy();
      expect(secondPath).toBe(firstPath);
    });
  });

  describe('Property-based behaviors @requirement:REQ-INT-001,REQ-INT-002,REQ-INT-003,REQ-INT-004,REQ-INT-005,REQ-INT-006,REQ-INT-007 @plan:PLAN-20260211-SESSIONRECORDING.P13', () => {
    it('property: arbitrary content list replays to same length', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
            minLength: 1,
            maxLength: 12,
          }),
          async (messages) => {
            await withFreshHarness(async (harness) => {
              harness.integration.subscribeToHistory(harness.historyService);
              for (const message of messages) {
                harness.emitter.emit('contentAdded', textContent(message));
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
    });

    it('property: arbitrary content list preserves emitted order', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1, maxLength: 16 }), {
            minLength: 1,
            maxLength: 10,
          }),
          async (messages) => {
            await withFreshHarness(async (harness) => {
              harness.integration.subscribeToHistory(harness.historyService);
              for (const message of messages) {
                harness.emitter.emit('contentAdded', textContent(message));
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
    });

    it('property: provider/model delegate updates replay metadata', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.stringMatching(/^[a-z][a-z0-9_-]{2,12}$/),
          fc.stringMatching(/^[a-z][a-z0-9._-]{2,18}$/),
          async (provider, model) => {
            await withFreshHarness(async (harness) => {
              harness.integration.subscribeToHistory(harness.historyService);
              harness.integration.recordProviderSwitch(provider, model);
              harness.emitter.emit('contentAdded', textContent('materialize'));
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
    });

    it('property: directories delegate updates replay metadata', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.stringMatching(/^\/[a-z]{1,6}$/), {
            minLength: 1,
            maxLength: 5,
          }),
          async (directories) => {
            await withFreshHarness(async (harness) => {
              harness.integration.subscribeToHistory(harness.historyService);
              harness.integration.recordDirectoriesChanged(directories);
              harness.emitter.emit('contentAdded', textContent('materialize'));
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
    });

    it('property: session_event delegate preserves count', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1, maxLength: 30 }), {
            minLength: 1,
            maxLength: 6,
          }),
          async (messages) => {
            await withFreshHarness(async (harness) => {
              harness.integration.subscribeToHistory(harness.historyService);
              for (const message of messages) {
                harness.integration.recordSessionEvent('info', message);
              }
              harness.emitter.emit('contentAdded', textContent('materialize'));
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
    });

    it('property: compression boundary leaves one summary plus post items', async () => {
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
              harness.integration.subscribeToHistory(harness.historyService);

              for (const message of preMessages) {
                harness.emitter.emit('contentAdded', textContent(message));
              }

              harness.emitter.emit('compressionStarted');
              for (const message of preMessages) {
                harness.emitter.emit(
                  'contentAdded',
                  textContent(`readd-${message}`),
                );
              }
              harness.emitter.emit(
                'compressionEnded',
                textContent('summary', 'ai'),
                preMessages.length,
              );

              for (const message of postMessages) {
                harness.emitter.emit('contentAdded', textContent(message));
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
    });

    it('property: replay eventCount equals parsed JSONL line count', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1, maxLength: 16 }), {
            minLength: 1,
            maxLength: 10,
          }),
          async (messages) => {
            await withFreshHarness(async (harness) => {
              harness.integration.subscribeToHistory(harness.historyService);
              for (const message of messages) {
                harness.emitter.emit('contentAdded', textContent(message));
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
    });

    it('property: replay lastSeq equals max seq in file', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1, maxLength: 16 }), {
            minLength: 1,
            maxLength: 10,
          }),
          async (messages) => {
            await withFreshHarness(async (harness) => {
              harness.integration.subscribeToHistory(harness.historyService);
              for (const message of messages) {
                harness.emitter.emit('contentAdded', textContent(message));
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
    });

    it('property: replacing history routes events to latest history only', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1, maxLength: 12 }), {
            minLength: 1,
            maxLength: 8,
          }),
          async (messages) => {
            await withFreshHarness(async (harness) => {
              const secondHistory = new HistoryService();
              const secondEmitter = historyEmitter(secondHistory);

              harness.integration.subscribeToHistory(harness.historyService);
              harness.integration.onHistoryServiceReplaced(secondHistory);

              for (const message of messages) {
                harness.emitter.emit(
                  'contentAdded',
                  textContent(`old-${message}`),
                );
                secondEmitter.emit(
                  'contentAdded',
                  textContent(`new-${message}`),
                );
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
    });

    it('property: dispose drops all post-dispose events', async () => {
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
              harness.integration.subscribeToHistory(harness.historyService);
              for (const message of beforeDispose) {
                harness.emitter.emit('contentAdded', textContent(message));
              }
              await harness.integration.flushAtTurnBoundary();

              harness.integration.dispose();
              for (const message of afterDispose) {
                harness.emitter.emit('contentAdded', textContent(message));
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
    });

    it('property: file path remains stable across multiple flush segments', async () => {
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
              harness.integration.subscribeToHistory(harness.historyService);

              for (const message of firstBatch) {
                harness.emitter.emit(
                  'contentAdded',
                  textContent(`first-${message}`),
                );
              }
              await harness.integration.flushAtTurnBoundary();
              const firstPath = harness.recordingService.getFilePath();

              for (const message of secondBatch) {
                harness.emitter.emit(
                  'contentAdded',
                  textContent(`second-${message}`),
                );
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
    });

    it('property: large random text survives replay unchanged', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1000, maxLength: 5000 }),
          async (text) => {
            await withFreshHarness(async (harness) => {
              harness.integration.subscribeToHistory(harness.historyService);
              harness.emitter.emit('contentAdded', textContent(text));
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
    });

    it('property: compressed itemsCompressed value is preserved', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 500 }),
          fc.string({ minLength: 1, maxLength: 24 }),
          async (itemsCompressed, summaryText) => {
            await withFreshHarness(async (harness) => {
              harness.integration.subscribeToHistory(harness.historyService);

              harness.emitter.emit(
                'contentAdded',
                textContent('baseline-materialize'),
              );
              harness.emitter.emit('compressionStarted');
              harness.emitter.emit(
                'compressionEnded',
                textContent(summaryText, 'ai'),
                itemsCompressed,
              );
              harness.emitter.emit(
                'contentAdded',
                textContent('post-compression-item'),
              );

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
    });
  });
});
