/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P19,P20
 * @requirement:HOOK-017,HOOK-019,HOOK-027,HOOK-036,HOOK-055,HOOK-134
 *
 * Behavioral tests for hook caller integration.
 *
 * These tests verify that hook trigger functions return typed results that
 * callers can use to make decisions.
 *
 * Test philosophy (per dev-docs/RULES.md):
 * - Tests are behavioral (input → output), not mock-interaction tests
 * - Tests verify actual outcomes, not implementation details
 * - Every line of production code is written in response to a failing test
 *
 * triggerBeforeToolHook and triggerAfterToolHook return typed results (P20).
 * triggerBeforeModelHook/triggerAfterModelHook/triggerBeforeToolSelectionHook
 * have been migrated into HookSystem.fireBeforeModel/AfterModel/BeforeToolSelectionEvent —
 * those describe blocks remain skipped pending separate test coverage.
 */

import { describe, it, expect } from 'vitest';
import {
  triggerBeforeToolHook,
  triggerAfterToolHook,
} from '../core/coreToolHookTriggers.js';
// Note: triggerBeforeModelHook, triggerAfterModelHook, triggerBeforeToolSelectionHook
// have been migrated into HookSystem.fireBeforeModelEvent/fireAfterModelEvent/fireBeforeToolSelectionEvent
import { createTestConfigWithHook } from './test-utils/createTestConfigWithHook.js';
import type { ToolResult } from '../tools/tools.js';

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
      expect(hookSpecificOutput?.tool_input).toStrictEqual({
        path: '/safe/path',
      });
    });
  });

  /**
   * Tests 4-5: triggerBeforeModelHook - migrated to HookSystem.fireBeforeModelEvent
   * @requirement:HOOK-134,HOOK-036
   *
   * These functions were migrated into HookSystem.fireBeforeModelEvent.
   * Coverage is provided by hookSystem-integration tests.
   */
  describe('triggerBeforeModelHook (migrated to HookSystem.fireBeforeModelEvent)', () => {
    it.skip('should return BeforeModelHookOutput when hook executes', async () => {
      // Skipped: triggerBeforeModelHook was merged into HookSystem.fireBeforeModelEvent.
      // See hookSystem-integration.test.ts for BeforeModel hook coverage.
      expect(true).toBe(true);
    });

    it.skip('should return synthetic response when hook blocks with llm_response', async () => {
      // Skipped: triggerBeforeModelHook was merged into HookSystem.fireBeforeModelEvent.
      expect(true).toBe(true);
    });
  });

  /**
   * Test 6: triggerAfterModelHook - migrated to HookSystem.fireAfterModelEvent
   * @requirement:HOOK-134
   */
  describe('triggerAfterModelHook (migrated to HookSystem.fireAfterModelEvent)', () => {
    it.skip('should return AfterModelHookOutput when hook executes', async () => {
      // Skipped: triggerAfterModelHook was merged into HookSystem.fireAfterModelEvent.
      expect(true).toBe(true);
    });
  });

  /**
   * Test 7: triggerBeforeToolSelectionHook - migrated to HookSystem.fireBeforeToolSelectionEvent
   * @requirement:HOOK-055
   */
  describe('triggerBeforeToolSelectionHook (migrated to HookSystem.fireBeforeToolSelectionEvent)', () => {
    it.skip('should return tool restrictions when hook provides allowedFunctionNames', async () => {
      // Skipped: triggerBeforeToolSelectionHook was merged into HookSystem.fireBeforeToolSelectionEvent.
      expect(true).toBe(true);
    });
  });

  /**
   * Test 8: triggerAfterToolHook returns context injection
   * @requirement:HOOK-027 - AfterTool can inject additional context
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
      // The behavioral requirement:
      // - Functions return typed result when hooks execute (Promise<T | undefined>)
      // - With a configured hook, result is defined when hooks execute

      const config = createTestConfigWithHook({
        event: 'BeforeTool',
        command: `echo '{"decision": "allow"}'`,
      });

      // Call the function
      const result = await triggerBeforeToolHook(config, 'test_tool', {});

      // With a valid config that has matching hooks, we should get a typed result
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });
});
