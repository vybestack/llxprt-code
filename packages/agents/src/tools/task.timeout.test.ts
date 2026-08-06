/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TaskTool timeout_seconds handling tests.
 * Sibling to task.test.ts (split to avoid file-level max-lines disable).
 */

import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from '../testApi.js';
import { TaskTool } from './task.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentOrchestrator } from '../core/subagentOrchestrator.js';
import {
  ContextState,
  SubagentTerminateMode,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';

describe('TaskTool', () => {
  let config: Config;

  beforeEach(() => {
    config = {
      getSessionId: () => 'session-123',
    } as unknown as Config;
  });

  describe('timeout_seconds handling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('uses default timeout when timeout_seconds is omitted', async () => {
      const dispose = vi.fn().mockResolvedValue(undefined);
      const scope = {
        output: {
          emitted_vars: {},
          terminate_reason: SubagentTerminateMode.GOAL,
        },
        runInteractive: vi.fn().mockResolvedValue(undefined),
        runNonInteractive: vi.fn(),
        onMessage: undefined,
      };
      const launch = vi.fn().mockResolvedValue({
        agentId: 'agent-default',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      const configWithSettings = {
        ...config,
        getEphemeralSettings: () => ({
          'task-default-timeout-seconds': 60,
          'task-max-timeout-seconds': 120,
        }),
      } as unknown as Config;
      const tool = new TaskTool(configWithSettings, {
        orchestratorFactory: () => orchestrator,
      });

      const invocation = tool.build({
        subagent_name: 'helper',
        goal_prompt: 'Ship it',
      });

      const resultPromise = invocation.execute(
        new AbortController().signal,
        undefined,
      );

      await advanceTimersByTimeAsync(0);

      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          runConfig: expect.objectContaining({
            max_time_minutes: 1,
          }),
        }),
        expect.any(AbortSignal),
      );

      await resultPromise;
    });

    it('clamps timeout_seconds to max setting', async () => {
      const dispose = vi.fn().mockResolvedValue(undefined);
      const scope = {
        output: {
          emitted_vars: {},
          terminate_reason: SubagentTerminateMode.GOAL,
        },
        runInteractive: vi.fn().mockResolvedValue(undefined),
        runNonInteractive: vi.fn(),
        onMessage: undefined,
      };
      const launch = vi.fn().mockResolvedValue({
        agentId: 'agent-max',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      const configWithSettings = {
        ...config,
        getEphemeralSettings: () => ({
          'task-default-timeout-seconds': 60,
          'task-max-timeout-seconds': 120,
        }),
      } as unknown as Config;

      const tool = new TaskTool(configWithSettings, {
        orchestratorFactory: () => orchestrator,
      });

      const invocation = tool.build({
        subagent_name: 'helper',
        goal_prompt: 'Ship it',
        timeout_seconds: 999999,
      });

      const resultPromise = invocation.execute(
        new AbortController().signal,
        undefined,
      );

      await advanceTimersByTimeAsync(0);

      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          runConfig: expect.objectContaining({
            max_time_minutes: 2,
          }),
        }),
        expect.any(AbortSignal),
      );

      const result = await resultPromise;

      // Assert the clamp is actually surfaced in the result metadata and
      // model-facing content, not just in the launch arguments (Issue #3031).
      expect(result.metadata?.timeoutClamped).toBe(true);
      expect(result.metadata?.requestedTimeoutSeconds).toBe(999999);
      expect(result.metadata?.effectiveTimeoutSeconds).toBe(120);
      expect(String(result.llmContent)).toContain(
        'reduced to the configured ceiling of 120s',
      );
      expect(String(result.llmContent)).toContain('task-max-timeout-seconds');
    });

    it('clamps timeout_seconds: -1 to the configured maximum (Issue #3031)', async () => {
      const dispose = vi.fn().mockResolvedValue(undefined);
      const scope = {
        output: {
          emitted_vars: {},
          terminate_reason: SubagentTerminateMode.GOAL,
        },
        runInteractive: vi.fn().mockResolvedValue(undefined),
        runNonInteractive: vi.fn(),
        onMessage: undefined,
      };
      const launch = vi.fn().mockResolvedValue({
        agentId: 'agent-unlimited',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      const configWithSettings = {
        ...config,
        getEphemeralSettings: () => ({
          'task-default-timeout-seconds': 60,
          'task-max-timeout-seconds': 120,
        }),
      } as unknown as Config;
      const tool = new TaskTool(configWithSettings, {
        orchestratorFactory: () => orchestrator,
      });

      const invocation = tool.build({
        subagent_name: 'helper',
        goal_prompt: 'Ship it',
        timeout_seconds: -1,
      });

      const resultPromise = invocation.execute(
        new AbortController().signal,
        undefined,
      );

      await advanceTimersByTimeAsync(0);

      // -1 under a finite maximum is bounded by the ceiling (120s = 2min),
      // not unbounded (Issue #3031).
      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          runConfig: expect.objectContaining({
            max_time_minutes: 2,
          }),
        }),
        expect.any(AbortSignal),
      );

      await resultPromise;
    });

    it('skips the timer only when the maximum itself is -1 (Issue #3031)', async () => {
      const dispose = vi.fn().mockResolvedValue(undefined);
      const scope = {
        output: {
          emitted_vars: {},
          terminate_reason: SubagentTerminateMode.GOAL,
        },
        runInteractive: vi.fn().mockResolvedValue(undefined),
        runNonInteractive: vi.fn(),
        onMessage: undefined,
      };
      const launch = vi.fn().mockResolvedValue({
        agentId: 'agent-unbounded',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      const configWithSettings = {
        ...config,
        getEphemeralSettings: () => ({
          'task-default-timeout-seconds': 60,
          'task-max-timeout-seconds': -1,
        }),
      } as unknown as Config;
      const tool = new TaskTool(configWithSettings, {
        orchestratorFactory: () => orchestrator,
      });

      const invocation = tool.build({
        subagent_name: 'helper',
        goal_prompt: 'Ship it',
        timeout_seconds: -1,
      });

      const resultPromise = invocation.execute(
        new AbortController().signal,
        undefined,
      );

      await advanceTimersByTimeAsync(0);

      // Unbounded is reachable only when the operator declines a ceiling.
      expect(launch).toHaveBeenCalledWith(
        expect.not.objectContaining({ runConfig: expect.anything() }),
        expect.any(AbortSignal),
      );

      await resultPromise;
    });

    it('returns TIMEOUT error and partial output when timed out', async () => {
      const dispose = vi.fn().mockResolvedValue(undefined);

      // The key insight: runInteractive in real SubAgentScope creates its own AbortController
      // that listens for parent signals. When timeoutController.signal aborts, the subagent
      // should detect this and reject with AbortError. We simulate that here.

      let rejectPromise: ((error: Error) => void) | null = null;

      const scope = {
        output: {
          emitted_vars: {},
          terminate_reason: SubagentTerminateMode.GOAL,
        },
        cancel: vi.fn(),
        runInteractive: vi.fn(
          (_context: ContextState, _options?: unknown) =>
            new Promise((_resolve, reject) => {
              rejectPromise = reject;
            }),
        ),
        runNonInteractive: vi.fn(),
        onMessage: undefined,
      };
      const launch = vi.fn().mockResolvedValue({
        agentId: 'agent-timeout',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      const configWithSettings = {
        ...config,
        getEphemeralSettings: () => ({
          'task-default-timeout-seconds': 60,
          'task-max-timeout-seconds': 120,
        }),
      } as unknown as Config;
      const tool = new TaskTool(configWithSettings, {
        orchestratorFactory: () => orchestrator,
        isInteractiveEnvironment: () => true,
      });

      const invocation = tool.build({
        subagent_name: 'helper',
        goal_prompt: 'Ship it',
        timeout_seconds: 0.05, // 50ms
      });

      const resultPromise = invocation.execute(
        new AbortController().signal,
        undefined,
      );

      // Wait for runInteractive to be called
      await advanceTimersByTimeAsync(5);

      expect(scope.runInteractive).toHaveBeenCalled();

      // Now advance time past the timeout (50ms)
      await advanceTimersByTimeAsync(60);

      // The timeout should fire and the reject function we captured
      // simulates the subagent detecting the abort and rejecting
      expect(rejectPromise).toBeDefined();
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      rejectPromise?.(abortError);

      await expect(resultPromise).resolves.toMatchObject({
        error: { type: ToolErrorType.TIMEOUT },
      });
    });

    it('returns EXECUTION_FAILED for user aborts', async () => {
      const dispose = vi.fn().mockResolvedValue(undefined);
      const scope = {
        output: {
          emitted_vars: {},
          terminate_reason: SubagentTerminateMode.GOAL,
        },
        runInteractive: vi.fn().mockResolvedValue(undefined),
        runNonInteractive: vi.fn(),
        onMessage: undefined,
      };
      const launch = vi.fn().mockResolvedValue({
        agentId: 'agent-abort',
        scope,
        dispose,
        prompt: {} as unknown,
        profile: {} as unknown,
        config: {} as unknown,
        runtime: {} as unknown,
      });
      const orchestrator = { launch } as unknown as SubagentOrchestrator;
      const configWithSettings = {
        ...config,
        getEphemeralSettings: () => ({
          'task-default-timeout-seconds': 60,
          'task-max-timeout-seconds': 120,
        }),
      } as unknown as Config;
      const tool = new TaskTool(configWithSettings, {
        orchestratorFactory: () => orchestrator,
      });

      const abortController = new AbortController();
      abortController.abort();

      const invocation = tool.build({
        subagent_name: 'helper',
        goal_prompt: 'Ship it',
        timeout_seconds: 1,
      });

      const result = await invocation.execute(
        abortController.signal,
        undefined,
      );

      expect(result.error?.type).toBe(ToolErrorType.EXECUTION_FAILED);
      expect(result.error?.type).not.toBe(ToolErrorType.TIMEOUT);
    });
  });

  it('validates required parameters', () => {
    const tool = new TaskTool(config, {
      orchestratorFactory: () => {
        throw new Error('should not be called');
      },
    });

    expect(() => tool.build({ goal_prompt: 'Do work' })).toThrow(
      "params must have required property 'subagent_name'",
    );
    expect(() => tool.build({ subagent_name: 'helper' })).toThrow(
      "params must have required property 'goal_prompt'",
    );
  });
});
