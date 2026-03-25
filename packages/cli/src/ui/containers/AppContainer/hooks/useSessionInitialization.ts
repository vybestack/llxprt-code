/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import type { Config, IContent } from '@vybestack/llxprt-code-core';
import {
  triggerSessionStartHook,
  SessionStartSource,
} from '@vybestack/llxprt-code-core';
import type { HistoryItem } from '../../../types.js';
import { iContentToHistoryItems } from '../../../utils/iContentToHistoryItems.js';

/**
 * @hook useSessionInitialization
 * @description One-time session initialization with state machine
 * @inputs config, addItem, loadHistory, resumedHistory
 * @outputs SessionInitState
 * @sideEffects Session start hook, history seeding
 * @cleanup AbortController.abort() on change/unmount
 * @strictMode Idempotent (guard refs + AbortController)
 * @subscriptionStrategy Stable (AbortController per run)
 *
 * State Machine:
 *   idle --(mount + resume)--> seeding
 *   idle --(mount, no resume)--> starting
 *   seeding --(success)--> seeded --> starting
 *   starting --(success)--> started --> memoryInit --> complete
 *   starting --(abort)--> aborted --> starting (new run)
 *
 * Guards:
 *   - hasSeededResumedHistory ref prevents duplicate history seeding
 *   - hasTriggeredSessionStart ref prevents duplicate session start
 *   - Monotonic: once complete, no transition (unless remount)
 */

export interface UseSessionInitializationParams {
  config: Config;
  addItem: (item: Omit<HistoryItem, 'id'>, baseTimestamp: number) => number;
  loadHistory: (newHistory: HistoryItem[]) => void;
  resumedHistory?: IContent[];
}

export interface UseSessionInitializationResult {
  llxprtMdFileCount: number;
  setLlxprtMdFileCount: (count: number) => void;
  coreMemoryFileCount: number;
  setCoreMemoryFileCount: (count: number) => void;
}

async function runSessionStartHook(
  config: Config,
  addItem: UseSessionInitializationParams['addItem'],
  signal: AbortSignal,
): Promise<void> {
  const sessionStartOutput = await triggerSessionStartHook(
    config,
    SessionStartSource.Startup,
  );

  if (signal.aborted) {
    return;
  }

  if (sessionStartOutput) {
    if (sessionStartOutput.systemMessage) {
      addItem(
        {
          type: 'info',
          text: sessionStartOutput.systemMessage,
        },
        Date.now(),
      );
    }

    const additionalContext = sessionStartOutput.getAdditionalContext();
    if (additionalContext) {
      const geminiClient = config.getGeminiClient();
      if (geminiClient) {
        await geminiClient.addHistory({
          role: 'user',
          parts: [{ text: additionalContext }],
        });
      }
    }
  }
}

export function useSessionInitialization({
  config,
  addItem,
  loadHistory,
  resumedHistory,
}: UseSessionInitializationParams): UseSessionInitializationResult {
  const [llxprtMdFileCount, setLlxprtMdFileCount] = useState<number>(0);
  const [coreMemoryFileCount, setCoreMemoryFileCount] = useState<number>(0);

  // Guard ref for idempotency in StrictMode
  const hasTriggeredSessionStart = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Effect: Seed resumed history into history manager.
  // This effect is idempotent: resumedHistory is a static prop from mount,
  // loadHistory replaces (not appends), and StrictMode double-mount is harmless.
  useEffect(() => {
    if (!resumedHistory || resumedHistory.length === 0) {
      return;
    }
    const uiItems = iContentToHistoryItems(resumedHistory);
    if (uiItems.length > 0) {
      loadHistory(uiItems);
    }
  }, [loadHistory, resumedHistory]);

  // Effect: Trigger SessionStart hook on initialization
  useEffect(() => {
    if (hasTriggeredSessionStart.current) {
      return;
    }
    hasTriggeredSessionStart.current = true;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    void runSessionStartHook(config, addItem, signal);

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [config, addItem]);

  // Effect: Initialize memory file counts from config
  useEffect(() => {
    setLlxprtMdFileCount(config.getLlxprtMdFileCount());
    setCoreMemoryFileCount(config.getCoreMemoryFileCount());
  }, [config]);

  return {
    llxprtMdFileCount,
    setLlxprtMdFileCount,
    coreMemoryFileCount,
    setCoreMemoryFileCount,
  };
}
