/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProviderManager } from '../ProviderManager.js';
import { ConversationCache } from './ConversationCache.js';
import { RESPONSES_API_MODELS } from './RESPONSES_API_MODELS.js';

// Helper types leveraging public APIs

type OpenAIProviderLike = {
  name: string;
  getCurrentModel?: () => string;
  getConversationCache?: () => ConversationCache;
  shouldUseResponses?: (model: string) => boolean;
  // Fallback index signature for accessing other dynamic props safely
  [key: string]: unknown;
};

export interface OpenAIProviderInfo {
  provider: OpenAIProviderLike | null;
  conversationCache: ConversationCache | null;
  isResponsesAPI: boolean;
  currentModel: string | null;
  remoteTokenInfo: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

/**
 * Retrieves OpenAI provider information from the current ProviderManager instance
 * @param providerManager The ProviderManager instance
 * @returns OpenAI provider info if available, null values otherwise
 */
export function getOpenAIProviderInfo(
  providerManager: ProviderManager | null | undefined,
): OpenAIProviderInfo {
  const result: OpenAIProviderInfo = {
    provider: null,
    conversationCache: null,
    isResponsesAPI: false,
    currentModel: null,
    remoteTokenInfo: {},
  };

  try {
    // Check if provider manager is available
    if (!providerManager || !providerManager.hasActiveProvider()) {
      return result;
    }

    // Get the active provider
    const activeProvider = providerManager.getActiveProvider();
    if (!activeProvider || activeProvider.name !== 'openai') {
      return result;
    }

    // Narrow to expected provider type using feature detection
    const openaiProvider = activeProvider as unknown as OpenAIProviderLike;
    result.provider = openaiProvider;

    // Access the conversation cache via public getter or lax cast
    if (typeof openaiProvider.getConversationCache === 'function') {
      result.conversationCache = openaiProvider.getConversationCache();
    } else if ('conversationCache' in openaiProvider) {
      // Cast only if property actually exists (type guard)
      result.conversationCache =
        (
          openaiProvider as {
            conversationCache?: ConversationCache;
          }
        ).conversationCache ?? null;
    }

    // Get current model
    result.currentModel = openaiProvider.getCurrentModel?.() || null;

    // Check if using Responses API (fall back to static list)
    if (openaiProvider.shouldUseResponses && result.currentModel) {
      result.isResponsesAPI = openaiProvider.shouldUseResponses(
        result.currentModel,
      );
    } else if (result.currentModel) {
      result.isResponsesAPI = (
        RESPONSES_API_MODELS as readonly string[]
      ).includes(result.currentModel);
    }

    // Note: Remote token info would need to be tracked separately during API calls
    // This is a placeholder for where that information would be stored
  } catch (error) {
    if (process.env.DEBUG) {
      console.error('Error accessing OpenAI provider info:', error);
    }
  }

  return result;
}

/**
 * Example usage:
 *
 * const openAIInfo = getOpenAIProviderInfo(providerManager);
 * if (openAIInfo.provider && openAIInfo.conversationCache) {
 *   // Access conversation cache
 *   const cachedMessages = openAIInfo.conversationCache.get(conversationId, parentId);
 *
 *   // Check if using Responses API
 *   if (openAIInfo.isResponsesAPI) {
 *     console.log('Using OpenAI Responses API');
 *   }
 * }
 */
