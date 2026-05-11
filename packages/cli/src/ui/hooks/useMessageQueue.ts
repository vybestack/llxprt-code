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
  submitQuery: (query: string) => void | Promise<void>;
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

  // Flush the entire queue as a single combined submission when all gates open:
  // config ready, idle, and MCP servers initialized.
  useEffect(() => {
    if (
      isConfigInitialized &&
      streamingState === StreamingState.Idle &&
      isMcpReady &&
      messageQueue.length > 0
    ) {
      // Combine all queued messages into one submission so they arrive as a
      // single conversational turn rather than triggering multiple round-trips.
      const combined = messageQueue.join('\n\n');
      setMessageQueue([]);
      void submitQuery(combined);
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
