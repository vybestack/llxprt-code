/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import {
  importOwnerSession,
  listOwnerBrowserTargets,
  resumeOwnerSession,
} from './ownerSessionUi.js';

const human = (text: string) => ({
  speaker: 'human' as const,
  blocks: [{ type: 'text' as const, text }],
});

function hasUserTurn(
  items: ReadonlyArray<{ type: string; text?: string }>,
  text: string,
): boolean {
  return items.some((item) => item.type === 'user' && item.text === text);
}

describe('owner-backed interactive session operations', () => {
  it('lists browser path projections, resumes a closed session and keeps a single lock', async () => {
    await withRecordingLifetimeFixture(async ({ agent, chatsDir, borrow }) => {
      await agent.setHistory([human('browse source')]);
      await agent.session.setRecording({ enabled: true });
      const sourceId = (await agent.session.listSessions()).at(0)?.id;
      if (!sourceId) throw new Error('No source session');
      const source = agent.session.getRecording().path;
      if (!source) throw new Error('No source recording');
      await agent.session.setRecording({ enabled: false });
      const next = await borrow();
      await next.setHistory([human('current owner')]);
      await next.session.setRecording({ enabled: true });
      const targets = await listOwnerBrowserTargets(next);
      const target = targets.find(
        (entry) =>
          entry.kind === 'session' && entry.session.sessionId === sourceId,
      );
      expect(
        target?.kind === 'session' ? target.session.filePath : undefined,
      ).toBe(source);
      const replay = await resumeOwnerSession(next, sourceId, 'allowed');
      expect(hasUserTurn(replay.uiHistory, 'browse source')).toBe(true);
      expect(
        (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
      ).toHaveLength(1);
    });
  }, 30000);

  it('forks a browser checkpoint with UI replay and deletes the source through the owner', async () => {
    await withRecordingLifetimeFixture(async ({ agent, chatsDir }) => {
      await agent.setHistory([human('checkpoint source')]);
      await agent.session.setRecording({ enabled: true });
      const checkpoint = await agent.session.createCheckpoint('browser-branch');
      const targets = await listOwnerBrowserTargets(agent);
      const target = targets.find(
        (entry) =>
          entry.kind === 'checkpoint' &&
          entry.checkpointId === checkpoint.checkpointId,
      );
      const sourcePath = agent.session.getRecording().path;
      if (!sourcePath) throw new Error('No source recording');
      expect(
        target?.kind === 'checkpoint' ? target.source.filePath : undefined,
      ).toBe(sourcePath);
      const replay = await resumeOwnerSession(
        agent,
        checkpoint.checkpointId,
        'allowed',
      );
      expect(hasUserTurn(replay.uiHistory, 'checkpoint source')).toBe(true);
      await agent.session.deleteCheckpoint(checkpoint.checkpointId);
      expect(
        (await listOwnerBrowserTargets(agent)).some(
          (entry) =>
            entry.kind === 'checkpoint' &&
            entry.checkpointId === checkpoint.checkpointId,
        ),
      ).toBe(false);
      expect(
        (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
      ).toHaveLength(1);
    });
  }, 30000);

  it('preserves the live owner after a failed resume and rejects deletion of an active session', async () => {
    await withRecordingLifetimeFixture(async ({ agent, chatsDir }) => {
      await agent.setHistory([human('survivor')]);
      await agent.session.setRecording({ enabled: true });
      const path = agent.session.getRecording().path;
      await expect(
        resumeOwnerSession(agent, 'missing-session', 'allowed'),
      ).rejects.toThrow('Failed to resume session');
      const checkpoint =
        await agent.session.createCheckpoint('discarded-branch');
      await agent.session.deleteCheckpoint(checkpoint.checkpointId);
      await expect(
        resumeOwnerSession(agent, checkpoint.checkpointId, 'allowed'),
      ).rejects.toThrow('Failed to resume session');
      const activeId = (await agent.session.listSessions()).at(0)?.id;
      if (!activeId) throw new Error('No active session');
      await expect(agent.session.deleteSession(activeId)).rejects.toThrow(
        'active session',
      );
      await agent.session.recordRecordingEvent({
        type: 'session_event',
        severity: 'info',
        message: 'survived',
      });
      if (!path) throw new Error('No recording');
      expect(await readFile(path, 'utf8')).toContain('survived');
      expect(
        (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
      ).toHaveLength(1);
    });
  }, 30000);

  it('imports a package once through the owner, replays IContent and releases the previous lock', async () => {
    await withRecordingLifetimeFixture(async ({ agent, chatsDir, borrow }) => {
      await agent.setHistory([human('portable turn')]);
      await agent.session.setRecording({ enabled: true });
      const destination = `${chatsDir}/portable`;
      const sourceId = (await agent.session.listSessions()).at(0)?.id;
      if (!sourceId) throw new Error('No source session');
      await agent.session.exportSession(sourceId, destination);
      await agent.session.setRecording({ enabled: false });
      const next = await borrow();
      await next.setHistory([human('current owner')]);
      await next.session.setRecording({ enabled: true });
      const replay = await importOwnerSession(next, destination, 'allowed');
      expect(hasUserTurn(replay.uiHistory, 'portable turn')).toBe(true);
      expect(
        (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
      ).toHaveLength(1);
      const path = next.session.getRecording().path;
      if (!path) throw new Error('Imported session has no recording');
      expect(await readFile(path, 'utf8')).toContain('portable turn');
    });
  }, 30000);
});
