/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { getProjectHash } from '@vybestack/llxprt-code-core';

import { resolveEmojiFilterMode } from '../utils/iContentToHistoryItems.js';

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
  readFuzzyFiltering: () => boolean,
): SlashCommand {
  return useMemo(() => {
    if (recordingOwner === 'agent')
      return createOwnerChat(agent, config, readFuzzyFiltering);
    return createChatCommand(
      bindChatRecordingOperations(
        () =>
          recordingSwapCallbacks?.getCurrentRecording() ??
          recordingIntegration?.getRecordingService() ??
          null,
        () => (config ? getProjectHash(config.getProjectRoot()) : null),
        () => config?.projectChatsDir ?? null,
        () => agent?.agentClient.mediaStore,
        () => {
          const client = agent?.agentClient;
          return client?.hasChatInitialized() === true
            ? client.getChat().getHistory()
            : null;
        },
        async (history) => {
          if (agent === null) throw new Error('Session agent is unavailable');
          await agent.agentClient.getChat().setHistory(history);
        },
        () => (config ? config.getModel() : null),
      ),
      readFuzzyFiltering,
    );
  }, [
    agent,
    config,
    recordingOwner,
    recordingIntegration,
    recordingSwapCallbacks,
    readFuzzyFiltering,
  ]);
}

function missingChatOwner(): never {
  throw new Error('No session owner available');
}

function createOwnerChat(
  agent: Agent | null,
  config: CliUiRuntime | null,
  readFuzzyFiltering: () => boolean,
): SlashCommand {
  return createChatOwnerCommand(
    bindChatOwnerOperations(
      agent === null
        ? missingChatOwner
        : agent.session.listCheckpoints.bind(agent.session),
      agent === null
        ? missingChatOwner
        : agent.session.createCheckpoint.bind(agent.session),
      agent === null
        ? missingChatOwner
        : agent.session.resume.bind(agent.session),
      agent === null
        ? missingChatOwner
        : agent.session.deleteCheckpoint.bind(agent.session),
      agent === null
        ? missingChatOwner
        : agent.session.renameCheckpoint.bind(agent.session),
      agent === null
        ? missingChatOwner
        : agent.session.getHistory.bind(agent.session),
      agent === null
        ? missingChatOwner
        : agent.session.clearHistory.bind(agent.session),
      agent === null
        ? missingChatOwner
        : agent.session.restoreTurns.bind(agent.session),
      agent === null
        ? missingChatOwner
        : agent.session.nameCurrentSession.bind(agent.session),
      () => {
        if (agent === null) return missingChatOwner();
        return agent.session.getRecording().path;
      },
      agent === null ? missingChatOwner : agent.getModel.bind(agent),
      () => resolveEmojiFilterMode(config),
    ),
    readFuzzyFiltering,
  );
}
