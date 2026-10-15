import { createSessionMetrics } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  FatalInputError,
  type Config,
  type AgentRequestInput,
  type WorkspaceTrustReadPort,
} from '@vybestack/llxprt-code-core';

import { parseSlashCommand } from './utils/commands.js';
import { CommandService } from './services/CommandService.js';
import { bindShellPromptOperations } from './services/prompt-processors/shellPromptHost.js';
import { FileCommandLoader } from './services/FileCommandLoader.js';
import type { CommandContext, SlashCommand } from './ui/commands/types.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { createNonInteractiveUI } from './ui/noninteractive/nonInteractiveUi.js';
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
  agent: Agent | undefined,
  trust: WorkspaceTrustReadPort | undefined,
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
    new FileCommandLoader(
      {
        userCommandsDir: config.userCommandsDir,
        projectCommandsDir: config.projectCommandsDir,
        getProjectRoot: () => config.getProjectRoot(),
        getExtensions: () => config.getExtensions(),
        getFolderTrust: () => config.getFolderTrust(),
        isTrustedFolder: () => authority.isTrustedFolder(),
      },
      bindShellPromptOperations(config),
    ),
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
      abortController.signal,
      trimmed,
      commandToExecute.name,
      args,
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
  signal: AbortSignal,
  trimmed: string,
  name: string,
  args: string,
): CommandContext {
  const sessionStats: SessionStatsState = {
    sessionId: firstNonEmptyString(config.getSessionId(), 'unknown'),
    sessionStartTime: new Date(),
    metrics:
      agent === undefined ? createSessionMetrics() : agent.metrics.getMetrics(),
    lastPromptTokenCount: 0,
    historyTokenCount: 0,
    promptCount: 1,
  };

  const context: CommandContext = {
    signal,
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
