/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ChatOwnerOperations } from '../commands/chatOwnerCommand.js';
import type { ChatRecordingOperations } from '../commands/chatCommand.js';
import type { SlashCommand } from '../commands/types.js';
import type { createWorkspaceCommandOwners } from './workspaceCommandOwners.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { RecordingIntegration } from '@vybestack/llxprt-code-core';
import type { RecordingSwapCallbacks } from '../../services/performResume.js';
import type { bindCommandOwnerResume } from './commandOwnerResumeHost.js';
import type { bindClearSession } from '../commands/simpleCommandHost.js';

export type RegisterWorkspaceCommands = (
  addItem: UseHistoryManagerReturn['addItem'],
  setMemoryFileCount: (count: number) => void,
  owner: 'agent' | 'raw' | undefined,
  raw: RecordingIntegration | undefined,
) => ReturnType<typeof createWorkspaceCommandOwners>;
export type RegisterChatCommands = (
  owner: 'agent' | 'raw' | undefined,
  raw: RecordingIntegration | undefined,
  swaps: RecordingSwapCallbacks | undefined,
  fuzzy: () => boolean,
) => { chatCommand: SlashCommand; continueCommand: SlashCommand };
export type RegisterSubagentCommand = (
  fuzzy: () => boolean,
  addItem: UseHistoryManagerReturn['addItem'],
) => SlashCommand;
export type ReadOwnedChat = () => ChatOwnerOperations;
export type ReadRawChat = (
  raw: RecordingIntegration | undefined,
  swaps: RecordingSwapCallbacks | undefined,
) => ChatRecordingOperations;
export type ResumeOwnedCommand = Parameters<typeof bindCommandOwnerResume>[0];
export type EndCommandSession = Parameters<typeof bindClearSession>[0];
export type StartNewCommandSession = Parameters<typeof bindClearSession>[1];
export type StartCommandSession = Parameters<typeof bindClearSession>[2];
