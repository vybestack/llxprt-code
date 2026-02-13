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
 * @plan PLAN-20260211-SESSIONRECORDING.P07
 * @requirement REQ-RPL-001, REQ-RPL-002, REQ-RPL-003, REQ-RPL-005, REQ-RPL-006, REQ-RPL-007, REQ-RPL-008
 *
 * Behavioral tests for ReplayEngine. Tests verify correct replay of session
 * JSONL files — no mock theater.
 *
 * Happy-path tests use SessionRecordingService to generate valid JSONL files.
 * Corruption/edge-case tests hand-craft JSONL strings directly.
 *
 * Property-based tests use @fast-check/vitest (≥30% of total tests).
 * All tests expect real behavior from replaySession / readSessionHeader.
 */

import { describe, expect, beforeEach, afterEach } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { replaySession, readSessionHeader } from './ReplayEngine.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import {
  type SessionRecordingServiceConfig,
  type SessionStartPayload,
  type SessionEventPayload,
} from './types.js';
import { type IContent } from '../services/history/IContent.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_HASH = 'abc123def456';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(
  overrides: Partial<SessionRecordingServiceConfig> = {},
): SessionRecordingServiceConfig {
  return {
    sessionId: overrides.sessionId ?? 'test-session-00000001',
    projectHash: overrides.projectHash ?? PROJECT_HASH,
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

function makeContentWithToolCall(
  toolName: string,
  params: unknown,
): IContent {
  return {
    speaker: 'ai',
    blocks: [
      { type: 'text', text: `Calling ${toolName}` },
      { type: 'tool_call', id: `call_${toolName}`, name: toolName, parameters: params },
    ],
  };
}

/**
 * Build a valid JSONL line for a session_start event.
 */
function sessionStartLine(
  seq: number,
  overrides: Partial<SessionStartPayload> = {},
): string {
  const payload: SessionStartPayload = {
    sessionId: overrides.sessionId ?? 'test-session-00000001',
    projectHash: overrides.projectHash ?? PROJECT_HASH,
    workspaceDirs: overrides.workspaceDirs ?? ['/home/user/project'],
    provider: overrides.provider ?? 'anthropic',
    model: overrides.model ?? 'claude-4',
    startTime: overrides.startTime ?? '2026-02-11T16:00:00.000Z',
  };
  return JSON.stringify({
    v: 1,
    seq,
    ts: '2026-02-11T16:00:00.000Z',
    type: 'session_start',
    payload,
  });
}

/**
 * Build a valid JSONL line for a content event.
 */
function contentLine(seq: number, content: IContent): string {
  return JSON.stringify({
    v: 1,
    seq,
    ts: new Date().toISOString(),
    type: 'content',
    payload: { content },
  });
}

/**
 * Build a valid JSONL line for a compressed event.
 */
function compressedLine(
  seq: number,
  summary: IContent,
  itemsCompressed: number,
): string {
  return JSON.stringify({
    v: 1,
    seq,
    ts: new Date().toISOString(),
    type: 'compressed',
    payload: { summary, itemsCompressed },
  });
}

/**
 * Build a valid JSONL line for a rewind event.
 */
function rewindLine(seq: number, itemsRemoved: number): string {
  return JSON.stringify({
    v: 1,
    seq,
    ts: new Date().toISOString(),
    type: 'rewind',
    payload: { itemsRemoved },
  });
}

/**
 * Build a valid JSONL line for a provider_switch event.
 */
function providerSwitchLine(
  seq: number,
  provider: string,
  model: string,
): string {
  return JSON.stringify({
    v: 1,
    seq,
    ts: new Date().toISOString(),
    type: 'provider_switch',
    payload: { provider, model },
  });
}

/**
 * Build a valid JSONL line for a session_event event.
 */
function sessionEventLine(
  seq: number,
  severity: 'info' | 'warning' | 'error',
  message: string,
): string {
  return JSON.stringify({
    v: 1,
    seq,
    ts: new Date().toISOString(),
    type: 'session_event',
    payload: { severity, message },
  });
}

/**
 * Build a valid JSONL line for a directories_changed event.
 */
function directoriesChangedLine(
  seq: number,
  directories: string[],
): string {
  return JSON.stringify({
    v: 1,
    seq,
    ts: new Date().toISOString(),
    type: 'directories_changed',
    payload: { directories },
  });
}

/**
 * Write raw JSONL lines to a file.
 */
async function writeJsonlFile(
  filePath: string,
  lines: string[],
): Promise<void> {
  await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf-8');
}

/**
 * Use SessionRecordingService to create a valid file and return its path.
 */
async function createValidFile(
  chatsDir: string,
  setup: (svc: SessionRecordingService) => void,
  configOverrides: Partial<SessionRecordingServiceConfig> = {},
): Promise<string> {
  const config = makeConfig({ chatsDir, ...configOverrides });
  const svc = new SessionRecordingService(config);
  setup(svc);
  await svc.flush();
  const filePath = svc.getFilePath()!;
  svc.dispose();
  return filePath;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

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
  // 1-2: Simple replay with content events
  // -------------------------------------------------------------------------

  describe('Content Accumulation @requirement:REQ-RPL-002 @plan:PLAN-20260211-SESSIONRECORDING.P07', () => {
    /**
     * Test 1: Simple replay with user+ai messages.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-002
     */
    it('replays valid file with user+AI messages into correct IContent[] history', async () => {
      const filePath = await createValidFile(chatsDir, (svc) => {
        svc.recordContent(makeContent('Hello from user', 'human'));
        svc.recordContent(makeContent('Hello from AI', 'ai'));
      });

      const result = await replaySession(filePath, PROJECT_HASH);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.history).toHaveLength(2);
      expect(result.history[0].speaker).toBe('human');
      expect(result.history[0].blocks[0]).toEqual({
        type: 'text',
        text: 'Hello from user',
      });
      expect(result.history[1].speaker).toBe('ai');
      expect(result.history[1].blocks[0]).toEqual({
        type: 'text',
        text: 'Hello from AI',
      });
    });

    /**
     * Test 2: Replay preserves IContent structure with tool_call blocks.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-002
     */
    it('preserves IContent structure including tool_call blocks', async () => {
      const toolContent = makeContentWithToolCall('readFile', {
        path: '/foo.ts',
      });
      const filePath = await createValidFile(chatsDir, (svc) => {
        svc.recordContent(makeContent('Read the file', 'human'));
        svc.recordContent(toolContent);
      });

      const result = await replaySession(filePath, PROJECT_HASH);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.history).toHaveLength(2);
      expect(result.history[1].speaker).toBe('ai');
      expect(result.history[1].blocks).toHaveLength(2);
      expect(result.history[1].blocks[0]).toEqual({
        type: 'text',
        text: 'Calling readFile',
      });
      expect(result.history[1].blocks[1]).toEqual({
        type: 'tool_call',
        id: 'call_readFile',
        name: 'readFile',
        parameters: { path: '/foo.ts' },
      });
    });
  });

  // -------------------------------------------------------------------------
  // 3-4: Compression handling
  // -------------------------------------------------------------------------

  describe('Compression Handling @requirement:REQ-RPL-003 @plan:PLAN-20260211-SESSIONRECORDING.P07', () => {
    /**
     * Test 3: Compression resets history.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-003
     */
    it('compression resets history to summary + post-compression content', async () => {
      const filePath = await createValidFile(chatsDir, (svc) => {
        for (let i = 0; i < 5; i++) {
          svc.recordContent(makeContent(`msg ${i}`, i % 2 === 0 ? 'human' : 'ai'));
        }
        svc.recordCompressed(
          makeContent('Summary of 5 messages', 'ai'),
          5,
        );
        svc.recordContent(makeContent('post-compression 1', 'human'));
        svc.recordContent(makeContent('post-compression 2', 'ai'));
      });

      const result = await replaySession(filePath, PROJECT_HASH);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.history).toHaveLength(3);
      expect(result.history[0].speaker).toBe('ai');
      expect(result.history[0].blocks[0]).toEqual({
        type: 'text',
        text: 'Summary of 5 messages',
      });
      expect(result.history[1].blocks[0]).toEqual({
        type: 'text',
        text: 'post-compression 1',
      });
      expect(result.history[2].blocks[0]).toEqual({
        type: 'text',
        text: 'post-compression 2',
      });
    });

    /**
     * Test 4: Multiple compressions use last.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-003
     */
    it('multiple compressions use last compression as base', async () => {
      const filePath = await createValidFile(chatsDir, (svc) => {
        for (let i = 0; i < 5; i++) {
          svc.recordContent(makeContent(`batch1-msg ${i}`, 'human'));
        }
        svc.recordCompressed(
          makeContent('First summary', 'ai'),
          5,
        );
        svc.recordContent(makeContent('mid 1', 'human'));
        svc.recordContent(makeContent('mid 2', 'ai'));
        svc.recordCompressed(
          makeContent('Second summary', 'ai'),
          3,
        );
        svc.recordContent(makeContent('final 1', 'human'));
        svc.recordContent(makeContent('final 2', 'ai'));
      });

      const result = await replaySession(filePath, PROJECT_HASH);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.history).toHaveLength(3);
      expect(result.history[0].blocks[0]).toEqual({
        type: 'text',
        text: 'Second summary',
      });
      expect(result.history[1].blocks[0]).toEqual({
        type: 'text',
        text: 'final 1',
      });
      expect(result.history[2].blocks[0]).toEqual({
        type: 'text',
        text: 'final 2',
      });
    });
  });

  // -------------------------------------------------------------------------
  // 5-7: Rewind handling
  // -------------------------------------------------------------------------

  describe('Rewind Handling @requirement:REQ-RPL-002d @plan:PLAN-20260211-SESSIONRECORDING.P07', () => {
    /**
     * Test 5: Rewind removes N items.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-002d
     */
    it('rewind removes last N items from accumulated history', async () => {
      const filePath = await createValidFile(chatsDir, (svc) => {
        for (let i = 0; i < 5; i++) {
          svc.recordContent(makeContent(`msg ${i}`, i % 2 === 0 ? 'human' : 'ai'));
        }
        svc.recordRewind(2);
      });

      const result = await replaySession(filePath, PROJECT_HASH);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.history).toHaveLength(3);
      expect(result.history[0].blocks[0]).toEqual({ type: 'text', text: 'msg 0' });
      expect(result.history[1].blocks[0]).toEqual({ type: 'text', text: 'msg 1' });
      expect(result.history[2].blocks[0]).toEqual({ type: 'text', text: 'msg 2' });
    });

    /**
     * Test 6: Rewind exceeding history empties.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-002d
     */
    it('rewind exceeding history size produces empty history (not error)', async () => {
      const filePath = await createValidFile(chatsDir, (svc) => {
        svc.recordContent(makeContent('msg 1', 'human'));
        svc.recordContent(makeContent('msg 2', 'ai'));
        svc.recordRewind(10);
      });

      const result = await replaySession(filePath, PROJECT_HASH);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.history).toHaveLength(0);
    });

    /**
     * Test 7: Rewind after compression operates on post-compression items only.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-002d, REQ-RPL-003
     */
    it('rewind after compression operates on post-compression items only', async () => {
      const filePath = await createValidFile(chatsDir, (svc) => {
        for (let i = 0; i < 4; i++) {
          svc.recordContent(makeContent(`pre ${i}`, 'human'));
        }
        svc.recordCompressed(makeContent('Summary', 'ai'), 4);
        svc.recordContent(makeContent('post 1', 'human'));
        svc.recordContent(makeContent('post 2', 'ai'));
        svc.recordContent(makeContent('post 3', 'human'));
        svc.recordRewind(1);
      });

      const result = await replaySession(filePath, PROJECT_HASH);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // summary + 2 remaining post-compression items
      expect(result.history).toHaveLength(3);
      expect(result.history[0].blocks[0]).toEqual({ type: 'text', text: 'Summary' });
      expect(result.history[1].blocks[0]).toEqual({ type: 'text', text: 'post 1' });
      expect(result.history[2].blocks[0]).toEqual({ type: 'text', text: 'post 2' });
    });
  });

  // -------------------------------------------------------------------------
  // 8-9: Corruption handling
  // -------------------------------------------------------------------------

  describe('Corruption Handling @requirement:REQ-RPL-005 @plan:PLAN-20260211-SESSIONRECORDING.P07', () => {
    /**
     * Test 8: Corrupt last line silently discarded.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it('corrupt last line is silently discarded with NO warning', async () => {
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('msg 1', 'human')),
        contentLine(3, makeContent('msg 2', 'ai')),
        '{"v":1,"seq":4,"ts":"2026-02-11T16:00:10.000Z","type":"content","payload":{"content":{"speaker":"hum', // truncated
      ];
      const filePath = path.join(chatsDir, 'corrupt-last.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.history).toHaveLength(2);
      expect(result.history[0].speaker).toBe('human');
      expect(result.history[1].speaker).toBe('ai');
      // No warning for corrupt last line — silent discard
      expect(result.warnings).toHaveLength(0);
    });

    /**
     * Test 9: Corrupt mid-file line skipped with warning.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it('corrupt mid-file line is skipped with warning, rest replayed', async () => {
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('msg 1', 'human')),
        'THIS IS NOT VALID JSON AT ALL!!!',
        contentLine(4, makeContent('msg 3', 'ai')),
      ];
      const filePath = path.join(chatsDir, 'corrupt-mid.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.history).toHaveLength(2);
      expect(result.history[0].speaker).toBe('human');
      expect(result.history[1].speaker).toBe('ai');
      // Warning for mid-file corruption includes line number
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
      expect(result.warnings.some((w) => w.includes('3'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 10-12: Error results
  // -------------------------------------------------------------------------

  describe('Error Results @requirement:REQ-RPL-005, REQ-RPL-006 @plan:PLAN-20260211-SESSIONRECORDING.P07', () => {
    /**
     * Test 10: Missing session_start returns error.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it('missing session_start returns error result', async () => {
      const lines = [
        contentLine(1, makeContent('orphan content', 'human')),
        contentLine(2, makeContent('more content', 'ai')),
      ];
      const filePath = path.join(chatsDir, 'no-start.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeTruthy();
    });

    /**
     * Test 11: Empty file returns error.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it('empty file returns error result', async () => {
      const filePath = path.join(chatsDir, 'empty.jsonl');
      await fs.writeFile(filePath, '', 'utf-8');

      const result = await replaySession(filePath, PROJECT_HASH);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeTruthy();
    });

    /**
     * Test 12: Project hash mismatch returns error.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-006
     */
    it('project hash mismatch returns error result', async () => {
      const lines = [
        sessionStartLine(1, { projectHash: 'abc' }),
        contentLine(2, makeContent('msg', 'human')),
      ];
      const filePath = path.join(chatsDir, 'hash-mismatch.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, 'def');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('hash');
    });
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

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.history).toHaveLength(2);
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
      expect(result.warnings.some((w) => w.includes('custom_event'))).toBe(true);
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

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.history).toHaveLength(3);
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
      expect(result.warnings.some((w) => w.includes('non-monotonic') || w.includes('seq'))).toBe(true);
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

      expect(result.ok).toBe(true);
      if (!result.ok) return;

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

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.metadata.workspaceDirs).toEqual(['/new/project', '/other/dir']);
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

      expect(result.ok).toBe(true);
      if (!result.ok) return;

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

      expect(result.ok).toBe(true);
      if (!result.ok) return;

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

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // History should only have the 2 content events
      expect(result.history).toHaveLength(2);
      expect(result.history[0].speaker).toBe('human');
      expect(result.history[1].speaker).toBe('ai');

      // sessionEvents should have the 2 session_event entries
      expect(result.sessionEvents).toHaveLength(2);
      expect(result.sessionEvents[0]).toEqual({
        severity: 'info',
        message: 'Turn completed successfully',
      });
      expect(result.sessionEvents[1]).toEqual({
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
        sessionEventLine(4, 'info', 'Session resumed at 2026-02-11T17:00:00.000Z'),
        contentLine(5, makeContent('resumed msg', 'human')),
      ];
      const filePath = path.join(chatsDir, 'resumed.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

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

      expect(result.ok).toBe(true);
      if (!result.ok) return;

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

      expect(result.ok).toBe(true);
      if (!result.ok) return;

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

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.history).toHaveLength(3);
      expect(result.history[0].blocks[0]).toEqual({ type: 'text', text: 'Summary of 4 msgs' });
      expect(result.history[1].blocks[0]).toEqual({ type: 'text', text: 'post-comp 1' });
      expect(result.history[2].blocks[0]).toEqual({ type: 'text', text: 'post-comp 2' });
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

      expect(result.ok).toBe(true);
      if (!result.ok) return;

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

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // summary + post-comp + final msg = 3
      expect(result.history).toHaveLength(3);
      expect(result.history[0].blocks[0]).toEqual({ type: 'text', text: 'Big summary' });
      expect(result.history[1].blocks[0]).toEqual({ type: 'text', text: 'post-comp' });
      expect(result.history[2].blocks[0]).toEqual({ type: 'text', text: 'final msg' });
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

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // summary + post 1 (post 2 rewound) + replacement = 3
      expect(result.history).toHaveLength(3);
      expect(result.history[0].blocks[0]).toEqual({ type: 'text', text: 'Summary' });
      expect(result.history[1].blocks[0]).toEqual({ type: 'text', text: 'post 1' });
      expect(result.history[2].blocks[0]).toEqual({ type: 'text', text: 'replacement' });
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

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // summary + e + f = 3
      expect(result.history).toHaveLength(3);
      expect(result.history[0].blocks[0]).toEqual({ type: 'text', text: 'AB summary' });
      expect(result.history[1].blocks[0]).toEqual({ type: 'text', text: 'e' });
      expect(result.history[2].blocks[0]).toEqual({ type: 'text', text: 'f' });
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
        payload: { projectHash: PROJECT_HASH, provider: 'anthropic', model: 'claude-4' },
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

      expect(result.ok).toBe(true);
      if (!result.ok) return;
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

      expect(result.ok).toBe(true);
      if (!result.ok) return;
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

      expect(result.ok).toBe(true);
      if (!result.ok) return;

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

      expect(result.ok).toBe(true);
      if (!result.ok) return;
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

      expect(result.ok).toBe(true);
      if (!result.ok) return;
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

      expect(result.ok).toBe(true);
      if (!result.ok) return;
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

      expect(result.ok).toBe(true);
      if (!result.ok) return;
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

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.metadata.workspaceDirs).toEqual(['/original']);
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

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The compressed event is malformed (missing itemsCompressed), so it should be skipped.
      // History is NOT cleared — 3 original content events remain.
      expect(result.history).toHaveLength(3);
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // 39-40: Repeated resume cycles
  // -------------------------------------------------------------------------

  describe('Repeated Resume Cycles @requirement:REQ-RPL-001, REQ-RPL-002 @plan:PLAN-20260211-SESSIONRECORDING.P07', () => {
    /**
     * Test 39: Repeated resume cycles verify seq monotonicity and no duplicate session_start.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001
     */
    it('3 resume boundaries: exactly 1 session_start, all content preserved', async () => {
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('seg1', 'human')),
        sessionEventLine(3, 'info', 'Session resumed at T1'),
        contentLine(4, makeContent('seg2', 'human')),
        sessionEventLine(5, 'info', 'Session resumed at T2'),
        contentLine(6, makeContent('seg3', 'human')),
        sessionEventLine(7, 'info', 'Session resumed at T3'),
        contentLine(8, makeContent('seg4', 'human')),
      ];
      const filePath = path.join(chatsDir, 'multi-resume.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.history).toHaveLength(4);
      expect(result.sessionEvents).toHaveLength(3);
      expect(result.warnings).toHaveLength(0);
    });

    /**
     * Test 40: Repeated resume cycles — history accumulation.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-002
     */
    it('all content from all resume cycles present in final history', async () => {
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('cycle1-msg1', 'human')),
        contentLine(3, makeContent('cycle1-msg2', 'ai')),
        sessionEventLine(4, 'info', 'Session resumed'),
        contentLine(5, makeContent('cycle2-msg1', 'human')),
        contentLine(6, makeContent('cycle2-msg2', 'ai')),
        sessionEventLine(7, 'info', 'Session resumed'),
        contentLine(8, makeContent('cycle3-msg1', 'human')),
        contentLine(9, makeContent('cycle3-msg2', 'ai')),
      ];
      const filePath = path.join(chatsDir, 'resume-accumulation.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.history).toHaveLength(6);
      const texts = result.history.map(
        (h) => (h.blocks[0] as { type: 'text'; text: string }).text,
      );
      expect(texts).toEqual([
        'cycle1-msg1',
        'cycle1-msg2',
        'cycle2-msg1',
        'cycle2-msg2',
        'cycle3-msg1',
        'cycle3-msg2',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // 41-42: Malformed event summary reporting
  // -------------------------------------------------------------------------

  describe('Malformed Event Summary @requirement:REQ-RPL-005 @plan:PLAN-20260211-SESSIONRECORDING.P07', () => {
    /**
     * Test 41: Replay malformed event summary.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it('file with multiple malformed events produces warnings', async () => {
      const badLine = JSON.stringify({
        v: 1,
        seq: 0, // will be overridden
        ts: new Date().toISOString(),
        type: 'content',
        payload: { data: 'missing content field' },
      });
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('good', 'human')),
        badLine.replace('"seq":0', '"seq":3'),
        badLine.replace('"seq":0', '"seq":4'),
        badLine.replace('"seq":0', '"seq":5'),
        contentLine(6, makeContent('also good', 'ai')),
      ];
      const filePath = path.join(chatsDir, 'multi-bad.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.history).toHaveLength(2);
      expect(result.warnings.length).toBeGreaterThanOrEqual(3);
    });

    /**
     * Test 42: Replay 5% threshold warning.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it('file where >5% events are malformed produces threshold warning', async () => {
      // 20 total events, 2 malformed = 10% > 5%
      const lines: string[] = [sessionStartLine(1)];
      for (let i = 2; i <= 19; i++) {
        lines.push(contentLine(i, makeContent(`msg ${i}`, i % 2 === 0 ? 'human' : 'ai')));
      }
      // Replace 2 mid-file content lines with malformed ones
      lines[3] = 'NOT JSON';
      lines[7] = '{"broken": true';
      lines.push(contentLine(20, makeContent('last', 'human')));

      const filePath = path.join(chatsDir, 'threshold.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Should have a threshold warning
      expect(result.warnings.some((w) => w.includes('5%') || w.includes('WARNING'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 42a-42b: BOM handling
  // -------------------------------------------------------------------------

  describe('BOM Handling @requirement:REQ-RPL-005 @plan:PLAN-20260211-SESSIONRECORDING.P07', () => {
    /**
     * Test 42a: UTF-8 BOM on first line stripped before parsing.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it('UTF-8 BOM on first line is stripped, replay succeeds', async () => {
      const bom = '\uFEFF';
      const lines = [
        bom + sessionStartLine(1),
        contentLine(2, makeContent('msg 1', 'human')),
        contentLine(3, makeContent('msg 2', 'ai')),
      ];
      const filePath = path.join(chatsDir, 'bom-replay.jsonl');
      // Write with BOM — don't use writeJsonlFile which adds trailing newline
      await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf-8');

      const result = await replaySession(filePath, PROJECT_HASH);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.history).toHaveLength(2);
      expect(result.metadata.sessionId).toBe('test-session-00000001');
      expect(result.warnings).toHaveLength(0);
    });

    /**
     * Test 42b: readSessionHeader strips BOM.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it('readSessionHeader strips BOM and returns metadata correctly', async () => {
      const bom = '\uFEFF';
      const lines = [
        bom + sessionStartLine(1),
        contentLine(2, makeContent('msg', 'human')),
      ];
      const filePath = path.join(chatsDir, 'bom-header.jsonl');
      await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf-8');

      const header = await readSessionHeader(filePath);

      expect(header).not.toBeNull();
      expect(header!.sessionId).toBe('test-session-00000001');
      expect(header!.projectHash).toBe(PROJECT_HASH);
    });
  });

  // =========================================================================
  // Property-Based Tests (≥30% of total — 12 property tests out of ~42 total)
  // =========================================================================

  describe('Property-Based Tests @plan:PLAN-20260211-SESSIONRECORDING.P07', () => {
    /**
     * Test 43: Any sequence of content events produces history of same length.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-002
     */
    it.prop([
      fc.array(
        fc.record({
          text: fc.string({ minLength: 1, maxLength: 100 }),
          speaker: fc.constantFrom('human' as const, 'ai' as const),
        }),
        { minLength: 1, maxLength: 20 },
      ),
    ])(
      'any sequence of content events produces history of same length @requirement:REQ-RPL-002',
      async (contents) => {
        const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-replay-'));
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            for (const c of contents) {
              svc.recordContent(makeContent(c.text, c.speaker));
            }
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.history).toHaveLength(contents.length);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 44: Compression always resets to exactly 1+post items.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-003
     */
    it.prop([
      fc.integer({ min: 1, max: 10 }),
      fc.integer({ min: 0, max: 10 }),
    ])(
      'compression always resets to exactly 1+post items @requirement:REQ-RPL-003',
      async (preCount, postCount) => {
        const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-comp-'));
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            for (let i = 0; i < preCount; i++) {
              svc.recordContent(makeContent(`pre ${i}`, 'human'));
            }
            svc.recordCompressed(makeContent('Summary', 'ai'), preCount);
            for (let i = 0; i < postCount; i++) {
              svc.recordContent(makeContent(`post ${i}`, 'human'));
            }
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          // summary (1) + postCount
          expect(result.history).toHaveLength(1 + postCount);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 45: Rewind(N) on history of size M produces max(0, M-N) items.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-002d
     */
    it.prop([
      fc.integer({ min: 1, max: 15 }),
      fc.integer({ min: 0, max: 20 }),
    ])(
      'rewind(N) on history of size M produces max(0, M-N) items @requirement:REQ-RPL-002d',
      async (historySize, rewindCount) => {
        const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-rewind-'));
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            for (let i = 0; i < historySize; i++) {
              svc.recordContent(makeContent(`msg ${i}`, 'human'));
            }
            svc.recordRewind(rewindCount);
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.history).toHaveLength(Math.max(0, historySize - rewindCount));
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 46: Multiple write-then-replay cycles are idempotent.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001
     */
    it.prop([
      fc.array(
        fc.record({
          text: fc.string({ minLength: 1, maxLength: 50 }),
          speaker: fc.constantFrom('human' as const, 'ai' as const),
        }),
        { minLength: 1, maxLength: 10 },
      ),
    ])(
      'replaying the same file twice produces identical results @requirement:REQ-RPL-001',
      async (contents) => {
        const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-idem-'));
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            for (const c of contents) {
              svc.recordContent(makeContent(c.text, c.speaker));
            }
          });

          const result1 = await replaySession(filePath, PROJECT_HASH);
          const result2 = await replaySession(filePath, PROJECT_HASH);

          expect(result1.ok).toBe(true);
          expect(result2.ok).toBe(true);
          if (!result1.ok || !result2.ok) return;

          expect(result1.history).toEqual(result2.history);
          expect(result1.lastSeq).toBe(result2.lastSeq);
          expect(result1.eventCount).toBe(result2.eventCount);
          expect(result1.warnings).toEqual(result2.warnings);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 47: Session metadata survives any event sequence.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-007
     */
    it.prop([
      fc.array(
        fc.constantFrom(
          'content' as const,
          'provider_switch' as const,
          'session_event' as const,
          'directories_changed' as const,
        ),
        { minLength: 1, maxLength: 10 },
      ),
    ])(
      'session metadata always present after replay @requirement:REQ-RPL-007',
      async (eventTypes) => {
        const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-meta-'));
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            // Ensure at least one content event for materialization
            svc.recordContent(makeContent('trigger', 'human'));
            for (const eventType of eventTypes) {
              switch (eventType) {
                case 'content':
                  svc.recordContent(makeContent('test', 'ai'));
                  break;
                case 'provider_switch':
                  svc.recordProviderSwitch('test-provider', 'test-model');
                  break;
                case 'session_event':
                  svc.recordSessionEvent('info', 'test event');
                  break;
                case 'directories_changed':
                  svc.recordDirectoriesChanged(['/test']);
                  break;
              }
            }
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.metadata).toBeDefined();
          expect(result.metadata.sessionId).toBeTruthy();
          expect(result.metadata.projectHash).toBe(PROJECT_HASH);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 48: lastSeq always equals the final event's seq.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001
     */
    it.prop([fc.integer({ min: 1, max: 30 })])(
      'lastSeq always equals the final event seq regardless of event count @requirement:REQ-RPL-001',
      async (eventCount) => {
        const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-lastseq-'));
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            for (let i = 0; i < eventCount; i++) {
              svc.recordContent(makeContent(`msg ${i}`, i % 2 === 0 ? 'human' : 'ai'));
            }
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          // session_start (seq=1) + eventCount content events
          expect(result.lastSeq).toBe(eventCount + 1);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 49: eventCount always matches total events regardless of corruption.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001
     */
    it.prop([
      fc.integer({ min: 1, max: 20 }),
      fc.boolean(),
    ])(
      'eventCount matches total valid events regardless of optional corrupt last line @requirement:REQ-RPL-001',
      async (contentCount, hasCorruptLastLine) => {
        const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-evcount-'));
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const lines: string[] = [sessionStartLine(1)];
          for (let i = 0; i < contentCount; i++) {
            lines.push(contentLine(i + 2, makeContent(`msg ${i}`, 'human')));
          }
          if (hasCorruptLastLine) {
            lines.push('{"v":1,"seq":999,"type":"content","payload":{"content":{"spea');
          }
          const filePath = path.join(localChatsDir, `evcount-${contentCount}.jsonl`);
          await writeJsonlFile(filePath, lines);

          const result = await replaySession(filePath, PROJECT_HASH);

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          // session_start + contentCount valid content events
          expect(result.eventCount).toBe(1 + contentCount);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 50: Any valid IContent round-trips through record -> replay losslessly.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-002
     */
    it.prop([
      fc.record({
        speaker: fc.constantFrom('human' as const, 'ai' as const),
        text: fc.string({ minLength: 1, maxLength: 200 }),
      }),
    ])(
      'any valid IContent round-trips through record -> replay losslessly @requirement:REQ-RPL-002',
      async ({ speaker, text }) => {
        const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-roundtrip-'));
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const content: IContent = {
            speaker,
            blocks: [{ type: 'text', text }],
          };

          const filePath = await createValidFile(localChatsDir, (svc) => {
            svc.recordContent(content);
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.history).toHaveLength(1);
          expect(result.history[0]).toEqual(content);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 51: Warnings array is always present (possibly empty) regardless of input.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001
     */
    it.prop([
      fc.array(
        fc.record({
          text: fc.string({ minLength: 1, maxLength: 50 }),
          speaker: fc.constantFrom('human' as const, 'ai' as const),
        }),
        { minLength: 1, maxLength: 10 },
      ),
    ])(
      'warnings array is always present regardless of input @requirement:REQ-RPL-001',
      async (contents) => {
        const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-warn-'));
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            for (const c of contents) {
              svc.recordContent(makeContent(c.text, c.speaker));
            }
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(Array.isArray(result.warnings)).toBe(true);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 52: seq monotonicity is preserved across any number of resumes.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001
     */
    it.prop([
      fc.integer({ min: 1, max: 5 }),
      fc.integer({ min: 1, max: 10 }),
    ])(
      'seq monotonicity preserved across N resumes @requirement:REQ-RPL-001',
      async (resumeCount, turnsPerSegment) => {
        const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-resume-'));
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          let seq = 1;
          const lines: string[] = [sessionStartLine(seq)];

          for (let r = 0; r <= resumeCount; r++) {
            if (r > 0) {
              seq++;
              lines.push(sessionEventLine(seq, 'info', `Session resumed at T${r}`));
            }
            for (let t = 0; t < turnsPerSegment; t++) {
              seq++;
              lines.push(contentLine(seq, makeContent(`r${r}-t${t}`, 'human')));
            }
          }

          const filePath = path.join(localChatsDir, `resume-mono-${resumeCount}.jsonl`);
          await writeJsonlFile(filePath, lines);

          const result = await replaySession(filePath, PROJECT_HASH);

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const expectedContentCount = (resumeCount + 1) * turnsPerSegment;
          expect(result.history).toHaveLength(expectedContentCount);
          expect(result.sessionEvents).toHaveLength(resumeCount);
          expect(result.lastSeq).toBe(seq);
          expect(result.warnings).toHaveLength(0);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 53: Arbitrary interleaving of content/compressed/rewind produces valid history.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-002
     */
    it.prop([
      fc.array(
        fc.oneof(
          fc.constant('content' as const),
          fc.constant('compressed' as const),
          fc.constant('rewind' as const),
        ),
        { minLength: 1, maxLength: 15 },
      ),
    ])(
      'arbitrary interleaving of content/compressed/rewind produces valid history @requirement:REQ-RPL-002',
      async (eventTypes) => {
        const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-interleave-'));
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          let seq = 1;
          const lines: string[] = [sessionStartLine(seq)];

          // Always start with one content event
          seq++;
          lines.push(contentLine(seq, makeContent('seed', 'human')));

          for (const eventType of eventTypes) {
            seq++;
            switch (eventType) {
              case 'content':
                lines.push(contentLine(seq, makeContent(`msg-${seq}`, 'human')));
                break;
              case 'compressed':
                lines.push(compressedLine(seq, makeContent('summary', 'ai'), 1));
                break;
              case 'rewind':
                lines.push(rewindLine(seq, 1));
                break;
            }
          }

          const filePath = path.join(localChatsDir, 'interleave.jsonl');
          await writeJsonlFile(filePath, lines);

          const result = await replaySession(filePath, PROJECT_HASH);

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          // History length should be non-negative
          expect(result.history.length).toBeGreaterThanOrEqual(0);
          // No undefined items
          for (const item of result.history) {
            expect(item).toBeDefined();
            expect(item.speaker).toBeTruthy();
            expect(Array.isArray(item.blocks)).toBe(true);
          }
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 54: Malformed payload for any known event type is skipped without crash.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
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
      'malformed payload for any known event type is skipped without crash @requirement:REQ-RPL-005',
      async (eventType) => {
        const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-malformed-'));
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const malformedEvent = JSON.stringify({
            v: 1,
            seq: 3,
            ts: new Date().toISOString(),
            type: eventType,
            payload: { randomGarbage: 'not-a-valid-payload' },
          });

          const lines = [
            sessionStartLine(1),
            contentLine(2, makeContent('before', 'human')),
            malformedEvent,
            contentLine(4, makeContent('after', 'ai')),
          ];
          const filePath = path.join(localChatsDir, `malformed-${eventType}.jsonl`);
          await writeJsonlFile(filePath, lines);

          const result = await replaySession(filePath, PROJECT_HASH);

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          // Valid content should still be present
          expect(result.history.length).toBeGreaterThanOrEqual(1);
          expect(result.warnings.length).toBeGreaterThanOrEqual(1);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 55: Rewind after compression with arbitrary post-compression count.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-002d, REQ-RPL-003
     */
    it.prop([
      fc.integer({ min: 1, max: 10 }),
      fc.integer({ min: 0, max: 15 }),
    ])(
      'rewind after compression: max(0, 1+postCount - rewindN) items @requirement:REQ-RPL-002d, REQ-RPL-003',
      async (postCount, rewindN) => {
        const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-comp-rw-'));
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            svc.recordContent(makeContent('pre', 'human'));
            svc.recordCompressed(makeContent('Summary', 'ai'), 1);
            for (let i = 0; i < postCount; i++) {
              svc.recordContent(makeContent(`post ${i}`, 'human'));
            }
            svc.recordRewind(rewindN);
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          // summary(1) + postCount, then rewind removes N
          const expectedLen = Math.max(0, 1 + postCount - rewindN);
          expect(result.history).toHaveLength(expectedLen);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 56: Provider switch always updates metadata to latest value.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-007
     */
    it.prop([
      fc.array(
        fc.record({
          provider: fc.constantFrom('anthropic', 'openai', 'google', 'azure'),
          model: fc.string({ minLength: 1, maxLength: 20 }),
        }),
        { minLength: 1, maxLength: 5 },
      ),
    ])(
      'provider switch always updates metadata to latest provider/model @requirement:REQ-RPL-007',
      async (switches) => {
        const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-pswitch-'));
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            svc.recordContent(makeContent('trigger', 'human'));
            for (const sw of switches) {
              svc.recordProviderSwitch(sw.provider, sw.model);
            }
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const lastSwitch = switches[switches.length - 1];
          expect(result.metadata.provider).toBe(lastSwitch.provider);
          expect(result.metadata.model).toBe(lastSwitch.model);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 57: directories_changed always updates metadata to latest value.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-007
     */
    it.prop([
      fc.array(
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 3 }),
        { minLength: 1, maxLength: 5 },
      ),
    ])(
      'directories_changed always updates metadata to latest directories @requirement:REQ-RPL-007',
      async (dirChanges) => {
        const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-dirs-'));
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            svc.recordContent(makeContent('trigger', 'human'));
            for (const dirs of dirChanges) {
              svc.recordDirectoriesChanged(dirs);
            }
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const lastDirs = dirChanges[dirChanges.length - 1];
          expect(result.metadata.workspaceDirs).toEqual(lastDirs);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 58: session_event never appears in history regardless of count.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-008
     */
    it.prop([
      fc.integer({ min: 1, max: 10 }),
      fc.integer({ min: 1, max: 10 }),
    ])(
      'session_events never appear in history regardless of count @requirement:REQ-RPL-008',
      async (contentCount, eventCount) => {
        const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-sevt-'));
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            for (let i = 0; i < contentCount; i++) {
              svc.recordContent(makeContent(`msg ${i}`, 'human'));
              if (i < eventCount) {
                svc.recordSessionEvent('info', `event ${i}`);
              }
            }
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          expect(result.history).toHaveLength(contentCount);
          expect(result.sessionEvents).toHaveLength(Math.min(contentCount, eventCount));
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 59: BOM on first line never prevents replay for valid files.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it.prop([
      fc.integer({ min: 1, max: 10 }),
      fc.boolean(),
    ])(
      'BOM on first line never prevents replay @requirement:REQ-RPL-005',
      async (contentCount, hasBom) => {
        const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-bom-'));
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const lines: string[] = [];
          const firstLine = sessionStartLine(1);
          lines.push(hasBom ? '\uFEFF' + firstLine : firstLine);
          for (let i = 0; i < contentCount; i++) {
            lines.push(contentLine(i + 2, makeContent(`msg ${i}`, 'human')));
          }
          const filePath = path.join(localChatsDir, 'bom-test.jsonl');
          await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf-8');

          const result = await replaySession(filePath, PROJECT_HASH);

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.history).toHaveLength(contentCount);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 60: Multiple compressions: only post-last-compression content survives.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-003
     */
    it.prop([
      fc.integer({ min: 1, max: 5 }),
      fc.integer({ min: 1, max: 5 }),
      fc.integer({ min: 0, max: 5 }),
    ])(
      'multiple compressions: only post-last-compression content survives @requirement:REQ-RPL-003',
      async (preFirst, preLast, postLast) => {
        const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-multicomp-'));
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            for (let i = 0; i < preFirst; i++) {
              svc.recordContent(makeContent(`batch1-${i}`, 'human'));
            }
            svc.recordCompressed(makeContent('First summary', 'ai'), preFirst);
            for (let i = 0; i < preLast; i++) {
              svc.recordContent(makeContent(`batch2-${i}`, 'human'));
            }
            svc.recordCompressed(makeContent('Last summary', 'ai'), preLast + 1);
            for (let i = 0; i < postLast; i++) {
              svc.recordContent(makeContent(`batch3-${i}`, 'human'));
            }
          });

          const result = await replaySession(filePath, PROJECT_HASH);

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          // last summary (1) + postLast content
          expect(result.history).toHaveLength(1 + postLast);
          expect(result.history[0].blocks[0]).toEqual({
            type: 'text',
            text: 'Last summary',
          });
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 61: readSessionHeader always returns matching data for valid files.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-001
     */
    it.prop([
      fc.record({
        sessionId: fc.uuid(),
        provider: fc.constantFrom('anthropic', 'openai', 'google'),
        model: fc.string({ minLength: 1, maxLength: 20 }),
      }),
    ])(
      'readSessionHeader returns matching metadata for valid files @requirement:REQ-RPL-001',
      async ({ sessionId, provider, model }) => {
        const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-header-'));
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const filePath = await createValidFile(localChatsDir, (svc) => {
            svc.recordContent(makeContent('trigger', 'human'));
          }, { sessionId, provider, model });

          const header = await readSessionHeader(filePath);

          expect(header).not.toBeNull();
          expect(header!.sessionId).toBe(sessionId);
          expect(header!.provider).toBe(provider);
          expect(header!.model).toBe(model);
          expect(header!.projectHash).toBe(PROJECT_HASH);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );

    /**
     * Test 62: Corrupt last line is always silently discarded regardless of file size.
     * @plan PLAN-20260211-SESSIONRECORDING.P07
     * @requirement REQ-RPL-005
     */
    it.prop([fc.integer({ min: 1, max: 15 })])(
      'corrupt last line is always silently discarded regardless of event count @requirement:REQ-RPL-005',
      async (contentCount) => {
        const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-corrupt-'));
        const localChatsDir = path.join(localTempDir, 'chats');
        await fs.mkdir(localChatsDir, { recursive: true });

        try {
          const lines: string[] = [sessionStartLine(1)];
          for (let i = 0; i < contentCount; i++) {
            lines.push(contentLine(i + 2, makeContent(`msg ${i}`, 'human')));
          }
          // Add truncated last line
          lines.push('{"v":1,"seq":999,"type":"content","payload":{"content":{"spe');
          const filePath = path.join(localChatsDir, 'corrupt-last.jsonl');
          await writeJsonlFile(filePath, lines);

          const result = await replaySession(filePath, PROJECT_HASH);

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.history).toHaveLength(contentCount);
          // Silent discard — no warnings for corrupt last line
          expect(result.warnings).toHaveLength(0);
        } finally {
          await fs.rm(localTempDir, { recursive: true, force: true });
        }
      },
    );
  });
});
