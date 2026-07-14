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

      assertReplayOk(result);

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
});
