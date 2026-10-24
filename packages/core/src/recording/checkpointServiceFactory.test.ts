/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import * as path from 'node:path';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';

import type { IContent } from '../services/history/IContent.js';
import { requireJsonlRecorder } from '../services/history/recorderBackend.js';

import { createCheckpointService } from './checkpointServiceFactory.js';
import { JournalCheckpointService } from './journalCheckpointService.js';
import { JournalRecordingService } from './journalRecordingService.js';
import type { SessionRecordingPort } from './recordingPort.js';
import { deleteSessionById } from './sessionManagement.js';
import { createLockedSessionRecorder } from './sessionRecorderFactory.js';

const PROJECT = 'checkpoint-factory';

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

async function recordRows(
  recorder: SessionRecordingPort,
  rows: readonly IContent[],
): Promise<void> {
  if (recorder instanceof JournalRecordingService) {
    await (await recorder.session()).append(rows);
    return;
  }
  const jsonl = requireJsonlRecorder(recorder);
  for (const item of rows) jsonl.recordContent(item);
}

function fileOf(recorder: SessionRecordingPort): string {
  const file = recorder.getFilePath();
  if (file === null) throw new Error('the recorder wrote no file');
  return file;
}

describe('checkpoint service factory', () => {
  const directory = useTempDir('checkpoint-factory-');

  const live = new Set<SessionRecordingPort>();
  afterEach(async () => {
    for (const recorder of live) await recorder.dispose();
    live.clear();
  });

  const backends = [['journal', JournalCheckpointService]] as const;

  for (const [backend, serviceClass] of backends) {
    describe(`backend ${backend}`, () => {
      async function active(sessionId = 'live'): Promise<SessionRecordingPort> {
        const recorder = await createLockedSessionRecorder({
          sessionId,
          projectHash: PROJECT,
          chatsDir: path.join(directory(), 'chats'),
          workspaceDirs: ['/work/a'],
          provider: 'anthropic',
          model: 'model-1',
        });
        live.add(recorder);
        await recordRows(recorder, [row('one'), row('two')]);
        await recorder.flush();
        return recorder;
      }

      it('builds that backend’s service', () => {
        expect(createCheckpointService()).toBeInstanceOf(serviceClass);
      });

      it('creates, renames, lists and deletes a checkpoint of a live recorder through one interface', async () => {
        const recorder = await active();
        const service = createCheckpointService();
        const created = await service.createCheckpoint(
          recorder,
          PROJECT,
          'first',
        );
        await service.renameCheckpoint(
          recorder,
          PROJECT,
          created.checkpointId,
          'renamed',
        );
        await recorder.flush();
        const filePath = fileOf(recorder);
        const listed = await service.listCheckpoints(filePath);
        expect(listed.map((view) => view.name)).toStrictEqual(['renamed']);
        expect(listed[0].checkpointId).toBe(created.checkpointId);
        expect(listed[0].sequence).toBe(created.sequence);
        expect(await service.getDeletionBlockers(filePath)).toStrictEqual(
          listed,
        );

        await service.deleteCheckpoint(recorder, PROJECT, created.checkpointId);
        await recorder.flush();
        expect(await service.listCheckpoints(filePath)).toStrictEqual([]);
        expect(await service.getDeletionBlockers(filePath)).toStrictEqual([]);
        await expect(
          service.renameCheckpoint(
            recorder,
            PROJECT,
            created.checkpointId,
            'gone',
          ),
        ).rejects.toThrow(/not found or deleted/);
        await expect(
          service.deleteCheckpoint(recorder, PROJECT, created.checkpointId),
        ).rejects.toThrow(/not found or deleted/);
      });

      it('rejects duplicate names and overwrites only after confirmation', async () => {
        const recorder = await active();
        const service = createCheckpointService();
        const first = await service.createCheckpoint(
          recorder,
          PROJECT,
          'shared',
        );
        await recorder.flush();
        await expect(
          service.createCheckpoint(recorder, PROJECT, 'shared'),
        ).rejects.toThrow(/already exists/);
        expect(
          (await service.listCheckpoints(fileOf(recorder))).map(
            (view) => view.checkpointId,
          ),
        ).toStrictEqual([first.checkpointId]);
        const replacement = await service.createCheckpoint(
          recorder,
          PROJECT,
          'shared',
          true,
        );
        await recorder.flush();
        expect(
          (await service.listCheckpoints(fileOf(recorder))).map(
            (view) => view.checkpointId,
          ),
        ).toStrictEqual([replacement.checkpointId]);
      });

      it('coordinates checkpoint and session names across closed sessions', async () => {
        const other = await active('other');
        const service = createCheckpointService();
        await service.createCheckpoint(other, PROJECT, 'taken');
        await other.flush();
        await other.dispose();
        live.delete(other);
        const recorder = await active();
        await expect(
          service.setSessionName(recorder, PROJECT, 'taken'),
        ).rejects.toThrow(/already exists/);
        await service.setSessionName(recorder, PROJECT, 'taken', true);
        await recorder.flush();
        expect(await service.getDeletionBlockers(fileOf(other))).toStrictEqual(
          [],
        );
        await expect(
          service.createCheckpoint(recorder, PROJECT, 'taken'),
        ).rejects.toThrow(/already exists/);
        const created = await service.createCheckpoint(
          recorder,
          PROJECT,
          'new',
        );
        await recorder.flush();
        await expect(
          service.renameCheckpoint(
            recorder,
            PROJECT,
            created.checkpointId,
            'taken',
          ),
        ).rejects.toThrow(/already exists/);
        for (const reserved of ['live', 'other', created.checkpointId]) {
          await expect(
            service.renameCheckpoint(
              recorder,
              PROJECT,
              created.checkpointId,
              reserved,
              true,
            ),
          ).rejects.toThrow(/already exists/);
        }
        expect(
          (await service.listCheckpoints(fileOf(recorder))).map(
            (view) => view.name,
          ),
        ).toStrictEqual(['new']);
      });

      it('blocks session deletion until its live checkpoints are deleted', async () => {
        const recorder = await active();
        const service = createCheckpointService();
        const checkpoint = await service.createCheckpoint(
          recorder,
          PROJECT,
          'blocker',
        );
        await recorder.flush();
        const file = fileOf(recorder);
        const chats = recorder.getChatsDir();
        await recorder.dispose();
        live.delete(recorder);
        const blocked = await deleteSessionById('live', chats, PROJECT);
        expect(blocked.ok).toBe(false);
        if (blocked.ok)
          throw new Error('deleted a session with live checkpoints');
        expect(blocked.error).toContain(
          `live checkpoints block deletion: blocker (${checkpoint.checkpointId})`,
        );
        expect(
          (await service.listCheckpoints(file)).map(
            (view) => view.checkpointId,
          ),
        ).toStrictEqual([checkpoint.checkpointId]);
        await service.deleteCheckpointClosed(
          file,
          PROJECT,
          chats,
          'live',
          checkpoint.checkpointId,
        );
        expect(await deleteSessionById('live', chats, PROJECT)).toStrictEqual({
          ok: true,
          deletedSessionId: 'live',
        });
      });

      it('creates, renames and deletes checkpoints on a closed session', async () => {
        const recorder = await active();
        const file = fileOf(recorder);
        const chats = recorder.getChatsDir();
        await recorder.dispose();
        live.delete(recorder);
        const service = createCheckpointService();
        const created = await service.createCheckpointClosed(
          file,
          PROJECT,
          chats,
          'live',
          'closed',
        );
        await expect(
          service.createCheckpointClosed(
            file,
            PROJECT,
            chats,
            'live',
            'closed',
          ),
        ).rejects.toThrow(/already exists/);
        await service.renameCheckpointClosed(
          file,
          PROJECT,
          chats,
          'live',
          created.checkpointId,
          'renamed',
        );
        const listed = await service.listCheckpoints(file);
        expect(
          listed.map((view) => ({
            name: view.name,
            id: view.checkpointId,
            sequence: view.sequence,
          })),
        ).toStrictEqual([
          {
            name: 'renamed',
            id: created.checkpointId,
            sequence: created.sequence,
          },
        ]);
        expect(await service.getDeletionBlockers(file)).toStrictEqual(listed);
        await service.deleteCheckpointClosed(
          file,
          PROJECT,
          chats,
          'live',
          created.checkpointId,
        );
        expect(await service.listCheckpoints(file)).toStrictEqual([]);
        expect(await service.getDeletionBlockers(file)).toStrictEqual([]);
      });
    });
  }

  it('creates the journal service without backend selection', () => {
    expect(createCheckpointService()).toBeInstanceOf(JournalCheckpointService);
  });
});
