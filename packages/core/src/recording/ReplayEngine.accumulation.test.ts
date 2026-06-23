/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { replaySession } from './ReplayEngine.js';
import {
  assertReplayOk,
  PROJECT_HASH,
  makeContent,
  sessionStartLine,
  contentLine,
  assertReplayError,
  makeContentWithToolCall,
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

      assertReplayOk(result);

      expect(result.history).toHaveLength(2);
      expect(result.history[0].speaker).toBe('human');
      expect(result.history[0].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'Hello from user',
      });
      expect(result.history[1].speaker).toBe('ai');
      expect(result.history[1].blocks[0]).toStrictEqual({
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

      assertReplayOk(result);

      expect(result.history).toHaveLength(2);
      expect(result.history[1].speaker).toBe('ai');
      expect(result.history[1].blocks).toHaveLength(2);
      expect(result.history[1].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'Calling readFile',
      });
      expect(result.history[1].blocks[1]).toStrictEqual({
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
          svc.recordContent(
            makeContent(`msg ${i}`, i % 2 === 0 ? 'human' : 'ai'),
          );
        }
        svc.recordCompressed(makeContent('Summary of 5 messages', 'ai'), 5);
        svc.recordContent(makeContent('post-compression 1', 'human'));
        svc.recordContent(makeContent('post-compression 2', 'ai'));
      });

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);

      expect(result.history).toHaveLength(3);
      expect(result.history[0].speaker).toBe('ai');
      expect(result.history[0].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'Summary of 5 messages',
      });
      expect(result.history[1].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'post-compression 1',
      });
      expect(result.history[2].blocks[0]).toStrictEqual({
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
        svc.recordCompressed(makeContent('First summary', 'ai'), 5);
        svc.recordContent(makeContent('mid 1', 'human'));
        svc.recordContent(makeContent('mid 2', 'ai'));
        svc.recordCompressed(makeContent('Second summary', 'ai'), 3);
        svc.recordContent(makeContent('final 1', 'human'));
        svc.recordContent(makeContent('final 2', 'ai'));
      });

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);

      expect(result.history).toHaveLength(3);
      expect(result.history[0].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'Second summary',
      });
      expect(result.history[1].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'final 1',
      });
      expect(result.history[2].blocks[0]).toStrictEqual({
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
          svc.recordContent(
            makeContent(`msg ${i}`, i % 2 === 0 ? 'human' : 'ai'),
          );
        }
        svc.recordRewind(2);
      });

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);

      expect(result.history).toHaveLength(3);
      expect(result.history[0].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'msg 0',
      });
      expect(result.history[1].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'msg 1',
      });
      expect(result.history[2].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'msg 2',
      });
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

      assertReplayOk(result);

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

      assertReplayOk(result);

      // summary + 2 remaining post-compression items
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
        text: 'post 2',
      });
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

      assertReplayOk(result);

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

      assertReplayOk(result);

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

      assertReplayError(result);
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

      assertReplayError(result);
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

      assertReplayError(result);
      expect(result.error).toContain('hash');
    });
  });
});
