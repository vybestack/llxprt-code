/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-004.3
 *
 * Type-level API-shape test (MAJOR 7): asserts that
 * `TurnProcessor['sendMessage']` resolves to `ModelOutput` and NOT to
 * `GenerateContentResponse`. This is a compile-time type assertion — if the
 * return type regresses to `GenerateContentResponse`, the `_isModelOutput`
 * assignment fails typecheck.
 */

import { describe, it, expect } from 'vitest';
import type { TurnProcessor } from '../TurnProcessor.js';
import type { ModelOutput } from '@vybestack/llxprt-code-core/llm-types/index.js';

/**
 * Compile-time assertion: awaited sendMessage(...) is assignable to ModelOutput.
 * If sendMessage returns Promise<GenerateContentResponse> this line fails
 * typecheck because GenerateContentResponse is not assignable to ModelOutput.
 */
type SendMessageResult = Awaited<ReturnType<TurnProcessor['sendMessage']>>;

const _isModelOutput: SendMessageResult extends ModelOutput ? true : false =
  true;

/**
 * Compile-time assertion: awaited sendMessage(...) is NOT GenerateContentResponse.
 * We verify by checking that ModelOutput's `content.blocks` property exists on
 * the result — GenerateContentResponse does not have `content.blocks`.
 */
const _hasBlocks: SendMessageResult extends { content: { blocks: unknown[] } }
  ? true
  : false = true;

describe('TurnProcessor.sendMessage API shape (P13)', () => {
  it('sendMessage return type is ModelOutput (type-level)', () => {
    expect(_isModelOutput).toBe(true);
  });

  it('sendMessage result has content.blocks (type-level)', () => {
    expect(_hasBlocks).toBe(true);
  });
});
