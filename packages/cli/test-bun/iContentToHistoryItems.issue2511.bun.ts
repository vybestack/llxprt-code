/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2511 (AC5): when an AI turn was recorded with no model attribution
 * (e.g. restored/imported history with no persisted metadata.model),
 * iContentToHistoryItems must render it as a gemini item whose `model` is
 * `undefined` — never substituting the current provider's default. This is the
 * neutral-restore invariant: a historical turn keeps the model it was
 * persisted with, and the absence of a model is preserved as an absence.
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core';
import { iContentToHistoryItems } from '../src/ui/utils/iContentToHistoryItems.js';
import { assertHasType } from '../src/test-utils/assertions.js';

describe('iContentToHistoryItems issue #2511 AC5', () => {
  it('maps ai content with no metadata.model to a gemini item with model undefined', () => {
    const input: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'No model attribution' }],
      },
    ];

    const output = iContentToHistoryItems(input);
    expect(output).toHaveLength(1);
    assertHasType(output[0], 'gemini');
    expect(output[0].model).toBeUndefined();
  });
});
