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
  return new Session(
    id,
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
    agent.tools.respondToConfirmation.bind(agent.tools),
    () => agent.session.getRecordingTitle(),
    (title) => agent.session.recordRecordingTitle(title),
    () => agent.memory.getFilePaths(),
    () => agent.profiles.list(),
    () => agent.tasks.list(),
    () => directory,
    () => 10,
    () => false,
    () => ({ respectGitIgnore: true, respectLlxprtIgnore: true }),
    () => directory,
    () => true,
    (path) => agent.workspace.readTextFile(path),
    (path, options) => agent.workspace.shouldIgnoreFile(path, options),
    () => agent.workspace.getCoreIgnorePatterns(),
    (key) => agent.getEphemeralSetting(key),
    (key, value) => agent.setEphemeralSetting(key, value),
    subscribeModelChanges,
    connection,
    configOptionsEnabled,
    terminals,
  );
}
