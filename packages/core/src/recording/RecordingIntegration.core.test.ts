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
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { EventEmitter } from 'node:events';

import { HistoryService } from '../services/history/HistoryService.js';
import { type IContent } from '../services/history/IContent.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { type SessionRecordingServiceConfig } from './types.js';

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

function toolCallContent(toolName: string): IContent {
  return {
    speaker: 'ai',
    blocks: [
      { type: 'text', text: `calling ${toolName}` },
      {
        type: 'tool_call',
        id: `call_${toolName}`,
        name: toolName,
        parameters: { x: 1 },
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

async function flushAndRead(
  integration: RecordingIntegration,
  recordingService: SessionRecordingService,
): Promise<JsonlEvent[]> {
  await integration.flushAtTurnBoundary();
  return readRecordedEvents(recordingService);
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

  describe('Core subscription behavior @requirement:REQ-INT-001 @plan:PLAN-20260211-SESSIONRECORDING.P13', () => {
    it('records one content event after subscribe and contentAdded emission', async () => {
      integration.subscribeToHistory(historyService);
      emitter.emit('contentAdded', textContent('hello one'));

      const events = await flushAndRead(integration, recordingService);
      expect(events.some((event) => event.type === 'content')).toBe(true);
    });

    it('does not record content emitted before subscribeToHistory', async () => {
      emitter.emit('contentAdded', textContent('before-subscribe'));
      integration.subscribeToHistory(historyService);
      emitter.emit('contentAdded', textContent('after-subscribe'));

      const events = await flushAndRead(integration, recordingService);
      const contentEvents = events.filter((event) => event.type === 'content');
      expect(contentEvents).toHaveLength(1);

      const payload = contentEvents[0].payload as { content: IContent };
      const text = (payload.content.blocks[0] as { type: 'text'; text: string })
        .text;
      expect(text).toBe('after-subscribe');
    });

    it('records multiple content events in the same order as emitted', async () => {
      integration.subscribeToHistory(historyService);
      emitter.emit('contentAdded', textContent('a'));
      emitter.emit('contentAdded', textContent('b'));
      emitter.emit('contentAdded', textContent('c'));

      const events = await flushAndRead(integration, recordingService);
      const contentEvents = events.filter((event) => event.type === 'content');
      const texts = contentEvents.map((event) => {
        const payload = event.payload as { content: IContent };
        return (payload.content.blocks[0] as { type: 'text'; text: string })
          .text;
      });
      expect(texts).toStrictEqual(['a', 'b', 'c']);
    });

    it('preserves tool_call content blocks through recording', async () => {
      integration.subscribeToHistory(historyService);
      emitter.emit('contentAdded', toolCallContent('search'));

      const events = await flushAndRead(integration, recordingService);
      const contentEvent = events.find((event) => event.type === 'content');
      expect(contentEvent).toBeDefined();
      const payload = contentEvent?.payload as { content: IContent };
      expect(payload.content.blocks.some((b) => b.type === 'tool_call')).toBe(
        true,
      );
    });

    it('preserves tool_response content blocks through recording', async () => {
      integration.subscribeToHistory(historyService);
      emitter.emit('contentAdded', toolResponseContent('search'));

      const events = await flushAndRead(integration, recordingService);
      const contentEvent = events.find((event) => event.type === 'content');
      expect(contentEvent).toBeDefined();
      const payload = contentEvent?.payload as { content: IContent };
      expect(
        payload.content.blocks.some((b) => b.type === 'tool_response'),
      ).toBe(true);
    });

    it('unsubscribe stops future content recording', async () => {
      integration.subscribeToHistory(historyService);
      emitter.emit('contentAdded', textContent('before-unsubscribe'));
      integration.unsubscribeFromHistory();
      emitter.emit('contentAdded', textContent('after-unsubscribe'));

      const events = await flushAndRead(integration, recordingService);
      const contentEvents = events.filter((event) => event.type === 'content');
      expect(contentEvents).toHaveLength(1);
    });

    it('re-subscribe to same history remains functional', async () => {
      integration.subscribeToHistory(historyService);
      integration.unsubscribeFromHistory();
      integration.subscribeToHistory(historyService);
      emitter.emit('contentAdded', textContent('rebound'));

      const events = await flushAndRead(integration, recordingService);
      expect(events.filter((event) => event.type === 'content')).toHaveLength(
        1,
      );
    });
  });

  describe('Compression-aware filtering @requirement:REQ-INT-002 @plan:PLAN-20260211-SESSIONRECORDING.P13', () => {
    it('suppresses content events during compression window', async () => {
      integration.subscribeToHistory(historyService);
      emitter.emit('contentAdded', textContent('baseline-materialize'));
      emitter.emit('compressionStarted');
      emitter.emit('contentAdded', textContent('re-added item'));
      emitter.emit(
        'compressionEnded',
        textContent('compression summary', 'ai'),
        42,
      );

      const events = await flushAndRead(integration, recordingService);
      const contentEvents = events.filter((event) => event.type === 'content');
      const contentTexts = contentEvents.map((event) => {
        const payload = event.payload as { content: IContent };
        return (payload.content.blocks[0] as { type: 'text'; text: string })
          .text;
      });
      expect(contentEvents).toHaveLength(1);
      expect(contentTexts).toStrictEqual(['baseline-materialize']);
      expect(
        events.filter((event) => event.type === 'compressed'),
      ).toHaveLength(1);
    });

    it('records compressed event payload when compression ends', async () => {
      integration.subscribeToHistory(historyService);
      emitter.emit('contentAdded', textContent('baseline-materialize'));
      emitter.emit('compressionStarted');
      emitter.emit('compressionEnded', textContent('summary', 'ai'), 7);

      const events = await flushAndRead(integration, recordingService);
      const compressedEvent = events.find(
        (event) => event.type === 'compressed',
      );
      expect(compressedEvent).toBeDefined();
      const payload = compressedEvent?.payload as {
        summary: IContent;
        itemsCompressed: number;
      };
      expect(payload.itemsCompressed).toBe(7);
      expect(
        (payload.summary.blocks[0] as { type: 'text'; text: string }).text,
      ).toBe('summary');
    });

    it('records post-compression content after compressionEnded', async () => {
      integration.subscribeToHistory(historyService);
      emitter.emit('contentAdded', textContent('baseline-materialize'));
      emitter.emit('compressionStarted');
      emitter.emit('compressionEnded', textContent('summary', 'ai'), 3);
      emitter.emit(
        'contentAdded',
        textContent('new-content-after-compression'),
      );

      const events = await flushAndRead(integration, recordingService);
      expect(
        events.filter((event) => event.type === 'compressed'),
      ).toHaveLength(1);
      expect(events.filter((event) => event.type === 'content')).toHaveLength(
        2,
      );
    });

    it('emits one compressed event per compression cycle', async () => {
      integration.subscribeToHistory(historyService);
      emitter.emit('contentAdded', textContent('baseline-materialize'));
      emitter.emit('compressionStarted');
      emitter.emit('compressionEnded', textContent('summary-1', 'ai'), 10);
      emitter.emit('compressionStarted');
      emitter.emit('compressionEnded', textContent('summary-2', 'ai'), 12);

      const events = await flushAndRead(integration, recordingService);
      expect(
        events.filter((event) => event.type === 'compressed'),
      ).toHaveLength(2);
    });
  });

  describe('Delegate methods @requirement:REQ-INT-003 @plan:PLAN-20260211-SESSIONRECORDING.P13', () => {
    it('recordProviderSwitch delegates to SessionRecordingService', async () => {
      integration.subscribeToHistory(historyService);
      integration.recordProviderSwitch('openai', 'gpt-5');
      emitter.emit('contentAdded', textContent('materialize content'));

      const events = await flushAndRead(integration, recordingService);
      expect(events.some((event) => event.type === 'provider_switch')).toBe(
        true,
      );
    });

    it('recordDirectoriesChanged delegates to SessionRecordingService', async () => {
      integration.subscribeToHistory(historyService);
      integration.recordDirectoriesChanged(['/a', '/b', '/c']);
      emitter.emit('contentAdded', textContent('materialize content'));

      const events = await flushAndRead(integration, recordingService);
      expect(events.some((event) => event.type === 'directories_changed')).toBe(
        true,
      );
    });

    it('recordSessionEvent delegates to SessionRecordingService', async () => {
      integration.subscribeToHistory(historyService);
      integration.recordSessionEvent('warning', 'Disk pressure');
      emitter.emit('contentAdded', textContent('materialize content'));

      const events = await flushAndRead(integration, recordingService);
      expect(events.some((event) => event.type === 'session_event')).toBe(true);
    });
  });

  describe('Flush / dispose / replacement behavior @requirement:REQ-INT-004,REQ-INT-005,REQ-INT-006 @plan:PLAN-20260211-SESSIONRECORDING.P13', () => {
    it('flushAtTurnBoundary persists pending events', async () => {
      integration.subscribeToHistory(historyService);
      emitter.emit('contentAdded', textContent('flush-boundary'));

      const events = await flushAndRead(integration, recordingService);
      expect(events.filter((event) => event.type === 'content')).toHaveLength(
        1,
      );
    });

    it('flushAtTurnBoundary with no activity does not create file', async () => {
      await integration.flushAtTurnBoundary();
      expect(recordingService.getFilePath()).toBeNull();
    });

    it('dispose prevents future event recording while keeping prior events', async () => {
      integration.subscribeToHistory(historyService);
      emitter.emit('contentAdded', textContent('before-dispose'));
      await integration.flushAtTurnBoundary();

      integration.dispose();
      emitter.emit('contentAdded', textContent('after-dispose'));
      const events = await readRecordedEvents(recordingService);
      expect(events.filter((event) => event.type === 'content')).toHaveLength(
        1,
      );
    });

    it('dispose is idempotent', async () => {
      integration.dispose();
      integration.dispose();
      expect(true).toBe(true);
    });

    it('onHistoryServiceReplaced switches subscription to new instance', async () => {
      const secondHistory = new HistoryService();
      const secondEmitter = historyEmitter(secondHistory);

      integration.subscribeToHistory(historyService);
      integration.onHistoryServiceReplaced(secondHistory);
      secondEmitter.emit('contentAdded', textContent('from-new-service'));

      const events = await flushAndRead(integration, recordingService);
      expect(events.filter((event) => event.type === 'content')).toHaveLength(
        1,
      );
    });

    it('after replacement, old history events are ignored', async () => {
      const secondHistory = new HistoryService();
      const secondEmitter = historyEmitter(secondHistory);

      integration.subscribeToHistory(historyService);
      integration.onHistoryServiceReplaced(secondHistory);

      emitter.emit('contentAdded', textContent('from-old-service'));
      secondEmitter.emit('contentAdded', textContent('from-new-service'));

      const events = await flushAndRead(integration, recordingService);
      const contentEvents = events.filter((event) => event.type === 'content');
      expect(contentEvents).toHaveLength(1);
      const text = (
        (contentEvents[0].payload as { content: IContent }).content
          .blocks[0] as {
          type: 'text';
          text: string;
        }
      ).text;
      expect(text).toBe('from-new-service');
    });

    it('replacement with same HistoryService instance is safe', async () => {
      integration.subscribeToHistory(historyService);
      integration.onHistoryServiceReplaced(historyService);
      emitter.emit('contentAdded', textContent('same-instance'));

      const events = await flushAndRead(integration, recordingService);
      expect(events.filter((event) => event.type === 'content')).toHaveLength(
        1,
      );
    });
  });
});
