import { buildZedSession } from './zed-agent-setup.js';
import type { SubscribeModelChanges } from '@vybestack/llxprt-code-core/utils/events.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { WorkspaceIgnoreOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { WorkspaceTextOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';

import type { Agent } from '@vybestack/llxprt-code-agents';
import type { Config } from '@vybestack/llxprt-code-core';

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
    readonly subscribeModelChanges: SubscribeModelChanges;
  };

export function projectZedSessionSettings(
  config: Config,
  agent: Pick<
    Agent,
    'getModel' | 'getEphemeralSetting' | 'setEphemeralSetting'
  >,
  files: WorkspaceTextOperations,
  ignore: WorkspaceIgnoreOperations,
  subscribeModelChanges: SubscribeModelChanges,
): ZedSessionSettings {
  return {
    subscribeModelChanges,
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

export function buildProjectedZedSession<T>(
  agent: Agent,
  config: Config,
  files: WorkspaceTextOperations,
  subscribeModelChanges: SubscribeModelChanges,
  create: (settings: ZedSessionSettings) => T,
  onError: (error: unknown) => void,
): Promise<T> {
  return buildZedSession(
    () => agent.dispose(),
    () =>
      create(
        projectZedSessionSettings(
          config,
          agent,
          files,
          agent.workspace,
          subscribeModelChanges,
        ),
      ),
    onError,
  );
}
