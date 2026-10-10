/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { replaySession } from '@vybestack/llxprt-code-core';
import { buildAgent, internalConfig } from './helpers/agentHarness.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

function content(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

describe('adopted recording instance path', () => {
  it('restarts an adopted recording on its original path with one header and monotonic replacement history across different timestamps', async () => {
    const workingDir = await mkdtemp(
      join(tmpdir(), 'recording-instance-resume-'),
    );
    const clock = vi.spyOn(Date.prototype, 'toISOString');
    clock.mockReturnValue('2026-09-30T12:34:56.000Z');
    const source = await buildAgent('multi-turn-text.jsonl', {
      workingDir,
      sessionId: 'recording-source-label',
    });
    const chatsDir = internalConfig(source.agent).projectChatsDir;
    const projectTemp = internalConfig(source.agent).projectTempDir;
    try {
      await source.agent.setHistory([content('source history')]);
      await source.agent.session.setRecording({ enabled: true });
      const originalPath = source.agent.session.getRecording().path;
      if (originalPath === undefined)
        throw new Error('Missing source recording');
      await source.agent.session.setRecording({ enabled: false });
      const owner = await buildAgent('multi-turn-text.jsonl', {
        workingDir,
        sessionId: 'independent-runtime-owner',
      });
      try {
        await owner.agent.session.resume('recording-source-label');
        await owner.agent.session.setRecording({ enabled: false });
        clock.mockReturnValue('2026-09-30T12:35:57.000Z');
        await owner.agent.setHistory([
          content('changed while recording stopped'),
        ]);
        await owner.agent.session.setRecording({ enabled: true });
        const restartedPath = owner.agent.session.getRecording().path;
        await owner.agent.session.setRecording({ enabled: false });
        expect(restartedPath).toBe(originalPath);
        const replay = await replaySession(originalPath, basename(projectTemp));
        if (!replay.ok) throw new Error(replay.error);
        expect(replay.sequenceCorrupt).toBe(false);
        expect(replay.history).toStrictEqual([
          content('changed while recording stopped'),
        ]);
        const records: unknown[] = (await readFile(originalPath, 'utf8'))
          .trim()
          .split('\n')
          .map((line): unknown => JSON.parse(line));
        expect(records).toMatchObject([
          {
            seq: 1,
            type: 'session_start',
            payload: { sessionId: 'recording-source-label' },
          },
          { seq: 2, type: 'content' },
          { seq: 3, type: 'session_event' },
          { seq: 4, type: 'rewind' },
          { seq: 5, type: 'content' },
        ]);
        expect(await owner.agent.session.listSessions()).toHaveLength(1);
        expect(chatsDir).toBe(internalConfig(owner.agent).projectChatsDir);
      } finally {
        await owner.cleanup();
      }
    } finally {
      await source.cleanup();
      vi.restoreAllMocks();
      await rm(projectTemp, { recursive: true, force: true });
      await rm(workingDir, { recursive: true, force: true });
    }
  }, 30000);
});
