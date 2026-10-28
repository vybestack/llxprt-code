/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Agent } from '@vybestack/llxprt-code-agents';
import type * as acp from '@agentclientprotocol/sdk';
import type { SubscribeModelChanges } from '@vybestack/llxprt-code-core/utils/events.js';
import type { TerminalManager } from '../zed-terminal-manager.js';
import { Session } from '../zed-session.js';

export function createOwnedTestSession(
  id: string,
  agent: Agent,
  directory: string,
  connection: Pick<
    acp.AgentSideConnection,
    'sessionUpdate' | 'requestPermission'
  >,
  configOptionsEnabled = false,
  terminals: TerminalManager | null = null,
  subscribeModelChanges: SubscribeModelChanges = (listener) =>
    agent.settings.subscribeModelChanges(listener),
): Session {
  return new Session({
    id,
    streamTurn: (input, options) => agent.stream(input, options),
    readModel: () => agent.getModel(),
    selectModel: (model) => agent.setModel(model),
    listModels: () => agent.listAvailableModels(),
    readContextLimit: () => agent.getProviderContextLimit(),
    readApprovalMode: () => agent.getApprovalMode(),
    writeApprovalMode: (mode) => agent.setApprovalMode(mode),
    readHistory: () => agent.getHistory(),
    compressHistory: (options) => agent.compress(options),
    retireAgent: () => agent.dispose(),
    lookupTool: (name) => agent.tools.get(name),
    listTools: () => agent.tools.list(),
    replyConfirmation: agent.tools.respondToConfirmation.bind(agent.tools),
    readTitle: () => agent.session.getRecordingTitle(),
    writeTitle: (title) => agent.session.recordRecordingTitle(title),
    readMemoryFiles: () => agent.memory.getFilePaths(),
    listProfiles: () => agent.profiles.list(),
    listTasks: () => agent.tasks.list(),
    readProjectRoot: () => directory,
    readMaxTurns: () => 10,
    readDebugMode: () => false,
    readFiltering: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    readTargetDir: () => directory,
    readRecursiveSearch: () => true,
    readTextFile: (path) => agent.workspace.readTextFile(path),
    shouldIgnoreFile: (path, options) =>
      agent.workspace.shouldIgnoreFile(path, options),
    readIgnorePatterns: () => agent.workspace.getCoreIgnorePatterns(),
    readSetting: (key) => agent.getEphemeralSetting(key),
    writeSetting: (key, value) => agent.setEphemeralSetting(key, value),
    subscribeModelChanges,
    connection,
    configOptionsEnabled,
    terminals,
  });
}
