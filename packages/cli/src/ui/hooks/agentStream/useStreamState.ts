/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * useStreamState — extracted state initialization and sanitization from
 * useAgentStream to keep the orchestrator under 80 lines.
 *
 * Owns: initError, abortController, turnCancelled, isResponding,
 * lastProfileName, thought, pendingHistoryItem, lastAgentActivityTime,
 * queuedSubmissions, submitQueryRef, emojiFilter, sanitizeContent,
 * flushPendingHistoryItem, logger, gitService.
 */

import { useState, useRef, useCallback, useMemo } from 'react';
import {
  type ThoughtSummary,
  EmojiFilter,
  type EmojiFilterMode,
  type ThinkingBlock,
  GitService,
} from '@vybestack/llxprt-code-core';
import { type HistoryItemWithoutId, MessageType } from '../../types.js';
import {
  EMOJI_BLOCKED_ERROR_TEXT,
  resolveEmojiFilterMode,
} from '../../utils/iContentToHistoryItems.js';
import { useStateAndRef } from '../useStateAndRef.js';
import { useLogger } from '../useLogger.js';
import { type QueuedSubmission } from './types.js';
import { useQueuedSubmissions } from './useQueuedSubmissions.js';
import type { StreamRuntime } from '../../cliUiRuntime.js';
import type { SubmissionExecutor } from './useSubmitQuery.js';
import { PendingResponseBuffer } from './pendingResponseBuffer.js';

export interface UseStreamStateReturn {
  initError: string | null;
  setInitError: React.Dispatch<React.SetStateAction<string | null>>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  abortActiveStream: (reason?: unknown) => void;
  turnCancelledRef: React.MutableRefObject<boolean>;
  turnCancelled: boolean;
  setTurnCancelled: (value: boolean) => void;
  drainSuppressedRef: React.MutableRefObject<boolean>;
  isResponding: boolean;
  setIsResponding: React.Dispatch<React.SetStateAction<boolean>>;
  lastProfileNameRef: React.MutableRefObject<string | undefined>;
  lastModelInfoRef: React.MutableRefObject<string | null>;
  lastModelIdentityRef: React.MutableRefObject<string | null>;
  thought: ThoughtSummary | null;
  setThought: React.Dispatch<React.SetStateAction<ThoughtSummary | null>>;
  pendingHistoryItem: HistoryItemWithoutId | null;
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>;
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >;
  lastAgentActivityTime: number;
  setLastAgentActivityTime: React.Dispatch<React.SetStateAction<number>>;
  queuedSubmissionsRef: React.MutableRefObject<QueuedSubmission[]>;
  queuedSubmissions: readonly QueuedSubmission[];
  enqueueSubmission: (submission: QueuedSubmission) => void;
  enqueueSubmissionFirst: (submission: QueuedSubmission) => void;
  requeueSubmission: (submission: QueuedSubmission) => void;
  dequeueSubmission: () => QueuedSubmission | undefined;
  clearSubmissions: () => void;
  tryReserveDrain: () => boolean;
  releaseDrain: () => void;
  submitQueryRef: React.MutableRefObject<SubmissionExecutor | null>;
  pendingResponse: PendingResponseBuffer;
  sanitizeContent: (text: string) => {
    text: string;
    blocked: boolean;
    feedback?: string;
  };
  flushPendingHistoryItem: (timestamp: number) => void;
  logger: ReturnType<typeof useLogger>;
  gitService: GitService | undefined;
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>;
}

function useEmojiFilterMode(runtime: StreamRuntime): EmojiFilterMode {
  return resolveEmojiFilterMode(runtime.ephemeral);
}

/**
 * Memoised on the mode string rather than the runtime object.
 *
 * The filter now backs the stateful {@link PendingResponseBuffer}, so
 * recreating it mid-stream would discard the accumulated response. Keying on a
 * primitive means a new `runtime` identity — which callers can produce on any
 * re-render — cannot silently truncate a reply (issue #2852).
 */
function useEmojiFilter(mode: EmojiFilterMode) {
  return useMemo(
    () => (mode !== 'allowed' ? new EmojiFilter({ mode }) : undefined),
    [mode],
  );
}

function useSanitizeContent(emojiFilter: EmojiFilter | undefined) {
  return useCallback(
    (text: string) => {
      if (!emojiFilter) {
        return {
          text,
          feedback: undefined as string | undefined,
          blocked: false,
        };
      }

      const result = emojiFilter.filterText(text);
      if (result.blocked) {
        return {
          text: '',
          feedback: result.systemFeedback,
          blocked: true as const,
        };
      }

      const sanitized =
        typeof result.filtered === 'string' ? result.filtered : '';

      return {
        text: sanitized,
        feedback: result.systemFeedback,
        blocked: false as const,
      };
    },
    [emojiFilter],
  );
}

function useFlushPendingHistoryItem(
  addItem: (item: HistoryItemWithoutId, timestamp: number) => number,
  pendingHistoryItemRef: React.MutableRefObject<HistoryItemWithoutId | null>,
  pendingResponse: PendingResponseBuffer,
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >,
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>,
) {
  return useCallback(
    (timestamp: number) => {
      const pending = pendingHistoryItemRef.current;
      if (!pending) {
        return;
      }

      if (pending.type === 'gemini' || pending.type === 'gemini_content') {
        commitAiPendingItem(
          pending,
          timestamp,
          addItem,
          pendingResponse,
          thinkingBlocksRef,
        );
      } else {
        addItem(pending, timestamp);
      }

      setPendingHistoryItem(null);
    },
    [
      addItem,
      pendingHistoryItemRef,
      pendingResponse,
      setPendingHistoryItem,
      thinkingBlocksRef,
    ],
  );
}

/**
 * Commits the in-progress assistant response. The text comes from
 * {@link PendingResponseBuffer}, which sanitised it incrementally as it
 * streamed, so no whole-text pass is needed here (issue #2852).
 */
function commitAiPendingItem(
  pending: HistoryItemWithoutId,
  timestamp: number,
  addItem: (item: HistoryItemWithoutId, timestamp: number) => number,
  pendingResponse: PendingResponseBuffer,
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>,
): void {
  const { text, feedback, blocked } = pendingResponse.materialize();
  pendingResponse.reset();
  const thinkingBlocks = thinkingBlocksRef.current;
  thinkingBlocksRef.current = [];

  if (blocked) {
    addItem(
      {
        type: MessageType.ERROR,
        text: EMOJI_BLOCKED_ERROR_TEXT,
      },
      timestamp,
    );
    if (feedback) {
      addItem({ type: MessageType.INFO, text: feedback }, timestamp);
    }
    return;
  }

  addItem(
    {
      ...pending,
      text,
      ...(thinkingBlocks.length > 0
        ? { thinkingBlocks: [...thinkingBlocks] }
        : {}),
    },
    timestamp,
  );

  if (feedback) {
    addItem({ type: MessageType.INFO, text: feedback }, timestamp);
  }
}

function useBasicStreamState() {
  const [initError, setInitError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const abortActiveStream = useCallback((reason?: unknown) => {
    abortControllerRef.current?.abort(reason);
  }, []);
  const turnCancelledRef = useRef(false);
  const [turnCancelled, setTurnCancelledState] = useState(false);
  const setTurnCancelled = useCallback((value: boolean) => {
    turnCancelledRef.current = value;
    setTurnCancelledState(value);
  }, []);
  const drainSuppressedRef = useRef(false);
  const [isResponding, setIsResponding] = useState<boolean>(false);
  const lastProfileNameRef = useRef<string | undefined>(undefined);
  const lastModelInfoRef = useRef<string | null>(null);
  const lastModelIdentityRef = useRef<string | null>(null);
  const [thought, setThought] = useState<ThoughtSummary | null>(null);
  const [pendingHistoryItem, pendingHistoryItemRef, setPendingHistoryItem] =
    useStateAndRef<HistoryItemWithoutId | null>(null);
  const [lastAgentActivityTime, setLastAgentActivityTime] = useState<number>(0);
  const {
    queuedSubmissions,
    queuedSubmissionsRef,
    enqueueSubmission,
    enqueueSubmissionFirst,
    requeueSubmission,
    dequeueSubmission,
    clearSubmissions,
    tryReserveDrain,
    releaseDrain,
  } = useQueuedSubmissions();
  const submitQueryRef = useRef<SubmissionExecutor | null>(null);
  const thinkingBlocksRef = useRef<ThinkingBlock[]>([]);

  return {
    initError,
    setInitError,
    abortControllerRef,
    abortActiveStream,
    turnCancelledRef,
    turnCancelled,
    setTurnCancelled,
    drainSuppressedRef,
    isResponding,
    setIsResponding,
    lastProfileNameRef,
    lastModelInfoRef,
    lastModelIdentityRef,
    thought,
    setThought,
    pendingHistoryItem,
    pendingHistoryItemRef,
    setPendingHistoryItem,
    lastAgentActivityTime,
    setLastAgentActivityTime,
    queuedSubmissions,
    queuedSubmissionsRef,
    enqueueSubmission,
    enqueueSubmissionFirst,
    requeueSubmission,
    dequeueSubmission,
    clearSubmissions,
    tryReserveDrain,
    releaseDrain,
    submitQueryRef,
    thinkingBlocksRef,
  };
}

export function useStreamState(
  addItem: (item: HistoryItemWithoutId, timestamp: number) => number,
  runtime: StreamRuntime,
): UseStreamStateReturn {
  const basic = useBasicStreamState();
  const storage = runtime.storage;

  const emojiFilter = useEmojiFilter(useEmojiFilterMode(runtime));
  const sanitizeContent = useSanitizeContent(emojiFilter);
  const pendingResponse = useMemo(
    () => new PendingResponseBuffer(emojiFilter),
    [emojiFilter],
  );
  const flushPendingHistoryItem = useFlushPendingHistoryItem(
    addItem,
    basic.pendingHistoryItemRef,
    pendingResponse,
    basic.setPendingHistoryItem,
    basic.thinkingBlocksRef,
  );
  const logger = useLogger(storage);
  const gitService = useMemo(() => {
    const projectRoot = runtime.session.getProjectRoot();
    if (projectRoot.length === 0) {
      return undefined;
    }
    return new GitService(projectRoot, storage);
  }, [runtime, storage]);

  return {
    ...basic,
    pendingResponse,
    sanitizeContent,
    flushPendingHistoryItem,
    logger,
    gitService,
  };
}
