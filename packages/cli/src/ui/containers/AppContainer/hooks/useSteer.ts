/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import { StreamingState } from '../../../types.js';

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
      // The AgenticLoop buffers steer text in pendingSteer and drains it at
      // the next iteration boundary — works whether or not a tool is
      // currently executing.
      agent.injectSteer(sanitized.text);
      return true;
    },
    [streamingState, sanitizeContent, agent],
  );
}
