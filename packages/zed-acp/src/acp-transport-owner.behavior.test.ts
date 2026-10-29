/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { collectRowsForAssertions } from '../../test-utils/src/core/collect-rows-for-assertions.js';
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
  return new Session({
    id: 'transport-owner',
    streamTurn: (input, options) => agent.stream(input, options),
    readModel: () => agent.getModel(),
    selectModel: (model) => agent.setModel(model),
    listModels: () => agent.listAvailableModels(),
    readContextLimit: () => agent.getProviderContextLimit(),
    readApprovalMode: () => agent.getApprovalMode(),
    writeApprovalMode: (mode) => agent.setApprovalMode(mode),
    readHistory: (signal) => agent.streamHistory(signal),
    compressHistory: (options) => agent.compress(options),
    retireAgent: () => agent.dispose(),
    lookupTool: (name) => agent.tools.get(name),
    listTools: () => agent.tools.list(),
    replyConfirmation: (id, decision, payload, requiresConfirmation) =>
      agent.tools.respondToConfirmation(
        id,
        decision,
        payload,
        requiresConfirmation,
      ),
    readTitle: () => agent.session.getRecordingTitle(),
    writeTitle: (title) => agent.session.recordRecordingTitle(title),
    readMemoryFiles: () => agent.memory.getFilePaths(),
    listProfiles: () => agent.profiles.list(),
    listTasks: () => agent.tasks.list(),
    readProjectRoot: config.getProjectRoot.bind(config),
    readMaxTurns: config.getMaxSessionTurns.bind(config),
    readDebugMode: config.getDebugMode.bind(config),
    readFiltering: config.getFileFilteringOptions.bind(config),
    readTargetDir: config.getTargetDir.bind(config),
    readRecursiveSearch: config.getEnableRecursiveFileSearch.bind(config),
    readTextFile: config.readTextFile.bind(config),
    shouldIgnoreFile: config.ignore.shouldIgnoreFile.bind(config.ignore),
    readIgnorePatterns: config.ignore.getCoreIgnorePatterns.bind(config.ignore),
    readSetting: config.getEphemeralSetting.bind(config),
    writeSetting: config.setEphemeralSetting.bind(config),
    subscribeModelChanges: config.subscribeModelChanges,
    connection: {
      sessionUpdate: async ({ update }: acp.SessionNotification) => {
        updates.push(update);
      },
      requestPermission: connection.requestPermission.bind(connection),
    },
    configOptionsEnabled: false,
    terminals: null,
  });
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
      await collectRowsForAssertions(owner.streamHistory(), (rows) => {
        expect(JSON.stringify(rows)).toContain('owner transport request');
      });
      await collectRowsForAssertions(sibling.streamHistory(), (rows) => {
        expect(rows).toHaveLength(0);
      });
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
