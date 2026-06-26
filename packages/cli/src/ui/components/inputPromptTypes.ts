/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandContext, SlashCommand } from '../commands/types.js';
import type { Key } from '../hooks/useKeypress.js';
import type { StreamingState } from '../types.js';
import type { TextBuffer } from './shared/text-buffer.js';
import type { ApprovalMode, Config } from '@vybestack/llxprt-code-core';

export interface InputPromptProps {
  buffer: TextBuffer;
  onSubmit: (value: string) => void;
  userMessages: readonly string[];
  onClearScreen: () => void;
  config: Config;
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
}

export type InputPromptRuntimeProps = Omit<
  InputPromptProps,
  'placeholder' | 'inputWidth' | 'suggestionsWidth' | 'suggestionsPosition'
>;
