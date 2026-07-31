/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandContext, SlashCommand } from '../commands/types.js';
import type { Key } from '../hooks/useKeypress.js';
import type { StreamingState } from '../types.js';
import type { TextBuffer } from './shared/text-buffer.js';
import type { ApprovalMode } from '@vybestack/llxprt-code-core';
import type { CliUiRuntime } from '../cliUiRuntime.js';

export interface InputPromptProps {
  buffer: TextBuffer;
  onSubmit: (value: string) => void;
  /**
   * Optional steer callback: during streaming, Ctrl+Enter injects the text
   * into the active agent loop at the next tool-call boundary. Returns true
   * if consumed (agent is streaming), false to fall through to newline.
   */
  onSteer?: (text: string) => boolean;
  userMessages: readonly string[];
  onClearScreen: () => void;
  config: CliUiRuntime;
  slashCommands: readonly SlashCommand[];
  commandContext: CommandContext;
  placeholder?: string;
  focus?: boolean;
  inputWidth: number;
  suggestionsWidth: number;
  shellModeActive: boolean;
  setShellModeActive: (value: boolean) => void;
  onEscapePromptChange?: (showPrompt: boolean) => void;
  onSuggestionsVisibilityChange?: (visible: boolean) => void;
  suggestionsPosition?: 'above' | 'below';
  vimHandleInput?: (key: Key) => boolean;
  approvalMode?: ApprovalMode;
  popAllMessages?: (callback: (messages: string) => void) => void;
  vimModeEnabled?: boolean;
  isEmbeddedShellFocused?: boolean;
  setQueueErrorMessage?: (message: string | null) => void;
  streamingState?: StreamingState;
  queueErrorMessage?: string | null;
  queuedSubmissionCount?: number;
  sendAllQueuedSubmissions?: () => void;
  clearQueuedSubmissions?: () => void;
}

export type InputPromptRuntimeProps = Omit<
  InputPromptProps,
  'placeholder' | 'inputWidth' | 'suggestionsWidth' | 'suggestionsPosition'
>;
