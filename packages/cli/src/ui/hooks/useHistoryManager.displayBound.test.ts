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

/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import { act } from 'react';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionRecordingService } from '@vybestack/llxprt-code-core';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { useHistory } from './useHistoryManager.js';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const LARGE_TEXT = 'a very long assistant response. '.repeat(400_000 / 32);

describe('UI history display bound preserves content elsewhere', () => {
  it('bounds the on-screen copy while core history keeps the full text', () => {
    const historyService = new HistoryService();
    historyService.add({
      speaker: 'ai',
      blocks: [{ type: 'text', text: LARGE_TEXT }],
    });

    const { result } = renderHook(() =>
      useHistory({ maxItems: 10, maxBytes: 4096 }),
    );
    act(() => {
      result.current.addItem({ type: 'gemini', text: LARGE_TEXT });
    });

    const displayed = result.current.history[0].text as string;
    const core = historyService.getAll()[0].blocks[0] as { text: string };

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
  });

  it('writes the full text to the session transcript', async () => {
    const chatsDir = mkdtempSync(path.join(tmpdir(), 'llxprt-display-bound-'));
    created.push(chatsDir);
    const recording = new SessionRecordingService({
      sessionId: 'display-bound',
      projectHash: 'project',
      chatsDir,
      workspaceDirs: [chatsDir],
      cwd: chatsDir,
      provider: 'test',
      model: 'test',
    });

    recording.recordContent({
      speaker: 'ai',
      blocks: [{ type: 'text', text: LARGE_TEXT }],
    });
    await recording.flush();

    const filePath = recording.getFilePath() as string;
    const records = readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type: string; payload: unknown });
    const content = records.find((record) => record.type === 'content');
    const block = (
      content?.payload as { content: { blocks: Array<{ text: string }> } }
    ).content.blocks[0];

    expect(block.text).toBe(LARGE_TEXT);
    await recording.dispose();
  });
});
