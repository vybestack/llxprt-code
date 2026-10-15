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

export interface ZedSessionView {
  readonly projectRoot: string;
  readonly maxSessionTurns: number;
  readonly debugMode: boolean;
  readonly fileFiltering: ReturnType<Config['getFileFilteringOptions']>;
  readonly targetDir: string;
  readonly recursiveFileSearch: boolean;
}

export function captureZedSessionView(
  config: Pick<
    Config,
    | 'getProjectRoot'
    | 'getMaxSessionTurns'
    | 'getDebugMode'
    | 'getFileFilteringOptions'
    | 'getTargetDir'
    | 'getEnableRecursiveFileSearch'
  >,
): ZedSessionView {
  return {
    projectRoot: config.getProjectRoot(),
    maxSessionTurns: config.getMaxSessionTurns(),
    debugMode: config.getDebugMode(),
    fileFiltering: config.getFileFilteringOptions(),
    targetDir: config.getTargetDir(),
    recursiveFileSearch: config.getEnableRecursiveFileSearch(),
  };
}

export function projectZedSessionSettings(
  view: ZedSessionView,
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
    getProjectRoot: () => view.projectRoot,
    getMaxSessionTurns: () => view.maxSessionTurns,
    getDebugMode: () => view.debugMode,
    ignore,
    getFileFilteringOptions: () => view.fileFiltering,
    getTargetDir: () => view.targetDir,
    getEnableRecursiveFileSearch: () => view.recursiveFileSearch,
    readTextFile: (filePath) => files.readTextFile(filePath),
    writeTextFile: (filePath, content) =>
      files.writeTextFile(filePath, content),
  };
}
