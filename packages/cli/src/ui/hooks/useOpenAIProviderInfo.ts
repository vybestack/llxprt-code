import type { SessionProviderReads } from '@vybestack/llxprt-code-agents';
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
import { type ProviderMessage as Message } from '@vybestack/llxprt-code-providers';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';

// Import OpenAIProviderInfo type from the function return type
type OpenAIProviderInfo = ReturnType<SessionProviderReads['readOpenAIInfo']>;

export interface UseOpenAIProviderInfoReturn extends OpenAIProviderInfo {
  refresh: () => void;
  getCachedConversation: (
    conversationId: string,
    parentId: string,
  ) => Message[] | null;
}

/**
 * React hook to access OpenAI provider information including conversation cache
 * @returns OpenAI provider information and helper methods
 */
export function useOpenAIProviderInfo(): UseOpenAIProviderInfoReturn {
  const runtime = useRuntimeApi();
  const getProviderInfo = useCallback(
    () => runtime.getOpenAIProviderInfo(),
    [runtime],
  );
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
        newInfo.providerIdentity !== providerInfo.providerIdentity ||
        newInfo.currentModel !== providerInfo.currentModel ||
        newInfo.isResponsesAPI !== providerInfo.isResponsesAPI
      ) {
        setProviderInfo(newInfo);
      }
    }, 1000); // Check every second

    return () => clearInterval(checkInterval);
  }, [providerInfo, getProviderInfo]);

  return {
    ...providerInfo,
    refresh,
    getCachedConversation: providerInfo.getCachedConversation,
  };
}
