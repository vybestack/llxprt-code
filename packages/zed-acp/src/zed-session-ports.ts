/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { WorkspaceIgnoreOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { WorkspaceTextOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';

import type { Agent } from '@vybestack/llxprt-code-agents';
import type { Config } from '@vybestack/llxprt-code-core';

export type ZedSessionAgentPort = Pick<
  Agent,
  | 'stream'
  | 'getModel'
  | 'setModel'
  | 'listAvailableModels'
  | 'getProviderContextLimit'
  | 'getApprovalMode'
  | 'setApprovalMode'
  | 'getHistory'
  | 'compress'
  | 'dispose'
> & {
  readonly tools: Pick<
    Agent['tools'],
    'get' | 'list' | 'respondToConfirmation'
  >;
  readonly session: Pick<
    Agent['session'],
    'getRecordingTitle' | 'recordRecordingTitle'
  >;
  readonly memory: Pick<Agent['memory'], 'getFilePaths'>;
  readonly profiles: Pick<Agent['profiles'], 'list'>;
  readonly tasks: Pick<Agent['tasks'], 'list'>;
};

export type ZedSessionSettings = Pick<
  Config,
  | 'getProjectRoot'
  | 'getMaxSessionTurns'
  | 'getDebugMode'
  | 'getFileFilteringOptions'
  | 'getTargetDir'
  | 'getEnableRecursiveFileSearch'
> &
  Pick<Agent, 'getModel' | 'getEphemeralSetting' | 'setEphemeralSetting'> &
  WorkspaceTextOperations & {
    readonly ignore: WorkspaceIgnoreOperations;
  };

export function projectZedSessionAgent(agent: Agent): ZedSessionAgentPort {
  return {
    stream: (input, options) => agent.stream(input, options),
    getModel: () => agent.getModel(),
    setModel: (model) => agent.setModel(model),
    listAvailableModels: () => agent.listAvailableModels(),
    getProviderContextLimit: () => agent.getProviderContextLimit(),
    getApprovalMode: () => agent.getApprovalMode(),
    setApprovalMode: (mode) => agent.setApprovalMode(mode),
    getHistory: () => agent.getHistory(),
    compress: (options) => agent.compress(options),
    dispose: () => agent.dispose(),
    tools: {
      get: (name) => agent.tools.get(name),
      list: () => agent.tools.list(),
      respondToConfirmation: (id, decision, payload, requiresConfirmation) =>
        agent.tools.respondToConfirmation(
          id,
          decision,
          payload,
          requiresConfirmation,
        ),
    },
    session: {
      getRecordingTitle: () => agent.session.getRecordingTitle(),
      recordRecordingTitle: (title) =>
        agent.session.recordRecordingTitle(title),
    },
    memory: { getFilePaths: () => agent.memory.getFilePaths() },
    profiles: { list: () => agent.profiles.list() },
    tasks: { list: () => agent.tasks.list() },
  };
}

export function projectZedSessionSettings(
  config: Config,
  agent: Pick<
    Agent,
    'getModel' | 'getEphemeralSetting' | 'setEphemeralSetting'
  >,
  files: WorkspaceTextOperations,
  ignore: WorkspaceIgnoreOperations,
): ZedSessionSettings {
  return {
    getModel: () => agent.getModel(),
    getEphemeralSetting: (key) => agent.getEphemeralSetting(key),
    setEphemeralSetting: (key, value) => agent.setEphemeralSetting(key, value),
    getProjectRoot: () => config.getProjectRoot(),
    getMaxSessionTurns: () => config.getMaxSessionTurns(),
    getDebugMode: () => config.getDebugMode(),
    ignore,
    getFileFilteringOptions: () => config.getFileFilteringOptions(),
    getTargetDir: () => config.getTargetDir(),
    getEnableRecursiveFileSearch: () => config.getEnableRecursiveFileSearch(),
    readTextFile: (filePath) => files.readTextFile(filePath),
    writeTextFile: (filePath, content) =>
      files.writeTextFile(filePath, content),
  };
}
