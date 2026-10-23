/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { replaySession } from '@vybestack/llxprt-code-core';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { describe, expect, it, vi } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { buildAgent, drain, internalConfig } from './helpers/agentHarness.js';
import {
  nativeRows,
  readJournalFileFacts,
  requireRecordingPath,
  rowTexts,
} from './helpers/native-session-fixture.js';

function content(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

describe('old adopted recording instance path', () => {
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
        // Journal rows additionally carry their chronology stamp.
        expect(replay.history).toMatchObject([
          content('changed while recording stopped'),
        ]);
        expect(replay.history).toHaveLength(1);
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
          // Resume leaves the one source row unchanged, so it writes no
          // chronology_bind for it.
          { seq: 4, type: 'replace_begin' },
          { seq: 5, type: 'content', payload: { tx: expect.any(String) } },
          { seq: 6, type: 'replace_commit', payload: { rowCount: 1 } },
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

describe('native adopted recording instance path', () => {
  it('retains source identity and creation time across stopped replacement, public continuation and independent reopen', async () => {
    await (async () => {
      const workingDir = await mkdtemp(
        join(tmpdir(), 'native-instance-resume-'),
      );
      const clock = vi.spyOn(Date.prototype, 'toISOString');
      clock.mockReturnValue('2026-09-30T12:34:56.000Z');
      const source = await buildAgent('multi-turn-text.jsonl', {
        workingDir,
        sessionId: 'native-source-label',
      });
      try {
        await source.agent.setHistory([content('source history')]);
        await source.agent.session.setRecording({ enabled: true });
        const path = requireRecordingPath(
          source.agent.session.getRecording().path,
        );
        await source.agent.session.setRecording({ enabled: false });
        const original = await nativeRows(path);
        const facts = await readJournalFileFacts(path);
        expect(facts).toMatchObject({
          rows: 1,
          facts: {
            sessionId: 'native-source-label',
            start: { startTime: '2026-09-30T12:34:56.000Z' },
          },
        });
        expect(rowTexts(original)).toStrictEqual(['source history']);
        const owner = await buildAgent('multi-turn-text.jsonl', {
          workingDir,
          sessionId: 'independent-native-owner',
        });
        try {
          const resumed = await owner.agent.session.resume(
            'native-source-label',
          );
          expect(await Array.fromAsync(resumed)).toStrictEqual(original);
          expect(
            await Array.fromAsync(owner.agent.streamHistory()),
          ).toStrictEqual(original);
          expect(owner.agent.session.getSessionId()).toBe(
            source.agent.session.getSessionId(),
          );
          expect(owner.agent.session.getRecording()).toMatchObject({
            enabled: true,
            format: 'journal',
            path,
          });
          await owner.agent.session.setRecording({ enabled: false });
          clock.mockReturnValue('2026-09-30T12:35:57.000Z');
          await owner.agent.setHistory([
            content('changed while recording stopped'),
          ]);
          const replacement = await Array.fromAsync(
            owner.agent.streamHistory(),
          );
          expect(isDeepStrictEqual(await nativeRows(path), original)).toBe(
            true,
          );
          await owner.agent.session.setRecording({ enabled: true });
          expect(owner.agent.session.getRecording()).toMatchObject({
            enabled: true,
            path,
          });
          await owner.agent.session.flushRecording();
          expect(await nativeRows(path)).toStrictEqual(replacement);
          expect(rowTexts(replacement)).toStrictEqual([
            'changed while recording stopped',
          ]);
          await drain(owner.agent.stream('continued adopted turn'));
          await owner.agent.session.setRecording({ enabled: false });
          const continued = await nativeRows(path);
          expect(rowTexts(continued)).toStrictEqual([
            'changed while recording stopped',
            'continued adopted turn',
            'turn one reply',
          ]);
          expect(continued[0]).toStrictEqual(replacement[0]);
          expect((await readJournalFileFacts(path))?.facts).toStrictEqual(
            facts?.facts,
          );
          const sessions = await owner.agent.session.listSessions();
          expect(sessions).toHaveLength(1);
          expect(sessions[0]).toMatchObject({
            id: 'native-source-label',
            createdAt: facts?.facts.start.startTime,
          });
          const reopened = await buildAgent('multi-turn-text.jsonl', {
            workingDir,
            sessionId: 'independent-native-reopen',
          });
          try {
            clock.mockReturnValue('2026-09-30T12:36:58.000Z');
            const restored = await reopened.agent.session.resume(
              'native-source-label',
            );
            expect(await Array.fromAsync(restored)).toStrictEqual(continued);
            expect(
              await Array.fromAsync(reopened.agent.streamHistory()),
            ).toStrictEqual(continued);
            expect(reopened.agent.session.getSessionId()).toBe(
              'native-source-label',
            );
            expect(reopened.agent.session.getRecording()).toMatchObject({
              enabled: true,
              path,
            });
            await drain(reopened.agent.stream('independent reopened turn'));
            await reopened.agent.session.setRecording({ enabled: false });
            expect(rowTexts(await nativeRows(path))).toStrictEqual([
              'changed while recording stopped',
              'continued adopted turn',
              'turn one reply',
              'independent reopened turn',
              'turn one reply',
            ]);
            expect(await reopened.agent.session.listSessions()).toHaveLength(1);
            expect((await readJournalFileFacts(path))?.facts).toStrictEqual(
              facts?.facts,
            );
          } finally {
            await reopened.cleanup();
          }
        } finally {
          await owner.cleanup();
        }
      } finally {
        await source.cleanup();
        clock.mockRestore();
      }
    })();
  }, 30000);
});
