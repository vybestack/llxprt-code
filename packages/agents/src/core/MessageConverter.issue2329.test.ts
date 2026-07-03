/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #2329: surface Claude Fable 5 safety-classifier
 * refusals as a distinguishable finish reason.
 *
 * Tests through the public convertIContentToResponse() entry point — no mock
 * theater. A refusal IContent must produce a response with finishReason STOP
 * and the raw provider stop reason preserved on candidate.finishMessage.
 */

import { describe, it, expect } from 'vitest';
import { FinishReason } from '@google/genai';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { convertIContentToResponse } from './MessageConverter.js';

describe('Issue 2329: refusal finish-reason mapping @issue:2329', () => {
  it('maps refusal metadata.stopReason to FinishReason.STOP', () => {
    const icontent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'I cannot help with that.' }],
      metadata: { stopReason: 'refusal' },
    };

    const response = convertIContentToResponse(icontent);

    expect(response.candidates).toBeDefined();
    expect(response.candidates).toHaveLength(1);
    expect(response.candidates[0].finishReason).toBe(FinishReason.STOP);
  });

  it('preserves the raw provider stop reason on candidate.finishMessage for refusal', () => {
    const icontent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'declined' }],
      metadata: { stopReason: 'refusal' },
    };

    const response = convertIContentToResponse(icontent);

    expect(response.candidates[0].finishMessage).toBe('refusal');
  });

  it('maps a normal end_turn to STOP and preserves finishMessage end_turn', () => {
    const icontent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Here is the answer.' }],
      metadata: { stopReason: 'end_turn' },
    };

    const response = convertIContentToResponse(icontent);

    expect(response.candidates[0].finishReason).toBe(FinishReason.STOP);
    expect(response.candidates[0].finishMessage).toBe('end_turn');
  });

  it('maps max_tokens to MAX_TOKENS and preserves finishMessage', () => {
    const icontent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'truncated' }],
      metadata: { stopReason: 'max_tokens' },
    };

    const response = convertIContentToResponse(icontent);

    expect(response.candidates[0].finishReason).toBe(FinishReason.MAX_TOKENS);
    expect(response.candidates[0].finishMessage).toBe('max_tokens');
  });

  it('does not set finishMessage when no termination reason is present', () => {
    const icontent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'text' }],
      metadata: {},
    };

    const response = convertIContentToResponse(icontent);

    expect(response.candidates[0].finishReason).toBeUndefined();
    expect(response.candidates[0].finishMessage).toBeUndefined();
  });

  it('leaves finishReason and finishMessage unset for an unknown stopReason', () => {
    const icontent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'text' }],
      metadata: { stopReason: 'some_future_reason' },
    };

    const response = convertIContentToResponse(icontent);

    expect(response.candidates[0].finishReason).toBeUndefined();
    expect(response.candidates[0].finishMessage).toBeUndefined();
  });
});
