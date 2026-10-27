/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { appendJournalUiItem } from '../../../hooks/command-journal-output.js';

import { useEffect, useRef, useState } from 'react';
import type { IContent } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { HistoryItemWithoutId } from '../../../types.js';
import type { UiRuntime } from '../../../cliUiRuntime.js';

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
  uiRuntime: UiRuntime;
  agent: Agent;
  recordingOwner?: 'agent' | 'raw';
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
  uiRuntime: UiRuntime,
  agent: Agent,
  addItem: UseSessionInitializationParams['addItem'],
  signal: AbortSignal,
  recordingOwner: UseSessionInitializationParams['recordingOwner'],
): Promise<void> {
  const sessionStartOutput = await agent.hooks
    .triggerSessionStart()
    .catch(() => ({ systemMessage: undefined, additionalContext: undefined }));

  if (signal.aborted) {
    return;
  }

  if (sessionStartOutput.systemMessage) {
    const item = {
      type: 'info',
      text: sessionStartOutput.systemMessage,
    } satisfies HistoryItemWithoutId;
    if (recordingOwner === 'agent')
      await appendJournalUiItem(
        agent.agentClient.getHistoryService(),
        agent.session,
        item,
      );
    else addItem(item, Date.now());
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
  recordingOwner,
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
      uiRuntime,
      agent,
      addItem,
      signal,
      recordingOwner,
    ).catch((error: unknown) => {
      if (mounted.current) setInitializationError(() => error);
    });

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [uiRuntime, agent, addItem, recordingOwner]);

  // Effect: Initialize memory file counts from uiRuntime.memory
  useEffect(() => {
    setLlxprtMdFileCount(uiRuntime.memory.getLlxprtMdFileCount());
    setCoreMemoryFileCount(uiRuntime.memory.getCoreMemoryFileCount());
  }, [uiRuntime]);

  if (initializationError !== null) throw initializationError;
  return {
    llxprtMdFileCount,
    setLlxprtMdFileCount,
    coreMemoryFileCount,
    setCoreMemoryFileCount,
  };
}
