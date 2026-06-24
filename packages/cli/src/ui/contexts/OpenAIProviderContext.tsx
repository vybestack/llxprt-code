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

import type React from 'react';
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import type { Config } from '@vybestack/llxprt-code-core';
import type {
  ProviderMessage as Message,
  ConversationCache,
} from '@vybestack/llxprt-code-providers';
import { useOpenAIProviderInfo } from '../hooks/useOpenAIProviderInfo.js';

interface RemoteTokenStats {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  lastUpdated: Date | null;
}

interface OpenAIProviderContextValue {
  isOpenAIActive: boolean;
  isResponsesAPI: boolean;
  currentModel: string | null;
  conversationCache: ConversationCache | null;
  remoteTokenStats: RemoteTokenStats;
  updateRemoteTokenStats: (stats: Partial<RemoteTokenStats>) => void;
  getCachedConversation: (
    conversationId: string,
    parentId: string,
  ) => Message[] | null;
}

const OpenAIProviderContext = createContext<
  OpenAIProviderContextValue | undefined
>(undefined);

export const OpenAIProviderContextProvider: React.FC<{
  config: Config;
  children: React.ReactNode;
}> = ({ config, children }) => {
  const providerInfo = useOpenAIProviderInfo(config);

  const [remoteTokenStats, setRemoteTokenStats] = useState<RemoteTokenStats>({
    promptTokenCount: 0,
    candidatesTokenCount: 0,
    totalTokenCount: 0,
    lastUpdated: null,
  });

  const updateRemoteTokenStats = useCallback(
    (stats: Partial<RemoteTokenStats>) => {
      setRemoteTokenStats((prev) => ({
        promptTokenCount: stats.promptTokenCount ?? prev.promptTokenCount,
        candidatesTokenCount:
          stats.candidatesTokenCount ?? prev.candidatesTokenCount,
        totalTokenCount: stats.totalTokenCount ?? prev.totalTokenCount,
        lastUpdated: new Date(),
      }));
    },
    [],
  );

  // Reset stats whenever the provider identity changes, so stale counts from a
  // previous provider (which may use a different tokenizer and context window)
  // are not carried over into the new provider's display.
  const previousProviderRef = useRef(providerInfo.provider);
  useEffect(() => {
    if (previousProviderRef.current !== providerInfo.provider) {
      previousProviderRef.current = providerInfo.provider;
      setRemoteTokenStats({
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        totalTokenCount: 0,
        lastUpdated: null,
      });
    }
  }, [providerInfo.provider]);

  const value: OpenAIProviderContextValue = useMemo(
    () => ({
      isOpenAIActive: providerInfo.provider !== null,
      isResponsesAPI: providerInfo.isResponsesAPI,
      currentModel: providerInfo.currentModel,
      conversationCache: providerInfo.conversationCache,
      remoteTokenStats,
      updateRemoteTokenStats,
      getCachedConversation: providerInfo.getCachedConversation,
    }),
    [
      providerInfo.provider,
      providerInfo.isResponsesAPI,
      providerInfo.currentModel,
      providerInfo.conversationCache,
      remoteTokenStats,
      updateRemoteTokenStats,
      providerInfo.getCachedConversation,
    ],
  );

  return (
    <OpenAIProviderContext.Provider value={value}>
      {children}
    </OpenAIProviderContext.Provider>
  );
};

export const useOpenAIProviderContext = () => {
  const context = useContext(OpenAIProviderContext);
  if (context === undefined) {
    throw new Error(
      'useOpenAIProviderContext must be used within an OpenAIProviderContextProvider',
    );
  }
  return context;
};
