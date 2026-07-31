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
import { createCompletionHandler } from './schema/index.js';
import type { CommandContext, SlashCommand } from './types.js';
import { MessageType } from '../types.js';

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

  const completionValues = async (
    commandName: string,
    partial: string,
  ): Promise<string[]> => {
    const schema = command(commandName).schema;
    assertDefined(schema);
    const handler = createCompletionHandler(schema);
    const result = await handler(
      context,
      {
        args: partial,
        completedArgs: [],
        partialArg: partial,
        commandPathLength: 2,
      },
      `/chat ${commandName} ${partial}`,
    );
    return result.suggestions.map((option) => option.value);
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
      if (typeof recording !== 'undefined') await recording.dispose();
    } finally {
      if (typeof root !== 'undefined') {
        await rm(root, { recursive: true, force: true });
      }
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

  it('rejects /chat save without a tag', async () => {
    expect(await command('save').action?.(context, '')).toStrictEqual({
      type: 'message',
      messageType: 'error',
      content: 'Missing tag. Usage: /chat save <tag>',
    });
  });

  it('rejects /chat resume without a tag', async () => {
    expect(await command('resume').action?.(context, '   ')).toStrictEqual({
      type: 'message',
      messageType: 'error',
      content: 'Missing tag. Usage: /chat resume <tag>',
    });
  });

  it('rejects /chat delete without a tag', async () => {
    expect(await command('delete').action?.(context, '')).toStrictEqual({
      type: 'message',
      messageType: 'error',
      content: 'Missing tag. Usage: /chat delete <tag>',
    });
  });

  it('prompts for confirmation before deleting a checkpoint', async () => {
    expect(
      await command('delete').action?.(context, 'milestone'),
    ).toMatchObject({
      type: 'confirm_action',
    });
  });

  it('requests overwrite confirmation when saving a duplicate checkpoint name', async () => {
    await command('save').action?.(context, 'dupe');

    const result = await command('save').action?.(context, 'dupe');

    expect(result).toMatchObject({ type: 'confirm_action' });
  });

  it('replaces a duplicate checkpoint after overwrite confirmation', async () => {
    await command('save').action?.(context, 'dupe');
    context.overwriteConfirmed = true;

    const result = await command('save').action?.(context, 'dupe');
    const replay = await replaySession(
      recording.getFilePath() ?? '',
      PROJECT_HASH,
    );

    expect({
      result,
      checkpoints: replay.checkpoints?.filter(
        (checkpoint) => checkpoint.deleted !== true,
      ),
    }).toStrictEqual({
      result: {
        type: 'message',
        messageType: 'info',
        content: 'Checkpoint saved: dupe.',
      },
      checkpoints: [expect.objectContaining({ name: 'dupe', deleted: false })],
    });
  });

  it('reports an error when saving an empty recording', async () => {
    await recording.dispose();
    recording = await SessionRecordingService.createLocked({
      sessionId: crypto.randomUUID(),
      projectHash: PROJECT_HASH,
      chatsDir,
      workspaceDirs: [root],
      cwd: root,
      provider: 'fake',
      model: 'fake-model',
    });

    expect(await command('save').action?.(context, 'empty')).toStrictEqual({
      type: 'message',
      messageType: 'error',
      content:
        'Failed to save checkpoint: Cannot create checkpoint: conversation has no content yet',
    });
  });

  it('treats an initialized empty history as having nothing to clear', async () => {
    Object.assign(context.services.config, {
      getAgentClient: () => ({
        hasChatInitialized: () => true,
        getChat: () => ({
          getHistory: () => [],
          setHistory: () => undefined,
        }),
      }),
    });

    expect(await command('clear').action?.(context, '')).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'No conversation to clear.',
    });
  });

  it('restores the requested human turn and persists its rewind', async () => {
    const history = [
      content('human', 'A'),
      content('ai', 'B'),
      content('human', 'C'),
      content('ai', 'D'),
    ];
    Object.assign(context.services.config, {
      getAgentClient: () => ({
        hasChatInitialized: () => true,
        getChat: () => ({
          getHistory: () => history,
        }),
      }),
    });
    recording.recordContent(content('human', 'C'));
    recording.recordContent(content('ai', 'D'));
    await recording.flush();

    const result = await command('restore').action?.(context, '1');

    expect(result).toStrictEqual({
      type: 'load_history',
      history: [
        { type: MessageType.USER, text: 'A' },
        { type: MessageType.AI, text: 'B' },
      ],
      clientHistory: history.slice(0, 2),
    });
    const replay = await replaySession(
      recording.getFilePath() ?? '',
      PROJECT_HASH,
    );
    expect(replay).toMatchObject({
      ok: true,
      history: [content('human', 'A'), content('ai', 'B')],
    });
  });

  it('completes checkpoint names for /chat resume', async () => {
    await command('save').action?.(context, 'alpha');
    await command('save').action?.(context, 'beta');

    expect(await completionValues('resume', 'alph')).toStrictEqual(['alpha']);
  });

  it('completes checkpoint names for /chat delete', async () => {
    await command('save').action?.(context, 'alpha');
    await command('save').action?.(context, 'beta');

    expect(await completionValues('delete', 'b')).toStrictEqual(['beta']);
  });

  it('reports recording-native debug information', async () => {
    const result = await command('debug').action?.(context, '');

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: `Chat Debug Information:
• Chat initialized: false
• History entries: 0 (chat not initialized)
• Current model: unavailable
• Recording file: ${recording.getFilePath()}
• Session ID: ${recording.getSessionId()}`,
    });
  });
});
