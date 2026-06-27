/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import { useState, useEffect, useCallback } from 'react';
import type { Config } from '@vybestack/llxprt-code-core';
import {
  getOpenAIProviderInfo,
  type ProviderMessage as Message,
} from '@vybestack/llxprt-code-providers';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';

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
  _config: Config,
): UseOpenAIProviderInfoReturn {
  const runtime = useRuntimeApi();
  const getProviderInfo = useCallback(() => {
    const services = runtime.getCliRuntimeServices();
    return getOpenAIProviderInfo(services.providerManager);
  }, [runtime]);
  const [providerInfo, setProviderInfo] = useState<OpenAIProviderInfo>(() =>
    getProviderInfo(),
  );

  const refresh = useCallback(() => {
    setProviderInfo(getProviderInfo());
  }, [getProviderInfo]);

  // Refresh when config changes or model switches
  useEffect(() => {
    const checkInterval = setInterval(() => {
      const newInfo = getProviderInfo();

      // Only update if something changed
      if (
        newInfo.provider !== providerInfo.provider ||
        newInfo.currentModel !== providerInfo.currentModel ||
        newInfo.isResponsesAPI !== providerInfo.isResponsesAPI
      ) {
        setProviderInfo(newInfo);
      }
    }, 1000); // Check every second

    return () => clearInterval(checkInterval);
  }, [providerInfo, getProviderInfo]);

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
