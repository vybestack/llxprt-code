/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { replaySession, readSessionHeader } from './ReplayEngine.js';
import {
  assertReplayOk,
  PROJECT_HASH,
  makeContent,
  sessionStartLine,
  contentLine,
  compressedLine,
  rewindLine,
  providerSwitchLine,
  sessionEventLine,
  writeJsonlFile,
  createValidFile,
} from './replay-test-helpers.js';

describe('ReplayEngine @plan:PLAN-20260211-SESSIONRECORDING.P07', () => {
  let tempDir: string;
  let chatsDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'replay-test-'));
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 13-14: Unknown events + non-monotonic seq
  // -------------------------------------------------------------------------

  describe('Unknown Events & Seq Warnings @requirement:REQ-RPL-002, REQ-RPL-005 @plan:PLAN-20260211-SESSIONRECORDING.P07', () => {
    /**
     * Test 13: Unknown event types skipped with warning.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-002
     */
    it('unknown event types are skipped with warning', async () => {
      const unknownLine = JSON.stringify({
        v: 1,
        seq: 3,
        ts: new Date().toISOString(),
        type: 'custom_event',
        payload: { data: 'whatever' },
      });
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('msg 1', 'human')),
        unknownLine,
        contentLine(4, makeContent('msg 2', 'ai')),
      ];
      const filePath = path.join(chatsDir, 'unknown-event.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);

      expect(result.history).toHaveLength(2);
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
      expect(result.warnings.some((w) => w.includes('custom_event'))).toBe(
        true,
      );
    });

    /**
     * Test 14: Non-monotonic seq logs warning but succeeds.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it('non-monotonic seq logs warning but replay succeeds', async () => {
      const lines = [
        sessionStartLine(1),
        contentLine(3, makeContent('msg 1', 'human')),
        contentLine(2, makeContent('msg 2', 'ai')), // out of order
        contentLine(4, makeContent('msg 3', 'human')),
      ];
      const filePath = path.join(chatsDir, 'non-monotonic.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);

      expect(result.history).toHaveLength(3);
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
      expect(
        result.warnings.some(
          (w) => w.includes('non-monotonic') || w.includes('seq'),
        ),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 15-18: Metadata tracking, lastSeq, eventCount
  // -------------------------------------------------------------------------

  describe('Metadata Tracking @requirement:REQ-RPL-007 @plan:PLAN-20260211-SESSIONRECORDING.P07', () => {
    /**
     * Test 15: provider_switch updates metadata.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-007
     */
    it('provider_switch updates metadata', async () => {
      const filePath = await createValidFile(chatsDir, (svc) => {
        svc.recordContent(makeContent('msg 1', 'human'));
        svc.recordProviderSwitch('openai', 'gpt-5');
        svc.recordContent(makeContent('msg 2', 'ai'));
      });

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);

      expect(result.metadata.provider).toBe('openai');
      expect(result.metadata.model).toBe('gpt-5');
    });

    /**
     * Test 16: directories_changed updates metadata.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-007
     */
    it('directories_changed updates metadata', async () => {
      const filePath = await createValidFile(chatsDir, (svc) => {
        svc.recordContent(makeContent('msg 1', 'human'));
        svc.recordDirectoriesChanged(['/new/project', '/other/dir']);
        svc.recordContent(makeContent('msg 2', 'ai'));
      });

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);

      expect(result.metadata.workspaceDirs).toStrictEqual([
        '/new/project',
        '/other/dir',
      ]);
    });

    /**
     * Test 17: lastSeq matches final event's seq.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001
     */
    it('lastSeq matches the last seen seq value', async () => {
      const filePath = await createValidFile(chatsDir, (svc) => {
        svc.recordContent(makeContent('msg 1', 'human'));
        svc.recordContent(makeContent('msg 2', 'ai'));
        svc.recordContent(makeContent('msg 3', 'human'));
      });

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);

      // session_start(1) + 3 content = 4 events, last seq is 4
      expect(result.lastSeq).toBe(4);
    });

    /**
     * Test 18: eventCount matches total processed.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001
     */
    it('eventCount matches total processed events', async () => {
      const filePath = await createValidFile(chatsDir, (svc) => {
        svc.recordContent(makeContent('msg 1', 'human'));
        svc.recordContent(makeContent('msg 2', 'ai'));
        svc.recordProviderSwitch('openai', 'gpt-5');
      });

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);

      // session_start + 2 content + provider_switch = 4
      expect(result.eventCount).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // 19-20: readSessionHeader
  // -------------------------------------------------------------------------

  describe('readSessionHeader @requirement:REQ-RPL-001 @plan:PLAN-20260211-SESSIONRECORDING.P07', () => {
    /**
     * Test 19: readSessionHeader returns first line metadata.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001
     */
    it('returns session metadata from the first line', async () => {
      const filePath = await createValidFile(chatsDir, (svc) => {
        svc.recordContent(makeContent('trigger', 'human'));
      });

      const header = await readSessionHeader(filePath);

      expect(header).not.toBeNull();
      expect(header!.sessionId).toBe('test-session-00000001');
      expect(header!.projectHash).toBe(PROJECT_HASH);
      expect(header!.provider).toBe('anthropic');
      expect(header!.model).toBe('claude-4');
    });

    /**
     * Test 20: readSessionHeader returns null for invalid file.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001
     */
    it('returns null for file with invalid first line', async () => {
      const filePath = path.join(chatsDir, 'bad-header.jsonl');
      await fs.writeFile(filePath, 'THIS IS NOT JSON\n', 'utf-8');

      const header = await readSessionHeader(filePath);

      expect(header).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 21-22: session_event handling
  // -------------------------------------------------------------------------

  describe('session_event Handling @requirement:REQ-RPL-008 @plan:PLAN-20260211-SESSIONRECORDING.P07', () => {
    /**
     * Test 21: session_event collected in sessionEvents, not in history.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-008
     */
    it('session_event records are in sessionEvents, NOT in history', async () => {
      const filePath = await createValidFile(chatsDir, (svc) => {
        svc.recordContent(makeContent('msg 1', 'human'));
        svc.recordSessionEvent('info', 'Turn completed successfully');
        svc.recordContent(makeContent('msg 2', 'ai'));
        svc.recordSessionEvent('warning', 'Token limit approaching');
      });

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);

      // History should only have the 2 content events
      expect(result.history).toHaveLength(2);
      expect(result.history[0].speaker).toBe('human');
      expect(result.history[1].speaker).toBe('ai');

      // sessionEvents should have the 2 session_event entries
      expect(result.sessionEvents).toHaveLength(2);
      expect(result.sessionEvents[0]).toStrictEqual({
        severity: 'info',
        message: 'Turn completed successfully',
      });
      expect(result.sessionEvents[1]).toStrictEqual({
        severity: 'warning',
        message: 'Token limit approaching',
      });
    });

    /**
     * Test 22: session_event("Session resumed...") collected for audit.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-008
     */
    it('session_event "Session resumed" collected for audit, not in history', async () => {
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('original msg', 'human')),
        contentLine(3, makeContent('original response', 'ai')),
        sessionEventLine(
          4,
          'info',
          'Session resumed at 2026-02-11T17:00:00.000Z',
        ),
        contentLine(5, makeContent('resumed msg', 'human')),
      ];
      const filePath = path.join(chatsDir, 'resumed.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);

      expect(result.history).toHaveLength(3);
      expect(result.sessionEvents).toHaveLength(1);
      expect(result.sessionEvents[0].message).toContain('Session resumed');
    });
  });

  // -------------------------------------------------------------------------
  // 23-27: Golden replay tests
  // -------------------------------------------------------------------------

  describe('Golden Replay Tests @requirement:REQ-RPL-001, REQ-RPL-002 @plan:PLAN-20260211-SESSIONRECORDING.P07', () => {
    /**
     * Test 23: Golden — New session event ordering.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001, REQ-RPL-002
     */
    it('golden: new session with correct ordering', async () => {
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('user 1', 'human')),
        contentLine(3, makeContent('ai 1', 'ai')),
        contentLine(4, makeContent('user 2', 'human')),
        contentLine(5, makeContent('ai 2', 'ai')),
        sessionEventLine(6, 'info', 'Turn completed'),
      ];
      const filePath = path.join(chatsDir, 'golden-new.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);

      expect(result.history).toHaveLength(4);
      expect(result.metadata.sessionId).toBe('test-session-00000001');
      expect(result.lastSeq).toBe(6);
      expect(result.warnings).toHaveLength(0);
    });

    /**
     * Test 24: Golden — Resumed session event ordering.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001, REQ-RPL-002, REQ-RPL-007
     */
    it('golden: resumed session with provider switch', async () => {
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('original', 'human')),
        contentLine(3, makeContent('response', 'ai')),
        sessionEventLine(4, 'info', 'Session resumed at T1'),
        providerSwitchLine(5, 'openai', 'gpt-5'),
        contentLine(6, makeContent('resumed msg', 'human')),
        contentLine(7, makeContent('resumed response', 'ai')),
      ];
      const filePath = path.join(chatsDir, 'golden-resumed.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);

      expect(result.history).toHaveLength(4);
      expect(result.metadata.provider).toBe('openai');
      expect(result.metadata.model).toBe('gpt-5');
      expect(result.warnings).toHaveLength(0);
    });

    /**
     * Test 25: Golden — Session with compression.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-003
     */
    it('golden: session with compression', async () => {
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('msg 1', 'human')),
        contentLine(3, makeContent('resp 1', 'ai')),
        contentLine(4, makeContent('msg 2', 'human')),
        contentLine(5, makeContent('resp 2', 'ai')),
        compressedLine(6, makeContent('Summary of 4 msgs', 'ai'), 4),
        contentLine(7, makeContent('post-comp 1', 'human')),
        contentLine(8, makeContent('post-comp 2', 'ai')),
      ];
      const filePath = path.join(chatsDir, 'golden-compressed.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);

      expect(result.history).toHaveLength(3);
      expect(result.history[0].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'Summary of 4 msgs',
      });
      expect(result.history[1].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'post-comp 1',
      });
      expect(result.history[2].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'post-comp 2',
      });
    });

    /**
     * Test 26: Golden — Session with multiple resumes.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001, REQ-RPL-007
     */
    it('golden: session with multiple resumes preserves all content', async () => {
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('seg1-user', 'human')),
        contentLine(3, makeContent('seg1-ai', 'ai')),
        sessionEventLine(4, 'info', 'Session resumed at T1'),
        contentLine(5, makeContent('seg2-user', 'human')),
        contentLine(6, makeContent('seg2-ai', 'ai')),
        sessionEventLine(7, 'info', 'Session resumed at T2'),
        providerSwitchLine(8, 'google', 'gemini-2'),
        contentLine(9, makeContent('seg3-user', 'human')),
        contentLine(10, makeContent('seg3-ai', 'ai')),
      ];
      const filePath = path.join(chatsDir, 'golden-multi-resume.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);

      expect(result.history).toHaveLength(6);
      expect(result.metadata.provider).toBe('google');
      expect(result.metadata.model).toBe('gemini-2');
      expect(result.sessionEvents).toHaveLength(2);
    });

    /**
     * Test 27: Golden — Resume + compression + resume.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001, REQ-RPL-003
     */
    it('golden: resume + compression + resume, compression supersedes all prior', async () => {
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('initial', 'human')),
        contentLine(3, makeContent('response', 'ai')),
        sessionEventLine(4, 'info', 'Session resumed at T1'),
        contentLine(5, makeContent('resumed 1', 'human')),
        contentLine(6, makeContent('resumed resp 1', 'ai')),
        compressedLine(7, makeContent('Big summary', 'ai'), 4),
        contentLine(8, makeContent('post-comp', 'human')),
        sessionEventLine(9, 'info', 'Session resumed at T2'),
        contentLine(10, makeContent('final msg', 'human')),
      ];
      const filePath = path.join(chatsDir, 'golden-resume-comp-resume.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);

      // summary + post-comp + final msg = 3
      expect(result.history).toHaveLength(3);
      expect(result.history[0].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'Big summary',
      });
      expect(result.history[1].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'post-comp',
      });
      expect(result.history[2].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'final msg',
      });
    });
  });

  // -------------------------------------------------------------------------
  // 28-29: Interleaved and edge-case tests
  // -------------------------------------------------------------------------

  describe('Interleaved Events @requirement:REQ-RPL-002, REQ-RPL-003 @plan:PLAN-20260211-SESSIONRECORDING.P07', () => {
    /**
     * Test 28: Interleaved content + compressed + rewind in same turn boundary.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-002, REQ-RPL-003
     */
    it('compression then rewind then new content produces correct state', async () => {
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('msg 1', 'human')),
        contentLine(3, makeContent('msg 2', 'ai')),
        contentLine(4, makeContent('msg 3', 'human')),
        compressedLine(5, makeContent('Summary', 'ai'), 3),
        contentLine(6, makeContent('post 1', 'human')),
        contentLine(7, makeContent('post 2', 'ai')),
        rewindLine(8, 1),
        contentLine(9, makeContent('replacement', 'ai')),
      ];
      const filePath = path.join(chatsDir, 'interleaved-1.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);

      // summary + post 1 (post 2 rewound) + replacement = 3
      expect(result.history).toHaveLength(3);
      expect(result.history[0].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'Summary',
      });
      expect(result.history[1].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'post 1',
      });
      expect(result.history[2].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'replacement',
      });
    });

    /**
     * Test 29: Extended interleaved events.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-002, REQ-RPL-003
     */
    it('content -> compressed -> content -> rewind -> content produces correct final state', async () => {
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('a', 'human')),
        contentLine(3, makeContent('b', 'ai')),
        compressedLine(4, makeContent('AB summary', 'ai'), 2),
        contentLine(5, makeContent('c', 'human')),
        contentLine(6, makeContent('d', 'ai')),
        rewindLine(7, 2), // removes c and d
        contentLine(8, makeContent('e', 'human')),
        contentLine(9, makeContent('f', 'ai')),
      ];
      const filePath = path.join(chatsDir, 'interleaved-2.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);

      // summary + e + f = 3
      expect(result.history).toHaveLength(3);
      expect(result.history[0].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'AB summary',
      });
      expect(result.history[1].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'e',
      });
      expect(result.history[2].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'f',
      });
    });
  });

  // -------------------------------------------------------------------------
  // 30-38: Malformed known payloads
  // -------------------------------------------------------------------------

  describe('Malformed Payloads @requirement:REQ-RPL-005 @plan:PLAN-20260211-SESSIONRECORDING.P07', () => {
    /**
     * Test 30: Malformed session_start (missing sessionId) as first line.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it('malformed session_start (missing sessionId) as first line returns fatal error', async () => {
      const badStart = JSON.stringify({
        v: 1,
        seq: 1,
        ts: new Date().toISOString(),
        type: 'session_start',
        payload: {
          projectHash: PROJECT_HASH,
          provider: 'anthropic',
          model: 'claude-4',
        },
      });
      const lines = [badStart, contentLine(2, makeContent('msg', 'human'))];
      const filePath = path.join(chatsDir, 'bad-start.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);
      expect(result.ok).toBe(false);
    });

    /**
     * Test 30b: Malformed session_start mid-file after valid session_start → skipped with warning.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it('malformed session_start mid-file is handled (warning or skip)', async () => {
      const badMidStart = JSON.stringify({
        v: 1,
        seq: 3,
        ts: new Date().toISOString(),
        type: 'session_start',
        payload: { provider: 'anthropic' }, // missing sessionId and projectHash
      });
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('msg', 'human')),
        badMidStart,
        contentLine(4, makeContent('msg 2', 'ai')),
      ];
      const filePath = path.join(chatsDir, 'bad-mid-start.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);
      expect(result.history).toHaveLength(2);
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    });

    /**
     * Test 31: Malformed content (missing content field).
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it('malformed content event (missing content field) is skipped with warning', async () => {
      const badContent = JSON.stringify({
        v: 1,
        seq: 3,
        ts: new Date().toISOString(),
        type: 'content',
        payload: { data: 'not a content field' },
      });
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('good 1', 'human')),
        badContent,
        contentLine(4, makeContent('good 2', 'ai')),
      ];
      const filePath = path.join(chatsDir, 'bad-content.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);
      expect(result.history).toHaveLength(2);
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    });

    /**
     * Test 32: Malformed compressed (missing summary).
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it('malformed compressed (missing summary) is skipped with warning, history NOT cleared', async () => {
      const badCompressed = JSON.stringify({
        v: 1,
        seq: 4,
        ts: new Date().toISOString(),
        type: 'compressed',
        payload: { itemsCompressed: 3 },
      });
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('msg 1', 'human')),
        contentLine(3, makeContent('msg 2', 'ai')),
        badCompressed,
        contentLine(5, makeContent('msg 3', 'human')),
      ];
      const filePath = path.join(chatsDir, 'bad-compressed.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);

      // History should NOT be cleared — malformed compressed is skipped
      expect(result.history).toHaveLength(3);
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    });

    /**
     * Test 33: Malformed rewind (missing itemsRemoved).
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it('malformed rewind (missing itemsRemoved) is skipped with warning', async () => {
      const badRewind = JSON.stringify({
        v: 1,
        seq: 4,
        ts: new Date().toISOString(),
        type: 'rewind',
        payload: { count: 2 }, // wrong field name
      });
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('msg 1', 'human')),
        contentLine(3, makeContent('msg 2', 'ai')),
        badRewind,
      ];
      const filePath = path.join(chatsDir, 'bad-rewind.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);
      expect(result.history).toHaveLength(2);
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    });

    /**
     * Test 34: Malformed rewind (negative itemsRemoved).
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it('malformed rewind (negative itemsRemoved) is skipped with warning', async () => {
      const badRewind = JSON.stringify({
        v: 1,
        seq: 4,
        ts: new Date().toISOString(),
        type: 'rewind',
        payload: { itemsRemoved: -3 },
      });
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('msg 1', 'human')),
        contentLine(3, makeContent('msg 2', 'ai')),
        badRewind,
      ];
      const filePath = path.join(chatsDir, 'bad-rewind-neg.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);
      expect(result.history).toHaveLength(2);
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    });

    /**
     * Test 35: Malformed provider_switch (missing provider).
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it('malformed provider_switch (missing provider) is skipped with warning, metadata unchanged', async () => {
      const badSwitch = JSON.stringify({
        v: 1,
        seq: 3,
        ts: new Date().toISOString(),
        type: 'provider_switch',
        payload: { model: 'gpt-5' },
      });
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('msg', 'human')),
        badSwitch,
      ];
      const filePath = path.join(chatsDir, 'bad-switch.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);
      expect(result.metadata.provider).toBe('anthropic');
    });

    /**
     * Test 36: Malformed session_event (missing severity).
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it('malformed session_event (missing severity) is skipped with warning', async () => {
      const badEvent = JSON.stringify({
        v: 1,
        seq: 3,
        ts: new Date().toISOString(),
        type: 'session_event',
        payload: { message: 'no severity field' },
      });
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('msg', 'human')),
        badEvent,
        contentLine(4, makeContent('msg 2', 'ai')),
      ];
      const filePath = path.join(chatsDir, 'bad-session-event.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);
      expect(result.history).toHaveLength(2);
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    });

    /**
     * Test 37: Malformed directories_changed (missing directories).
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it('malformed directories_changed (missing directories) is skipped, metadata unchanged', async () => {
      const badDirs = JSON.stringify({
        v: 1,
        seq: 3,
        ts: new Date().toISOString(),
        type: 'directories_changed',
        payload: { paths: ['/wrong/field'] },
      });
      const lines = [
        sessionStartLine(1, { workspaceDirs: ['/original'] }),
        contentLine(2, makeContent('msg', 'human')),
        badDirs,
      ];
      const filePath = path.join(chatsDir, 'bad-dirs.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);
      expect(result.metadata.workspaceDirs).toStrictEqual(['/original']);
    });

    /**
     * Test 38: Malformed compressed (missing itemsCompressed).
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it('malformed compressed (missing itemsCompressed) is skipped, history preserved', async () => {
      const badCompressed = JSON.stringify({
        v: 1,
        seq: 4,
        ts: new Date().toISOString(),
        type: 'compressed',
        payload: { summary: makeContent('Summary', 'ai') },
      });
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('msg 1', 'human')),
        contentLine(3, makeContent('msg 2', 'ai')),
        badCompressed,
        contentLine(5, makeContent('msg 3', 'human')),
      ];
      const filePath = path.join(chatsDir, 'bad-comp-no-count.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);
      // The compressed event is malformed (missing itemsCompressed), so it should be skipped.
      // History is NOT cleared — 3 original content events remain.
      expect(result.history).toHaveLength(3);
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    });
  });
});
