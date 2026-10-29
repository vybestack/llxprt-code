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
import type { ProviderMessage as Message } from '@vybestack/llxprt-code-providers';
import { useOpenAIProviderInfo } from '../hooks/useOpenAIProviderInfo.js';

interface RemoteTokenStats {
  inputTokenCount: number;
  outputTokenCount: number;
  totalTokenCount: number;
  lastUpdated: Date | null;
}

interface OpenAIProviderContextValue {
  isOpenAIActive: boolean;
  isResponsesAPI: boolean;
  currentModel: string | null;
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
  children: React.ReactNode;
}> = ({ children }) => {
  const providerInfo = useOpenAIProviderInfo();

  const [remoteTokenStats, setRemoteTokenStats] = useState<RemoteTokenStats>({
    inputTokenCount: 0,
    outputTokenCount: 0,
    totalTokenCount: 0,
    lastUpdated: null,
  });

  const updateRemoteTokenStats = useCallback(
    (stats: Partial<RemoteTokenStats>) => {
      setRemoteTokenStats((prev) => ({
        inputTokenCount: stats.inputTokenCount ?? prev.inputTokenCount,
        outputTokenCount: stats.outputTokenCount ?? prev.outputTokenCount,
        totalTokenCount: stats.totalTokenCount ?? prev.totalTokenCount,
        lastUpdated: new Date(),
      }));
    },
    [],
  );

  // Reset stats whenever the provider identity changes, so stale counts from a
  // previous provider (which may use a different tokenizer and context window)
  // are not carried over into the new provider's display.
  const previousProviderRef = useRef(providerInfo.providerIdentity);
  useEffect(() => {
    if (previousProviderRef.current !== providerInfo.providerIdentity) {
      previousProviderRef.current = providerInfo.providerIdentity;
      setRemoteTokenStats({
        inputTokenCount: 0,
        outputTokenCount: 0,
        totalTokenCount: 0,
        lastUpdated: null,
      });
    }
  }, [providerInfo.providerIdentity]);

  const value: OpenAIProviderContextValue = useMemo(
    () => ({
      isOpenAIActive: providerInfo.providerIdentity !== null,
      isResponsesAPI: providerInfo.isResponsesAPI,
      currentModel: providerInfo.currentModel,
      remoteTokenStats,
      updateRemoteTokenStats,
      getCachedConversation: providerInfo.getCachedConversation,
    }),
    [
      providerInfo.providerIdentity,
      providerInfo.isResponsesAPI,
      providerInfo.currentModel,
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
