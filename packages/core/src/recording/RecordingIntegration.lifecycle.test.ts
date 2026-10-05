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

import { collectRowsForAssertions } from '../test-utils/collect-rows-for-assertions.js';
import {
  assertDefined,
  blockTextOrEmpty,
} from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { HistoryService } from '../services/history/HistoryService.js';
import { type IContent } from '../services/history/IContent.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { withRecordingFailureReport } from './recording-failure-consumer.js';
import { replaySession } from './ReplayEngine.js';
import { assertReplayOk } from './replay-test-helpers.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { type SessionRecordingServiceConfig } from './types.js';
import { SessionPersistenceService } from '../storage/SessionPersistenceService.js';
import { Storage } from '@vybestack/llxprt-code-settings';

interface ControlledSave {
  readonly file: string;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

function textFromUnknownBlock(block: unknown): string {
  if (typeof block !== 'object' || block === null) return '';
  if (!('type' in block) || block.type !== 'text') return '';
  if (!('text' in block) || typeof block.text !== 'string') return '';
  return block.text;
}

class ControlledPersistenceService extends SessionPersistenceService {
  private readonly controlledSaves: ControlledSave[] = [];

  private readonly ready = new Map<number, () => void>();

  override saveJournal(file: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const index = this.controlledSaves.length;
      this.controlledSaves.push({ file, resolve, reject });
      this.ready.get(index)?.();
    });
  }

  async waitForSave(index: number): Promise<ControlledSave> {
    if (this.controlledSaves.length <= index) {
      await new Promise<void>((resolve) => this.ready.set(index, resolve));
    }
    return this.getSave(index);
  }

  getSave(index: number): ControlledSave {
    const save = this.controlledSaves.find(
      (_candidate, candidateIndex) => candidateIndex === index,
    );
    assertDefined(
      save,
      `Persistence generation ${index + 1} was not scheduled`,
    );
    return save;
  }

  get pendingSaves(): number {
    return this.controlledSaves.length;
  }
}

function errorMessages(error: unknown): string[] {
  if (error instanceof AggregateError) {
    return [error.message, ...error.errors.flatMap(errorMessages)];
  }
  if (error instanceof Error) {
    return [
      error.message,
      ...(error.cause === undefined ? [] : errorMessages(error.cause)),
    ];
  }
  return [String(error)];
}

async function captureFailure(operation: Promise<void>): Promise<unknown> {
  try {
    await withRecordingFailureReport(operation, async () => undefined);
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected operation to fail');
}

const PROJECT_HASH = 'project-hash-recording-integration';

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

async function flushAndRead(
  integration: RecordingIntegration,
  recordingService: SessionRecordingService,
): Promise<JsonlEvent[]> {
  await integration.flushAtTurnBoundary();
  return readRecordedEvents(recordingService);
}

let tempDir: string;

let chatsDir: string;

let recordingService: SessionRecordingService;

let integration: RecordingIntegration;

let historyService: HistoryService;

describe('RecordingIntegration lifecycle @plan:PLAN-20260211-SESSIONRECORDING.P13', () => {
  beforeEach(beforeEachRecordingLifecycle);

  afterEach(afterEachRecordingLifecycle);

  describe('Delegate methods @requirement:REQ-INT-003 @plan:PLAN-20260211-SESSIONRECORDING.P13', () => {
    it(
      'recordProviderSwitch delegates to SessionRecordingService',
      testRecordingLifecycle01,
    );

    it(
      'recordDirectoriesChanged delegates to SessionRecordingService',
      testRecordingLifecycle02,
    );

    it(
      'recordSessionEvent delegates to SessionRecordingService',
      testRecordingLifecycle03,
    );
  });

  describe('Flush / dispose / replacement behavior @requirement:REQ-INT-004,REQ-INT-005,REQ-INT-006 @plan:PLAN-20260211-SESSIONRECORDING.P13', () => {
    it('flushAtTurnBoundary persists pending events', testRecordingLifecycle04);

    it(
      'flushAtTurnBoundary with no activity does not create file',
      testRecordingLifecycle05,
    );

    it(
      'flushes the latest history generation after rapid recording events',
      testRecordingLifecycle06,
    );

    it(
      'publishes a complete history batch to recording and persistence in order',
      testRecordingLifecycle07,
    );

    it(
      'rolls back recording and persistence when batch publication listener fails',
      testRecordingLifecycle08,
    );

    it(
      'propagates a pending persistence failure after flushing recording data',
      testRecordingLifecycle09,
    );

    it(
      'captures a synchronous persistence scheduling failure without interrupting recording',
      testRecordingLifecycle10,
    );

    it(
      'surfaces each failed generation once and allows a repaired later generation to flush',
      testRecordingLifecycle11,
    );

    it(
      'does not attribute a newer failed generation to an older boundary or clear it',
      testRecordingLifecycle12,
    );

    it(
      'waits for and surfaces queued persistence failure while disabling integration',
      testRecordingLifecycle13,
    );

    it(
      'dispose prevents future event recording while keeping prior events',
      testRecordingLifecycle14,
    );

    it('dispose is idempotent', testRecordingLifecycle15);

    it(
      'journal attachment switches subscription to the new instance',
      testRecordingLifecycle16,
    );

    it(
      'after replacement, old history events are ignored',
      testRecordingLifecycle17,
    );

    it(
      'replacement with same HistoryService instance is safe',
      testRecordingLifecycle18,
    );
  });
});

async function testRecordingLifecycle01(): Promise<void> {
  await integration.subscribeToJournal(historyService);
  integration.recordProviderSwitch('openai', 'gpt-5');
  historyService.add(textContent('materialize content'));

  const events = await flushAndRead(integration, recordingService);
  expect(events.some((event) => event.type === 'provider_switch')).toBe(true);
}

async function testRecordingLifecycle02(): Promise<void> {
  await integration.subscribeToJournal(historyService);
  integration.recordDirectoriesChanged(['/a', '/b', '/c']);
  historyService.add(textContent('materialize content'));

  const events = await flushAndRead(integration, recordingService);
  expect(events.some((event) => event.type === 'directories_changed')).toBe(
    true,
  );
}

async function testRecordingLifecycle03(): Promise<void> {
  await integration.subscribeToJournal(historyService);
  integration.recordSessionEvent('warning', 'Disk pressure');
  historyService.add(textContent('materialize content'));

  const events = await flushAndRead(integration, recordingService);
  expect(events.some((event) => event.type === 'session_event')).toBe(true);
}

async function testRecordingLifecycle04(): Promise<void> {
  await integration.subscribeToJournal(historyService);
  historyService.add(textContent('flush-boundary'));

  const events = await flushAndRead(integration, recordingService);
  expect(events.filter((event) => event.type === 'content')).toHaveLength(1);
}

async function testRecordingLifecycle05(): Promise<void> {
  await integration.flushAtTurnBoundary();
  expect(recordingService.getFilePath()).toBeNull();
}

async function testRecordingLifecycle06(): Promise<void> {
  await integration.dispose();
  const storage = new Storage(tempDir);
  const persistence = new SessionPersistenceService(
    storage,
    'recording-integration-persistence',
    { maxQueueBytes: 1024 * 1024 },
  );
  integration = new RecordingIntegration(recordingService, persistence);
  await integration.subscribeToJournal(historyService);

  historyService.add(textContent('first'));
  historyService.add(textContent('second'));
  historyService.add(textContent('final'));

  await integration.flushAtTurnBoundary();
  const restored = await persistence.loadMostRecent();

  expect(
    restored?.history.map((entry) => {
      const block = entry.blocks[0];
      return blockTextOrEmpty(block);
    }),
  ).toStrictEqual(['first', 'second', 'final']);
  expect(persistence.getPendingByteCount()).toBe(0);
  await fs.rm(storage.getProjectTempDir(), {
    recursive: true,
    force: true,
  });
}

async function testRecordingLifecycle07(): Promise<void> {
  await integration.dispose();
  const storage = new Storage(path.join(tempDir, 'batch-success'));
  const persistence = new SessionPersistenceService(storage, 'batch-success');
  integration = new RecordingIntegration(recordingService, persistence);
  await integration.subscribeToJournal(historyService);

  await historyService.addBatch([
    textContent('batch first'),
    textContent('batch second', 'ai'),
  ]);
  await integration.flushAtTurnBoundary();
  const events = await readRecordedEvents(recordingService);
  const restored = await persistence.loadMostRecent();

  expect(
    events
      .filter((event) => event.type === 'content')
      .map((event) => {
        const payload = event.payload;
        if (
          typeof payload !== 'object' ||
          payload === null ||
          !('content' in payload)
        ) {
          return '';
        }
        const content = payload.content;
        if (
          typeof content !== 'object' ||
          content === null ||
          !('blocks' in content) ||
          !Array.isArray(content.blocks)
        ) {
          return '';
        }
        return textFromUnknownBlock(content.blocks[0]);
      }),
  ).toStrictEqual(['batch first', 'batch second']);
  expect(
    restored?.history.map((content) => textFromUnknownBlock(content.blocks[0])),
  ).toStrictEqual(['batch first', 'batch second']);
}

async function testRecordingLifecycle08(): Promise<void> {
  await integration.dispose();
  const storage = new Storage(path.join(tempDir, 'batch-listener-failure'));
  const persistence = new SessionPersistenceService(
    storage,
    'batch-listener-failure',
  );
  integration = new RecordingIntegration(recordingService, persistence);
  await integration.subscribeToJournal(historyService);
  historyService.on('contentBatchAdded', () => {
    throw new Error('publication listener failed');
  });

  await expect(
    historyService.addBatch([
      textContent('not recorded first'),
      textContent('not recorded second', 'ai'),
    ]),
  ).rejects.toThrow('publication listener failed');
  await collectRowsForAssertions(
    historyService.streamRawHistory(),
    async (contentsForAssertions) => {
      expect(contentsForAssertions).toStrictEqual([]);
      await recordingService.flush();
      const file = recordingService.getFilePath();
      if (file === null) throw new Error('Journal missing');
      const replay = await replaySession(file, PROJECT_HASH);
      assertReplayOk(replay);
      expect(replay.history).toStrictEqual([]);
      expect(persistence.getPendingByteCount()).toBe(0);
      expect(await persistence.loadMostRecent()).toBeNull();
    },
  );
}

async function testRecordingLifecycle09(): Promise<void> {
  await integration.dispose();
  const storage = new Storage(path.join(tempDir, 'failing-persistence'));
  const projectTemp = storage.getProjectTempDir();
  await fs.mkdir(projectTemp, { recursive: true });
  await fs.writeFile(path.join(projectTemp, 'chats'), 'not a directory');
  const persistence = new SessionPersistenceService(
    storage,
    'recording-integration-failure',
    { maxQueueBytes: 1024 * 1024 },
  );
  integration = new RecordingIntegration(recordingService, persistence);
  await integration.subscribeToJournal(historyService);

  try {
    historyService.add(textContent('durable recording before failure'));

    let failure: unknown;
    try {
      await withRecordingFailureReport(
        integration.flushAtTurnBoundary(),
        async () => undefined,
      );
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(errorMessages(failure).join('\n')).toContain('EEXIST');
    expect(
      (await readRecordedEvents(recordingService)).some(
        (event) => event.type === 'content',
      ),
    ).toBe(true);
    expect(persistence.getPendingByteCount()).toBe(0);
  } finally {
    await fs.rm(projectTemp, { recursive: true, force: true });
  }
}

async function testRecordingLifecycle10(): Promise<void> {
  await integration.dispose();
  class SchedulingFailure extends SessionPersistenceService {
    override saveJournal(): Promise<void> {
      throw new Error('persistence scheduling failed');
    }
  }
  const persistence = new SchedulingFailure(
    new Storage(path.join(tempDir, 'synchronous-failure')),
    'synchronous-failure',
  );
  integration = new RecordingIntegration(recordingService, persistence);
  await integration.subscribeToJournal(historyService);
  const content: IContent = {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'record before persistence clone' }],
    metadata: {
      providerMetadata: { nonCloneable: () => undefined },
    },
  };

  expect(() => historyService.add(content)).not.toThrow();
  const failure = await captureFailure(integration.flushAtTurnBoundary());

  expect(errorMessages(failure)).toContain('persistence scheduling failed');
  expect(
    (await readRecordedEvents(recordingService)).some(
      (event) => event.type === 'content',
    ),
  ).toBe(true);
}

async function testRecordingLifecycle11(): Promise<void> {
  await integration.dispose();
  const storage = new Storage(path.join(tempDir, 'transient-failure'));
  const projectTemp = storage.getProjectTempDir();
  await fs.mkdir(projectTemp, { recursive: true });
  await fs.writeFile(path.join(projectTemp, 'chats'), 'not a directory');
  const persistence = new SessionPersistenceService(
    storage,
    'transient-failure',
  );
  integration = new RecordingIntegration(recordingService, persistence);
  await integration.subscribeToJournal(historyService);

  historyService.add(textContent('failed generation'));
  const firstFailure = await captureFailure(integration.flushAtTurnBoundary());
  await fs.rm(path.join(projectTemp, 'chats'), { force: true });
  await fs.mkdir(path.join(projectTemp, 'chats'), { recursive: true });
  historyService.add(textContent('repaired generation'));

  await expect(integration.flushAtTurnBoundary()).resolves.toBeUndefined();
  expect(errorMessages(firstFailure).join('\n')).toContain('EEXIST');
}

async function testRecordingLifecycle12(): Promise<void> {
  await integration.dispose();
  const persistence = new ControlledPersistenceService(
    new Storage(path.join(tempDir, 'generation-order')),
    'generation-order',
  );
  integration = new RecordingIntegration(recordingService, persistence);
  await integration.subscribeToJournal(historyService);

  historyService.add(textContent('generation one'));
  const firstBoundary = integration.flushAtTurnBoundary();
  const firstSave = await persistence.waitForSave(0);
  historyService.add(textContent('generation two'));
  const secondBoundary = captureFailure(integration.flushAtTurnBoundary());
  const secondSave = await persistence.waitForSave(1);
  secondSave.reject(new Error('generation two failed'));
  firstSave.resolve();

  await expect(firstBoundary).resolves.toBeUndefined();
  const secondFailure = await secondBoundary;
  expect(errorMessages(secondFailure)).toContain(
    'Session persistence generation 2 failed: generation two failed',
  );
}

async function testRecordingLifecycle13(): Promise<void> {
  await integration.dispose();
  const persistence = new ControlledPersistenceService(
    new Storage(path.join(tempDir, 'dispose-failure')),
    'dispose-failure',
  );
  integration = new RecordingIntegration(recordingService, persistence);
  await integration.subscribeToJournal(historyService);
  historyService.add(textContent('queued before disable'));

  const boundary = withRecordingFailureReport(
    integration.flushAtTurnBoundary(),
    async () => undefined,
  );
  const pending = await persistence.waitForSave(0);
  const disposal = withRecordingFailureReport(
    integration.dispose(),
    async () => undefined,
  );
  const outcomes = Promise.allSettled([boundary, disposal]);
  pending.reject(new Error('queued save failed'));
  const results = await outcomes;
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? errorMessages(result.reason) : [],
  );
  expect(failures).toContain(
    'Session persistence generation 1 failed: queued save failed',
  );
  await expect(integration.dispose()).resolves.toBeUndefined();
}

async function testRecordingLifecycle14(): Promise<void> {
  await integration.subscribeToJournal(historyService);
  historyService.add(textContent('before-dispose'));
  await integration.flushAtTurnBoundary();

  await integration.dispose();
  historyService.add(textContent('after-dispose'));
  const events = await readRecordedEvents(recordingService);
  expect(events.filter((event) => event.type === 'content')).toHaveLength(1);
}

async function testRecordingLifecycle15(): Promise<void> {
  const firstDisposal = integration.dispose();
  const repeatedDisposal = integration.dispose();
  await repeatedDisposal;

  expect(repeatedDisposal).toBe(firstDisposal);
}

async function testRecordingLifecycle16(): Promise<void> {
  const secondHistory = new HistoryService();

  await integration.subscribeToJournal(historyService);
  await integration.subscribeToJournal(secondHistory);
  secondHistory.add(textContent('from-new-service'));

  const events = await flushAndRead(integration, recordingService);
  expect(events.filter((event) => event.type === 'content')).toHaveLength(1);
}

async function testRecordingLifecycle17(): Promise<void> {
  const secondHistory = new HistoryService();

  await integration.subscribeToJournal(historyService);
  await integration.subscribeToJournal(secondHistory);

  historyService.add(textContent('from-old-service'));
  secondHistory.add(textContent('from-new-service'));

  const events = await flushAndRead(integration, recordingService);
  const contentEvents = events.filter((event) => event.type === 'content');
  expect(contentEvents).toHaveLength(1);
  const text = (
    (contentEvents[0].payload as { content: IContent }).content.blocks[0] as {
      type: 'text';
      text: string;
    }
  ).text;
  expect(text).toBe('from-new-service');
}

async function testRecordingLifecycle18(): Promise<void> {
  await integration.subscribeToJournal(historyService);
  await integration.subscribeToJournal(historyService);
  historyService.add(textContent('same-instance'));

  const events = await flushAndRead(integration, recordingService);
  expect(events.filter((event) => event.type === 'content')).toHaveLength(1);
}

async function beforeEachRecordingLifecycle(): Promise<void> {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recording-int-test-'));
  chatsDir = path.join(tempDir, 'chats');
  await fs.mkdir(chatsDir, { recursive: true });

  recordingService = new SessionRecordingService(makeConfig(chatsDir));
  integration = new RecordingIntegration(recordingService);
  historyService = new HistoryService();
}

async function afterEachRecordingLifecycle(): Promise<void> {
  await integration.dispose();
  await recordingService.dispose();
  await fs.rm(tempDir, { recursive: true, force: true });
}
