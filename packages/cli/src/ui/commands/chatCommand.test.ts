/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SessionRecordingService,
  replaySession,
  type IContent,
} from '@vybestack/llxprt-code-core';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { assertDefined } from '../../test-utils/assertions.js';
import { chatCommand } from './chatCommand.js';
import type { CommandContext, SlashCommand } from './types.js';

const PROJECT_HASH = 'chat-command-checkpoints';

function content(speaker: 'human' | 'ai', text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

describe('chatCommand recording-native checkpoints @plan:2026-07-28-issue-2625', () => {
  let root: string;
  let chatsDir: string;
  let recording: SessionRecordingService;
  let context: CommandContext;

  const command = (name: string): SlashCommand => {
    const result = chatCommand.subCommands?.find((item) => item.name === name);
    assertDefined(result);
    return result;
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'chat-command-'));
    chatsDir = join(root, 'chats');
    recording = await SessionRecordingService.createLocked({
      sessionId: crypto.randomUUID(),
      projectHash: PROJECT_HASH,
      chatsDir,
      workspaceDirs: [root],
      cwd: root,
      provider: 'fake',
      model: 'fake-model',
    });
    recording.recordContent(content('human', 'A'));
    recording.recordContent(content('ai', 'B'));
    await recording.flush();
    context = createMockCommandContext({
      recordingSwapCallbacks: {
        getCurrentRecording: () => recording,
      },
    });
    assertDefined(context.services.config);
    Object.assign(context.services.config, {
      getProjectRoot: () => root,
    });
  });

  afterEach(async () => {
    try {
      await recording.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('creates, lists, renames, and tombstones checkpoints in the active JSONL recording', async () => {
    expect(await command('save').action?.(context, 'milestone')).toMatchObject({
      type: 'message',
      messageType: 'info',
    });

    await command('list').action?.(context, '');
    expect(context.ui.addItem).toHaveBeenCalledWith({
      type: 'chat_list',
      chats: [expect.objectContaining({ name: 'milestone' })],
    });

    expect(
      await command('rename').action?.(context, 'milestone renamed'),
    ).toMatchObject({ type: 'message', messageType: 'info' });
    context.overwriteConfirmed = true;
    expect(await command('delete').action?.(context, 'renamed')).toMatchObject({
      type: 'message',
      messageType: 'info',
    });

    const replay = await replaySession(
      recording.getFilePath() ?? '',
      PROJECT_HASH,
    );
    expect(replay).toMatchObject({
      ok: true,
      checkpoints: [
        expect.objectContaining({ name: 'renamed', deleted: true }),
      ],
    });
  });

  it('/chat resume emits the canonical continuation transition action', async () => {
    expect(
      await command('resume').action?.(context, 'milestone'),
    ).toStrictEqual({
      type: 'perform_resume',
      sessionRef: 'milestone',
    });
  });

  it('names the active session without changing its title', async () => {
    expect(
      await command('name').action?.(context, 'living-branch'),
    ).toMatchObject({
      type: 'message',
      messageType: 'info',
    });
    const replay = await replaySession(
      recording.getFilePath() ?? '',
      PROJECT_HASH,
    );
    expect(replay.ok).toBe(true);
    expect(replay.sessionName).toBe('living-branch');
    expect(replay.metadata).toStrictEqual(
      expect.not.objectContaining({ title: expect.anything() }),
    );
  });

  it('exposes all recording-native subcommands', () => {
    expect(chatCommand.subCommands?.map((item) => item.name)).toStrictEqual([
      'list',
      'save',
      'resume',
      'delete',
      'rename',
      'clear',
      'restore',
      'name',
      'debug',
    ]);
  });
});
