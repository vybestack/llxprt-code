/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { requireMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { describe, expect, it, spyOn } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { replaySession } from '@vybestack/llxprt-code-core';
import { withRecordingLifetimeFixture } from './helpers/recording-owner-lifetime-fixture.js';

const human = (text: string) => ({
  speaker: 'human' as const,
  blocks: [{ type: 'text' as const, text }],
});
const ai = (text: string) => ({
  speaker: 'ai' as const,
  blocks: [{ type: 'text' as const, text }],
});

describe('Agent session owner history restore and checkpoint names', () => {
  it('uses the agent-captured media store for recording and checkpoint replay after Config media access is disabled', async () => {
    await withRecordingLifetimeFixture(async ({ agent, config }) => {
      const mediaStore = requireMediaStore(agent.agentClient);
      const media = await mediaStore.admit({
        bytes: new Uint8Array([1, 3, 5, 7]),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      Object.defineProperty(config, 'getLocalMediaStore', {
        configurable: true,
        value: () => {
          throw new Error('Config media getter must not be used');
        },
      });
      try {
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'image' }, media],
          },
        ]);
        await agent.session.setRecording({ enabled: true });
        const checkpoint =
          await agent.session.createCheckpoint('media-checkpoint');
        expect(checkpoint.name).toBe('media-checkpoint');
        expect(await agent.session.listCheckpoints()).toHaveLength(1);
        const path = agent.session.getRecording().path;
        if (!path) throw new Error('Missing recording path');
        const replay = await replaySession(
          path,
          basename(config.projectTempDir),
          { mediaStore },
        );
        if (!replay.ok) throw new Error(replay.error);
        expect(JSON.stringify(replay.history)).toContain(media.contentId);
        await agent.session.setRecording({ enabled: false });
      } finally {
        Reflect.deleteProperty(config, 'getLocalMediaStore');
      }
    });
  }, 30000);

  it('restores recorded human turns, persists the rewind and continues recording on the same lock', async () => {
    await withRecordingLifetimeFixture(async ({ agent, config, chatsDir }) => {
      await agent.setHistory([human('first'), ai('one')]);
      await agent.session.setRecording({ enabled: true });
      await agent.setHistory([
        human('first'),
        ai('one'),
        human('second'),
        ai('two'),
      ]);
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('Recording path missing');
      const result = await agent.session.restoreTurns(1);
      expect(result.itemsRemoved).toBe(2);
      expect(result.remainingHistory).toHaveLength(2);
      expect(await agent.getHistory()).toHaveLength(2);
      await agent.setHistory([human('first'), ai('one'), human('third')]);
      await agent.session.flushRecording();
      const replay = await replaySession(
        path,
        basename(config.projectTempDir),
        { mediaStore: requireMediaStore(agent.agentClient) },
      );
      expect(replay.ok).toBe(true);
      if (!replay.ok) throw new Error(replay.error);
      expect(JSON.stringify(replay.history)).not.toContain('second');
      expect(JSON.stringify(replay.history)).toContain('third');
      expect(await readFile(path, 'utf8')).toContain('"rewind"');
      expect(
        (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
      ).toHaveLength(1);
      await agent.session.setRecording({ enabled: false });
      expect(
        (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
      ).toHaveLength(0);
    });
  }, 30000);

  it('serializes restore before a queued checkpoint and rejects mutations after disposal', async () => {
    await withRecordingLifetimeFixture(async ({ agent, config, chatsDir }) => {
      await agent.setHistory([
        human('kept-turn'),
        ai('kept-reply'),
        human('discarded-turn'),
      ]);
      await agent.session.setRecording({ enabled: true });
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('Recording path missing');
      const [restored, checkpoint] = await Promise.all([
        agent.session.restoreTurns(1),
        agent.session.createCheckpoint('after-rewind'),
      ]);
      expect(restored.itemsRemoved).toBe(1);
      const replay = await replaySession(
        path,
        basename(config.projectTempDir),
        { mediaStore: requireMediaStore(agent.agentClient) },
      );
      if (!replay.ok) throw new Error(replay.error);
      const raw = await readFile(path, 'utf8');
      expect(raw.indexOf('"rewind"')).toBeLessThan(
        raw.indexOf('"checkpoint_created"'),
      );
      expect(checkpoint.name).toBe('after-rewind');
      expect(JSON.stringify(replay.history)).not.toContain('discarded-turn');
      expect(
        (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
      ).toHaveLength(1);
      await agent.dispose();
      await expect(agent.session.restoreTurns(1)).rejects.toThrow(
        'Session disposed',
      );
      expect(
        (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
      ).toHaveLength(0);
    });
  }, 30000);

  it('rejects invalid turns and restores live and durable history if client restoration fails', async () => {
    await withRecordingLifetimeFixture(async ({ agent, config }) => {
      await agent.setHistory([
        human('base'),
        ai('base-reply'),
        human('cut'),
        ai('cut-reply'),
      ]);
      await agent.session.setRecording({ enabled: true });
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('Recording path missing');
      await expect(agent.session.restoreTurns(-1)).rejects.toThrow(
        'non-negative integer',
      );
      const client = agent.agentClient;
      const original = client.restoreHistory.bind(client);
      const fault = spyOn(client, 'restoreHistory').mockImplementationOnce(
        async (...args) => {
          await original(...args);
          throw new Error('restore interrupted');
        },
      );
      try {
        await expect(agent.session.restoreTurns(1)).rejects.toThrow(
          'restore interrupted',
        );
      } finally {
        fault.mockRestore();
      }
      expect(JSON.stringify(await agent.getHistory())).toContain('cut-reply');
      await agent.session.flushRecording();
      const replay = await replaySession(
        path,
        basename(config.projectTempDir),
        {
          mediaStore: requireMediaStore(agent.agentClient),
        },
      );
      expect(replay.ok).toBe(true);
      if (!replay.ok) throw new Error(replay.error);
      expect(JSON.stringify(replay.history)).toContain('cut-reply');
      const restored = await agent.session.restoreTurns(1);
      expect(restored.itemsRemoved).toBe(2);
      expect(JSON.stringify(await agent.getHistory())).not.toContain(
        'cut-reply',
      );
    });
  }, 30000);

  it('denies collisions without UI confirmation and atomically overwrites on create, rename and session naming', async () => {
    await withRecordingLifetimeFixture(async ({ agent, config }) => {
      await agent.setHistory([human('checkpoint-seed')]);
      await agent.session.setRecording({ enabled: true });
      const first = await agent.session.createCheckpoint('occupied');
      await expect(agent.session.createCheckpoint('occupied')).rejects.toThrow(
        'already exists',
      );
      const second = await agent.session.createCheckpoint('occupied', {
        overwrite: true,
      });
      expect(second.checkpointId).not.toBe(first.checkpointId);
      expect(
        (await agent.session.listCheckpoints()).map(
          (item) => item.checkpointId,
        ),
      ).toStrictEqual([second.checkpointId]);
      const third = await agent.session.createCheckpoint('rename-source');
      await expect(
        agent.session.renameCheckpoint(third.checkpointId, 'occupied'),
      ).rejects.toThrow('already exists');
      await agent.session.renameCheckpoint(third.checkpointId, 'occupied', {
        overwrite: true,
      });
      expect(
        (await agent.session.listCheckpoints()).map(
          (item) => item.checkpointId,
        ),
      ).toStrictEqual([third.checkpointId]);
      await expect(
        agent.session.nameCurrentSession('occupied'),
      ).rejects.toThrow('already exists');
      await agent.session.nameCurrentSession('occupied', { overwrite: true });
      expect(await agent.session.listCheckpoints()).toHaveLength(0);
      expect(
        (await agent.session.listSessions()).some(
          (item) => item.name === 'occupied',
        ),
      ).toBe(true);
      expect(config.getSessionId()).toBeUndefined();
    });
  }, 30000);

  it('preserves the colliding name when a confirmed checkpoint write fails', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.setHistory([human('rollback-seed')]);
      await agent.session.setRecording({ enabled: true });
      const first = await agent.session.createCheckpoint('kept');
      const second = await agent.session.createCheckpoint('other');
      const before = await readFile(
        agent.session.getRecording().path ?? '',
        'utf8',
      );
      const recordingPath = agent.session.getRecording().path;
      if (!recordingPath) throw new Error('Recording path missing');
      const originalAppend = await import('node:fs/promises');
      const fault = spyOn(originalAppend, 'appendFile');
      fault.mockRejectedValueOnce(new Error('disk refused append'));
      try {
        await expect(
          agent.session.renameCheckpoint(second.checkpointId, 'kept', {
            overwrite: true,
          }),
        ).rejects.toThrow('disk refused append');
      } finally {
        fault.mockRestore();
      }
      expect(
        (await agent.session.listCheckpoints())
          .map((item) => item.checkpointId)
          .sort(),
      ).toStrictEqual([first.checkpointId, second.checkpointId].sort());
      expect(await readFile(recordingPath, 'utf8')).toBe(before);
    });
  }, 30000);

  it('keeps a borrowed sibling recording and its lock isolated while restoring and renaming a closed checkpoint', async () => {
    await withRecordingLifetimeFixture(
      async ({ agent: owner, borrow, config, chatsDir }) => {
        const sibling = await borrow();
        await owner.setHistory([
          human('owner-first'),
          ai('owner-reply'),
          human('owner-last'),
        ]);
        await owner.session.setRecording({ enabled: true });
        const ownerCheckpoint =
          await owner.session.createCheckpoint('shared-name');
        const ownerPath = owner.session.getRecording().path;
        await sibling.setHistory([human('sibling-first'), ai('sibling-reply')]);
        await sibling.session.setRecording({ enabled: true });
        const siblingCheckpoint =
          await sibling.session.createCheckpoint('closed-source');
        const siblingPath = sibling.session.getRecording().path;
        await sibling.session.setRecording({ enabled: false });
        await owner.session.renameCheckpoint(
          siblingCheckpoint.checkpointId,
          'renamed-closed',
        );
        expect(
          (await owner.session.listCheckpoints())
            .map((entry) => entry.checkpointId)
            .sort(),
        ).toStrictEqual(
          [ownerCheckpoint.checkpointId, siblingCheckpoint.checkpointId].sort(),
        );
        await owner.session.restoreTurns(1);
        expect(JSON.stringify(await owner.getHistory())).not.toContain(
          'owner-last',
        );
        expect(sibling.session.getRecording().enabled).toBe(false);
        expect(await readFile(ownerPath ?? '', 'utf8')).toContain('"rewind"');
        expect(config.getSessionId()).toBeUndefined();
        expect(await readFile(siblingPath ?? '', 'utf8')).toContain(
          'sibling-first',
        );
        expect(
          (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
        ).toHaveLength(1);
      },
    );
  }, 30000);
});
