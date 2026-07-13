/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import { StreamingState, type HistoryItemWithoutId } from '../../../types.js';
import { isToolExecuting } from './useInputHandling.js';

interface SteerAgent {
  injectSteer(text: string): void;
}

interface SanitizedContent {
  text: string;
  blocked: boolean;
  feedback?: string;
}

export function useSteer(
  agent: SteerAgent,
  streamingState: StreamingState,
  sanitizeContent: (text: string) => SanitizedContent,
  pendingHistoryItems: HistoryItemWithoutId[],
  addMessage: (message: string) => void,
): (text: string) => boolean {
  return useCallback(
    (text: string): boolean => {
      if (streamingState !== StreamingState.Responding) {
        return false;
      }
      let sanitized: SanitizedContent;
      try {
        sanitized = sanitizeContent(text);
      } catch {
        return false;
      }
      if (sanitized.blocked || sanitized.text.length === 0) {
        return false;
      }
      if (!isToolExecuting(pendingHistoryItems)) {
        addMessage(sanitized.text);
        return true;
      }
      agent.injectSteer(sanitized.text);
      return true;
    },
    [streamingState, sanitizeContent, pendingHistoryItems, addMessage, agent],
  );
}
