/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import type { RecordingIntegration } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { RecordingSwapCallbacks } from '../../services/performResume.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import { createChatCommand } from '../commands/chatCommand.js';
import {
  bindChatOwnerOperations,
  bindChatRecordingOperations,
} from '../commands/chatCommandHost.js';
import { createChatOwnerCommand } from '../commands/chatOwnerCommand.js';
import type { SlashCommand } from '../commands/types.js';

/**
 * Registers the /chat command for one session. Agent-owned recording binds the
 * Agent's session operations; raw interactive recording binds its recording
 * swap callbacks. Memoised so the registered identity stays stable while its
 * owner does.
 */
export function useChatCommand(
  agent: Agent | null,
  config: CliUiRuntime | null,
  recordingOwner: 'agent' | 'raw' | undefined,
  recordingIntegration: RecordingIntegration | undefined,
  recordingSwapCallbacks: RecordingSwapCallbacks | undefined,
): SlashCommand {
  return useMemo(
    () =>
      recordingOwner === 'agent'
        ? createChatOwnerCommand(bindChatOwnerOperations(agent, config))
        : createChatCommand(
            bindChatRecordingOperations({
              agent,
              config,
              recordingIntegration,
              recordingSwapCallbacks,
            }),
          ),
    [
      agent,
      config,
      recordingOwner,
      recordingIntegration,
      recordingSwapCallbacks,
    ],
  );
}
