/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { prepareHistoryUserInput } from './streamResponseHelpers.js';

describe('prepareHistoryUserInput', () => {
  it('keeps userInputWasArray aligned with filtered empty array history input when a single eager tool response is fully removed', () => {
    const userInput: IContent = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call-1',
          toolName: 'tool',
          result: { output: 'ok' },
        },
      ],
    };

    const prepared = prepareHistoryUserInput(userInput, new Set(['call-1']));

    expect(prepared.historyUserInput).toStrictEqual([]);
    expect(prepared.userInputFlags).toStrictEqual({
      userInputWasArray: true,
      userInputWasFunctionResponse: true,
    });
  });
});
