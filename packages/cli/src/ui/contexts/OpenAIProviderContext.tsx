/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import {
  Config,
  ProviderMessage as Message,
  ConversationCache,
} from '@vybestack/llxprt-code-core';
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

  // Reset stats when provider changes
  useEffect(() => {
    if (!providerInfo.provider) {
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
