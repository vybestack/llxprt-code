import { useRecordingPrompts } from './helpers/recording-prompts.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { requireMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { describe, expect, it, spyOn } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import {
  withOldRecordingFixture as withRecordingLifetimeFixture,
  withNativeRecordingFixture,
  nativeRecordingFiles,
  nativeRows,
  rowTexts,
  requireRecordingPath,
  readJournalCheckpoints,
  readJournalFileFacts,
  type NativeFileControl,
} from './helpers/native-session-fixture.js';

const human = (text: string) => ({
  speaker: 'human' as const,
  blocks: [{ type: 'text' as const, text }],
});
const ai = (text: string) => ({
  speaker: 'ai' as const,
  blocks: [{ type: 'text' as const, text }],
});

describe('native agent owner restore and checkpoint names', () => {
  useRecordingPrompts();
  it('uses captured media for durable recording, checkpoint fork and resume without Config media access', async () => {
    await withNativeRecordingFixture(async ({ agent, config, clientFor }) => {
      const store = requireMediaStore(clientFor(agent));
      const media = await store.admit({
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
        const checkpoint =
          await agent.session.createCheckpoint('media-checkpoint');
        expect(await agent.session.listCheckpoints()).toContainEqual(
          checkpoint,
        );
        const path = requireRecordingPath(agent.session.getRecording().path);
        expect(JSON.stringify(await nativeRows(path))).toContain(
          media.contentId,
        );
        await agent.session.forkFromCheckpoint(checkpoint.checkpointId);
        const childPath = requireRecordingPath(
          agent.session.getRecording().path,
        );
        expect(JSON.stringify(await nativeRows(childPath))).toContain(
          media.contentId,
        );
        await agent.session.setRecording({ enabled: false });
        await agent.session.resume('latest');
        expect(
          JSON.stringify(await Array.fromAsync(agent.streamHistory())),
        ).toContain(media.contentId);
      } finally {
        Reflect.deleteProperty(config, 'getLocalMediaStore');
      }
    });
  }, 30000);

  it('streams restored rows, durably cuts human turns and continues on the same recording lock', async () => {
    await withNativeRecordingFixture(async ({ agent, chatsDir }) => {
      await agent.setHistory([human('first'), ai('one')]);
      await agent.session.setRecording({ enabled: true });
      await agent.setHistory([
        human('first'),
        ai('one'),
        human('second'),
        ai('two'),
      ]);
      const path = requireRecordingPath(agent.session.getRecording().path);
      const beforeLocks = (await readdir(chatsDir)).filter((file) =>
        file.endsWith('.lock'),
      );
      expect(beforeLocks).toHaveLength(1);
      const { remainingHistory, itemsRemoved } =
        await agent.session.restoreTurns(1);
      expect(itemsRemoved).toBe(2);
      expect(Array.isArray(remainingHistory)).toBe(false);
      expect(rowTexts(await Array.fromAsync(remainingHistory))).toStrictEqual([
        'first',
        'one',
      ]);
      expect(rowTexts(await nativeRows(path))).toStrictEqual(['first', 'one']);
      await agent.setHistory([human('first'), ai('one'), human('third')]);
      await agent.session.flushRecording();
      expect(rowTexts(await nativeRows(path))).toStrictEqual([
        'first',
        'one',
        'third',
      ]);
      expect(
        (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
      ).toStrictEqual(beforeLocks);
      await agent.session.setRecording({ enabled: false });
      expect(
        (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
      ).toStrictEqual([]);
      await agent.session.resume('latest');
      expect(
        rowTexts(await Array.fromAsync(agent.streamHistory())),
      ).toStrictEqual(['first', 'one', 'third']);
    });
  }, 30000);

  it('serializes restore before checkpoint, forks the restored version and rejects mutation after disposal', async () => {
    await withNativeRecordingFixture(async ({ agent, chatsDir }) => {
      await agent.setHistory([
        human('kept-turn'),
        ai('kept-reply'),
        human('discarded-turn'),
      ]);
      await agent.session.setRecording({ enabled: true });
      const path = requireRecordingPath(agent.session.getRecording().path);
      const [restored, checkpoint] = await Promise.all([
        agent.session.restoreTurns(1),
        agent.session.createCheckpoint('after-rewind'),
      ]);
      expect(restored.itemsRemoved).toBe(1);
      expect(await readJournalCheckpoints(path)).toContainEqual(
        expect.objectContaining({
          checkpointId: checkpoint.checkpointId,
          sequence: checkpoint.sequence,
        }),
      );
      expect(rowTexts(await nativeRows(path))).toStrictEqual([
        'kept-turn',
        'kept-reply',
      ]);
      await agent.session.forkFromCheckpoint(checkpoint.checkpointId);
      expect(
        rowTexts(await Array.fromAsync(agent.streamHistory())),
      ).toStrictEqual(['kept-turn', 'kept-reply']);
      await agent.dispose();
      await expect(agent.session.restoreTurns(1)).rejects.toThrow(
        'Session disposed',
      );
      expect(
        (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
      ).toStrictEqual([]);
    });
  }, 30000);

  it('rejects invalid turns and restores live and durable owners when client restoration fails', async () => {
    await withNativeRecordingFixture(async ({ agent, clientFor }) => {
      await agent.setHistory([
        human('base'),
        ai('base-reply'),
        human('cut'),
        ai('cut-reply'),
      ]);
      await agent.session.setRecording({ enabled: true });
      const path = requireRecordingPath(agent.session.getRecording().path);
      const before = await nativeRows(path);
      await expect(agent.session.restoreTurns(-1)).rejects.toThrow(
        'non-negative integer',
      );
      const client = clientFor(agent);
      const original = client.resetChat.bind(client);
      const fault = spyOn(client, 'resetChat').mockImplementationOnce(
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
      expect(
        isDeepStrictEqual(await Array.fromAsync(agent.streamHistory()), before),
      ).toBe(true);
      await agent.session.flushRecording();
      expect(isDeepStrictEqual(await nativeRows(path), before)).toBe(true);
      expect((await agent.session.restoreTurns(1)).itemsRemoved).toBe(2);
      expect(rowTexts(await nativeRows(path))).toStrictEqual([
        'base',
        'base-reply',
      ]);
    });
  }, 30000);

  it('denies collisions and atomically overwrites create, rename and session names', async () => {
    await withNativeRecordingFixture(async ({ agent, config }) => {
      await agent.setHistory([human('checkpoint-seed')]);
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
      expect(await agent.session.listCheckpoints()).toStrictEqual([]);
      const path = requireRecordingPath(agent.session.getRecording().path);
      expect((await readJournalFileFacts(path))?.facts.name).toBe('occupied');
      expect(config.getSessionId()).toBeUndefined();
    });
  }, 30000);

  for (const kind of ['write', 'flush'] as const) {
    it(`preserves colliding checkpoint names after a native ${kind} failure and actual reopen`, async () => {
      await withNativeRecordingFixture(async ({ agent, chatsDir }) => {
        const control: NativeFileControl = {};
        const restore = nativeRecordingFiles(chatsDir, control);
        try {
          await agent.setHistory([human('rollback-seed')]);
          const first = await agent.session.createCheckpoint('kept');
          const second = await agent.session.createCheckpoint('other');
          const path = requireRecordingPath(agent.session.getRecording().path);
          const failure = new Error(`disk refused ${kind}`);
          if (kind === 'write') control.writeError = failure;
          else control.flushError = failure;
          await expect(
            agent.session.renameCheckpoint(second.checkpointId, 'kept', {
              overwrite: true,
            }),
          ).rejects.toThrow(failure);
          const expected = [
            { checkpointId: first.checkpointId, name: 'kept' },
            { checkpointId: second.checkpointId, name: 'other' },
          ];
          expect(await agent.session.listCheckpoints()).toStrictEqual(
            expect.arrayContaining(
              expected.map((entry) => expect.objectContaining(entry)),
            ),
          );
          expect(await readJournalCheckpoints(path)).toStrictEqual(
            expect.arrayContaining(
              expected.map((entry) => expect.objectContaining(entry)),
            ),
          );
          await expect(
            agent.session.setRecording({ enabled: false }),
          ).rejects.toThrow(failure);
          control.writeError = undefined;
          control.flushError = undefined;
          await agent.session.resume('latest');
          expect(await agent.session.listCheckpoints()).toHaveLength(2);
          expect(await agent.session.listCheckpoints()).toStrictEqual(
            expect.arrayContaining(
              expected.map((entry) => expect.objectContaining(entry)),
            ),
          );
        } finally {
          restore();
        }
      });
    }, 30000);
  }

  it('isolates two borrowed owners while restoring and renaming a closed checkpoint', async () => {
    await withNativeRecordingFixture(
      async ({ agent: owner, borrow, config, chatsDir }) => {
        const sibling = await borrow();
        await owner.setHistory([
          human('owner-first'),
          ai('owner-reply'),
          human('owner-last'),
        ]);
        const first = await owner.session.createCheckpoint('shared-name');
        const ownerPath = requireRecordingPath(
          owner.session.getRecording().path,
        );
        await sibling.setHistory([human('sibling-first'), ai('sibling-reply')]);
        const second = await sibling.session.createCheckpoint('closed-source');
        const siblingPath = requireRecordingPath(
          sibling.session.getRecording().path,
        );
        await sibling.session.setRecording({ enabled: false });
        await owner.session.renameCheckpoint(
          second.checkpointId,
          'renamed-closed',
        );
        expect(
          (await owner.session.listCheckpoints())
            .map((entry) => entry.checkpointId)
            .sort(),
        ).toStrictEqual([first.checkpointId, second.checkpointId].sort());
        await owner.setHistory([
          human('owner-current'),
          ai('owner-current-reply'),
        ]);
        const restored = await owner.session.restoreTurns(1);
        expect(restored.itemsRemoved).toBe(2);
        await owner.session.flushRecording();
        expect(rowTexts(await nativeRows(ownerPath))).toStrictEqual([]);
        expect(await Array.fromAsync(owner.streamHistory())).toStrictEqual([]);
        expect(rowTexts(await nativeRows(siblingPath))).toStrictEqual([
          'sibling-first',
          'sibling-reply',
        ]);
        expect(await readJournalCheckpoints(siblingPath)).toContainEqual(
          expect.objectContaining({
            checkpointId: second.checkpointId,
            name: 'renamed-closed',
          }),
        );
        expect(sibling.session.getRecording().enabled).toBe(false);
        expect(config.getSessionId()).toBeUndefined();
        expect(
          (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
        ).toHaveLength(1);
      },
    );
  }, 30000);
});

describe('public restore media reservation failure', () => {
  useRecordingPrompts();
  for (const fixture of [
    withRecordingLifetimeFixture,
    withNativeRecordingFixture,
  ]) {
    it(`keeps live and durable rows atomic when the second media reservation fails (${fixture.name})`, async () => {
      await fixture(async ({ agent, clientFor }) => {
        const store = requireMediaStore(clientFor(agent));
        const first = await store.admit({
          bytes: new Uint8Array([2, 4, 6]),
          mimeType: 'image/png',
          semanticMetadata: {},
        });
        const second = await store.admit({
          bytes: new Uint8Array([3, 5, 7]),
          mimeType: 'image/png',
          semanticMetadata: {},
        });
        await agent.setHistory([
          { speaker: 'human', blocks: [first] },
          ai('kept reply'),
          { speaker: 'human', blocks: [second] },
          ai('cut reply'),
        ]);
        await agent.session.createCheckpoint('media-before-failure');
        const path = requireRecordingPath(agent.session.getRecording().path);
        const before = await Array.fromAsync(agent.streamHistory());
        const bytes = await readFile(path);
        const reserve = store.reserve.bind(store);
        const failure = new Error('second snapshot reservation refused');
        const fault = spyOn(store, 'reserve').mockImplementation(
          async (reference, owner) => {
            if (
              owner.startsWith('clear-snapshot:') &&
              reference.contentId === second.contentId
            )
              throw failure;
            await reserve(reference, owner);
          },
        );
        try {
          await expect(agent.session.restoreTurns(1)).rejects.toThrow(failure);
        } finally {
          fault.mockRestore();
        }
        expect(
          isDeepStrictEqual(
            await Array.fromAsync(agent.streamHistory()),
            before,
          ),
        ).toBe(true);
        expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
        expect(await store.readVerified(first)).toStrictEqual(
          new Uint8Array([2, 4, 6]),
        );
        expect(await store.readVerified(second)).toStrictEqual(
          new Uint8Array([3, 5, 7]),
        );
        expect((await agent.session.restoreTurns(1)).itemsRemoved).toBe(2);
        await agent.session.flushRecording();
        await agent.session.setRecording({ enabled: false });
        await agent.setHistory([]);
        await clientFor(agent).getHistoryService()?.settleMediaOwnership();
        expect(await store.hasReservations(first.contentId)).toBe(false);
        expect(await store.hasReservations(second.contentId)).toBe(false);
      });
    }, 30000);
  }
});
