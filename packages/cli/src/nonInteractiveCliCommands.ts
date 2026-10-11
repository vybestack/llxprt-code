type SessionSettingsOwner = NonNullable<FromConfigOptions['settingsOwner']>;
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { buildSlashCommandRuntime } from './ui/cliUiRuntime.js';
import {
  type RuntimeProviderManager,
  FatalInputError,
  Logger,
  type Config,
  type AgentRequestInput,
  type WorkspaceTrustReadPort,
} from '@vybestack/llxprt-code-core';

import { parseSlashCommand } from './utils/commands.js';
import { uiTelemetryService } from '@vybestack/llxprt-code-telemetry';
import { CommandService } from './services/CommandService.js';
import { FileCommandLoader } from './services/FileCommandLoader.js';
import type { CommandContext, SlashCommand } from './ui/commands/types.js';
import type { RuntimeApi } from './ui/contexts/RuntimeContext.js';
import { createProviderAliasRefresh } from './runtime/createRuntimeOwnerFeatures.js';
import { createOAuthControl } from './runtime/createOAuthControl.js';
import type { Agent, FromConfigOptions } from '@vybestack/llxprt-code-agents';
import { createNonInteractiveUI } from './ui/noninteractive/nonInteractiveUi.js';
import type { LoadedSettings } from './config/settings.js';
import type { SessionStatsState } from './ui/contexts/SessionContext.js';
import { firstNonEmptyString } from './utils/coalesce.js';

/**
 * Processes a slash command in a non-interactive environment.
 *
 * @returns A Promise that resolves to `AgentRequestInput` if a valid command is
 *   found and results in a prompt, or `undefined` otherwise.
 * @throws {FatalInputError} if the command result is not supported in
 *   non-interactive mode.
 */
export const handleSlashCommand = async (
  rawQuery: string,
  abortController: AbortController,
  config: Config,
  settings: LoadedSettings,
  agent: Agent | undefined,
  runtimeApi: RuntimeApi | undefined,
  providerManager: RuntimeProviderManager | undefined,
  trust: WorkspaceTrustReadPort | undefined,
  readOAuthManager: () => OAuthManager | undefined = () => undefined,
  telemetrySettings?: SessionSettingsOwner,
): Promise<AgentRequestInput | undefined> => {
  const trimmed = rawQuery.trim();
  if (!trimmed.startsWith('/')) {
    return undefined;
  }

  // Only custom commands are supported for now.
  const authority = agent?.ide ?? trust;
  if (authority === undefined)
    throw new Error('File commands require the workspace trust authority');
  const loaders = [
    new FileCommandLoader({
      userCommandsDir: config.userCommandsDir,
      projectCommandsDir: config.projectCommandsDir,
      getProjectRoot: () => config.getProjectRoot(),
      getExtensions: () => config.getExtensions(),
      getFolderTrust: () => config.getFolderTrust(),
      isTrustedFolder: () => authority.isTrustedFolder(),
    }),
  ];
  const commandService = await CommandService.create(
    loaders,
    abortController.signal,
  );
  const commands = commandService.getCommands();

  const { commandToExecute, args } = parseSlashCommand(trimmed, commands);

  if (commandToExecute?.action) {
    const context = buildHeadlessCommandContext(
      config,
      agent,
      settings,
      providerManager,
      runtimeApi,
      abortController.signal,
      trimmed,
      commandToExecute.name,
      args,
      readOAuthManager,
      telemetrySettings,
    );

    const result = await commandToExecute.action(context, args);

    return commandPrompt(result);
  }

  return undefined;
};

function commandPrompt(
  result: Awaited<ReturnType<NonNullable<SlashCommand['action']>>>,
): AgentRequestInput | undefined {
  if (result) {
    switch (result.type) {
      case 'submit_prompt':
        return result.content as AgentRequestInput;
      case 'confirm_shell_commands':
        // This result indicates a command attempted to confirm shell commands.
        // However note that currently, ShellTool is excluded in non-interactive
        // mode unless 'YOLO mode' is active, so confirmation actually won't
        // occur because of YOLO mode.
        // This ensures that if a command *does* request confirmation (e.g.
        // in the future with more granular permissions), it's handled appropriately.
        throw new FatalInputError(
          'Exiting due to a confirmation prompt requested by the command.',
        );
      default:
        throw new FatalInputError(
          'Exiting due to command result that is not supported in non-interactive mode.',
        );
    }
  }
  return undefined;
}

function buildHeadlessCommandContext(
  config: Config,
  agent: Agent | undefined,
  settings: LoadedSettings,
  providerManager: RuntimeProviderManager | undefined,
  runtimeApi: RuntimeApi | undefined,
  signal: AbortSignal,
  trimmed: string,
  name: string,
  args: string,
  readOAuthManager: () => OAuthManager | undefined,
  telemetrySettings?: SessionSettingsOwner,
): CommandContext {
  const sessionStats: SessionStatsState = {
    sessionId: firstNonEmptyString(config.getSessionId(), 'unknown'),
    sessionStartTime: new Date(),
    metrics: uiTelemetryService.getMetrics(),
    lastPromptTokenCount: 0,
    historyTokenCount: 0,
    promptCount: 1,
  };

  const logger = new Logger(config.getSessionId(), config.projectTempDir);

  const context: CommandContext = {
    get runtimeApi() {
      if (!runtimeApi)
        throw new Error(
          'Headless command requires an Agent-owned runtime API.',
        );
      return runtimeApi;
    },
    refreshProviderAliases: () => {
      const manager = requireHeadlessProviderManager(agent, providerManager);
      return createProviderAliasRefresh(manager)();
    },
    get oauthControl() {
      const manager = requireHeadlessProviderManager(agent, providerManager);
      return createOAuthControl(readOAuthManager, manager);
    },
    signal,
    services: {
      get config() {
        if (agent === undefined)
          throw new Error(
            'Headless command requires an Agent-owned runtime API.',
          );
        return buildSlashCommandRuntime(
          config,
          agent,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          telemetrySettings,
        );
      },
      agent: agent ?? null,
      settings,
      git: undefined,
      logger,
    },
    ui: createNonInteractiveUI(),
    session: {
      stats: sessionStats,
      sessionShellAllowlist: new Set(),
    },
    invocation: {
      raw: trimmed,
      name,
      args,
    },
  };

  return context;
}

function requireHeadlessProviderManager(
  agent: Agent | undefined,
  supplied: RuntimeProviderManager | undefined,
): RuntimeProviderManager {
  const manager = agent?.providerManager ?? supplied;
  if (manager === undefined)
    throw new Error('Headless command requires a provider owner.');
  return manager;
}
