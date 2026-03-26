/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import { StreamingState } from '../types.js';

export interface UseMessageQueueOptions {
  isConfigInitialized: boolean;
  streamingState: StreamingState;
  submitQuery: (query: string) => void;
  isMcpReady: boolean;
}

export interface UseMessageQueueReturn {
  messageQueue: string[];
  addMessage: (message: string) => void;
}

export function useMessageQueue({
  isConfigInitialized,
  streamingState,
  submitQuery,
  isMcpReady,
}: UseMessageQueueOptions): UseMessageQueueReturn {
  const [messageQueue, setMessageQueue] = useState<string[]>([]);

  const addMessage = useCallback((message: string) => {
    setMessageQueue((prev) => [...prev, message]);
  }, []);

  // Flush the queue one message at a time when all gates are open:
  // config ready, idle, and MCP servers initialized.
  useEffect(() => {
    if (
      isConfigInitialized &&
      streamingState === StreamingState.Idle &&
      isMcpReady &&
      messageQueue.length > 0
    ) {
      // Submit messages one at a time to preserve individual conversational turns.
      const [next, ...rest] = messageQueue;
      setMessageQueue(rest);
      submitQuery(next);
    }
  }, [
    isConfigInitialized,
    streamingState,
    isMcpReady,
    messageQueue,
    submitQuery,
  ]);

  return {
    messageQueue,
    addMessage,
  };
}
