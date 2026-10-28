/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { resolveEmojiFilterMode } from '../utils/iContentToHistoryItems.js';

import { describe, expect, it } from 'bun:test';
import { readFile, readdir, rm } from 'node:fs/promises';
import { basename } from 'node:path';
import { replaySession } from '@vybestack/llxprt-code-core';
import {
  openRouteAAgent,
  type RouteAAgent,
} from '../../../../agents/src/api/__tests__/helpers/route-a-agent.js';
import { useFakeResponsesReplay } from '../../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { bindChatOwnerOperations } from './chatCommandHost.js';
import { createChatOwnerCommand } from './chatOwnerCommand.js';

const human = (text: string) => ({
  speaker: 'human' as const,
  blocks: [{ type: 'text' as const, text }],
});
const ai = (text: string) => ({
  speaker: 'ai' as const,
  blocks: [{ type: 'text' as const, text }],
});

type RestoreTurns = Agent['session']['restoreTurns'];

// Registers /chat the way the session host does: bound to this one owner.
// `restoreTurns` replaces only the restore operation handed to the production
// binding, so a failure can be injected at the command's collaborator boundary.
function ownerActions(
  agent: Agent,
  restoreTurns: RestoreTurns = (turns) => agent.session.restoreTurns(turns),
) {
  const chat = createChatOwnerCommand(
    bindChatOwnerOperations(
      () => agent.session.listCheckpoints(),
      (name, options) => agent.session.createCheckpoint(name, options),
      (tag) => agent.session.resume(tag),
      (checkpointId) => agent.session.deleteCheckpoint(checkpointId),
      (checkpointId, name, options) =>
        agent.session.renameCheckpoint(checkpointId, name, options),
      () => agent.session.getHistory(),
      () => agent.session.clearHistory(),
      restoreTurns,
      (name, options) => agent.session.nameCurrentSession(name, options),
      () => agent.session.getRecording().path,
      () => agent.getModel(),
      () => resolveEmojiFilterMode(null),
    ),
    () => true,
  );
  return (name: string) => {
    const handler = chat.subCommands?.find((cmd) => cmd.name === name)?.action;
    if (!handler) throw new Error(`Missing /chat ${name}`);
    return handler;
  };
}

// One Route A agent (the caller-owned Config a host passes to fromConfig), plus
// independent siblings opened over the same working directory so that they
// share the chats directory. Everything is closed and the project temp
// directory removed when the scenario ends.
async function withChatRoute(
  scenario: (
    route: RouteAAgent,
    openSibling: () => Promise<RouteAAgent>,
  ) => Promise<void>,
): Promise<void> {
  const route = await openRouteAAgent({ config: { interactive: true } });
  const projectTempDir = route.config.projectTempDir;
  const siblings: RouteAAgent[] = [];
  try {
    await scenario(route, async () => {
      const sibling = await openRouteAAgent({
        config: { interactive: true, workingDir: route.directory },
      });
      siblings.push(sibling);
      return sibling;
    });
  } finally {
    for (const sibling of siblings.reverse()) await sibling.close();
    await route.close();
    await rm(projectTempDir, { recursive: true, force: true });
  }
}

const lockFiles = async (chatsDir: string): Promise<string[]> =>
  (await readdir(chatsDir)).filter((file) => file.endsWith('.lock'));

describe('owner-backed /chat command route', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');
  it('creates, lists, renames and deletes through one active owner and durable JSONL', async () => {
    await withChatRoute(async ({ agent, config }) => {
      const chatsDir = config.projectChatsDir;
      await agent.setHistory([human('seed'), ai('reply')]);
      await agent.session.setRecording({ enabled: true });
      const action = ownerActions(agent);
      const context = createMockCommandContext({ services: { agent } });
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('No owner recording');
      expect(await action('save')(context, 'first')).toMatchObject({
        messageType: 'info',
      });
      await action('list')(context, '');
      expect(context.ui.addItem).toHaveBeenCalledWith({
        type: 'chat_list',
        chats: [expect.objectContaining({ name: 'first' })],
      });
      expect(await action('rename')(context, 'first renamed')).toMatchObject({
        messageType: 'info',
      });
      expect(await action('delete')(context, 'renamed')).toMatchObject({
        type: 'confirm_action',
      });
      context.overwriteConfirmed = true;
      expect(await action('delete')(context, 'renamed')).toMatchObject({
        messageType: 'info',
      });
      const replay = await replaySession(path, basename(config.projectTempDir));
      if (!replay.ok) throw new Error(replay.error);
      expect(replay.ok).toBe(true);
      expect(replay.checkpoints).toContainEqual(
        expect.objectContaining({ name: 'renamed', deleted: true }),
      );
      expect(await lockFiles(chatsDir)).toHaveLength(1);
      expect(await readFile(path, 'utf8')).toContain('"checkpoint_deleted"');
    });
  }, 30000);

  it('refuses collisions until confirmation and overwrites create, rename and name', async () => {
    await withChatRoute(async ({ agent, config }) => {
      await agent.setHistory([human('seed')]);
      await agent.session.setRecording({ enabled: true });
      const action = ownerActions(agent);
      const context = createMockCommandContext({ services: { agent } });
      await action('save')(context, 'occupied');
      expect(await action('save')(context, 'occupied')).toMatchObject({
        type: 'confirm_action',
      });
      expect(await agent.session.listCheckpoints()).toHaveLength(1);
      context.overwriteConfirmed = true;
      expect(await action('save')(context, 'occupied')).toMatchObject({
        messageType: 'info',
      });
      context.overwriteConfirmed = false;
      await action('save')(context, 'source');
      expect(await action('rename')(context, 'source occupied')).toMatchObject({
        type: 'confirm_action',
      });
      context.overwriteConfirmed = true;
      expect(await action('rename')(context, 'source occupied')).toMatchObject({
        messageType: 'info',
      });
      context.overwriteConfirmed = false;
      expect(await action('name')(context, 'occupied')).toMatchObject({
        type: 'confirm_action',
      });
      context.overwriteConfirmed = true;
      expect(await action('name')(context, 'occupied')).toMatchObject({
        messageType: 'info',
      });
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('No owner recording');
      const replay = await replaySession(path, basename(config.projectTempDir));
      if (!replay.ok) throw new Error(replay.error);
      expect(replay.sessionName).toBe('occupied');
      expect(await agent.session.listCheckpoints()).toHaveLength(0);
    });
  }, 30000);

  it('restores and clears owner history with UI-only replay and no duplicate client history write', async () => {
    await withChatRoute(async ({ agent, config }) => {
      const chatsDir = config.projectChatsDir;
      await agent.setHistory([
        human('first'),
        ai('one'),
        human('second'),
        ai('two'),
      ]);
      await agent.session.setRecording({ enabled: true });
      const action = ownerActions(agent);
      const context = createMockCommandContext({ services: { agent } });
      const restored = await action('restore')(context, '1');
      expect(restored).toBeUndefined();
      expect(JSON.stringify(await agent.getHistory())).not.toContain('second');
      expect(context.ui.loadHistory).toHaveBeenCalledWith([
        expect.objectContaining({ type: 'user', text: 'first' }),
        expect.objectContaining({ type: 'gemini', text: 'one' }),
      ]);
      await agent.setHistory([human('first'), ai('one'), human('third')]);
      expect(await action('clear')(context, '')).toBeUndefined();
      expect(JSON.stringify(await agent.getHistory())).not.toContain('third');
      expect(context.ui.clear).toHaveBeenCalled();
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('No owner recording');
      const replay = await replaySession(path, basename(config.projectTempDir));
      if (!replay.ok) throw new Error(replay.error);
      expect(JSON.stringify(replay.history)).not.toContain('third');
      const raw = await readFile(path, 'utf8');
      expect(raw).toContain('"rewind"');
      expect(await lockFiles(chatsDir)).toHaveLength(1);
    });
  }, 30000);

  it('reports an error and leaves the UI and owner history untouched when the restore operation fails', async () => {
    await withChatRoute(async ({ agent, config }) => {
      await agent.setHistory([human('first'), ai('one'), human('second')]);
      await agent.session.setRecording({ enabled: true });
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('No owner recording');
      const action = ownerActions(agent, async () => {
        throw new Error('restore interrupted');
      });
      const context = createMockCommandContext({ services: { agent } });

      const result = await action('restore')(context, '1');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: 'Failed to restore history: restore interrupted',
      });
      expect(context.ui.loadHistory).not.toHaveBeenCalled();
      expect(context.ui.clear).not.toHaveBeenCalled();
      expect(context.ui.addItem).not.toHaveBeenCalled();
      await agent.session.flushRecording();
      const replay = await replaySession(path, basename(config.projectTempDir));
      if (!replay.ok) throw new Error(replay.error);
      expect(JSON.stringify(replay.history)).toContain('second');
      expect(JSON.stringify(await agent.getHistory())).toContain('second');
    });
  }, 30000);

  it('isolates borrowed sibling and resolves closed checkpoints by ID', async () => {
    await withChatRoute(async ({ agent, config }, openSibling) => {
      const chatsDir = config.projectChatsDir;
      const { agent: sibling } = await openSibling();
      await agent.setHistory([human('owner')]);
      await agent.session.setRecording({ enabled: true });
      await sibling.setHistory([human('sibling')]);
      await sibling.session.setRecording({ enabled: true });
      const saved = await sibling.session.createCheckpoint('foreign');
      const siblingPath = sibling.session.getRecording().path;
      await sibling.session.setRecording({ enabled: false });
      const action = ownerActions(agent);
      const context = createMockCommandContext({ services: { agent } });
      expect(
        await action('rename')(context, 'foreign new-foreign'),
      ).toMatchObject({ messageType: 'info' });
      expect(
        await action('delete')(context, `${saved.checkpointId} --force`),
      ).toMatchObject({ messageType: 'info' });
      const siblingReplay = await replaySession(
        siblingPath ?? '',
        basename(config.projectTempDir),
      );
      if (!siblingReplay.ok) throw new Error(siblingReplay.error);
      expect(siblingReplay.checkpoints).toContainEqual(
        expect.objectContaining({ name: 'new-foreign', deleted: true }),
      );
      const ownerPath = agent.session.getRecording().path;
      if (!ownerPath) throw new Error('No owner recording');
      expect(await readFile(ownerPath, 'utf8')).not.toContain('new-foreign');
      expect(await lockFiles(chatsDir)).toHaveLength(1);
    });
  }, 30000);
  it('resumes a checkpoint through the same owner with UI history replay', async () => {
    await withChatRoute(async ({ agent, config }) => {
      const chatsDir = config.projectChatsDir;
      await agent.setHistory([human('branch-point'), ai('first')]);
      await agent.session.setRecording({ enabled: true });
      await agent.session.createCheckpoint('branch');
      await agent.setHistory([
        human('branch-point'),
        ai('first'),
        human('later'),
      ]);
      const action = ownerActions(agent);
      const context = createMockCommandContext({ services: { agent } });
      expect(await action('resume')(context, 'branch')).toBeUndefined();
      expect(context.ui.loadHistory).toHaveBeenCalledWith([
        expect.objectContaining({ type: 'user', text: 'branch-point' }),
        expect.objectContaining({ type: 'gemini', text: 'first' }),
      ]);
      expect(context.ui.clear).not.toHaveBeenCalled();
      expect(JSON.stringify(await agent.getHistory())).not.toContain('later');
      expect(await lockFiles(chatsDir)).toHaveLength(1);
    });
  }, 30000);
  it('reads empty history from the owner without opening a second recorder', async () => {
    await withChatRoute(async ({ agent, config }) => {
      const chatsDir = config.projectChatsDir;
      await agent.session.setRecording({ enabled: true });
      const action = ownerActions(agent);
      const context = createMockCommandContext({ services: { agent } });
      expect(await action('clear')(context, '')).toMatchObject({
        content: 'No conversation to clear.',
      });
      expect(await agent.session.getHistory()).toHaveLength(0);
      expect(await lockFiles(chatsDir)).toHaveLength(1);
    });
  }, 30000);
});
