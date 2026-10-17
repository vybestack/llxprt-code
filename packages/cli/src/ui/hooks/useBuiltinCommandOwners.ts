/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CredentialCommands } from './credentialCommandTypes.js';

import { useMemo } from 'react';
import type { BuiltinCommandOwners } from '../../services/BuiltinCommandLoader.js';
import type { SlashCommand } from '../commands/types.js';
import type { useHistoryCommandOwners } from './useHistoryCommandOwners.js';
import type { usePresentationCommands } from './usePresentationCommands.js';
import type { useHostCommands } from './useHostCommands.js';
import type { useUtilityCommands } from './useUtilityCommands.js';
import type { useResourceCommands } from './useResourceCommands.js';
type RegisteredPresentationCommands = ReturnType<
  typeof usePresentationCommands
> &
  ReturnType<typeof useUtilityCommands> &
  ReturnType<typeof useResourceCommands> &
  ReturnType<typeof useHostCommands>;
type BuiltinCommandOwnerParts = Pick<
  BuiltinCommandOwners,
  | 'chatCommand'
  | 'continueCommand'
  | 'setCommand'
  | 'extensionsCommand'
  | 'subagentCommand'
> & {
  presentationCommands: RegisteredPresentationCommands;
  historyCommandOwners: ReturnType<typeof useHistoryCommandOwners>;
  toolsCommand: SlashCommand;
  directoryCommand: SlashCommand;
  memoryCommand: SlashCommand;
  imageCommand: SlashCommand;
  bugCommand: SlashCommand;
  policiesCommand: SlashCommand;
  hooksCommand: SlashCommand;
  taskCommand: SlashCommand;
  todoCommand: SlashCommand;
  credentialCommands: CredentialCommands;
};

export function useBuiltinCommandOwners(
  parts: BuiltinCommandOwnerParts,
): BuiltinCommandOwners {
  const {
    chatCommand,
    continueCommand,
    historyCommandOwners,
    presentationCommands,
    setCommand,
    toolsCommand,
    directoryCommand,
    memoryCommand,
    imageCommand,
    bugCommand,
    policiesCommand,
    hooksCommand,
    taskCommand,
    todoCommand,
    credentialCommands,
    extensionsCommand,
    subagentCommand,
  } = parts;
  return useMemo(
    () => ({
      chatCommand,
      continueCommand,
      ...historyCommandOwners,
      ...presentationCommands,
      setCommand,
      toolsCommand,
      directoryCommand,
      memoryCommand,
      imageCommand,
      bugCommand,
      policiesCommand,
      hooksCommand,
      taskCommand,
      todoCommand,
      extensionsCommand,
      subagentCommand,
      ...credentialCommands,
    }),
    [
      chatCommand,
      continueCommand,
      historyCommandOwners,
      presentationCommands,
      setCommand,
      toolsCommand,
      directoryCommand,
      memoryCommand,
      imageCommand,
      bugCommand,
      policiesCommand,
      hooksCommand,
      taskCommand,
      todoCommand,
      credentialCommands,
      extensionsCommand,
      subagentCommand,
    ],
  );
}
