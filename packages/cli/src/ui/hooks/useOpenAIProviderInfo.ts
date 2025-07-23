/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Config,
  ProviderMessage as Message,
  getOpenAIProviderInfo,
} from '@vybestack/llxprt-code-core';
import { getProviderManager } from '../../providers/providerManagerInstance.js';

// Import OpenAIProviderInfo type from the function return type
type OpenAIProviderInfo = ReturnType<typeof getOpenAIProviderInfo>;

export interface UseOpenAIProviderInfoReturn extends OpenAIProviderInfo {
  refresh: () => void;
  getCachedConversation: (
    conversationId: string,
    parentId: string,
  ) => Message[] | null;
}

/**
 * React hook to access OpenAI provider information including conversation cache
 * @param config The Config instance from the app
 * @returns OpenAI provider information and helper methods
 */
export function useOpenAIProviderInfo(
  config: Config,
): UseOpenAIProviderInfoReturn {
  const [providerInfo, setProviderInfo] = useState<OpenAIProviderInfo>(() =>
    getOpenAIProviderInfo(getProviderManager(config)),
  );

  const refresh = useCallback(() => {
    setProviderInfo(getOpenAIProviderInfo(getProviderManager(config)));
  }, [config]);

  // Refresh when config changes or model switches
  useEffect(() => {
    const checkInterval = setInterval(() => {
      const newInfo = getOpenAIProviderInfo(getProviderManager(config));

      // Only update if something changed
      if (
        newInfo.currentModel !== providerInfo.currentModel ||
        newInfo.isResponsesAPI !== providerInfo.isResponsesAPI ||
        (newInfo.provider !== null) !== (providerInfo.provider !== null)
      ) {
        setProviderInfo(newInfo);
      }
    }, 1000); // Check every second

    return () => clearInterval(checkInterval);
  }, [config, providerInfo]);

  const getCachedConversation = useCallback(
    (conversationId: string, parentId: string) => {
      if (!providerInfo.conversationCache) {
        return null;
      }
      return providerInfo.conversationCache.get(conversationId, parentId);
    },
    [providerInfo.conversationCache],
  );

  return {
    ...providerInfo,
    refresh,
    getCachedConversation,
  };
}
