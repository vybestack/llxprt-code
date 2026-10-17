/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  FatalInputError,
  type AgentRequestInput,
} from '@vybestack/llxprt-code-core';

import { parseSlashCommand } from './utils/commands.js';
import { CommandService } from './services/CommandService.js';
import type { FileCommandLoader } from './services/FileCommandLoader.js';
import type { CommandContext, SlashCommand } from './ui/commands/types.js';
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
  createLoader: () => FileCommandLoader,
  readSessionId: () => string,
  readMetrics: () => SessionStatsState['metrics'],
): Promise<AgentRequestInput | undefined> => {
  const trimmed = rawQuery.trim();
  if (!trimmed.startsWith('/')) {
    return undefined;
  }

  const loaders = [createLoader()];
  const commandService = await CommandService.create(
    loaders,
    abortController.signal,
  );
  const commands = commandService.getCommands();

  const { commandToExecute, args } = parseSlashCommand(trimmed, commands);

  if (commandToExecute?.action) {
    const context = buildHeadlessCommandContext(
      readSessionId,
      readMetrics,
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
  readSessionId: () => string,
  readMetrics: () => SessionStatsState['metrics'],
  signal: AbortSignal,
  trimmed: string,
  name: string,
  args: string,
): CommandContext {
  const sessionStats: SessionStatsState = {
    sessionId: firstNonEmptyString(readSessionId(), 'unknown'),
    sessionStartTime: new Date(),
    metrics: readMetrics(),
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
