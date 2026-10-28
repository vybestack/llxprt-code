import { checkpointBindings } from '../../__tests__/recording-checkpoint-fixture.js';
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
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { renderHook } from '../../__tests__/render.js';
import {
  ownerOperations,
  rawOperations,
} from '../hooks/__tests__/chat-registration-inputs.js';
import { useOwnerSessionAgents } from '../hooks/__tests__/owner-session-agents.js';
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
        ...checkpointBindings(
          () => swap?.getCurrentRecording() ?? null,
          () => null,
          () => null,
          () => undefined,
        ),
        () => agent.session.readInitializedHistory(),
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

async function saveCheckpoint(
  agent: Agent,
  mode?: 'agent' | 'raw',
): Promise<string> {
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
  return readFile(path, 'utf8');
}

describe('interactive /chat command registry', () => {
  const openAgent = useOwnerSessionAgents();
  it('uses the Agent session for explicit owner mode in sync and async loads', async () => {
    const { agent: first } = await openAgent();
    const sync = await saveCheckpoint(first, 'agent');
    expect(sync).toContain('checkpoint');
    const { agent } = await openAgent();
    await agent.session.setRecording({ enabled: true });
    const registered = registeredChat(agent, 'agent');
    const command = (
      await loaderFor(registered).loadCommands(new AbortController().signal)
    ).find((item) => item.name === 'chat');
    expect(command).toBe(registered);
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
      const { agent } = await openAgent();
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
    } finally {
      await recording.dispose();
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
});
