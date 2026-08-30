/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GitService, LlxprtExtension } from '@vybestack/llxprt-code-core';
import type { AgentExecutor, ExecutionEventBus } from '@a2a-js/sdk/server';

export interface CommandArgument {
  readonly name: string;
  readonly description: string;
  readonly isRequired?: boolean;
}

/**
 * Interface-neutral command context (#3221): commands render host-owned state
 * (loaded extensions, startup model, checkpoint storage) instead of reaching
 * into a runtime Config. The A2A server supplies these fields from the same
 * settings/extensions input it uses to build task Agents.
 */
export interface CommandContext {
  extensions: readonly LlxprtExtension[];
  model: string;
  checkpointing: {
    enabled: boolean;
    getProjectTempCheckpointsDir(): string;
  };
  git?: GitService;
  agentExecutor?: AgentExecutor;
  eventBus?: ExecutionEventBus;
}

export interface Command {
  readonly name: string;
  readonly description: string;
  readonly arguments?: CommandArgument[];
  readonly subCommands?: Command[];
  readonly topLevel?: boolean;
  readonly requiresWorkspace?: boolean;
  readonly streaming?: boolean;

  execute(
    context: CommandContext,
    args: string[],
  ): Promise<CommandExecutionResponse>;
}

export interface CommandExecutionResponse {
  readonly name: string;
  readonly data: unknown;
}
