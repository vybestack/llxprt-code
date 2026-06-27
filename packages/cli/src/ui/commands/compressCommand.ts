/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CompressionStatus,
  PerformCompressionResult,
  type AgentChatContract,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { HistoryItemCompression } from '../types.js';
import { MessageType } from '../types.js';
import type { SlashCommand } from './types.js';
import { CommandKind } from './types.js';

function resolveCompressionStatus(
  result: PerformCompressionResult,
  originalTokenCount: number,
  newTokenCount: number,
  wasRecentlyCompressedBeforeCommand: boolean,
): CompressionStatus {
  switch (result) {
    case PerformCompressionResult.FAILED:
    case PerformCompressionResult.SKIPPED_COOLDOWN:
      return CompressionStatus.COMPRESSION_FAILED;
    case PerformCompressionResult.SKIPPED_EMPTY:
      return CompressionStatus.NOOP;
    case PerformCompressionResult.COMPRESSED:
      if (newTokenCount < originalTokenCount) {
        return CompressionStatus.COMPRESSED;
      }
      if (newTokenCount > originalTokenCount) {
        return CompressionStatus.COMPRESSION_FAILED_INFLATED_TOKEN_COUNT;
      }
      if (wasRecentlyCompressedBeforeCommand) {
        return CompressionStatus.ALREADY_COMPRESSED;
      }
      return CompressionStatus.NOOP;
    default:
      return CompressionStatus.NOOP;
  }
}

function resolveAgentCompressionStatus(
  status: 'compressed' | 'skipped' | 'failed',
  originalTokenCount: number | undefined,
  newTokenCount: number | undefined,
): CompressionStatus {
  if (status === 'failed') {
    return CompressionStatus.COMPRESSION_FAILED;
  }
  if (status === 'skipped') {
    return CompressionStatus.NOOP;
  }
  if (originalTokenCount === undefined || newTokenCount === undefined) {
    return CompressionStatus.NOOP;
  }
  if (newTokenCount < originalTokenCount) {
    return CompressionStatus.COMPRESSED;
  }
  return CompressionStatus.NOOP;
}

function makePendingCompression(): HistoryItemCompression {
  return {
    type: MessageType.COMPRESSION,
    compression: {
      isPending: true,
      originalTokenCount: null,
      newTokenCount: null,
      compressionStatus: null,
    },
  };
}

async function executeCompressionViaAgent(
  agent: Agent,
  promptId: string,
): Promise<HistoryItemCompression> {
  const result = await agent.compress({ promptId });
  return {
    type: MessageType.COMPRESSION,
    compression: {
      isPending: false,
      originalTokenCount: result.originalTokenCount ?? null,
      newTokenCount: result.newTokenCount ?? null,
      compressionStatus: resolveAgentCompressionStatus(
        result.status,
        result.originalTokenCount,
        result.newTokenCount,
      ),
    },
  };
}

async function executeCompression(
  chat: AgentChatContract,
  promptId: string,
): Promise<HistoryItemCompression> {
  const historyService = chat.getHistoryService();
  if (!historyService) {
    throw new Error('Chat history service is unavailable.');
  }
  const originalTokenCount = historyService.getTotalTokens();
  const wasRecentlyCompressedBeforeCommand = chat.wasRecentlyCompressed();
  const result = await chat.performCompression(promptId);
  const newTokenCount = historyService.getTotalTokens();
  const compressionStatus = resolveCompressionStatus(
    result,
    originalTokenCount,
    newTokenCount,
    wasRecentlyCompressedBeforeCommand,
  );
  return {
    type: MessageType.COMPRESSION,
    compression: {
      isPending: false,
      originalTokenCount,
      newTokenCount,
      compressionStatus,
    },
  };
}

export const compressCommand: SlashCommand = {
  name: 'compress',
  altNames: ['summarize'],
  description: 'Compresses the context by replacing it with a summary.',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context) => {
    const { ui } = context;
    if (ui.pendingItem) {
      ui.addItem(
        {
          type: MessageType.ERROR,
          text: 'Already compressing, wait for previous request to complete',
        },
        Date.now(),
      );
      return;
    }

    try {
      ui.setPendingItem(makePendingCompression());
      const promptId = `compress-${Date.now()}`;
      const agent = context.services.agent;
      if (agent) {
        const compressionResult = await executeCompressionViaAgent(
          agent,
          promptId,
        );
        ui.addItem(compressionResult);
        return;
      }
      // Fallback: Config path (tracked migration debt for null agent).
      const agentClient = context.services.config?.getAgentClient();
      if (agentClient == null || agentClient.hasChatInitialized() !== true) {
        ui.addItem(
          {
            type: MessageType.ERROR,
            text: 'Chat instance not available for compression.',
          },
          Date.now(),
        );
        return;
      }
      const chat = agentClient.getChat();
      const historyService = chat.getHistoryService();
      if (!historyService) {
        ui.addItem(
          {
            type: MessageType.ERROR,
            text: 'Chat instance not available for compression.',
          },
          Date.now(),
        );
        return;
      }
      const compressionResult = await executeCompression(chat, promptId);
      ui.addItem(compressionResult);
    } catch (e) {
      ui.addItem(
        {
          type: MessageType.ERROR,
          text: `Failed to compress chat history: ${
            e instanceof Error ? e.message : String(e)
          }`,
        },
        Date.now(),
      );
    } finally {
      ui.setPendingItem(null);
    }
  },
};
