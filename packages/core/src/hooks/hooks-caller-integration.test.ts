/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P19
 * @requirement:HOOK-017,HOOK-019,HOOK-027,HOOK-036,HOOK-055,HOOK-134
 *
 * Behavioral tests for hook caller integration.
 *
 * These tests verify that hook trigger functions return typed results that
 * callers can use to make decisions. They are written to FAIL with the
 * current implementation which returns Promise<void>.
 *
 * Test philosophy (per dev-docs/RULES.md):
 * - Tests are behavioral (input → output), not mock-interaction tests
 * - Tests verify actual outcomes, not implementation details
 * - Every line of production code is written in response to a failing test
 *
 * These tests MUST FAIL until P20 (implementation phase) is complete.
 */

import { describe, it, expect } from 'vitest';
import {
  triggerBeforeToolHook,
  triggerAfterToolHook,
} from '../core/coreToolHookTriggers.js';
import {
  triggerBeforeModelHook,
  triggerAfterModelHook,
  triggerBeforeToolSelectionHook,
} from '../core/geminiChatHookTriggers.js';
import { createTestConfigWithHook } from './test-utils/createTestConfigWithHook.js';
import type { IContent } from '../services/history/IContent.js';
import type { ToolResult } from '../tools/tools.js';

/**
 * Mock LLM request for BeforeModel tests
 */
const mockLLMRequest = {
  contents: [
    {
      speaker: 'human' as const,
      blocks: [{ type: 'text' as const, text: 'Hello' }],
    },
  ],
};

/**
 * Mock LLM response for AfterModel tests
 */
const mockLLMResponse: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'text', text: 'Hello back!' }],
};

/**
 * Mock tool result for AfterTool tests
 */
const mockToolResult: ToolResult = {
  llmContent: { type: 'text', text: 'Tool executed successfully' },
  returnDisplay: '',
};

describe('Hook Caller Integration', () => {
  /**
   * Test 1: triggerBeforeToolHook returns typed result
   * @requirement:HOOK-134 - Trigger functions return typed results, not void
   *
   * Expected to FAIL because: triggerBeforeToolHook currently returns Promise<void>
   */
  describe('triggerBeforeToolHook', () => {
    it('should return BeforeToolHookOutput when hook executes', async () => {
      // Arrange: Config with an allowing hook that outputs valid JSON
      const config = createTestConfigWithHook({
        event: 'BeforeTool',
        command: 'echo \'{"decision": "allow"}\'',
      });

      // Act
      const result = await triggerBeforeToolHook(config, 'read_file', {
        path: '/test',
      });

      // Assert: Should return typed output, NOT undefined
      expect(result).toBeDefined();
      expect(result).toHaveProperty('isBlockingDecision');
      expect(result).toHaveProperty('getEffectiveReason');
    });

    /**
     * Test 2: BeforeTool block decision accessible
     * @requirement:HOOK-017 - BeforeTool can block execution with exit code 2
     *
     * Expected to FAIL because: Result is discarded (void return)
     */
    it('should return blocking decision when hook exits with code 2', async () => {
      const config = createTestConfigWithHook({
        event: 'BeforeTool',
        command: 'echo "Blocked for testing" >&2; exit 2',
      });

      const result = await triggerBeforeToolHook(config, 'write_file', {
        path: '/etc/passwd',
      });

      expect(result).toBeDefined();
      expect(result!.isBlockingDecision()).toBe(true);
      expect(result!.getEffectiveReason()).toContain('Blocked for testing');
    });

    /**
     * Test 3: BeforeTool modified input accessible
     * @requirement:HOOK-019 - BeforeTool can modify tool input
     *
     * Expected to FAIL because: Result is discarded, getModifiedToolInput doesn't exist
     */
    it('should return modified tool_input when hook provides it', async () => {
      const config = createTestConfigWithHook({
        event: 'BeforeTool',
        command:
          'echo \'{"decision": "allow", "hookSpecificOutput": {"tool_input": {"path": "/safe/path"}}}\'',
      });

      const result = await triggerBeforeToolHook(config, 'read_file', {
        path: '/etc/passwd',
      });

      expect(result).toBeDefined();
      // The BeforeToolHookOutput should have a method to get modified input
      // This method needs to be added to the type
      const hookSpecificOutput = (
        result as unknown as {
          hookSpecificOutput?: { tool_input?: Record<string, unknown> };
        }
      ).hookSpecificOutput;
      expect(hookSpecificOutput).toBeDefined();
      expect(hookSpecificOutput?.tool_input).toEqual({ path: '/safe/path' });
    });
  });

  /**
   * Test 4: triggerBeforeModelHook returns typed result
   * @requirement:HOOK-134 - Trigger functions return typed results, not void
   *
   * Expected to FAIL because: triggerBeforeModelHook currently returns Promise<void>
   */
  describe('triggerBeforeModelHook', () => {
    it('should return BeforeModelHookOutput when hook executes', async () => {
      const config = createTestConfigWithHook({
        event: 'BeforeModel',
        command: 'echo \'{"decision": "allow"}\'',
      });

      const result = await triggerBeforeModelHook(config, mockLLMRequest);

      // Assert: Should return typed output, NOT undefined
      expect(result).toBeDefined();
      expect(result).toHaveProperty('isBlockingDecision');
      expect(result).toHaveProperty('getSyntheticResponse');
    });

    /**
     * Test 5: BeforeModel synthetic response accessible
     * @requirement:HOOK-036 - BeforeModel can block with synthetic response
     *
     * Expected to FAIL because: Result is discarded
     */
    it('should return synthetic response when hook blocks with llm_response', async () => {
      const config = createTestConfigWithHook({
        event: 'BeforeModel',
        command: `echo '{"decision": "block", "reason": "Content policy", "hookSpecificOutput": {"llm_response": {"candidates": [{"content": {"role": "model", "parts": ["I cannot help with that."]}, "finishReason": "STOP"}]}}}'`,
      });

      const result = await triggerBeforeModelHook(config, mockLLMRequest);

      expect(result).toBeDefined();
      expect(result!.isBlockingDecision()).toBe(true);
      const synthetic = result!.getSyntheticResponse();
      expect(synthetic).toBeDefined();
      // The synthetic response should have the content from the hook
      expect(synthetic?.candidates?.[0]?.content?.parts).toBeDefined();
    });
  });

  /**
   * Test 6: triggerAfterModelHook returns modified response data
   * @requirement:HOOK-134 - Trigger functions return typed results, not void
   *
   * Expected to FAIL because: triggerAfterModelHook currently returns Promise<void>
   */
  describe('triggerAfterModelHook', () => {
    it('should return AfterModelHookOutput when hook executes', async () => {
      const config = createTestConfigWithHook({
        event: 'AfterModel',
        command: `echo '{"decision": "allow", "hookSpecificOutput": {"additionalContext": "Model response processed"}}'`,
      });

      const result = await triggerAfterModelHook(config, mockLLMResponse);

      // Assert: Should return typed output, NOT undefined
      expect(result).toBeDefined();
      expect(result).toHaveProperty('getAdditionalContext');
    });
  });

  /**
   * Test 7: triggerBeforeToolSelectionHook returns tool restrictions
   * @requirement:HOOK-055 - BeforeToolSelection can restrict available tools
   *
   * Expected to FAIL because: Result is discarded
   */
  describe('triggerBeforeToolSelectionHook', () => {
    it('should return tool restrictions when hook provides allowedFunctionNames', async () => {
      const config = createTestConfigWithHook({
        event: 'BeforeToolSelection',
        command: `echo '{"decision": "allow", "hookSpecificOutput": {"toolConfig": {"mode": "AUTO", "allowedFunctionNames": ["read_file", "list_directory"]}}}'`,
      });

      const result = await triggerBeforeToolSelectionHook(config, []);

      expect(result).toBeDefined();
      // Result should have method to get modified tool config
      const toolConfig = result!.applyToolConfigModifications({});
      expect(toolConfig).toBeDefined();
      expect(toolConfig.toolConfig?.allowedFunctionNames).toEqual([
        'list_directory',
        'read_file',
      ]);
    });
  });

  /**
   * Test 8: triggerAfterToolHook returns context injection
   * @requirement:HOOK-027 - AfterTool can inject additional context
   *
   * Expected to FAIL because: Result is discarded
   */
  describe('triggerAfterToolHook', () => {
    it('should return additionalContext when hook provides it', async () => {
      const config = createTestConfigWithHook({
        event: 'AfterTool',
        command: `echo '{"decision": "allow", "hookSpecificOutput": {"additionalContext": "Security note: file was sanitized"}}'`,
      });

      const result = await triggerAfterToolHook(
        config,
        'read_file',
        { path: '/test' },
        mockToolResult,
      );

      expect(result).toBeDefined();
      expect(result!.getAdditionalContext()).toBe(
        'Security note: file was sanitized',
      );
    });
  });

  /**
   * Test 9: Runtime verification that trigger functions return typed results
   * @requirement:HOOK-134 - Meta requirement for typed returns
   *
   * This test verifies that trigger functions return actual typed results,
   * not void/undefined. It uses a config with hooks disabled to avoid
   * actual hook execution, but still checks the return type behavior.
   *
   * Expected to FAIL because: Functions return Promise<void> (always undefined)
   *
   * When P20 is implemented:
   * - Functions should return Promise<TypedResult | undefined>
   * - With hooks disabled, they should return undefined (not void)
   * - The key difference: void means "no return value" vs undefined means "optional return"
   * - This test will pass when functions have proper typed returns, even when returning undefined
   */
  describe('HOOK-134 Enforcement', () => {
    it('trigger functions return type should support optional typed result', async () => {
      // This test verifies that when we call triggers with a valid config
      // that has matching hooks, we get back a typed result object.
      //
      // The critical behavioral difference:
      // - Current: functions return void (Promise<void>), result is always undefined
      // - Target: functions return typed result when hooks execute (Promise<T | undefined>)
      //
      // We use the same test config pattern as other tests - if hooks execute,
      // we should get a result back.

      const config = createTestConfigWithHook({
        event: 'BeforeTool',
        command: `echo '{"decision": "allow"}'`,
      });

      // Call the function
      const result = await triggerBeforeToolHook(config, 'test_tool', {});

      // The function signature should indicate it CAN return a value
      // With void return, result is guaranteed undefined
      // With typed return, result would be defined when hooks execute
      //
      // This assertion fails because current impl returns void (undefined)
      // When fixed, this will pass because hooks are configured and should produce output
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });
});
