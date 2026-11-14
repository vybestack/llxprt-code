/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import type { IContent, EmojiFilterMode } from '@vybestack/llxprt-code-core';
import type { HistoryItemWithoutId } from '../../../types.js';

/**
 * @hook useSessionInitialization
 * @description One-time session initialization with state machine
 * @inputs uiRuntime, addItem, prependHistory, resumedBoot
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
  readEmojiFilterMode: () => EmojiFilterMode;
  readLlxprtMdFileCount: () => number;
  readCoreMemoryFileCount: () => number;
  addItem: (item: HistoryItemWithoutId, baseTimestamp: number) => number;
  resumedBoot?: { streamRows(): AsyncIterable<IContent> };
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
    const item = {
      type: 'info',
      text: sessionStartOutput.systemMessage,
    } satisfies HistoryItemWithoutId;
    addItem(item, Date.now());
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
  readLlxprtMdFileCount,
  readCoreMemoryFileCount,
  addItem,
}: UseSessionInitializationParams): UseSessionInitializationResult {
  const [llxprtMdFileCount, setLlxprtMdFileCount] = useState<number>(0);
  const [coreMemoryFileCount, setCoreMemoryFileCount] = useState<number>(0);
  const [initializationError, setInitializationError] = useState<unknown>(null);

  // Guard refs for idempotency in StrictMode
  const hasTriggeredSessionStart = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
    ).catch((error: unknown) => {
      if (mounted.current) setInitializationError(() => error);
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

  if (initializationError !== null) throw initializationError;
  return {
    llxprtMdFileCount,
    setLlxprtMdFileCount,
    coreMemoryFileCount,
    setCoreMemoryFileCount,
  };
}
