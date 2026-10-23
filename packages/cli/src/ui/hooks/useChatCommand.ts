/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo } from 'react';
import {
  createChatCommand,
  type ChatRecordingOperations,
} from '../commands/chatCommand.js';
import {
  createChatOwnerCommand,
  type ChatOwnerOperations,
} from '../commands/chatOwnerCommand.js';
import type { SlashCommand } from '../commands/types.js';

export function useChatCommand(
  ownerOperations: ChatOwnerOperations,
  recordingOperations: ChatRecordingOperations,
  recordingOwner: 'agent' | 'raw' | undefined,
  readFuzzyFiltering: () => boolean,
): SlashCommand {
  return useMemo(
    () =>
      recordingOwner === 'agent'
        ? createChatOwnerCommand(ownerOperations, readFuzzyFiltering)
        : createChatCommand(recordingOperations, readFuzzyFiltering),
    [ownerOperations, recordingOperations, recordingOwner, readFuzzyFiltering],
  );
}
