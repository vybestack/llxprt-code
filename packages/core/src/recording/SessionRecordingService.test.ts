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
 * Property-based tests use @fast-check/vitest (≥30% of total tests).
 * All tests expect real behavior from the service. They will fail against
 * the Phase 03 stub — that is correct TDD.
 */

import { describe, expect, beforeEach, afterEach } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SessionRecordingService } from './SessionRecordingService.js';
import {
  type SessionRecordingServiceConfig,
  type SessionRecordLine,
  type SessionEventType,
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

/**
 * Read a JSONL file and parse each line into a SessionRecordLine.
 */
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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('SessionRecordingService @plan:PLAN-20260211-SESSIONRECORDING.P04', () => {
  let tempDir: string;
  let chatsDir: string;
  let service: SessionRecordingService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-rec-test-'));
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    service?.dispose();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Enqueue + Flush + JSONL Format
  // -------------------------------------------------------------------------

  describe('Enqueue + Flush @requirement:REQ-REC-003 @plan:PLAN-20260211-SESSIONRECORDING.P04', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-003.1, REQ-REC-003.2, REQ-REC-003.3
     */
    it('enqueue + flush writes valid JSONL to disk', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      service.recordContent(makeContent('Hello from user'));
      await service.flush();

      const filePath = service.getFilePath();
      expect(filePath).not.toBeNull();
      const events = await readJsonlFile(filePath!);

      // First line should be session_start, second should be content
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0].type).toBe('session_start');
      expect(events[1].type).toBe('content');

      const contentPayload = events[1].payload as { content: IContent };
      expect(contentPayload.content.speaker).toBe('human');
      expect(contentPayload.content.blocks[0]).toEqual({
        type: 'text',
        text: 'Hello from user',
      });
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-003.3
     */
    it('each line in JSONL file is independently parseable as JSON', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      for (let i = 0; i < 5; i++) {
        service.recordContent(makeContent(`message ${i}`));
      }
      await service.flush();

      const filePath = service.getFilePath()!;
      const raw = await fs.readFile(filePath, 'utf-8');
      const lines = raw.trim().split('\n');

      // session_start + 5 content events = 6 lines
      expect(lines).toHaveLength(6);

      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed).toHaveProperty('v');
        expect(parsed).toHaveProperty('seq');
        expect(parsed).toHaveProperty('ts');
        expect(parsed).toHaveProperty('type');
        expect(parsed).toHaveProperty('payload');
        expect(parsed.v).toBe(1);
      }
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-005
     */
    it('flush resolves after all queued events are written to disk', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      for (let i = 0; i < 10; i++) {
        service.recordContent(makeContent(`msg ${i}`));
      }
      await service.flush();

      const filePath = service.getFilePath()!;
      const events = await readJsonlFile(filePath);

      // session_start + 10 content = 11
      expect(events).toHaveLength(11);
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-005
     */
    it('flush on empty queue resolves immediately without error', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      // flush with nothing enqueued should not throw
      await service.flush();

      // no file materialized since no content event
      expect(service.getFilePath()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Monotonic Sequence Numbers
  // -------------------------------------------------------------------------

  describe('Monotonic Sequence @requirement:REQ-REC-001.2 @plan:PLAN-20260211-SESSIONRECORDING.P04', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-001.2
     */
    it('events have strictly monotonically increasing sequence numbers', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      service.recordContent(makeContent('msg 1'));
      service.recordContent(makeContent('msg 2'));
      service.recordContent(makeContent('msg 3'));
      service.recordContent(makeContent('msg 4'));
      service.recordContent(makeContent('msg 5'));
      await service.flush();

      const events = await readJsonlFile(service.getFilePath()!);
      // session_start=1, content events=2,3,4,5,6
      expect(events).toHaveLength(6);

      for (let i = 0; i < events.length; i++) {
        expect(events[i].seq).toBe(i + 1);
      }

      // Verify strict monotonicity
      for (let i = 1; i < events.length; i++) {
        expect(events[i].seq).toBeGreaterThan(events[i - 1].seq);
      }
    });
  });

  // -------------------------------------------------------------------------
  // ISO-8601 Timestamps + Schema Version
  // -------------------------------------------------------------------------

  describe('Timestamps & Schema @requirement:REQ-REC-001.1, REQ-REC-001.3 @plan:PLAN-20260211-SESSIONRECORDING.P04', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-001.3
     */
    it('every event has a valid ISO-8601 timestamp', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      service.recordContent(makeContent('hello'));
      service.recordProviderSwitch('openai', 'gpt-5');
      service.recordContent(makeContent('world', 'ai'));
      await service.flush();

      const events = await readJsonlFile(service.getFilePath()!);
      expect(events.length).toBeGreaterThanOrEqual(4);

      for (const event of events) {
        expect(isValidIso8601(event.ts)).toBe(true);
      }
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-001.1
     */
    it('every event has schema version v=1', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      service.recordContent(makeContent('test'));
      await service.flush();

      const events = await readJsonlFile(service.getFilePath()!);
      for (const event of events) {
        expect(event.v).toBe(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Deferred Materialization
  // -------------------------------------------------------------------------

  describe('Deferred Materialization @requirement:REQ-REC-004 @plan:PLAN-20260211-SESSIONRECORDING.P04', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-004.2
     */
    it('no file is created when only session_start is enqueued (no content)', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      // Only session_start is buffered in constructor — no explicit content
      await service.flush();
      service.dispose();

      expect(service.getFilePath()).toBeNull();

      const files = await fs.readdir(chatsDir);
      const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));
      expect(jsonlFiles).toHaveLength(0);
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-004.1
     */
    it('file materializes on first content event with session_start as line 1', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      // No file yet
      expect(service.getFilePath()).toBeNull();

      // Enqueue content — triggers materialization
      service.recordContent(makeContent('first user message'));
      await service.flush();

      const filePath = service.getFilePath();
      expect(filePath).not.toBeNull();

      const events = await readJsonlFile(filePath!);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('session_start');
      expect(events[1].type).toBe('content');

      const startPayload = events[0].payload as { sessionId: string };
      expect(startPayload.sessionId).toBe('test-session-00000001');
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-004
     */
    it('metadata events buffered before content are written in enqueue order', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      // Buffer metadata events before any content
      service.recordProviderSwitch('openai', 'gpt-5');
      service.recordDirectoriesChanged(['/new/path']);

      // No file yet
      expect(service.getFilePath()).toBeNull();

      // Content triggers materialization
      service.recordContent(makeContent('hello'));
      await service.flush();

      const events = await readJsonlFile(service.getFilePath()!);
      expect(events).toHaveLength(4);
      expect(events[0].type).toBe('session_start');
      expect(events[1].type).toBe('provider_switch');
      expect(events[2].type).toBe('directories_changed');
      expect(events[3].type).toBe('content');

      // Verify monotonic sequence
      expect(events[0].seq).toBe(1);
      expect(events[1].seq).toBe(2);
      expect(events[2].seq).toBe(3);
      expect(events[3].seq).toBe(4);

      // Verify payloads
      const switchPayload = events[1].payload as {
        provider: string;
        model: string;
      };
      expect(switchPayload.provider).toBe('openai');
      expect(switchPayload.model).toBe('gpt-5');

      const dirsPayload = events[2].payload as { directories: string[] };
      expect(dirsPayload.directories).toEqual(['/new/path']);
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-004
     */
    it('getFilePath() is null before materialization, returns path after', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      expect(service.getFilePath()).toBeNull();

      service.recordContent(makeContent('trigger'));
      await service.flush();

      const filePath = service.getFilePath();
      expect(filePath).not.toBeNull();
      expect(typeof filePath).toBe('string');
      expect(filePath!.endsWith('.jsonl')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // ENOSPC Handling
  // -------------------------------------------------------------------------

  describe('ENOSPC Handling @requirement:REQ-REC-006 @plan:PLAN-20260211-SESSIONRECORDING.P04', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-006, REQ-REC-007
     */
    it('ENOSPC write failure disables recording and isActive() becomes false', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      // Record one event to materialize the file
      service.recordContent(makeContent('before error'));
      await service.flush();

      expect(service.isActive()).toBe(true);

      const filePath = service.getFilePath()!;

      // Make the file read-only to simulate write failure (EACCES/ENOSPC path)
      await fs.chmod(filePath, 0o444);

      // Enqueue another event — the background writer should hit ENOSPC/EACCES
      service.recordContent(makeContent('this should fail to write'));

      try {
        await service.flush();
      } catch {
        // flush may or may not throw — the important thing is the state transition
      }

      // After a write failure, isActive should be false
      expect(service.isActive()).toBe(false);

      // Restore permissions for cleanup
      await fs.chmod(filePath, 0o644);
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-006.2
     */
    it('subsequent enqueue calls are no-ops after ENOSPC', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      // Materialize
      service.recordContent(makeContent('initial'));
      await service.flush();

      const filePath = service.getFilePath()!;
      const eventsBeforeError = await readJsonlFile(filePath);
      const lineCountBefore = eventsBeforeError.length;

      // Cause write failure
      await fs.chmod(filePath, 0o444);
      service.recordContent(makeContent('fail write'));

      try {
        await service.flush();
      } catch {
        // expected
      }

      // Restore permissions
      await fs.chmod(filePath, 0o644);

      // Now enqueue more after recording is disabled
      service.recordContent(makeContent('this is a no-op'));
      service.recordContent(makeContent('also a no-op'));
      await service.flush();

      // File should NOT have the no-op events
      const eventsAfter = await readJsonlFile(filePath);
      // The line count should not have increased by the no-op events
      // It may have increased by the "fail write" event if partial write happened
      // but it must NOT have the post-disable events
      expect(eventsAfter.length).toBeLessThanOrEqual(lineCountBefore + 1);
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-007
     */
    it('isActive() starts true for a newly constructed service', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      expect(service.isActive()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Session ID + Accessors
  // -------------------------------------------------------------------------

  describe('Accessors @requirement:REQ-REC-003 @plan:PLAN-20260211-SESSIONRECORDING.P04', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-003
     */
    it('getSessionId() returns the session ID from constructor config', () => {
      const config = makeConfig({ chatsDir, sessionId: 'my-unique-session' });
      service = new SessionRecordingService(config);

      expect(service.getSessionId()).toBe('my-unique-session');
    });
  });

  // -------------------------------------------------------------------------
  // initializeForResume
  // -------------------------------------------------------------------------

  describe('initializeForResume @requirement:REQ-REC-008 @plan:PLAN-20260211-SESSIONRECORDING.P04', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-008
     */
    it('resumes with correct filePath and sequence continuing from lastSeq', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      const existingFile = path.join(chatsDir, 'session-existing.jsonl');
      await fs.writeFile(existingFile, '');

      service.initializeForResume(existingFile, 42);

      expect(service.getFilePath()).toBe(existingFile);

      // Enqueue content — seq should continue from 42
      service.recordContent(makeContent('resumed message'));
      await service.flush();

      const events = await readJsonlFile(existingFile);
      expect(events.length).toBeGreaterThanOrEqual(1);

      // The first new event should have seq = 43
      expect(events[0].seq).toBe(43);
      expect(events[0].type).toBe('content');
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-008
     */
    it('resume skips session_start buffer (no duplicate session_start)', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      const existingFile = path.join(chatsDir, 'session-resume.jsonl');
      await fs.writeFile(existingFile, '');

      service.initializeForResume(existingFile, 10);

      service.recordContent(makeContent('new content after resume'));
      await service.flush();

      const events = await readJsonlFile(existingFile);
      // Should NOT have a session_start — only the content event
      const sessionStarts = events.filter((e) => e.type === 'session_start');
      expect(sessionStarts).toHaveLength(0);
      expect(events[0].type).toBe('content');
    });
  });

  // -------------------------------------------------------------------------
  // dispose
  // -------------------------------------------------------------------------

  describe('dispose @requirement:REQ-REC-003 @plan:PLAN-20260211-SESSIONRECORDING.P04', () => {
    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-003
     */
    it('dispose stops recording: enqueue after dispose writes nothing', async () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      // Materialize
      service.recordContent(makeContent('before dispose'));
      await service.flush();

      const filePath = service.getFilePath()!;
      const eventsBefore = await readJsonlFile(filePath);
      const lineCountBefore = eventsBefore.length;

      service.dispose();

      // Enqueue after dispose — should be no-op
      service.recordContent(makeContent('after dispose'));
      await service.flush();

      const eventsAfter = await readJsonlFile(filePath);
      expect(eventsAfter).toHaveLength(lineCountBefore);
    });

    /**
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-003, REQ-REC-007
     */
    it('dispose sets isActive() to false', () => {
      const config = makeConfig({ chatsDir });
      service = new SessionRecordingService(config);

      expect(service.isActive()).toBe(true);

      service.dispose();

      expect(service.isActive()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Event Type Payloads
  // -------------------------------------------------------------------------

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
      expect(payload.summary.blocks[0]).toEqual({
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
      expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);

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
    it.prop([
      fc.record({
        speaker: fc.constantFrom('human' as const, 'ai' as const),
        text: fc.string({ minLength: 1, maxLength: 200 }),
      }),
    ])(
      'any valid IContent round-trips through JSONL faithfully @requirement:REQ-REC-003.3 @plan:PLAN-20260211-SESSIONRECORDING.P04',
      async ({ speaker, text }) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-roundtrip-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
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
          expect(payload.content.blocks[0]).toEqual({ type: 'text', text });

          svc.dispose();
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Property test 17: Sequence numbers are always monotonic regardless of enqueue pattern.
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-001.2
     */
    it.prop([
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
    ])(
      'sequence numbers are always strictly monotonic @requirement:REQ-REC-001.2 @plan:PLAN-20260211-SESSIONRECORDING.P04',
      async (eventTypes) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-seq-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const config = makeConfig({ chatsDir: localChatsDir });
          const svc = new SessionRecordingService(config);

          // Ensure first event is content to trigger materialization
          svc.recordContent(makeContent('trigger'));

          for (const eventType of eventTypes) {
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
            }
          }

          await svc.flush();
          const events = await readJsonlFile(svc.getFilePath()!);

          // Verify strict monotonicity
          for (let i = 1; i < events.length; i++) {
            expect(events[i].seq).toBeGreaterThan(events[i - 1].seq);
          }

          svc.dispose();
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Property test 18: Multiple flush calls are idempotent.
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-005
     */
    it.prop([fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 10 })])(
      'multiple flush calls produce same file content @requirement:REQ-REC-005 @plan:PLAN-20260211-SESSIONRECORDING.P04',
      async (flushCount, eventCount) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-flush-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
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

          svc.dispose();
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Property test 19: Session ID is always present in session_start payload.
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-001
     */
    it.prop([fc.uuid()])(
      'session_start payload always contains matching sessionId @requirement:REQ-REC-001 @plan:PLAN-20260211-SESSIONRECORDING.P04',
      async (sessionId) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-sid-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const config = makeConfig({ chatsDir: localChatsDir, sessionId });
          const svc = new SessionRecordingService(config);

          svc.recordContent(makeContent('trigger'));
          await svc.flush();

          const events = await readJsonlFile(svc.getFilePath()!);
          expect(events[0].type).toBe('session_start');

          const startPayload = events[0].payload as { sessionId: string };
          expect(startPayload.sessionId).toBe(sessionId);

          svc.dispose();
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Property test 20: Any number of enqueued events produces correct line count.
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-003.2
     */
    it.prop([fc.integer({ min: 1, max: 30 })])(
      'N content events produce exactly N+1 lines (session_start + N) @requirement:REQ-REC-003.2 @plan:PLAN-20260211-SESSIONRECORDING.P04',
      async (eventCount) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-count-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const config = makeConfig({ chatsDir: localChatsDir });
          const svc = new SessionRecordingService(config);

          for (let i = 0; i < eventCount; i++) {
            svc.recordContent(makeContent(`msg ${i}`));
          }
          await svc.flush();

          const events = await readJsonlFile(svc.getFilePath()!);
          expect(events).toHaveLength(eventCount + 1);

          svc.dispose();
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Property test 21: Timestamps are always valid ISO-8601 in any number of events.
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-001.3
     */
    it.prop([fc.integer({ min: 1, max: 15 })])(
      'all events have valid ISO-8601 timestamps @requirement:REQ-REC-001.3 @plan:PLAN-20260211-SESSIONRECORDING.P04',
      async (eventCount) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-ts-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
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

          svc.dispose();
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Property test 22: Envelope structure is consistent regardless of event type.
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-001
     */
    it.prop([
      fc.constantFrom(
        'content' as const,
        'compressed' as const,
        'rewind' as const,
        'provider_switch' as const,
        'session_event' as const,
        'directories_changed' as const,
      ),
    ])(
      'every event has consistent envelope {v, seq, ts, type, payload} @requirement:REQ-REC-001 @plan:PLAN-20260211-SESSIONRECORDING.P04',
      async (eventType) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-envelope-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const config = makeConfig({ chatsDir: localChatsDir });
          const svc = new SessionRecordingService(config);

          // First enqueue content to materialize
          svc.recordContent(makeContent('trigger'));

          // Then enqueue the specific event type
          switch (eventType) {
            case 'content':
              svc.recordContent(makeContent('test'));
              break;
            case 'compressed':
              svc.recordCompressed(
                { speaker: 'ai', blocks: [{ type: 'text', text: 'summary' }] },
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
          }

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

          svc.dispose();
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Property test 24: Any number of metadata events before first content preserves
     * exact order (Architecture Review FIX 7).
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-004, REQ-REC-001.2
     */
    it.prop([
      fc.array(
        fc.constantFrom(
          'provider_switch' as const,
          'directories_changed' as const,
          'session_event' as const,
        ),
        { minLength: 0, maxLength: 10 },
      ),
    ])(
      'any metadata events before first content are written in exact enqueue order @requirement:REQ-REC-004, REQ-REC-001.2 @plan:PLAN-20260211-SESSIONRECORDING.P04',
      async (metadataTypes) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-order-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const config = makeConfig({ chatsDir: localChatsDir });
          const svc = new SessionRecordingService(config);

          // Enqueue metadata events before any content
          for (const eventType of metadataTypes) {
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
            }
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

          svc.dispose();
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Property test (bonus): Session start payload always contains all required fields.
     *
     * @plan PLAN-20260211-SESSIONRECORDING.P04
     * @requirement REQ-REC-001
     */
    it.prop([
      fc.record({
        sessionId: fc.uuid(),
        provider: fc.constantFrom('anthropic', 'openai', 'google'),
        model: fc.string({ minLength: 1, maxLength: 30 }),
      }),
    ])(
      'session_start payload has all required fields @requirement:REQ-REC-001 @plan:PLAN-20260211-SESSIONRECORDING.P04',
      async ({ sessionId, provider, model }) => {
        const localTempDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'prop-start-'),
        );
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
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
          expect(startPayload.workspaceDirs).toEqual(config.workspaceDirs);
          expect(typeof startPayload.startTime).toBe('string');
          expect(isValidIso8601(startPayload.startTime as string)).toBe(true);

          svc.dispose();
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );
  });
});
