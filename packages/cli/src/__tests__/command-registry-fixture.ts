/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { bindCommandRawResume } from '../ui/hooks/commandRawResumeHost.js';
import { performResume } from '../services/performResume.js';
import { slashCommandLogger } from '../ui/hooks/slashCommandProcessor.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { bindChatOwnerOperations } from '../ui/commands/chatCommandHost.js';
import { createChatOwnerCommand } from '../ui/commands/chatOwnerCommand.js';
import type { UseSlashCommandProcessorCoreArgs } from '../ui/hooks/useSlashCommandProcessorCore.js';
import { createWorkspaceCommandOwners } from '../ui/hooks/workspaceCommandOwners.js';
import { resolveEmojiFilterMode } from '../ui/utils/iContentToHistoryItems.js';
import { CommandKind, type SlashCommand } from '../ui/commands/types.js';
import type { CliUiRuntime } from '../ui/cliUiRuntime.js';
import {
  createBuiltinCommandLoaderFactory,
  createRegisteredCommandLoader,
  createCommandChangeSubscription,
  type ReadBuiltinCommands,
} from '../services/commandRegistryOperations.js';
import { McpPromptLoader } from '../services/McpPromptLoader.js';
import { FileCommandLoader } from '../services/FileCommandLoader.js';
import { bindShellPromptOperations } from '../services/prompt-processors/shellPromptHost.js';

export function createCommandRegistryFixture(
  config: CliUiRuntime | null,
  agent: Agent | null = null,
) {
  const createBuiltin = createBuiltinCommandLoaderFactory(
    () => config?.getEnableHooksUI() === true,
    () => config?.isSkillsSupportEnabled() === true,
    () => config?.isAdminSkillsEnabled() !== false,
    () => {
      const manager = config?.extensionEnablementManager;
      return manager ? (name, path) => manager.isEnabled(name, path) : null;
    },
  );
  return {
    readBuiltinCommands: (owners: Parameters<ReadBuiltinCommands>[0]) =>
      createBuiltin(owners).loadCommandsSync(),
    loadRegisteredCommands: createRegisteredCommandLoader(
      createBuiltin,
      () =>
        new McpPromptLoader(
          config
            ? {
                getMcpServers: () => config.getMcpServers(),
                listPrompts: (server) => config.listPrompts(server),
              }
            : null,
        ),
      () =>
        new FileCommandLoader(
          config
            ? {
                userCommandsDir: config.userCommandsDir,
                projectCommandsDir: config.projectCommandsDir,
                getProjectRoot: () => config.getProjectRoot(),
                getExtensions: () => config.getExtensions(),
                getFolderTrust: () => config.getFolderTrust(),
                isTrustedFolder: () => config.isTrustedFolder(),
              }
            : null,
          bindShellPromptOperations(config),
        ),
    ),
    subscribeCommandChanges: config
      ? createCommandChangeSubscription(
          (listener) => {
            const ide = config.getIdeClient();
            ide?.addStatusChangeListener(listener);
            return () => ide?.removeStatusChangeListener(listener);
          },
          (listener) => agent?.mcp.subscribeStatus(listener),
        )
      : () => undefined,
  };
}

type CommandRegistrationFixture = Pick<
  UseSlashCommandProcessorCoreArgs,
  | 'registerWorkspaceCommands'
  | 'registerChatCommands'
  | 'registerSubagentCommand'
  | 'resumeOwnedCommand'
  | 'replaceCommandHistory'
  | 'bindRawCommandResume'
  | 'recordCommandEvent'
  | 'isMcpDiscoveryPending'
  | 'endCommandSession'
  | 'startNewCommandSession'
  | 'startCommandSession'
  | 'listCommandTools'
>;

function unavailableOwner(): never {
  throw new Error('Command operation is unavailable in this UI fixture');
}

function fixtureCommand(name: string): SlashCommand {
  return {
    name,
    description: `Fixture ${name} command`,
    kind: CommandKind.BUILT_IN,
    action: () => undefined,
  };
}

export function createCommandRegistrationFixture(
  agent?: Agent,
): CommandRegistrationFixture {
  const session = agent?.session;
  const chatCommand =
    agent === undefined || session === undefined
      ? fixtureCommand('chat')
      : createChatOwnerCommand(
          bindChatOwnerOperations(
            session.listCheckpoints.bind(session),
            session.createCheckpoint.bind(session),
            session.resume.bind(session),
            session.deleteCheckpoint.bind(session),
            session.renameCheckpoint.bind(session),
            session.getHistory.bind(session),
            session.clearHistory.bind(session),
            session.restoreTurns.bind(session),
            session.nameCurrentSession.bind(session),
            () => session.getRecording().path,
            () => agent.getModel(),
            () => resolveEmojiFilterMode(null),
          ),
          () => false,
        );
  return {
    registerWorkspaceCommands: (addItem, setMemoryFileCount) =>
      createWorkspaceCommandOwners(
        null,
        null,
        unavailableOwner,
        unavailableOwner,
        addItem,
        setMemoryFileCount,
        async () => {},
        () => null,
        unavailableOwner,
        unavailableOwner,
        null,
        unavailableOwner,
        unavailableOwner,
        unavailableOwner,
        null,
        unavailableOwner,
        unavailableOwner,
        unavailableOwner,
        unavailableOwner,
        unavailableOwner,
        unavailableOwner,
        unavailableOwner,
      ),
    registerChatCommands: (owner) => ({
      chatCommand: owner === 'agent' ? chatCommand : fixtureCommand('chat'),
      continueCommand: fixtureCommand('continue'),
    }),
    registerSubagentCommand: () => fixtureCommand('subagent'),
    resumeOwnedCommand: unavailableOwner,
    replaceCommandHistory: unavailableOwner,
    bindRawCommandResume: (config, callbacks) =>
      bindCommandRawResume(
        config,
        config?.sessionPersistence,
        () => agent?.agentClient.getHistoryService() ?? null,
        callbacks,
        slashCommandLogger,
        performResume,
      ),
    recordCommandEvent: null,
    isMcpDiscoveryPending: () => false,
    endCommandSession: async () => {},
    startNewCommandSession: async () => {},
    startCommandSession: async () => ({}),
    listCommandTools: () => [],
  };
}
