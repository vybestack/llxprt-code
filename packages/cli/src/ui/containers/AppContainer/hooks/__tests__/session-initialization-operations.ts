/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IContent } from '@vybestack/llxprt-code-core';
import { resolveEmojiFilterMode } from '../../../../utils/iContentToHistoryItems.js';
export function initializationOperations(
  config: {
    memory: {
      getLlxprtMdFileCount: () => number;
      getCoreMemoryFileCount: () => number;
    };
    ephemeral: Parameters<typeof resolveEmojiFilterMode>[0];
    agentClientSource: {
      getAgentClient: () => {
        addHistory: (entry: IContent) => Promise<unknown>;
      };
    };
  },
  agent: {
    hooks: {
      triggerSessionStart: () => Promise<{
        systemMessage?: string;
        additionalContext?: string;
      }>;
    };
  },
) {
  return {
    triggerSessionStart: () => agent.hooks.triggerSessionStart(),
    appendHookContext: async (text: string) => {
      await config.agentClientSource
        .getAgentClient()
        .addHistory({ speaker: 'human', blocks: [{ type: 'text', text }] });
    },
    readEmojiFilterMode: () => resolveEmojiFilterMode(config.ephemeral),
    readLlxprtMdFileCount: () => config.memory.getLlxprtMdFileCount(),
    readCoreMemoryFileCount: () => config.memory.getCoreMemoryFileCount(),
  };
}
