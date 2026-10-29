/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { afterEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import type { IContent } from '../services/history/IContent.js';
import { readJournalSnapshot } from './__tests__/support/journalSnapshot.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { SessionLockManager } from './SessionLockManager.js';
import { SessionTransitionService } from './SessionTransitionService.js';
import type { CheckpointMetadataView } from './types.js';

const PROJECT_HASH = 'rec-meta-project-hash';

function content(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function fileOf(recording: JournalRecordingService): string {
  const file = recording.getFilePath();
  if (file === null) throw new Error('Missing journal recording');
  return file;
}

describe('recording metadata and committed journal history', () => {
  const directory = useTempDir('rec-meta-');
  const recordings = new Set<JournalRecordingService>();
  afterEach(async () => {
    for (const recording of recordings) await recording.dispose();
    recordings.clear();
  });

  function config(): Parameters<typeof JournalRecordingService.create>[0] {
    return {
      sessionId: crypto.randomUUID(),
      projectHash: PROJECT_HASH,
      chatsDir: directory(),
      workspaceDirs: ['/test/workspace'],
      provider: 'anthropic',
      model: 'claude-4',
    };
  }

  function recorder(): JournalRecordingService {
    const recording = JournalRecordingService.create(config());
    recordings.add(recording);
    return recording;
  }

  it('is a readonly record with the expected shape', () => {
    const view: CheckpointMetadataView = {
      checkpointId: 'cp-1',
      name: 'foo',
      sequence: 5,
      deleted: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    expect(view.checkpointId).toBe('cp-1');
    expect(view.name).toBe('foo');
    expect(view.sequence).toBe(5);
    expect(view.deleted).toBe(false);
  });

  it('writes a checkpoint with a stable ID, name and saved version', async () => {
    const recording = recorder();
    await recordRowsForTest(recording, [content('A'), content('B', 'ai')]);
    const info = await recording.createCheckpoint('foo');
    expect(info.name).toBe('foo');
    expect(info.checkpointId).toBeTruthy();
    await recording.dispose();
    const saved = await readJournalSnapshot(fileOf(recording), PROJECT_HASH);
    expect(saved.checkpoints).toHaveLength(1);
    expect(saved.checkpoints[0].name).toBe('foo');
    expect(saved.checkpoints[0].checkpointId).toBe(info.checkpointId);
    expect(saved.checkpoints[0].sequence).toBe(info.sequence);
  });

  it('preserves the checkpoint creation timestamp in metadata', async () => {
    const recording = recorder();
    await recordRowsForTest(recording, [content('A')]);
    await recording.createCheckpoint('timestamped');
    await recording.dispose();
    const saved = await readJournalSnapshot(fileOf(recording), PROJECT_HASH);
    expect(saved.checkpoints[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns each concurrently created checkpoint saved sequence', async () => {
    const recording = recorder();
    await recordRowsForTest(recording, [content('A')]);
    const [first, second] = await Promise.all([
      recording.createCheckpoint('first'),
      recording.createCheckpoint('second'),
    ]);
    await recording.dispose();
    const saved = await readJournalSnapshot(fileOf(recording), PROJECT_HASH);
    const sequenceByName = new Map(
      saved.checkpoints.map((checkpoint) => [
        checkpoint.name,
        checkpoint.sequence,
      ]),
    );
    expect(sequenceByName.get(first.name)).toBe(first.sequence);
    expect(sequenceByName.get(second.name)).toBe(second.sequence);
    expect(
      new Set(saved.checkpoints.map((checkpoint) => checkpoint.sequence)).size,
    ).toBe(2);
  });

  it('rejects checkpoint creation on an empty unmaterialized conversation', async () => {
    const recording = recorder();
    await expect(recording.createCheckpoint('empty')).rejects.toThrow(
      'conversation has no content yet',
    );
    expect(recording.getFilePath()).toBeNull();
  });

  it('materializes an unstarted recording when naming the session', async () => {
    const recording = recorder();
    await recording.setSessionName('before-first-turn');
    expect(recording.getFilePath()).not.toBeNull();
    const saved = await readJournalSnapshot(fileOf(recording), PROJECT_HASH);
    expect(saved.sessionName).toBe('before-first-turn');
  });

  it('rejects rename and delete on an unmaterialized recording', async () => {
    const recording = recorder();
    await expect(
      recording.renameCheckpoint('missing', 'renamed'),
    ).rejects.toThrow('Checkpoint missing does not exist');
    await expect(recording.deleteCheckpoint('missing')).rejects.toThrow(
      'Checkpoint missing does not exist',
    );
    expect(recording.getFilePath()).toBeNull();
  });

  it('rejects checkpoint creation on an inactive recorder', async () => {
    const recording = recorder();
    await recordRowsForTest(recording, [content('A')]);
    await recording.dispose();
    await expect(recording.createCheckpoint('after-dispose')).rejects.toThrow(
      'recording is not active',
    );
  });

  it('deletes only the named checkpoint ID', async () => {
    const recording = recorder();
    await recordRowsForTest(recording, [content('A')]);
    const created = await recording.createCheckpoint('foo');
    await recording.createCheckpoint('retained');
    await recording.deleteCheckpoint(created.checkpointId);
    await recording.dispose();
    const saved = await readJournalSnapshot(fileOf(recording), PROJECT_HASH);
    expect(
      saved.checkpoints.find(
        (checkpoint) => checkpoint.checkpointId === created.checkpointId,
      ),
    ).toBeUndefined();
    expect(
      saved.checkpoints.map((checkpoint) => checkpoint.name),
    ).toStrictEqual(['retained']);
  });

  it('persists a session name and null clears it', async () => {
    const recording = recorder();
    await recordRowsForTest(recording, [content('A')]);
    await recording.setSessionName('experiment-a');
    expect(
      (await readJournalSnapshot(fileOf(recording), PROJECT_HASH)).sessionName,
    ).toBe('experiment-a');
    await recording.setSessionName(null);
    await recording.dispose();
    expect(
      (await readJournalSnapshot(fileOf(recording), PROJECT_HASH)).sessionName,
    ).toBeNull();
  });

  it('restores only rows through the saved checkpoint version', async () => {
    const recording = recorder();
    await recordRowsForTest(recording, [
      content('A'),
      content('B', 'ai'),
      content('C'),
    ]);
    await recording.createCheckpoint('atC');
    await recordRowsForTest(recording, [content('D', 'ai'), content('E')]);
    await recording.dispose();
    const targets = await SessionDiscovery.listContinueTargets(
      directory(),
      PROJECT_HASH,
    );
    const target = targets.find((candidate) => candidate.kind === 'checkpoint');
    if (target?.kind !== 'checkpoint') throw new Error('Missing checkpoint');
    const result = await new SessionTransitionService().forkFromCheckpoint(
      target,
      directory(),
      PROJECT_HASH,
      'anthropic',
      'claude-4',
      ['/test/workspace'],
    );
    if (!result.ok) throw new Error(result.error);
    recordings.add(result.recording);
    const restored = await Array.fromAsync(result.boot.streamRows());
    expect(restored).toHaveLength(3);
    expect(restored.map((row) => row.blocks)).toStrictEqual([
      content('A').blocks,
      content('B', 'ai').blocks,
      content('C').blocks,
    ]);
  });

  it('metadata never appears in history', async () => {
    const recording = recorder();
    await recordRowsForTest(recording, [content('A')]);
    await recording.createCheckpoint('foo');
    await recording.setSessionName('named');
    await recording.dispose();
    const saved = await readJournalSnapshot(fileOf(recording), PROJECT_HASH);
    expect(saved.history).toHaveLength(1);
    expect(saved.history[0].blocks[0]).toStrictEqual({
      type: 'text',
      text: 'A',
    });
  });

  it('renames checkpoints by stable ID without changing their saved sequence', async () => {
    const recording = recorder();
    await recordRowsForTest(recording, [content('A')]);
    const created = await recording.createCheckpoint('foo');
    await recording.renameCheckpoint(created.checkpointId, 'bar');
    await recording.dispose();
    const saved = await readJournalSnapshot(fileOf(recording), PROJECT_HASH);
    expect(saved.checkpoints).toHaveLength(1);
    expect(saved.checkpoints[0].checkpointId).toBe(created.checkpointId);
    expect(saved.checkpoints[0].name).toBe('bar');
    expect(saved.checkpoints[0].sequence).toBe(created.sequence);
    expect(saved.checkpoints[0].deleted).toBe(false);
  });

  it('excludes deleted checkpoints from the live view', async () => {
    const recording = recorder();
    await recordRowsForTest(recording, [content('A')]);
    const created = await recording.createCheckpoint('foo');
    await recording.deleteCheckpoint(created.checkpointId);
    await recording.dispose();
    expect(
      (await readJournalSnapshot(fileOf(recording), PROJECT_HASH)).checkpoints,
    ).toHaveLength(0);
  });

  it('records ancestry metadata when a fork is seeded', async () => {
    const parent = recorder();
    const rows = [content('A'), content('B', 'ai'), content('C')];
    await recordRowsForTest(parent, rows);
    const checkpoint = await parent.createCheckpoint('atC');
    await parent.dispose();
    const child = recorder();
    await recordRowsForTest(child, rows);
    const ancestry = {
      parentSessionId: parent.getSessionId(),
      parentSequence: checkpoint.sequence,
      checkpointId: checkpoint.checkpointId,
      checkpointName: checkpoint.name,
    };
    child.recordSessionFork(ancestry);
    await child.dispose();
    const saved = await readJournalSnapshot(fileOf(child), PROJECT_HASH);
    expect(saved.ancestry).toMatchObject({
      parentSessionId: parent.getSessionId(),
      parentSequence: checkpoint.sequence,
      checkpointName: 'atC',
    });
    expect(saved.ancestry).toStrictEqual(ancestry);
  });

  it('exposes saved checkpoints and session name together', async () => {
    const recording = recorder();
    await recordRowsForTest(recording, [content('A')]);
    const checkpoint = await recording.createCheckpoint('foo');
    await recording.setSessionName('my-session');
    await recording.dispose();
    const saved = await readJournalSnapshot(fileOf(recording), PROJECT_HASH);
    expect(saved.checkpoints).toBeDefined();
    expect(saved.checkpoints).toHaveLength(1);
    expect(saved.checkpoints[0].checkpointId).toBe(checkpoint.checkpointId);
    expect(saved.checkpoints[0].name).toBe('foo');
    expect(saved.sessionName).toBe('my-session');
  });

  it('lists and resolves named sessions and checkpoints without changing titles', async () => {
    const recording = recorder();
    await recordRowsForTest(recording, [content('A')]);
    await recording.createCheckpoint('branch-point');
    await recording.setSessionName('living-branch');
    await recording.dispose();
    const targets = await SessionDiscovery.listContinueTargets(
      directory(),
      PROJECT_HASH,
    );
    expect(targets.map((target) => target.kind)).toStrictEqual([
      'session',
      'checkpoint',
    ]);
    expect(
      SessionDiscovery.resolveContinueRef('branch-point', targets),
    ).toMatchObject({ target: { kind: 'checkpoint' } });
    expect(
      SessionDiscovery.resolveContinueRef('living-branch', targets),
    ).toMatchObject({ target: { kind: 'session' } });
    const session = targets.find((target) => target.kind === 'session');
    const checkpoint = targets.find((target) => target.kind === 'checkpoint');
    if (checkpoint?.kind !== 'checkpoint')
      throw new Error('Missing checkpoint');
    expect(
      SessionDiscovery.resolveContinueRef(checkpoint.checkpointId, targets),
    ).toMatchObject({ target: { kind: 'checkpoint' } });
    expect(session?.session.title).toBeUndefined();
    expect(checkpoint).not.toHaveProperty('session');
  });

  it('rejects reserved and project-duplicate names', async () => {
    const recording = recorder();
    await recordRowsForTest(recording, [content('A')]);
    await recording.createCheckpoint('taken');
    await recording.dispose();
    await expect(
      SessionDiscovery.validateAvailableName(
        'taken',
        directory(),
        PROJECT_HASH,
      ),
    ).rejects.toThrow(/already exists/);
    await expect(
      SessionDiscovery.validateAvailableName(
        'latest',
        directory(),
        PROJECT_HASH,
      ),
    ).rejects.toThrow(/reserved/);
    await expect(
      SessionDiscovery.validateAvailableName('2', directory(), PROJECT_HASH),
    ).rejects.toThrow(/reserved/);
  });

  it('holds a full-session-ID lock until recorder disposal', async () => {
    const options = config();
    const recording = await JournalRecordingService.createLocked(options);
    recordings.add(recording);
    await recordRowsForTest(recording, [content('A')]);
    expect(
      await SessionLockManager.isLocked(directory(), options.sessionId),
    ).toBe(true);
    await expect(
      SessionLockManager.acquire(directory(), options.sessionId),
    ).rejects.toThrow(/in use/);
    await recording.dispose();
    expect(
      await SessionLockManager.isLocked(directory(), options.sessionId),
    ).toBe(false);
  });
});
