/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'bun:test';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type * as acp from '@agentclientprotocol/sdk';
import { Session } from './zed-session.js';
import { useCommandOwners } from '../../cli/src/__tests__/command-owner-fixture.js';
import { RecordingConnection } from './__tests__/zed-test-helpers.js';

function ownedTransport(agent: Agent, updates: acp.SessionUpdate[]): Session {
  const connection = new RecordingConnection();
  const config = {
    getProjectRoot: () => agent.workspace.getWorkingDirectory(),
    getTargetDir: () => agent.workspace.getWorkingDirectory(),
    getMaxSessionTurns: () => 3,
    getDebugMode: () => false,
    getModel: () => agent.getModel(),
    getEphemeralSetting: (key: string) => agent.getEphemeralSetting(key),
    setEphemeralSetting: (key: string, value: unknown) =>
      agent.setEphemeralSetting(key, value),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getEnableRecursiveFileSearch: () => false,
    readTextFile: (path: string) => readFile(path, 'utf8'),
    writeTextFile: (path: string, text: string) => writeFile(path, text),
    ignore: agent.workspace,
    subscribeModelChanges: () => () => {},
  };
  return new Session(
    'transport-owner',
    (input, options) => agent.stream(input, options),
    () => agent.getModel(),
    (model) => agent.setModel(model),
    () => agent.listAvailableModels(),
    () => agent.getProviderContextLimit(),
    () => agent.getApprovalMode(),
    (mode) => agent.setApprovalMode(mode),
    () => agent.getHistory(),
    (options) => agent.compress(options),
    () => agent.dispose(),
    (name) => agent.tools.get(name),
    () => agent.tools.list(),
    (id, decision, payload, requiresConfirmation) =>
      agent.tools.respondToConfirmation(
        id,
        decision,
        payload,
        requiresConfirmation,
      ),
    () => agent.session.getRecordingTitle(),
    (title) => agent.session.recordRecordingTitle(title),
    () => agent.memory.getFilePaths(),
    () => agent.profiles.list(),
    () => agent.tasks.list(),
    config,
    {
      sessionUpdate: async ({ update }: acp.SessionNotification) => {
        updates.push(update);
      },
      requestPermission: connection.requestPermission.bind(connection),
    },
  );
}

describe('ACP transport session operations', () => {
  const makeOwner = useCommandOwners();
  it('streams and replays owned history while sibling transport survives disposal', async () => {
    const owner = await makeOwner('acp-transport-owner');
    const sibling = await makeOwner('acp-transport-sibling');
    const updates: acp.SessionUpdate[] = [];
    const siblingUpdates: acp.SessionUpdate[] = [];
    const transport = ownedTransport(owner, updates);
    const siblingTransport = ownedTransport(sibling, siblingUpdates);
    try {
      const prompt: acp.PromptRequest = {
        sessionId: 'transport-owner',
        prompt: [{ type: 'text', text: 'owner transport request' }],
      };
      expect(await transport.prompt(prompt)).toMatchObject({
        stopReason: 'end_turn',
      });
      expect(JSON.stringify(await owner.getHistory())).toContain(
        'owner transport request',
      );
      expect(await sibling.getHistory()).toHaveLength(0);
      await transport.replayLiveHistory();
      expect(JSON.stringify(updates)).toContain('owner transport request');
      await transport.dispose();
      expect(await siblingTransport.prompt(prompt)).toMatchObject({
        stopReason: 'end_turn',
      });
      expect(JSON.stringify(siblingUpdates)).toContain('agent_message_chunk');
    } finally {
      await transport.dispose();
      await siblingTransport.dispose();
    }
  });
});
