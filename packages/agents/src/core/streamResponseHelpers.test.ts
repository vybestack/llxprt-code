/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { Content } from '@google/genai';
import { prepareHistoryUserInput } from './streamResponseHelpers.js';

describe('prepareHistoryUserInput', () => {
  it('keeps userInputWasArray aligned with filtered empty array history input when a single eager function response is fully removed', () => {
    const userInput: Content = {
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: 'tool',
            response: { output: 'ok' },
            id: 'call-1',
          },
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
