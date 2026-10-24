/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The UI history byte budget is a DISPLAY bound (issue #2852).
 *
 * Bounding scrollback is only acceptable because the same content is retained
 * in full by two other places: the core `HistoryService` that builds model
 * requests, and the on-disk session transcript. These tests pin that, so a
 * future change cannot quietly turn the display bound into data loss.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { renderHook } from '../../__tests__/render.js';
import { act } from 'react';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createSessionRecorder,
  type SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  collectJournalFileRowsForAssertions,
  collectRowsForAssertions,
} from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { useHistory } from './useHistoryManager.js';
import { createTurnStore } from '../stores/turn/turnStore.js';

const created: string[] = [];
const services: SessionRecordingPort[] = [];

const LARGE_TEXT = 'a very long assistant response. '.repeat(400_000 / 32);

describe('UI history display bound preserves content elsewhere', () => {
  afterEach(async () => {
    // Disposal here rather than inline, so a failing assertion cannot leak the
    // recording service or its temp directory.
    for (const service of services.splice(0)) {
      await service.dispose();
    }
    for (const dir of created.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('bounds the on-screen copy while core history keeps the full text', async () => {
    const historyService = new HistoryService();
    historyService.add({
      speaker: 'ai',
      blocks: [{ type: 'text', text: LARGE_TEXT }],
    });

    const turnStore = createTurnStore();
    const { result } = renderHook(() =>
      useHistory(turnStore, { maxItems: 10, maxBytes: 4096 }),
    );
    act(() => {
      result.current.addItem({ type: 'gemini', text: LARGE_TEXT });
    });

    const displayed = result.current.history[0].text as string;
    await collectRowsForAssertions(
      historyService.streamRawHistory(),
      (rows) => {
        const core = rows[0].blocks[0];
        if (core.type !== 'text') throw new Error('Expected core text');
        expect({
          displayIsBounded: displayed.length < LARGE_TEXT.length,
          displayExplainsBound: displayed.includes(
            'full text is in the session transcript',
          ),
          coreIsComplete: core.text === LARGE_TEXT,
        }).toStrictEqual({
          displayIsBounded: true,
          displayExplainsBound: true,
          coreIsComplete: true,
        });
      },
    );
  });

  it('writes the full text to the session transcript', async () => {
    const chatsDir = mkdtempSync(path.join(tmpdir(), 'llxprt-display-bound-'));
    created.push(chatsDir);
    const recording = createSessionRecorder({
      sessionId: 'display-bound',
      projectHash: 'project',
      chatsDir,
      workspaceDirs: [chatsDir],
      cwd: chatsDir,
      provider: 'test',
      model: 'test',
    });
    services.push(recording);

    await recordRowsForTest(recording, [
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: LARGE_TEXT }],
      },
    ]);
    await recording.flush();

    const filePath = recording.getFilePath();
    if (filePath === null) throw new Error('Missing native transcript');
    await collectJournalFileRowsForAssertions(filePath, (rows) => {
      const contentTexts = rows.map((row) => {
        const block = row.blocks[0];
        if (block.type !== 'text') throw new Error('Expected recorded text');
        return block.text;
      });
      expect(contentTexts).toStrictEqual([LARGE_TEXT]);
    });
  });
});
