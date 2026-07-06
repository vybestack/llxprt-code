/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared command action return types for LLxprt Code.
 *
 * These types define the contract between command implementations and command processors.
 * They are used by both core and CLI packages to communicate command results.
 *
 * @upstream b27cf0b0a8dd - Adapted from upstream's move of command types to core.
 *                         LLxprt keeps full command logic in CLI but shares action types.
 */

import type { ContractContent } from '../core/clientContract.js';

/**
 * The return type for a command action that results in scheduling a tool call.
 */
export interface ToolActionReturn {
  type: 'tool';
  toolName: string;
  toolArgs: Record<string, unknown>;
}

/**
 * The return type for a command action that results in a simple message
 * being displayed to the user.
 */
export interface MessageActionReturn {
  type: 'message';
  messageType: 'info' | 'error';
  content: string;
}

/**
 * The return type for a command action that results in replacing
 * the entire conversation history.
 *
 * @template HistoryType - The type of history items being loaded
 */
export interface LoadHistoryActionReturn<HistoryType = unknown> {
  type: 'load_history';
  history: HistoryType[];
  clientHistory: ContractContent[]; // The history for the generative client
}

/**
 * The return type for a command action that should immediately submit
 * content as a prompt to the generative model.
 */
export interface SubmitPromptActionReturn {
  type: 'submit_prompt';
  content: ContractContent[] | ContractContent | string;
}

/**
 * Discriminated union of all command action return types that are shared
 * between core and CLI packages.
 *
 * Note: This does NOT include CLI-specific actions like:
 * - QuitActionReturn
 * - OpenDialogActionReturn
 * - ConfirmShellCommandsActionReturn
 * - ConfirmActionReturn
 * - PerformResumeActionReturn
 *
 * Those remain in the CLI package as they are tightly coupled to UI concerns.
 *
 * @template HistoryType - The type of history items, defaults to unknown
 */
export type CommandActionReturn<HistoryType = unknown> =
  | ToolActionReturn
  | MessageActionReturn
  | LoadHistoryActionReturn<HistoryType>
  | SubmitPromptActionReturn;
