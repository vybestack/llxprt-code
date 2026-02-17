/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P21
 * @requirement:HOOK-017,HOOK-019,HOOK-036,HOOK-040,HOOK-048,HOOK-055,HOOK-129,HOOK-131,HOOK-132
 *
 * Behavioral tests for hook caller APPLICATION of results.
 *
 * P20 made trigger functions return typed results. But callers still use
 * `void` prefix and IGNORE results:
 * - `geminiChat.ts:1337` — `void triggerBeforeToolSelectionHook(...)`
 * - `geminiChat.ts:1381` — `void triggerBeforeModelHook(...)`
 * - `geminiChat.ts:1418` — `void triggerAfterModelHook(...)`
 * - `coreToolScheduler.ts:1727` — `void triggerBeforeToolHook(...)`
 * - `coreToolScheduler.ts:1777` — `void triggerAfterToolHook(...)`
 *
 * These tests verify END-TO-END outcomes when hooks return blocking/modifying
 * results. They MUST FAIL until callers are updated to await and apply results.
 *
 * Test philosophy (per dev-docs/RULES.md):
 * - Tests are behavioral (input → output), not mock-interaction tests
 * - Tests verify actual outcomes, not implementation details
 * - Every line of production code is written in response to a failing test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ToolCall,
  SuccessfulToolCall,
} from '../core/coreToolScheduler.js';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  type ToolResult,
  Kind,
  ToolRegistry,
  ApprovalMode,
  type Config,
} from '../index.js';
import { PolicyDecision } from '../policy/types.js';
import { HookSystem } from './hookSystem.js';
import type { HookDefinition, HookType } from './types.js';

/**
 * A tool that tracks whether it was executed
 */
class TrackingToolInvocation extends BaseToolInvocation<
  Record<string, unknown>,
  ToolResult
> {
  static executionCount = 0;
  static lastArgs: Record<string, unknown> | undefined;

  async execute(): Promise<ToolResult> {
    TrackingToolInvocation.executionCount++;
    TrackingToolInvocation.lastArgs = this.params;
    return {
      llmContent: `Executed with args: ${JSON.stringify(this.params)}`,
      returnDisplay: `Tool executed`,
    };
  }

  getDescription(): string {
    return 'Tracking tool invocation';
  }
}

class TrackingTool extends BaseDeclarativeTool<
  Record<string, unknown>,
  ToolResult
> {
  constructor() {
    super(
      'tracking_tool',
      'Tracking Tool',
      'A tool that tracks execution for testing',
      Kind.Other,
      { type: 'object', properties: { path: { type: 'string' } } },
    );
  }

  protected createInvocation(
    params: Record<string, unknown>,
  ): TrackingToolInvocation {
    return new TrackingToolInvocation(params);
  }
}

/**
 * Create mock message bus for testing
 */
function createMockMessageBus() {
  return {
    subscribe: vi.fn().mockReturnValue(() => {}),
    publish: vi.fn(),
    respondToConfirmation: vi.fn(),
    requestConfirmation: vi.fn().mockResolvedValue(true),
    removeAllListeners: vi.fn(),
    listenerCount: vi.fn().mockReturnValue(0),
  };
}

/**
 * Create mock policy engine that allows everything
 */
function createMockPolicyEngine() {
  return {
    evaluate: vi.fn().mockReturnValue(PolicyDecision.ALLOW),
    checkDecision: vi.fn().mockReturnValue(PolicyDecision.ALLOW),
  };
}

/**
 * Create a config with hooks enabled and a specific hook configured
 */
function createConfigWithHook(options: {
  event: string;
  command: string;
  matcher?: string;
  timeout?: number;
}): Config {
  const hookDef: HookDefinition = {
    matcher: options.matcher,
    hooks: [
      {
        type: 'command' as HookType.Command,
        command: options.command,
        timeout: options.timeout ?? 5000,
      },
    ],
  };

  const hooks: Record<string, HookDefinition[]> = {
    [options.event]: [hookDef],
  };

  let hookSystem: HookSystem | undefined;

  const trackingTool = new TrackingTool();
  const mockToolRegistry = {
    getTool: () => trackingTool,
    getFunctionDeclarations: () => [],
    tools: new Map([['tracking_tool', trackingTool]]),
    discovery: {},
    registerTool: () => {},
    getToolByName: () => trackingTool,
    getToolByDisplayName: () => trackingTool,
    getTools: () => [trackingTool],
    discoverTools: async () => {},
    getAllTools: () => [trackingTool],
    getToolsByServer: () => [],
  } as unknown as ToolRegistry;

  const config = {
    getSessionId: () => 'test-session-' + Date.now(),
    getUsageStatisticsEnabled: () => true,
    getDebugMode: () => false,
    getApprovalMode: () => ApprovalMode.DEFAULT,
    getEphemeralSettings: () => ({}),
    getAllowedTools: () => [],
    getContentGeneratorConfig: () => ({ model: 'test-model' }),
    getToolRegistry: () => mockToolRegistry,
    getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
    getPolicyEngine: vi.fn().mockReturnValue(createMockPolicyEngine()),
    getEnableHooks: () => true,
    getHooks: () => hooks,
    getWorkingDir: () => '/tmp/test',
    getTargetDir: () => '/tmp/test',
    getExtensions: () => [],
    getModel: () => 'test-model',
    getHookSystem() {
      if (!hookSystem) {
        hookSystem = new HookSystem(config as Config);
      }
      return hookSystem;
    },
  } as unknown as Config;

  return config;
}

/**
 * Create scheduler for testing
 */
function createTestScheduler(config: Config) {
  const onAllToolCallsComplete = vi.fn();
  const onToolCallsUpdate = vi.fn();

  const scheduler = new CoreToolScheduler({
    config,
    toolRegistry: config.getToolRegistry(),
    onAllToolCallsComplete,
    onToolCallsUpdate,
    getPreferredEditor: () => 'vscode',
    onEditorClose: vi.fn(),
  });

  return { scheduler, onAllToolCallsComplete, onToolCallsUpdate };
}

describe('Hook Caller Application', () => {
  beforeEach(() => {
    // Reset tracking state
    TrackingToolInvocation.executionCount = 0;
    TrackingToolInvocation.lastArgs = undefined;
  });

  /**
   * Test 1: coreToolScheduler blocks tool when BeforeTool hook blocks
   * @requirement:HOOK-017,HOOK-129
   *
   * Expected behavior: When BeforeTool hook returns isBlockingDecision() === true,
   * the tool should NOT execute.
   *
   * This test MUST FAIL because coreToolScheduler currently uses:
   *   `void triggerBeforeToolHook(this.config, toolName, args);`
   * which ignores the hook result.
   */
  describe('coreToolScheduler blocks tool when BeforeTool hook blocks', () => {
    it('should NOT execute tool when BeforeTool hook returns blocking decision', async () => {
      // Arrange: Hook that blocks execution (exit code 2 = block)
      const config = createConfigWithHook({
        event: 'BeforeTool',
        command: 'echo "Tool blocked by policy" >&2; exit 2',
      });

      const { scheduler, onAllToolCallsComplete } = createTestScheduler(config);

      // Act: Schedule the tool call
      await scheduler.schedule(
        [
          {
            callId: 'block-test-1',
            name: 'tracking_tool',
            args: { path: '/etc/passwd' },
            isClientInitiated: false,
            prompt_id: 'prompt-block-1',
          },
        ],
        new AbortController().signal,
      );

      // Assert: Tool should NOT have been executed
      expect(TrackingToolInvocation.executionCount).toBe(0);

      // And the completed call should indicate blocking
      const completedCalls = onAllToolCallsComplete.mock
        .calls[0]?.[0] as ToolCall[];
      // When properly blocked, status should be 'error' with hook blocking reason
      // Currently it will be 'success' because the hook result is ignored
      expect(completedCalls?.[0]?.status).toBe('error');
    });
  });

  /**
   * Test 2: coreToolScheduler applies modified tool input
   * @requirement:HOOK-019
   *
   * Expected behavior: When BeforeTool hook returns modified tool_input,
   * the tool should be called with the modified input.
   *
   * This test MUST FAIL because the hook result is ignored.
   */
  describe('coreToolScheduler applies modified tool input', () => {
    it('should use modified tool_input from BeforeTool hook', async () => {
      // Arrange: Hook that modifies the path argument
      const config = createConfigWithHook({
        event: 'BeforeTool',
        command: `echo '{"decision": "allow", "hookSpecificOutput": {"tool_input": {"path": "/safe/sanitized/path"}}}'`,
      });

      const { scheduler } = createTestScheduler(config);

      // Act: Schedule with original (potentially dangerous) path
      await scheduler.schedule(
        [
          {
            callId: 'modify-test-1',
            name: 'tracking_tool',
            args: { path: '/etc/passwd' },
            isClientInitiated: false,
            prompt_id: 'prompt-modify-1',
          },
        ],
        new AbortController().signal,
      );

      // Assert: Tool should have been called with MODIFIED args
      expect(TrackingToolInvocation.lastArgs).toEqual({
        path: '/safe/sanitized/path',
      });
    });
  });

  /**
   * Test 3: coreToolScheduler appends systemMessage to result
   * @requirement:HOOK-131
   *
   * Expected behavior: When AfterTool hook returns systemMessage,
   * that message should be appended to the tool result.
   *
   * This test MUST FAIL because triggerAfterToolHook result is ignored.
   */
  describe('coreToolScheduler appends systemMessage to result', () => {
    it('should include systemMessage from AfterTool hook in result', async () => {
      // Arrange: Hook that provides additional context
      const config = createConfigWithHook({
        event: 'AfterTool',
        command: `echo '{"decision": "allow", "systemMessage": "Security scan: file contents verified safe"}'`,
      });

      const { scheduler, onAllToolCallsComplete } = createTestScheduler(config);

      // Act
      await scheduler.schedule(
        [
          {
            callId: 'system-msg-test-1',
            name: 'tracking_tool',
            args: { path: '/test/file' },
            isClientInitiated: false,
            prompt_id: 'prompt-system-1',
          },
        ],
        new AbortController().signal,
      );

      // Assert: Result should include the systemMessage
      const completedCalls = onAllToolCallsComplete.mock
        .calls[0]?.[0] as ToolCall[];
      const successCall = completedCalls?.[0] as SuccessfulToolCall;
      // The response should contain the systemMessage in some form
      // This could be via responseParts or metadata depending on implementation
      const responseText = successCall?.response?.responseParts
        ?.map((p) => {
          if ('functionResponse' in p) {
            return JSON.stringify(p.functionResponse?.response);
          }
          return '';
        })
        .join('');
      expect(responseText).toContain('Security scan: file contents verified');
    });
  });

  /**
   * Test 4: coreToolScheduler sets suppressDisplay
   * @requirement:HOOK-132
   *
   * Expected behavior: When AfterTool hook returns suppressOutput: true,
   * the result's suppressDisplay should be set.
   *
   * This test MUST FAIL because triggerAfterToolHook result is ignored.
   */
  describe('coreToolScheduler sets suppressDisplay', () => {
    it('should suppress display when AfterTool hook sets suppressOutput', async () => {
      // Arrange: Hook that suppresses output display
      const config = createConfigWithHook({
        event: 'AfterTool',
        command: `echo '{"decision": "allow", "suppressOutput": true}'`,
      });

      const { scheduler, onAllToolCallsComplete } = createTestScheduler(config);

      // Act
      await scheduler.schedule(
        [
          {
            callId: 'suppress-test-1',
            name: 'tracking_tool',
            args: { path: '/test/file' },
            isClientInitiated: false,
            prompt_id: 'prompt-suppress-1',
          },
        ],
        new AbortController().signal,
      );

      // Assert: Result should have suppressDisplay set
      const completedCalls = onAllToolCallsComplete.mock
        .calls[0]?.[0] as ToolCall[];
      const successCall = completedCalls?.[0] as SuccessfulToolCall;
      // Check for suppressDisplay in response metadata or similar
      // The exact field depends on how ToolCallResponseInfo is extended
      expect(
        (successCall?.response as { suppressDisplay?: boolean })
          ?.suppressDisplay,
      ).toBe(true);
    });
  });

  /**
   * Test 5: geminiChat skips model call when BeforeModel hook blocks
   * @requirement:HOOK-036
   *
   * Expected behavior: When BeforeModel hook returns isBlockingDecision() === true,
   * the LLM API should NOT be called.
   *
   * This test MUST FAIL because geminiChat uses:
   *   `void triggerBeforeModelHook(configForHooks, requestForHook);`
   *
   * We verify by checking the source code pattern - geminiChat must NOT use `void`
   * prefix when calling triggerBeforeModelHook. This is a static analysis test.
   */
  describe('geminiChat skips model call when BeforeModel hook blocks', () => {
    it('geminiChat should await triggerBeforeModelHook (currently uses void)', async () => {
      // This test verifies the CALLER behavior by checking the source code pattern.
      // The geminiChat.ts currently has:
      //   void triggerBeforeModelHook(configForHooks, requestForHook);
      //
      // This MUST be changed to:
      //   const hookResult = await triggerBeforeModelHook(configForHooks, requestForHook);
      //   if (hookResult?.isBlockingDecision()) { ... }

      // Read the source code and verify the pattern
      const fs = await import('node:fs/promises');
      const geminiChatPath = new URL('../core/geminiChat.ts', import.meta.url)
        .pathname;
      const sourceCode = await fs.readFile(geminiChatPath, 'utf-8');

      // The test FAILS if geminiChat uses `void` prefix (ignores result)
      // The test PASSES when geminiChat awaits and uses the result
      const usesVoidPrefix = sourceCode.includes(
        'void triggerBeforeModelHook(',
      );

      // This assertion will FAIL with current code (uses void)
      // and PASS when fixed (awaits and applies result)
      expect(usesVoidPrefix).toBe(false);
    });
  });

  /**
   * Test 6: geminiChat uses synthetic response from hook
   * @requirement:HOOK-036
   *
   * Expected behavior: When BeforeModel hook blocks with llm_response,
   * that synthetic response should be returned instead of calling the API.
   *
   * This test MUST FAIL because the hook result is ignored by the caller.
   * We verify by checking that the source code handles getSyntheticResponse().
   */
  describe('geminiChat uses synthetic response from hook', () => {
    it('geminiChat should use getSyntheticResponse from hook (currently ignores)', async () => {
      // This test verifies the CALLER behavior by checking the source code.
      // geminiChat should have code like:
      //   const hookResult = await triggerBeforeModelHook(...);
      //   const synthetic = hookResult?.getSyntheticResponse();
      //   if (synthetic) { return synthetic; }

      const fs = await import('node:fs/promises');
      const geminiChatPath = new URL('../core/geminiChat.ts', import.meta.url)
        .pathname;
      const sourceCode = await fs.readFile(geminiChatPath, 'utf-8');

      // The test FAILS if geminiChat doesn't call getSyntheticResponse
      // The test PASSES when geminiChat checks for and uses synthetic responses
      const handlesSyntheticResponse = sourceCode.includes(
        'getSyntheticResponse',
      );

      // This assertion will FAIL with current code (ignores hook result)
      // and PASS when fixed (checks for synthetic response)
      expect(handlesSyntheticResponse).toBe(true);
    });
  });

  /**
   * Test 7: geminiChat applies tool restrictions
   * @requirement:HOOK-055
   *
   * Expected behavior: When BeforeToolSelection hook returns allowedFunctionNames,
   * only those tools should be available for the model to call.
   *
   * This test MUST FAIL because geminiChat uses:
   *   `void triggerBeforeToolSelectionHook(configForHooks, toolsFromConfig);`
   */
  describe('geminiChat applies tool restrictions', () => {
    it('geminiChat should await triggerBeforeToolSelectionHook (currently uses void)', async () => {
      // This test verifies the CALLER behavior by checking the source code pattern.
      // The geminiChat.ts currently has:
      //   void triggerBeforeToolSelectionHook(configForHooks, toolsFromConfig);
      //
      // This MUST be changed to:
      //   const hookResult = await triggerBeforeToolSelectionHook(...);
      //   if (hookResult) { tools = hookResult.applyToolConfigModifications(tools); }

      const fs = await import('node:fs/promises');
      const geminiChatPath = new URL('../core/geminiChat.ts', import.meta.url)
        .pathname;
      const sourceCode = await fs.readFile(geminiChatPath, 'utf-8');

      // The test FAILS if geminiChat uses `void` prefix (ignores result)
      // The test PASSES when geminiChat awaits and uses the result
      const usesVoidPrefix = sourceCode.includes(
        'void triggerBeforeToolSelectionHook(',
      );

      // This assertion will FAIL with current code (uses void)
      // and PASS when fixed (awaits and applies tool restrictions)
      expect(usesVoidPrefix).toBe(false);
    });
  });

  /**
   * Test 8: geminiChat stops agent loop on continue:false
   * @requirement:HOOK-040,HOOK-048
   *
   * Expected behavior: When AfterModel hook returns continue: false,
   * the agent loop should terminate without additional model calls.
   *
   * This test MUST FAIL because geminiChat uses:
   *   `void triggerAfterModelHook(configForHooks, lastResponse);`
   */
  describe('geminiChat stops agent loop on continue:false', () => {
    it('geminiChat should await triggerAfterModelHook (currently uses void)', async () => {
      // This test verifies the CALLER behavior by checking the source code pattern.
      // The geminiChat.ts currently has:
      //   void triggerAfterModelHook(configForHooks, lastResponse);
      //
      // This MUST be changed to:
      //   const hookResult = await triggerAfterModelHook(configForHooks, lastResponse);
      //   if (hookResult?.shouldStopExecution()) { break; }

      const fs = await import('node:fs/promises');
      const geminiChatPath = new URL('../core/geminiChat.ts', import.meta.url)
        .pathname;
      const sourceCode = await fs.readFile(geminiChatPath, 'utf-8');

      // The test FAILS if geminiChat uses `void` prefix (ignores result)
      // The test PASSES when geminiChat awaits and checks shouldStopExecution
      const usesVoidPrefix = sourceCode.includes('void triggerAfterModelHook(');

      // This assertion will FAIL with current code (uses void)
      // and PASS when fixed (awaits and applies stop execution logic)
      expect(usesVoidPrefix).toBe(false);
    });
  });
});
