/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import type { IContent } from '@vybestack/llxprt-code-core';
import type { HistoryItem } from '../../../types.js';
import { iContentToHistoryItems } from '../../../utils/iContentToHistoryItems.js';

/**
 * @hook useSessionInitialization
 * @description One-time session initialization with state machine
 * @inputs uiRuntime, addItem, loadHistory, resumedHistory
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
 *   starting --(abort before success)--> aborted --> starting (new run)
 *
 * Guards:
 *   - hasSeededResumedHistory ref prevents duplicate history seeding
 *   - hasTriggeredSessionStart ref prevents duplicate session start
 *   - Monotonic: once complete, no transition (unless remount)
 */

export interface UseSessionInitializationParams {
  triggerSessionStart: () => Promise<{
    systemMessage?: string;
    additionalContext?: string;
  }>;
  appendHookContext: (text: string) => Promise<void>;
  readEmojiFilterMode: () => Parameters<typeof iContentToHistoryItems>[1];
  readLlxprtMdFileCount: () => number;
  readCoreMemoryFileCount: () => number;
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

function isAbortSignalAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

async function runSessionStartHook(
  triggerSessionStart: UseSessionInitializationParams['triggerSessionStart'],
  appendHookContext: UseSessionInitializationParams['appendHookContext'],
  addItem: UseSessionInitializationParams['addItem'],
  signal: AbortSignal,
): Promise<void> {
  const sessionStartOutput = await triggerSessionStart();

  if (signal.aborted) {
    return;
  }

  if (sessionStartOutput.systemMessage) {
    addItem(
      {
        type: 'info',
        text: sessionStartOutput.systemMessage,
      },
      Date.now(),
    );
  }

  const additionalContext = sessionStartOutput.additionalContext;
  if (additionalContext && !isAbortSignalAborted(signal)) {
    try {
      await appendHookContext(additionalContext);
    } catch {
      // Failures adding hook-provided context to history are non-fatal.
    }
  }
}

export function useSessionInitialization({
  triggerSessionStart,
  appendHookContext,
  readEmojiFilterMode,
  readLlxprtMdFileCount,
  readCoreMemoryFileCount,
  addItem,
  loadHistory,
  resumedHistory,
}: UseSessionInitializationParams): UseSessionInitializationResult {
  const [llxprtMdFileCount, setLlxprtMdFileCount] = useState<number>(0);
  const [coreMemoryFileCount, setCoreMemoryFileCount] = useState<number>(0);

  // Guard refs for idempotency in StrictMode
  const hasTriggeredSessionStart = useRef(false);
  const hasSeededResumedHistory = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Effect: Seed resumed history into history manager.
  // The guard ref prevents redundant loadHistory calls across StrictMode
  // double-mount while keeping resumedHistory as a static mount-time prop.
  useEffect(() => {
    if (
      hasSeededResumedHistory.current ||
      !resumedHistory ||
      resumedHistory.length === 0
    ) {
      return undefined;
    }
    hasSeededResumedHistory.current = true;
    const uiItems = iContentToHistoryItems(
      resumedHistory,
      readEmojiFilterMode(),
    );
    if (uiItems.length > 0) {
      loadHistory(uiItems);
    }
    return undefined;
  }, [loadHistory, resumedHistory, readEmojiFilterMode]);

  // Effect: Trigger SessionStart hook on initialization
  useEffect(() => {
    if (hasTriggeredSessionStart.current) {
      return undefined;
    }
    hasTriggeredSessionStart.current = true;

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    void runSessionStartHook(
      triggerSessionStart,
      appendHookContext,
      addItem,
      signal,
    ).catch(() => {
      // Hook failures should not block session initialization.
    });

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [triggerSessionStart, appendHookContext, addItem]);

  // Effect: Initialize memory file counts from uiRuntime.memory
  useEffect(() => {
    setLlxprtMdFileCount(readLlxprtMdFileCount());
    setCoreMemoryFileCount(readCoreMemoryFileCount());
  }, [readLlxprtMdFileCount, readCoreMemoryFileCount]);

  return {
    llxprtMdFileCount,
    setLlxprtMdFileCount,
    coreMemoryFileCount,
    setCoreMemoryFileCount,
  };
}
