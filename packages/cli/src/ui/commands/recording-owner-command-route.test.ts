/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SessionRecordingService,
  replaySession,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import {
  useRecordingPrompts,
  withRecordingLifetimeFixture,
} from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { renderHook } from '../../__tests__/render.js';
import {
  ownerOperations,
  rawOperations,
} from '../hooks/__tests__/chat-registration-inputs.js';
import { bindChatRecordingOperations } from './chatCommandHost.js';
import { useChatCommand } from '../hooks/useChatCommand.js';
import type { RecordingSwapCallbacks } from '../../services/performResume.js';
import type { SlashCommand } from './types.js';

function registeredChat(
  agent: Agent,
  mode: 'agent' | 'raw' | undefined,
  swap?: RecordingSwapCallbacks,
): SlashCommand {
  const { result, unmount } = renderHook(() =>
    useChatCommand(
      ownerOperations(agent),
      bindChatRecordingOperations(
        () => swap?.getCurrentRecording() ?? null,
        () => null,
        () => null,
        rawOperations(agent).getMediaStore,
        () =>
          agent.agentClient.hasChatInitialized()
            ? agent.agentClient.getChat().getHistory()
            : null,
        rawOperations(agent).replaceChatHistory,
        () => null,
      ),
      mode,
      () => true,
    ),
  );
  const command = result.current;
  unmount();
  return command;
}

function loaderFor(chatCommand: SlashCommand): BuiltinCommandLoader {
  return new BuiltinCommandLoader(
    { ...createUnconfiguredBuiltinOwners(), chatCommand },
    null,
  );
}

async function saveCheckpoint(mode?: 'agent' | 'raw'): Promise<string> {
  let recorded = '';
  await withRecordingLifetimeFixture(async (agent) => {
    await agent.setHistory([
      { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
    ]);
    await agent.session.setRecording({ enabled: true });
    const path = agent.session.getRecording().path;
    if (!path) throw new Error('No owner recording');
    const command = loaderFor(registeredChat(agent, mode))
      .loadCommandsSync()
      .find((item) => item.name === 'chat')
      ?.subCommands?.find((item) => item.name === 'save');
    if (!command?.action) throw new Error('Missing /chat save');
    const result = await command.action(
      createMockCommandContext({ services: { agent } }),
      'checkpoint',
    );
    expect(result).toMatchObject({ messageType: 'info' });
    recorded = await readFile(path, 'utf8');
  });
  return recorded;
}

describe('interactive /chat command registry', () => {
  useRecordingPrompts();
  it('uses the Agent session for explicit owner mode in sync and async loads', async () => {
    const sync = await saveCheckpoint('agent');
    expect(sync).toContain('checkpoint');
    await withRecordingLifetimeFixture(async (agent) => {
      await agent.session.setRecording({ enabled: true });
      const registered = registeredChat(agent, 'agent');
      const command = (
        await loaderFor(registered).loadCommands(new AbortController().signal)
      ).find((item) => item.name === 'chat');
      expect(command).toBe(registered);
    });
  }, 30000);

  it('keeps the raw recording handler by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chat-raw-route-'));
    const projectHash = 'chat-raw-route';
    const recording = await SessionRecordingService.createLocked({
      sessionId: crypto.randomUUID(),
      projectHash,
      chatsDir: join(root, 'chats'),
      workspaceDirs: [root],
      cwd: root,
      provider: 'fake',
      model: 'fake-model',
    });
    try {
      recording.recordContent({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'raw hello' }],
      });
      await recording.flush();
      await withRecordingLifetimeFixture(async (agent) => {
        await agent.session.setRecording({ enabled: true });
        const registered = registeredChat(agent, undefined, {
          getCurrentRecording: () => recording,
          getCurrentIntegration: () => null,
          getCurrentLockHandle: () => null,
          setRecording: () => undefined,
        });
        const command = loaderFor(registered)
          .loadCommandsSync()
          .find((item) => item.name === 'chat');
        expect(command).toBe(registered);
        const save = command?.subCommands?.find((item) => item.name === 'save');
        if (!save?.action) throw new Error('Missing /chat save');
        expect(
          await save.action(
            createMockCommandContext({ services: { agent } }),
            'raw-checkpoint',
          ),
        ).toMatchObject({ messageType: 'info' });
        const replay = await replaySession(
          recording.getFilePath() ?? '',
          projectHash,
        );
        if (!replay.ok) throw new Error(replay.error);
        expect(replay.checkpoints).toContainEqual(
          expect.objectContaining({ name: 'raw-checkpoint' }),
        );
        expect(await agent.session.listCheckpoints()).toHaveLength(0);
      });
    } finally {
      await recording.dispose();
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
});
