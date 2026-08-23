/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
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
  makeMarkedContent,
  compressedLine,
  rewindLine,
  writeJsonlFile,
  createValidFile,
} from './replay-test-helpers.js';
import { type IContent } from '../services/history/IContent.js';

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
  // Rewind by chronology marker (#2934)
  // -------------------------------------------------------------------------

  describe('Rewind by chronology marker @issue:2934', () => {
    const textsOf = (history: readonly IContent[]): string[] =>
      history.map((item) =>
        item.blocks[0].type === 'text' ? item.blocks[0].text : '',
      );

    /**
     * The recorded count is measured against live history, which an
     * unjournalled density pass has already shortened. The marker is measured
     * against identity, so it survives that divergence.
     */
    it('cuts at the entry carrying the recorded chronology seq, not at the recorded offset', async () => {
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeMarkedContent('kept 1', 'human', 1)),
        contentLine(3, makeMarkedContent('kept 2', 'ai', 2)),
        contentLine(4, makeMarkedContent('removed 1', 'human', 3)),
        contentLine(5, makeMarkedContent('removed 2', 'ai', 4)),
        // The count is stale — it was computed after density pruned an entry
        // from live history — so it would remove one item too few.
        rewindLine(6, 1, 3),
      ];
      const filePath = path.join(chatsDir, 'marker-rewind.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);
      expect(textsOf(result.history)).toStrictEqual(['kept 1', 'kept 2']);
    });

    /**
     * A session recorded before chronology markers existed and then resumed
     * has unmarked entries followed by marked ones. The cut sits in the
     * unmarked prefix, where no marker can identify it. Cutting at the nearest
     * later marker would leave the removed turns in place, so the recorded
     * count is used instead.
     */
    it('falls back to the recorded count when the cut entry predates chronology markers', async () => {
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('Q1', 'human')),
        contentLine(3, makeContent('A1', 'ai')),
        contentLine(4, makeContent('Q2', 'human')),
        contentLine(5, makeContent('A2', 'ai')),
        contentLine(6, makeMarkedContent('Q3', 'human', 5)),
        contentLine(7, makeMarkedContent('A3', 'ai', 6)),
        // Live history stamped the resumed entries in memory only, so seq 3
        // names an entry the journal never marked.
        rewindLine(8, 4, 3),
      ];
      const filePath = path.join(chatsDir, 'marker-rewind-legacy-prefix.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);
      expect(textsOf(result.history)).toStrictEqual(['Q1', 'A1']);
    });

    /**
     * A `compressed` event destroys the entries it replaces, so a later rewind
     * can name an entry that is no longer in the replayed history. Cutting at
     * the nearest later marker would strand the summary; the recorded count
     * clears it.
     */
    it('falls back to the recorded count when a compressed event destroyed the cut entry', async () => {
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeMarkedContent('Q1', 'human', 1)),
        contentLine(3, makeMarkedContent('A1', 'ai', 2)),
        // The summary reached the journal without a marker.
        compressedLine(4, makeContent('Summary', 'ai'), 2),
        contentLine(5, makeMarkedContent('Q2', 'human', 4)),
        // Restore-all: the cut is the summary, stamped seq 3 in live history.
        rewindLine(6, 2, 3),
      ];
      const filePath = path.join(chatsDir, 'marker-rewind-compressed.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);
      expect(result.history).toStrictEqual([]);
    });

    it('falls back to the recorded count when no entry carries a marker at all', async () => {
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('kept', 'human')),
        contentLine(3, makeContent('dropped 1', 'ai')),
        contentLine(4, makeContent('dropped 2', 'human')),
        rewindLine(5, 2, 7),
      ];
      const filePath = path.join(chatsDir, 'marker-rewind-unmarked.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);
      expect(textsOf(result.history)).toStrictEqual(['kept']);
    });

    it('leaves an already-empty history empty', async () => {
      const lines = [sessionStartLine(1), rewindLine(2, 3, 1)];
      const filePath = path.join(chatsDir, 'marker-rewind-empty.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);
      expect(result.history).toStrictEqual([]);
    });

    it('retains an unmarked prefix when the cut entry itself is marked', async () => {
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeContent('legacy prefix', 'human')),
        contentLine(3, makeMarkedContent('kept', 'ai', 5)),
        contentLine(4, makeMarkedContent('dropped', 'human', 6)),
        rewindLine(5, 1, 6),
      ];
      const filePath = path.join(chatsDir, 'marker-rewind-mixed.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);
      expect(textsOf(result.history)).toStrictEqual(['legacy prefix', 'kept']);
    });

    it('does not match a content marker whose seq is not a valid sequence number', async () => {
      const lines = [
        sessionStartLine(1),
        contentLine(2, makeMarkedContent('kept', 'human', 1)),
        contentLine(3, makeMarkedContent('nonsense marker', 'ai', -2)),
        contentLine(4, makeMarkedContent('dropped', 'human', 3)),
        rewindLine(5, 1, 3),
      ];
      const filePath = path.join(chatsDir, 'marker-rewind-bad-marker.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);
      expect(textsOf(result.history)).toStrictEqual([
        'kept',
        'nonsense marker',
      ]);
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
