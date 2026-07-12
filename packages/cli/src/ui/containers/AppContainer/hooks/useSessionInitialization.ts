/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import type { IContent } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { HistoryItem } from '../../../types.js';
import { iContentToHistoryItems } from '../../../utils/iContentToHistoryItems.js';
import type { UiRuntime } from '../../../cliUiRuntime.js';

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
  uiRuntime: UiRuntime;
  agent: Agent;
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
  uiRuntime: UiRuntime,
  agent: Agent,
  addItem: UseSessionInitializationParams['addItem'],
  signal: AbortSignal,
): Promise<void> {
  const sessionStartOutput = await agent.hooks.triggerSessionStart();

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
    const agentClient = uiRuntime.agentClientSource.getAgentClient();
    try {
      await agentClient.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: additionalContext }],
      });
    } catch {
      // Failures adding hook-provided context to history are non-fatal.
    }
  }
}

export function useSessionInitialization({
  uiRuntime,
  agent,
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
    const uiItems = iContentToHistoryItems(resumedHistory);
    if (uiItems.length > 0) {
      loadHistory(uiItems);
    }
    return undefined;
  }, [loadHistory, resumedHistory]);

  // Effect: Trigger SessionStart hook on initialization
  useEffect(() => {
    if (hasTriggeredSessionStart.current) {
      return undefined;
    }
    hasTriggeredSessionStart.current = true;

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    void runSessionStartHook(uiRuntime, agent, addItem, signal).catch(() => {
      // Hook failures should not block session initialization.
    });

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [uiRuntime, agent, addItem]);

  // Effect: Initialize memory file counts from uiRuntime.memory
  useEffect(() => {
    setLlxprtMdFileCount(uiRuntime.memory.getLlxprtMdFileCount());
    setCoreMemoryFileCount(uiRuntime.memory.getCoreMemoryFileCount());
  }, [uiRuntime]);

  return {
    llxprtMdFileCount,
    setLlxprtMdFileCount,
    coreMemoryFileCount,
    setCoreMemoryFileCount,
  };
}
