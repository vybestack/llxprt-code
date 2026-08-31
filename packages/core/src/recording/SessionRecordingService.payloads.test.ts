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
 * @plan PLAN-20260211-SESSIONRECORDING.P04
 * @requirement REQ-REC-003, REQ-REC-004, REQ-REC-005, REQ-REC-006, REQ-REC-007, REQ-REC-008
 *
 * Behavioral tests for SessionRecordingService. Tests verify actual file
 * contents written to real temp directories — no mock theater.
 *
 * Property-based tests use fast-check (≥30% of total tests).
 * All tests expect real behavior from the service. They will fail against
 * the Phase 03 stub — that is correct TDD.
 */

import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { describe, expect, beforeEach, afterEach, it, vi } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SessionRecordingService } from './SessionRecordingService.js';
import { debugLogger } from '../utils/debugLogger.js';
import {
  type SessionRecordingServiceConfig,
  type SessionRecordLine,
} from './types.js';
import { type IContent } from '../services/history/IContent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(
  overrides: Partial<SessionRecordingServiceConfig> = {},
): SessionRecordingServiceConfig {
  return {
    sessionId: overrides.sessionId ?? 'test-session-00000001',
    projectHash: overrides.projectHash ?? 'abc123def456',
    chatsDir: overrides.chatsDir ?? '/tmp/test-chats',
    workspaceDirs: overrides.workspaceDirs ?? ['/home/user/project'],
    cwd: overrides.cwd ?? '/home/user/project/subdir',
    provider: overrides.provider ?? 'anthropic',
    model: overrides.model ?? 'claude-4',
  };
}

function makeContent(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
  };
}

function applySequenceEvent(
  svc: SessionRecordingService,
  eventType:
    | 'content'
    | 'rewind'
    | 'provider_switch'
    | 'session_event'
    | 'directories_changed',
): void {
  switch (eventType) {
    case 'content':
      svc.recordContent(makeContent('test'));
      break;
    case 'session_event':
      svc.recordSessionEvent('info', 'test event');
      break;
    case 'provider_switch':
      svc.recordProviderSwitch('test-provider', 'test-model');
      break;
    case 'directories_changed':
      svc.recordDirectoriesChanged(['/test']);
      break;
    case 'rewind':
      svc.recordRewind(1);
      break;
    default:
      throw new Error('Unsupported sequence event');
  }
}

function applyEnvelopeEvent(
  svc: SessionRecordingService,
  eventType:
    | 'content'
    | 'compressed'
    | 'rewind'
    | 'provider_switch'
    | 'session_event'
    | 'directories_changed',
): void {
  switch (eventType) {
    case 'content':
      svc.recordContent(makeContent('test'));
      break;
    case 'compressed':
      svc.recordCompressed(
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'summary' }],
        },
        5,
      );
      break;
    case 'rewind':
      svc.recordRewind(2);
      break;
    case 'provider_switch':
      svc.recordProviderSwitch('test', 'model');
      break;
    case 'session_event':
      svc.recordSessionEvent('info', 'test');
      break;
    case 'directories_changed':
      svc.recordDirectoriesChanged(['/dir']);
      break;
    default:
      throw new Error('Unsupported envelope event');
  }
}

function applyMetadataEvent(
  svc: SessionRecordingService,
  eventType: 'provider_switch' | 'directories_changed' | 'session_event',
): void {
  switch (eventType) {
    case 'provider_switch':
      svc.recordProviderSwitch('test', 'model');
      break;
    case 'directories_changed':
      svc.recordDirectoriesChanged(['/dir']);
      break;
    case 'session_event':
      svc.recordSessionEvent('info', 'event');
      break;
    default:
      throw new Error('Unsupported metadata event');
  }
}

/**
 * Read a JSONL file and parse each line into a SessionRecordLine.
 */
/**
 * Runs `body` against a freshly created temp chats directory and removes
 * the whole temp tree afterwards, even if `body` throws.
 */
async function withTempChatsDir<T>(
  prefix: string,
  body: (chatsDir: string) => Promise<T>,
): Promise<T> {
  const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const localChatsDir = path.join(localTempDir, 'chats');
  await fs.mkdir(localChatsDir, { recursive: true });
  try {
    return await body(localChatsDir);
  } finally {
    await fs.rm(localTempDir, { recursive: true, force: true });
  }
}

async function readJsonlFile(filePath: string): Promise<SessionRecordLine[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const lines = raw.trim().split('\n');
  return lines.map((line) => JSON.parse(line) as SessionRecordLine);
}

/**
 * Verify an ISO-8601 timestamp string is valid.
 */
function isValidIso8601(ts: string): boolean {
  const date = new Date(ts);
  return !isNaN(date.getTime()) && ts === date.toISOString();
}

describe('SessionRecordingService payloads and ordering @plan:PLAN-20260211-SESSIONRECORDING.P04', () => {
  let tempDir: string;
  let chatsDir: string;
  let service: SessionRecordingService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-rec-test-'));
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await service.dispose();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Event Type Payloads @requirement:REQ-REC-002 @plan:PLAN-20260211-SESSIONRECORDING.P04', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-002
     */
    it('compressed event contains summary IContent and itemsCompressed', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      const summary: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Summary of prior conversation' }],
        metadata: { isSummary: true },
      };

      service.recordContent(makeContent('trigger materialization'));
      service.recordCompressed(summary, 48);
      await service.flush();

      const events = await readJsonlFile(service.getFilePath()!);
      const compressed = events.find((e) => e.type === 'compressed');
      expect(compressed).toBeDefined();

      const payload = compressed!.payload as {
        summary: IContent;
        itemsCompressed: number;
      };
      expect(payload.itemsCompressed).toBe(48);
      expect(payload.summary.speaker).toBe('ai');
      expect(payload.summary.blocks[0]).toStrictEqual({
        type: 'text',
        text: 'Summary of prior conversation',
      });
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-002
     */
    it('session_event contains severity and message', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      service.recordContent(makeContent('trigger'));
      service.recordSessionEvent('warning', 'Token limit approaching');
      await service.flush();

      const events = await readJsonlFile(service.getFilePath()!);
      const sessionEvent = events.find((e) => e.type === 'session_event');
      expect(sessionEvent).toBeDefined();

      const payload = sessionEvent!.payload as {
        severity: string;
        message: string;
      };
      expect(payload.severity).toBe('warning');
      expect(payload.message).toBe('Token limit approaching');
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-002
     */
    it('rewind event contains itemsRemoved count', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      service.recordContent(makeContent('trigger'));
      service.recordRewind(3);
      await service.flush();

      const events = await readJsonlFile(service.getFilePath()!);
      const rewind = events.find((e) => e.type === 'rewind');
      expect(rewind).toBeDefined();

      const payload = rewind!.payload as { itemsRemoved: number };
      expect(payload.itemsRemoved).toBe(3);
    });

    /**
     * @issue #2934
     */
    it('rewind event carries the chronology cut marker when provided', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      service.recordContent(makeContent('trigger'));
      service.recordRewind(3, 7);
      await service.flush();

      const events = await readJsonlFile(service.getFilePath()!);
      const rewind = events.find((e) => e.type === 'rewind');
      expect(rewind).toBeDefined();

      const payload = rewind!.payload as {
        itemsRemoved: number;
        cutSeq?: number;
      };
      expect(payload.itemsRemoved).toBe(3);
      expect(payload.cutSeq).toBe(7);
    });

    /**
     * A rewind recorded without a resolvable cut marker must stay
     * byte-compatible with legacy count-only events.
     *
     * @issue #2934
     */
    it('rewind event omits the cut marker when none is provided', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      service.recordContent(makeContent('trigger'));
      service.recordRewind(3);
      await service.flush();

      const raw = await fs.readFile(service.getFilePath()!, 'utf8');
      const rewindLines = raw
        .split('\n')
        .filter((line) => line.includes('"type":"rewind"'));
      expect(rewindLines).toHaveLength(1);
      expect(rewindLines[0]).not.toContain('cutSeq');
    });
  });

  // -------------------------------------------------------------------------
  // Deferred materialization: metadata ordering (Architecture Review FIX 7)
  // -------------------------------------------------------------------------

  describe('Deferred Materialization Ordering @requirement:REQ-REC-004, REQ-REC-001.2 @plan:PLAN-20260211-SESSIONRECORDING.P04', () => {
    /**
     * Test case 23 from plan: exact enqueue order preserved for buffered metadata events.
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-004, REQ-REC-001.2
     */
    it('deferred materialization preserves exact enqueue order for buffered metadata', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      // Buffer metadata events (session_start already buffered in constructor)
      service.recordProviderSwitch('openai', 'gpt-5');
      service.recordDirectoriesChanged(['/new/path']);

      // Content triggers materialization
      service.recordContent(makeContent('hello'));
      await service.flush();

      const events = await readJsonlFile(service.getFilePath()!);
      expect(events).toHaveLength(4);

      // Exact order: session_start, provider_switch, directories_changed, content
      expect(events[0].type).toBe('session_start');
      expect(events[1].type).toBe('provider_switch');
      expect(events[2].type).toBe('directories_changed');
      expect(events[3].type).toBe('content');

      // Monotonic seq: 1, 2, 3, 4
      expect(events.map((e) => e.seq)).toStrictEqual([1, 2, 3, 4]);

      // All have valid ISO-8601 timestamps
      for (const event of events) {
        expect(isValidIso8601(event.ts)).toBe(true);
      }

      // session_start is FIRST regardless of buffered metadata count
      expect(events[0].type).toBe('session_start');
      const startPayload = events[0].payload as { sessionId: string };
      expect(startPayload.sessionId).toBe(config.sessionId);
    });
  });

  // -------------------------------------------------------------------------
  // Windows temp-root watcher (Issue 2800)
  // -------------------------------------------------------------------------

  if (process.platform === 'win32') {
    it('reports removal through the canonical Windows temp watcher', async () => {
      const errorSpy = vi
        .spyOn(debugLogger, 'error')
        .mockImplementation(() => {});
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      try {
        service.recordContent(makeContent('materialize watcher'));
        await service.flush();
        await fs.rm(chatsDir, { recursive: true, force: true });

        await waitFor(
          () => {
            expect(errorSpy).toHaveBeenCalledWith(
              expect.stringContaining('chatsDir was removed'),
            );
          },
          { timeout: 5000 },
        );
      } finally {
        errorSpy.mockRestore();
      }
    });
  }

  // =========================================================================
  // Property-Based Tests (≥30% of total — 9 property tests out of 24 total)
  // =========================================================================

  describe('Property-Based Tests @plan:PLAN-20260211-SESSIONRECORDING.P04', () => {
    /**
     * Property test 16: Any valid IContent can be enqueued and round-trips through JSONL.
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-003.3
     */
    it('any valid IContent round-trips through JSONL faithfully @requirement:REQ-REC-003.3 @plan:PLAN-20260211-SESSIONRECORDING.P04', async () =>
      fc.assert(
        fc.asyncProperty(
          fc.record({
            speaker: fc.constantFrom('human' as const, 'ai' as const),
            text: fc.string({ minLength: 1, maxLength: 200 }),
          }),
          async ({ speaker, text }) =>
            withTempChatsDir('prop-roundtrip-', async (localChatsDir) => {
              const config = makeConfig({ chatsDir: localChatsDir });
              const svc = new SessionRecordingService(config);

              const content: IContent = {
                speaker,
                blocks: [{ type: 'text', text }],
              };

              svc.recordContent(content);
              await svc.flush();

              const events = await readJsonlFile(svc.getFilePath()!);
              const contentEvent = events.find((e) => e.type === 'content');
              expect(contentEvent).toBeDefined();

              const payload = contentEvent!.payload as { content: IContent };
              expect(payload.content.speaker).toBe(speaker);
              expect(payload.content.blocks[0]).toStrictEqual({
                type: 'text',
                text,
              });

              await svc.dispose();
            }),
        ),
      ));

    /**
     * Property test 17: Sequence numbers are always monotonic regardless of enqueue pattern.
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-001.2
     */
    it('sequence numbers are always strictly monotonic @requirement:REQ-REC-001.2 @plan:PLAN-20260211-SESSIONRECORDING.P04', async () =>
      fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.constantFrom(
              'content' as const,
              'session_event' as const,
              'provider_switch' as const,
              'directories_changed' as const,
              'rewind' as const,
            ),
            { minLength: 1, maxLength: 15 },
          ),
          async (eventTypes) =>
            withTempChatsDir('prop-seq-', async (localChatsDir) => {
              const config = makeConfig({ chatsDir: localChatsDir });
              const svc = new SessionRecordingService(config);

              // Ensure first event is content to trigger materialization
              svc.recordContent(makeContent('trigger'));

              for (const eventType of eventTypes) {
                applySequenceEvent(svc, eventType);
              }

              await svc.flush();
              const events = await readJsonlFile(svc.getFilePath()!);

              // Verify strict monotonicity
              for (let i = 1; i < events.length; i++) {
                expect(events[i].seq).toBeGreaterThan(events[i - 1].seq);
              }

              await svc.dispose();
            }),
        ),
      ));

    /**
     * Property test 18: Multiple flush calls are idempotent.
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-005
     */
    it('multiple flush calls produce same file content @requirement:REQ-REC-005 @plan:PLAN-20260211-SESSIONRECORDING.P04', async () =>
      fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 1, max: 10 }),
          async (flushCount, eventCount) =>
            withTempChatsDir('prop-flush-', async (localChatsDir) => {
              const config = makeConfig({ chatsDir: localChatsDir });
              const svc = new SessionRecordingService(config);

              for (let i = 0; i < eventCount; i++) {
                svc.recordContent(makeContent(`msg ${i}`));
              }

              // Flush multiple times
              for (let i = 0; i < flushCount; i++) {
                await svc.flush();
              }

              const events = await readJsonlFile(svc.getFilePath()!);
              // session_start + eventCount content events
              expect(events).toHaveLength(eventCount + 1);

              await svc.dispose();
            }),
        ),
      ));

    /**
     * Property test 19: Session ID is always present in session_start payload.
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-001
     */
    it('session_start payload always contains matching sessionId @requirement:REQ-REC-001 @plan:PLAN-20260211-SESSIONRECORDING.P04', async () =>
      fc.assert(
        fc.asyncProperty(fc.uuid(), async (sessionId) =>
          withTempChatsDir('prop-sid-', async (localChatsDir) => {
            const config = makeConfig({ chatsDir: localChatsDir, sessionId });
            const svc = new SessionRecordingService(config);

            svc.recordContent(makeContent('trigger'));
            await svc.flush();

            const events = await readJsonlFile(svc.getFilePath()!);
            expect(events[0].type).toBe('session_start');

            const startPayload = events[0].payload as { sessionId: string };
            expect(startPayload.sessionId).toBe(sessionId);

            await svc.dispose();
          }),
        ),
      ));

    /**
     * Property test 20: Any number of enqueued events produces correct line count.
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-003.2
     */
    it('N content events produce exactly N+1 lines (session_start + N) @requirement:REQ-REC-003.2 @plan:PLAN-20260211-SESSIONRECORDING.P04', async () =>
      fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 30 }), async (eventCount) =>
          withTempChatsDir('prop-count-', async (localChatsDir) => {
            const config = makeConfig({ chatsDir: localChatsDir });
            const svc = new SessionRecordingService(config);

            for (let i = 0; i < eventCount; i++) {
              svc.recordContent(makeContent(`msg ${i}`));
            }
            await svc.flush();

            const events = await readJsonlFile(svc.getFilePath()!);
            expect(events).toHaveLength(eventCount + 1);

            await svc.dispose();
          }),
        ),
      ));

    /**
     * Property test 21: Timestamps are always valid ISO-8601 in any number of events.
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-001.3
     */
    it('all events have valid ISO-8601 timestamps @requirement:REQ-REC-001.3 @plan:PLAN-20260211-SESSIONRECORDING.P04', async () =>
      fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 15 }), async (eventCount) =>
          withTempChatsDir('prop-ts-', async (localChatsDir) => {
            const config = makeConfig({ chatsDir: localChatsDir });
            const svc = new SessionRecordingService(config);

            for (let i = 0; i < eventCount; i++) {
              svc.recordContent(makeContent(`msg ${i}`));
            }
            await svc.flush();

            const events = await readJsonlFile(svc.getFilePath()!);
            for (const event of events) {
              expect(isValidIso8601(event.ts)).toBe(true);
            }

            await svc.dispose();
          }),
        ),
      ));

    /**
     * Property test 22: Envelope structure is consistent regardless of event type.
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-001
     */
    it('every event has consistent envelope {v, seq, ts, type, payload} @requirement:REQ-REC-001 @plan:PLAN-20260211-SESSIONRECORDING.P04', async () =>
      fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            'content' as const,
            'compressed' as const,
            'rewind' as const,
            'provider_switch' as const,
            'session_event' as const,
            'directories_changed' as const,
          ),
          async (eventType) =>
            withTempChatsDir('prop-envelope-', async (localChatsDir) => {
              const config = makeConfig({ chatsDir: localChatsDir });
              const svc = new SessionRecordingService(config);

              // First enqueue content to materialize
              svc.recordContent(makeContent('trigger'));

              // Then enqueue the specific event type
              applyEnvelopeEvent(svc, eventType);

              await svc.flush();
              const events = await readJsonlFile(svc.getFilePath()!);

              for (const event of events) {
                expect(typeof event.v).toBe('number');
                expect(event.v).toBe(1);
                expect(typeof event.seq).toBe('number');
                expect(typeof event.ts).toBe('string');
                expect(typeof event.type).toBe('string');
                expect(event.payload).toBeDefined();
                expect(event.payload).not.toBeNull();
              }

              await svc.dispose();
            }),
        ),
      ));

    /**
     * Property test 24: Any number of metadata events before first content preserves
     * exact order (Architecture Review FIX 7).
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-004, REQ-REC-001.2
     */
    it('any metadata events before first content are written in exact enqueue order @requirement:REQ-REC-004, REQ-REC-001.2 @plan:PLAN-20260211-SESSIONRECORDING.P04', async () =>
      fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.constantFrom(
              'provider_switch' as const,
              'directories_changed' as const,
              'session_event' as const,
            ),
            { minLength: 0, maxLength: 10 },
          ),
          async (metadataTypes) =>
            withTempChatsDir('prop-order-', async (localChatsDir) => {
              const config = makeConfig({ chatsDir: localChatsDir });
              const svc = new SessionRecordingService(config);

              // Enqueue metadata events before any content
              for (const eventType of metadataTypes) {
                applyMetadataEvent(svc, eventType);
              }

              // Content triggers materialization
              svc.recordContent(makeContent('first content'));
              await svc.flush();

              const events = await readJsonlFile(svc.getFilePath()!);

              // Expected: session_start + metadata events + content
              const expectedLength = 1 + metadataTypes.length + 1;
              expect(events).toHaveLength(expectedLength);

              // Line 1 is always session_start
              expect(events[0].type).toBe('session_start');

              // Middle lines are metadata in exact enqueue order
              for (let i = 0; i < metadataTypes.length; i++) {
                expect(events[i + 1].type).toBe(metadataTypes[i]);
              }

              // Last line is content
              expect(events[events.length - 1].type).toBe('content');

              // All seq values are strictly monotonically increasing (1, 2, ..., N+2)
              for (let i = 0; i < events.length; i++) {
                expect(events[i].seq).toBe(i + 1);
              }

              await svc.dispose();
            }),
        ),
      ));

    /**
     * Property test (bonus): Session start payload always contains all required fields.
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-001
     */
    it('session_start payload has all required fields @requirement:REQ-REC-001 @plan:PLAN-20260211-SESSIONRECORDING.P04', async () =>
      fc.assert(
        fc.asyncProperty(
          fc.record({
            sessionId: fc.uuid(),
            provider: fc.constantFrom('anthropic', 'openai', 'google'),
            model: fc.string({ minLength: 1, maxLength: 30 }),
          }),
          async ({ sessionId, provider, model }) =>
            withTempChatsDir('prop-start-', async (localChatsDir) => {
              const config = makeConfig({
                chatsDir: localChatsDir,
                sessionId,
                provider,
                model,
              });
              const svc = new SessionRecordingService(config);

              svc.recordContent(makeContent('trigger'));
              await svc.flush();

              const events = await readJsonlFile(svc.getFilePath()!);
              const startPayload = events[0].payload as Record<string, unknown>;

              expect(startPayload.sessionId).toBe(sessionId);
              expect(startPayload.projectHash).toBe(config.projectHash);
              expect(startPayload.provider).toBe(provider);
              expect(startPayload.model).toBe(model);
              expect(startPayload.workspaceDirs).toStrictEqual(
                config.workspaceDirs,
              );
              expect(startPayload.cwd).toBe(config.cwd);
              expect(typeof startPayload.startTime).toBe('string');
              expect(isValidIso8601(startPayload.startTime as string)).toBe(
                true,
              );

              await svc.dispose();
            }),
        ),
      ));
  });
});
