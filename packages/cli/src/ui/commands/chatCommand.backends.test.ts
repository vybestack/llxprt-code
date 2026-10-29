/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  SessionDiscovery,
  createLockedSessionRecorder,
  type IContent,
  type LockHandle,
  type RecordingIntegration,
  type SessionMetadata,
  type SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertDefined } from '../../__tests__/assertions.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import {
  performResume,
  type RecordingSwapCallbacks,
} from '../../services/performResume.js';
import type { HistoryItemWithoutId } from '../types.js';
import { rawChatCommand } from '../../__tests__/raw-chat-command.fixture.js';
import type { CommandContext, SlashCommand } from './types.js';

const PROJECT = 'chat-command-backends';

function row(text: string, speaker: IContent['speaker'] = 'human'): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

async function texts(rows: AsyncIterable<IContent>): Promise<string[]> {
  const out: string[] = [];
  for await (const item of rows) {
    const block = item.blocks[0];
    if (block.type === 'text') out.push(block.text);
  }
  return out;
}

interface Live {
  recording: SessionRecordingPort | null;
  integration: RecordingIntegration | null;
  lock: LockHandle | null;
  metadata: SessionMetadata | null;
}

describe('/chat save then /chat resume with journal history', () => {
  let root: string;
  let chatsDir: string;
  let live: Live;
  let context: CommandContext;
  let displayed: HistoryItemWithoutId[];

  const command = (name: string): SlashCommand => {
    const result = rawChatCommand(
      () => live.recording,
      () => null,
      () => 'claude-4',
    ).subCommands?.find((item) => item.name === name);
    assertDefined(result);
    return result;
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'chat-command-backends-'));
    chatsDir = join(root, 'chats');
    const recording = await createLockedSessionRecorder({
      sessionId: 'live',
      projectHash: PROJECT,
      chatsDir,
      workspaceDirs: [root],
      cwd: root,
      provider: 'anthropic',
      model: 'claude-4',
    });
    await recordRowsForTest(recording, [row('A'), row('B', 'ai'), row('C')]);
    await recording.flush();
    live = {
      recording,
      integration: null,
      lock: recording.getOwnedLockHandle(),
      metadata: null,
    };
    displayed = [];
    context = createMockCommandContext({
      recordingSwapCallbacks: {
        getCurrentRecording: () => live.recording,
      },
      ui: {
        addItem: (item: HistoryItemWithoutId) => {
          displayed.push(item);
        },
      },
    });
  });

  afterEach(async () => {
    await live.integration?.dispose();
    await live.recording?.dispose();
    await rm(root, { recursive: true, force: true });
  });

  function resumeContext(): Parameters<typeof performResume>[1] {
    const recordingCallbacks: RecordingSwapCallbacks = {
      getCurrentRecording: () => live.recording,
      getCurrentIntegration: () => live.integration,
      getCurrentLockHandle: () => live.lock,
      getCurrentMetadata: () => live.metadata,
      setRecording: (recording, integration, lock, metadata) => {
        live = { recording, integration, lock, metadata };
      },
    };
    return {
      chatsDir,
      projectHash: PROJECT,
      currentSessionId: 'live',
      currentProvider: 'anthropic',
      currentModel: 'claude-4',
      workspaceDirs: [root],
      recordingCallbacks,
    };
  }

  it('saves a checkpoint of the live session, lists it, and resumes a child holding the saved rows', async () => {
    expect(await command('save').action?.(context, 'milestone')).toMatchObject({
      type: 'message',
      messageType: 'info',
    });
    await live.recording?.flush();
    const rowsAfter = row('after the save');
    assertDefined(live.recording);
    await recordRowsForTest(live.recording, [rowsAfter]);
    await live.recording.flush();

    await command('list').action?.(context, '');
    expect(displayed).toStrictEqual([
      {
        type: 'chat_list',
        chats: [expect.objectContaining({ name: 'milestone' })],
      },
    ]);

    const action = await command('resume').action?.(context, 'milestone');
    expect(action).toStrictEqual({
      type: 'perform_resume',
      sessionRef: 'milestone',
    });

    const result = await performResume('milestone', resumeContext());
    if (!result.ok) throw new Error(result.error);
    expect(await texts(result.history)).toStrictEqual(['A', 'B', 'C']);
    expect(result.metadata.sessionId).not.toBe('live');
    expect(live.recording.getSessionId()).toBe(result.metadata.sessionId);
  });

  it('requires confirmation to replace a checkpoint name and keeps the replacement resumable', async () => {
    expect(await command('save').action?.(context, 'milestone')).toMatchObject({
      type: 'message',
      messageType: 'info',
    });
    const original = (
      await SessionDiscovery.listContinueTargets(chatsDir, PROJECT)
    ).find((target) => target.kind === 'checkpoint');
    assertDefined(original);
    assertDefined(live.recording);
    await recordRowsForTest(live.recording, [row('replacement row')]);
    await live.recording.flush();

    expect(await command('save').action?.(context, 'milestone')).toMatchObject({
      type: 'confirm_action',
    });
    const beforeConfirmation = await SessionDiscovery.listContinueTargets(
      chatsDir,
      PROJECT,
    );
    expect(
      beforeConfirmation
        .filter((target) => target.kind === 'checkpoint')
        .map((target) => target.checkpointId),
    ).toStrictEqual([original.checkpointId]);
    context.overwriteConfirmed = true;
    expect(await command('save').action?.(context, 'milestone')).toMatchObject({
      type: 'message',
      messageType: 'info',
    });
    await live.recording.flush();
    const checkpoints = (
      await SessionDiscovery.listContinueTargets(chatsDir, PROJECT)
    ).filter((target) => target.kind === 'checkpoint');
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].checkpointId).not.toBe(original.checkpointId);
    const result = await performResume('milestone', resumeContext());
    if (!result.ok) throw new Error(result.error);
    expect(await texts(result.history)).toStrictEqual([
      'A',
      'B',
      'C',
      'replacement row',
    ]);
  });

  it('renames and deletes a closed checkpoint while another session is live', async () => {
    expect(await command('save').action?.(context, 'closed')).toMatchObject({
      type: 'message',
      messageType: 'info',
    });
    assertDefined(live.recording);
    await live.recording.dispose();
    const recording = await createLockedSessionRecorder({
      sessionId: 'next',
      projectHash: PROJECT,
      chatsDir,
      workspaceDirs: [root],
      provider: 'anthropic',
      model: 'claude-4',
    });
    live = {
      recording,
      integration: null,
      lock: recording.getOwnedLockHandle(),
      metadata: null,
    };
    await recordRowsForTest(recording, [row('next session')]);
    await recording.flush();
    expect(
      await command('rename').action?.(context, 'closed renamed'),
    ).toMatchObject({ type: 'message', messageType: 'info' });
    const renamed = (
      await SessionDiscovery.listContinueTargets(chatsDir, PROJECT)
    ).filter((target) => target.kind === 'checkpoint');
    expect(
      renamed.map((target) => [target.source.sessionId, target.checkpointName]),
    ).toStrictEqual([['live', 'renamed']]);
    expect(
      await command('delete').action?.(context, 'renamed --force'),
    ).toMatchObject({ type: 'message', messageType: 'info' });
    expect(
      (await SessionDiscovery.listContinueTargets(chatsDir, PROJECT)).filter(
        (target) => target.kind === 'checkpoint',
      ),
    ).toStrictEqual([]);
    expect(recording.isActive()).toBe(true);
    expect(recording.ownsLockFor('next')).toBe(true);
  });

  it('renames, names the session, and deletes a checkpoint so that it is gone from the listing', async () => {
    await command('save').action?.(context, 'milestone');
    expect(
      await command('rename').action?.(context, 'milestone renamed'),
    ).toMatchObject({ type: 'message', messageType: 'info' });
    expect(await command('name').action?.(context, 'branch')).toMatchObject({
      type: 'message',
      messageType: 'info',
    });
    await live.recording?.flush();
    const named = await SessionDiscovery.listContinueTargets(chatsDir, PROJECT);
    expect(
      named.map((target) =>
        target.kind === 'checkpoint' ? target.checkpointName : 'session',
      ),
    ).toContain('renamed');

    context.overwriteConfirmed = true;
    expect(await command('delete').action?.(context, 'renamed')).toMatchObject({
      type: 'message',
      messageType: 'info',
    });
    await live.recording?.flush();
    const remaining = await SessionDiscovery.listContinueTargets(
      chatsDir,
      PROJECT,
    );
    expect(
      remaining.filter((target) => target.kind === 'checkpoint'),
    ).toStrictEqual([]);
  });
});
