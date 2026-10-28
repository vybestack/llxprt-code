/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { McpPromptLoader } from '../services/McpPromptLoader.js';
import {
  createBuiltinCommandLoaderFactory,
  createRegisteredCommandLoader,
  createCommandChangeSubscription,
  type LoadRegisteredCommands,
  type ReadBuiltinCommands,
  type SubscribeCommandChanges,
} from '../services/commandRegistryOperations.js';
import { createHeadlessCommandLoader } from '../nonInteractiveBindings.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type {
  CommandRegistryReads,
  FileCommandReads,
} from './cliCommandPorts.js';

/**
 * The command-registry bindings the UI registers: the builtin loader's
 * support flags, the MCP prompts that become slash commands, and the file- and
 * extension-provided commands found under the workspace.
 */
export interface AppCommandRegistry {
  readBuiltinCommands: ReadBuiltinCommands;
  loadRegisteredCommands: LoadRegisteredCommands;
  subscribeCommandChanges: SubscribeCommandChanges;
}

function fileCommandFiles(files: FileCommandReads) {
  return createHeadlessCommandLoader(
    () => files.userCommandsDir,
    () => files.projectCommandsDir,
    () => files.getProjectRoot(),
    () => files.getExtensions(),
    () => files.getFolderTrust(),
    () => () => files.isTrustedFolder(),
    () => files.getShellReplacement(),
    () => files.getExcludeTools(),
    () => files.getCoreTools(),
    () => files.getApprovalMode(),
    () => files.getShellExecutionConfig(),
    () => files.getTargetDir(),
    () => files.getShouldUseNodePtyShell(),
  );
}

export function createAppCommandRegistry(
  reads: CommandRegistryReads,
  files: FileCommandReads,
  ide: Pick<Agent['ide'], 'subscribeConnection'>,
  mcp: Pick<Agent['mcp'], 'subscribeStatus'>,
): AppCommandRegistry {
  const createBuiltin = createBuiltinCommandLoaderFactory(
    () => reads.getEnableHooksUI() === true,
    () => reads.isSkillsSupportEnabled() === true,
    () => reads.isAdminSkillsEnabled() !== false,
    () => {
      const manager = reads.extensionEnablementManager;
      return manager ? (name, path) => manager.isEnabled(name, path) : null;
    },
  );
  return {
    readBuiltinCommands: (owners) => createBuiltin(owners).loadCommandsSync(),
    loadRegisteredCommands: createRegisteredCommandLoader(
      createBuiltin,
      () =>
        new McpPromptLoader({
          getMcpServers: () => reads.getMcpServers(),
          listPrompts: (server) => reads.listPrompts(server),
        }),
      fileCommandFiles(files),
    ),
    subscribeCommandChanges: createCommandChangeSubscription(
      (listener) => ide.subscribeConnection(() => listener()),
      (listener) => mcp.subscribeStatus(listener),
    ),
  };
}
