/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createIdeCommand } from '../ui/commands/ideCommand.js';
import { bindIdeCommand } from '../ui/commands/ideCommandHost.js';
import { bindCommandRawResume } from '../ui/hooks/commandRawResumeHost.js';
import { performResume } from '../services/performResume.js';
import { slashCommandLogger } from '../ui/hooks/slashCommandProcessor.js';
import { createMockSettings } from './render.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { bindChatOwnerOperations } from '../ui/commands/chatCommandHost.js';
import { createChatOwnerCommand } from '../ui/commands/chatOwnerCommand.js';
import type { UseSlashCommandProcessorCoreArgs } from '../ui/hooks/useSlashCommandProcessorCore.js';
import { createWorkspaceCommandOwners } from '../ui/hooks/workspaceCommandOwners.js';
import { resolveEmojiFilterMode } from '../ui/utils/iContentToHistoryItems.js';
import { CommandKind, type SlashCommand } from '../ui/commands/types.js';
import type { FixtureCommandRuntime } from './slash-command-runtime-fixture.js';
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
  config: FixtureCommandRuntime | null,
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
    ...createFixtureIdeBindings(agent),
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
          (listener) => agent?.ide.subscribeConnection(() => listener()),
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

/** Every workspace command family, wired to unavailable operations. */
function createUnavailableWorkspaceOwners(
  addItem: Parameters<
    CommandRegistrationFixture['registerWorkspaceCommands']
  >[0],
  setMemoryFileCount: Parameters<
    CommandRegistrationFixture['registerWorkspaceCommands']
  >[1],
) {
  return createWorkspaceCommandOwners({
    workspace: {
      memory: null,
      bug: null,
      directory: null,
      getTargetDir: () => '',
    },
    writes: { addItem, setMemoryFileCount },
    policies: {
      readRules: () => null,
      readDefaultDecision: unavailableOwner,
      readNonInteractive: unavailableOwner,
    },
    hooks: {
      list: null,
      enable: unavailableOwner,
      disable: unavailableOwner,
      setDisabled: unavailableOwner,
    },
    tasks: {
      list: null,
      listRunning: unavailableOwner,
      get: unavailableOwner,
      cancel: unavailableOwner,
    },
    tools: {
      list: null,
      readSetting: unavailableOwner,
      writeSetting: unavailableOwner,
      refreshSchema: async () => {},
    },
    directory: {
      addDirectoryContext: unavailableOwner,
      recordDirectoriesChanged: unavailableOwner,
    },
    image: { runImageOperation: unavailableOwner },
    bug: { getConversationHistory: unavailableOwner, readIdeName: () => '' },
  });
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
    registerWorkspaceCommands: createUnavailableWorkspaceOwners,
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
        agent?.session,
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

function createFixtureIdeBindings(agent: Agent | null) {
  return {
    readCurrentIde: () => agent?.ide.readConnection().currentIde,
    readIdeContext: () => agent?.ide.readContext(),
    subscribeIdeContext: (
      listener: Parameters<Agent['ide']['subscribeContext']>[0],
    ) => agent?.ide.subscribeContext(listener) ?? (() => {}),
    readIdeWorkspaceTrust: () => agent?.ide.readWorkspaceTrust(),
    subscribeIdeWorkspaceTrust: (
      listener: Parameters<Agent['ide']['subscribeWorkspaceTrust']>[0],
    ) => agent?.ide.subscribeWorkspaceTrust(listener) ?? (() => {}),
    readIdeMode: () => agent?.ide.getIdeMode() ?? false,
    readIdeAvailable: () => agent?.ide.readConnection().available ?? false,
    readIdeDisplayName: () =>
      agent?.ide.getIdeMode() === true
        ? (agent.ide.readConnection().detectedIdeDisplayName ?? '')
        : '',
    readIdeDiffingEnabled: () =>
      agent?.ide.readConnection().diffingEnabled ?? false,
    subscribeIdeDiffing: (listener: () => void) =>
      agent?.ide.subscribeConnection(() => listener()) ?? (() => {}),
    resolveIdeDiff: async (
      filePath: string,
      outcome: 'accepted' | 'rejected',
    ) => {
      await agent?.ide.resolveDiff(filePath, outcome);
    },
    registerIdeCommand: (
      addItem: UseSlashCommandProcessorCoreArgs['addItem'],
    ) => {
      if (agent === null) return null;
      const ide = agent.ide;
      return createIdeCommand(
        bindIdeCommand(
          ide.readConnection.bind(ide),
          ide.readContext.bind(ide),
          ide.setIdeMode.bind(ide),
          ide.setIdeClientConnected.bind(ide),
          ide.setIdeClientDisconnected.bind(ide),
          createMockSettings({}),
          addItem,
        ),
      );
    },
  };
}
