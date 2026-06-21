/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared helpers for turn test files. Extracted from the original monolithic
 * turn.test.ts so no file-level max-lines disable is needed.
 */

import type {
  ServerGeminiStreamEvent,
  ServerGeminiFinishedEvent,
} from './turn.js';
import { GeminiEventType } from './turn.js';
import type { GenerateContentResponse, Part } from '@google/genai';
import type { Mock } from 'vitest';

export type MockedChatInstance = {
  sendMessageStream: Mock;
  getHistory: Mock;
  getConfig: () =>
    | { getEphemeralSetting: (key: string) => unknown }
    | undefined;
};

export function findFinishedEvent(
  events: ServerGeminiStreamEvent[],
): ServerGeminiFinishedEvent | undefined {
  return events.find(
    (event): event is ServerGeminiFinishedEvent =>
      event.type === GeminiEventType.Finished,
  );
}

/**
 * Reusable mock implementation object for generateContentResponseUtilities —
 * pass this to vi.mock factory in each turn test file.
 */
export function generateContentResponseUtilitiesMock() {
  return {
    getResponseText: (resp: GenerateContentResponse) =>
      resp.candidates?.[0]?.content?.parts
        ?.filter((part) => (part as { thought?: boolean }).thought !== true)
        .map((part) => part.text)
        .join('') ?? undefined,
    getFunctionCalls: (resp: GenerateContentResponse) =>
      resp.functionCalls ?? [],
    getFunctionCallsFromParts: (parts: Part[]) => {
      const functionCalls = parts
        .filter((part) => part.functionCall !== undefined)
        .map((part) => part.functionCall!);
      return functionCalls.length > 0 ? functionCalls : undefined;
    },
    analyzeResponseOutcome: (parts: Part[]) => {
      let hasVisibleText = false;
      let hasThinking = false;
      let hasToolCalls = false;
      for (const part of parts) {
        const isThinking = (part as { thought?: boolean }).thought === true;
        if (isThinking) hasThinking = true;
        if (part.functionCall !== undefined) hasToolCalls = true;
        if (
          !isThinking &&
          typeof part.text === 'string' &&
          part.text.trim() !== ''
        )
          hasVisibleText = true;
      }
      return {
        hasVisibleText,
        hasThinking,
        hasToolCalls,
        isActionable: hasVisibleText || hasToolCalls,
      };
    },
  };
}
