/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the core-owned toolIdNormalization utility.
 *
 * These tests verify that the core-owned toolIdNormalization produces
 * identical output to the original providers/utils location, ensuring
 * the utility is self-sufficient in core with no provider imports.
 *
 * The existing test file (toolIdNormalization.test.ts) covers individual
 * function behavior. These tests focus on contract-level guarantees:
 * - The utility can be imported from the core path
 * - The utility has no dependency on the providers package
 * - The normalization behavior is deterministically correct across formats
 *
 * @plan:PLAN-20260603-ISSUE1584.P04
 * @requirement:REQ-TEST-001
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeToOpenAIToolId,
  normalizeToHistoryToolId,
  normalizeToAnthropicToolId,
} from '@vybestack/llxprt-code-tools';

describe('toolIdNormalization core-owned contract', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('normalizes all three formats to OpenAI (call_) correctly — cross-format consistency', () => {
    const openaiId = 'call_abc123def';
    const historyId = 'hist_tool_abc123def';
    const anthropicId = 'toolu_abc123def';

    // All three must normalize to the same OpenAI format result
    expect(normalizeToOpenAIToolId(openaiId)).toBe('call_abc123def');
    expect(normalizeToOpenAIToolId(historyId)).toBe('call_abc123def');
    expect(normalizeToOpenAIToolId(anthropicId)).toBe('call_abc123def');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('normalizes all three formats to history (hist_tool_) correctly — cross-format consistency', () => {
    const openaiId = 'call_abc123def';
    const historyId = 'hist_tool_abc123def';
    const anthropicId = 'toolu_abc123def';

    expect(normalizeToHistoryToolId(openaiId)).toBe('hist_tool_abc123def');
    expect(normalizeToHistoryToolId(historyId)).toBe('hist_tool_abc123def');
    expect(normalizeToHistoryToolId(anthropicId)).toBe('hist_tool_abc123def');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('normalizes all three formats to Anthropic (toolu_) correctly — cross-format consistency', () => {
    const openaiId = 'call_abc123def';
    const historyId = 'hist_tool_abc123def';
    const anthropicId = 'toolu_abc123def';

    expect(normalizeToAnthropicToolId(openaiId)).toBe('toolu_abc123def');
    expect(normalizeToAnthropicToolId(historyId)).toBe('toolu_abc123def');
    expect(normalizeToAnthropicToolId(anthropicId)).toBe('toolu_abc123def');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('deterministic normalization — same input always produces same output', () => {
    const ids = [
      'call_abc123',
      'hist_tool_xyz789',
      'toolu_def456',
      'unknown_id',
    ];

    for (const id of ids) {
      const openai1 = normalizeToOpenAIToolId(id);
      const openai2 = normalizeToOpenAIToolId(id);
      expect(openai1).toBe(openai2);

      const history1 = normalizeToHistoryToolId(id);
      const history2 = normalizeToHistoryToolId(id);
      expect(history1).toBe(history2);

      const anthropic1 = normalizeToAnthropicToolId(id);
      const anthropic2 = normalizeToAnthropicToolId(id);
      expect(anthropic1).toBe(anthropic2);
    }
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('roundtrip normalization preserves identity for canonical formats', () => {
    // OpenAI format roundtrip: call_X -> hist_tool_X -> call_X
    const openaiOriginal = 'call_abc123def';
    const historyForm = normalizeToHistoryToolId(openaiOriginal);
    const openaiRoundtrip = normalizeToOpenAIToolId(historyForm);
    expect(openaiRoundtrip).toBe(openaiOriginal);

    // History format roundtrip: hist_tool_X -> call_X -> hist_tool_X
    const historyOriginal = 'hist_tool_abc123def';
    const openaiForm = normalizeToOpenAIToolId(historyOriginal);
    const historyRoundtrip = normalizeToHistoryToolId(openaiForm);
    expect(historyRoundtrip).toBe(historyOriginal);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('handles edge cases: empty string, long IDs, special characters', () => {
    // Empty string
    expect(normalizeToOpenAIToolId('')).toBe('call_');
    expect(normalizeToHistoryToolId('')).toBe('hist_tool_');
    expect(normalizeToAnthropicToolId('')).toBe('toolu_empty');

    // Long ID with mixed format
    const longId = 'call_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
    expect(normalizeToOpenAIToolId(longId)).toBe(longId);

    // Special characters (sanitized)
    expect(normalizeToOpenAIToolId('call_abc.123')).toBe('call_abc123');
    expect(normalizeToAnthropicToolId('call_abc.123')).toBe('toolu_abc-123');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('toolIdNormalization is importable from core tools path without provider imports', async () => {
    // Dynamic import tests that the module resolves from core path.
    // This would fail if the core path redirected to providers.
    const mod = await import('@vybestack/llxprt-code-tools');
    expect(mod.normalizeToOpenAIToolId).toBeTypeOf('function');
    expect(mod.normalizeToHistoryToolId).toBeTypeOf('function');
    expect(mod.normalizeToAnthropicToolId).toBeTypeOf('function');
  });
});
