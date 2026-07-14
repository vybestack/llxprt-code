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
  sessionEventLine,
  writeJsonlFile,
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

      assertReplayOk(result);

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

      assertReplayOk(result);

      expect(result.history).toHaveLength(6);
      const texts = result.history.map(
        (h) => (h.blocks[0] as { type: 'text'; text: string }).text,
      );
      expect(texts).toStrictEqual([
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

      assertReplayOk(result);
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
        lines.push(
          contentLine(i, makeContent(`msg ${i}`, i % 2 === 0 ? 'human' : 'ai')),
        );
      }
      // Replace 2 mid-file content lines with malformed ones
      lines[3] = 'NOT JSON';
      lines[7] = '{"broken": true';
      lines.push(contentLine(20, makeContent('last', 'human')));

      const filePath = path.join(chatsDir, 'threshold.jsonl');
      await writeJsonlFile(filePath, lines);

      const result = await replaySession(filePath, PROJECT_HASH);

      assertReplayOk(result);
      // Should have a threshold warning
      expect(
        result.warnings.some((w) => w.includes('5%') || w.includes('WARNING')),
      ).toBe(true);
    });
  });
});
