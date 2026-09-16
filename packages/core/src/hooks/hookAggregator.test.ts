/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P15,P16,P17
 * @requirement:HOOK-092,HOOK-093,HOOK-094,HOOK-095,HOOK-096,HOOK-097,HOOK-098,HOOK-099,HOOK-100,HOOK-101,HOOK-102,HOOK-103,HOOK-104,HOOK-105
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { HookAggregator } from './hookAggregator.js';
import type {
  HookExecutionResult,
  BeforeToolSelectionOutput,
  BeforeModelOutput,
  HookOutput,
} from './types.js';
import { HookType, HookEventName } from './types.js';

// Helper function to create proper HookExecutionResult objects
function createHookExecutionResult(
  output?: HookOutput,
  success = true,
  duration = 100,
  error?: Error,
): HookExecutionResult {
  return {
    success,
    output,
    duration,
    error,
    hookConfig: {
      type: HookType.Command,
      command: 'test-command',
      timeout: 30000,
    },
    eventName: HookEventName.BeforeTool,
  };
}

describe('HookAggregator', () => {
  let aggregator: HookAggregator;

  beforeEach(() => {
    aggregator = new HookAggregator();
  });

  describe('aggregateResults', () => {
    it('should handle empty results', () => {
      const results: HookExecutionResult[] = [];

      const aggregated = aggregator.aggregateResults(
        results,
        HookEventName.BeforeTool,
      );

      expect(aggregated.success).toBe(true);
      expect(aggregated.allOutputs).toHaveLength(0);
      expect(aggregated.errors).toHaveLength(0);
      expect(aggregated.totalDuration).toBe(0);
      expect(aggregated.finalOutput).toBeUndefined();
    });

    it('should aggregate successful results', () => {
      const results: HookExecutionResult[] = [
        createHookExecutionResult(
          { decision: 'allow', reason: 'Hook 1 approved' },
          true,
          100,
        ),
        createHookExecutionResult(
          { decision: 'allow', reason: 'Hook 2 approved' },
          true,
          150,
        ),
      ];

      const aggregated = aggregator.aggregateResults(
        results,
        HookEventName.BeforeTool,
      );

      expect(aggregated.success).toBe(true);
      expect(aggregated.allOutputs).toHaveLength(2);
      expect(aggregated.errors).toHaveLength(0);
      expect(aggregated.totalDuration).toBe(250);
      expect(aggregated.finalOutput?.decision).toBe('allow');
      expect(aggregated.finalOutput?.reason).toBe(
        'Hook 1 approved\nHook 2 approved',
      );
    });

    it('should handle errors in results', () => {
      const results: HookExecutionResult[] = [
        {
          hookConfig: {
            type: HookType.Command,
            command: 'test-command',
            timeout: 30000,
          },
          eventName: HookEventName.BeforeTool,
          success: false,
          error: new Error('Hook failed'),
          duration: 50,
        },
        {
          hookConfig: {
            type: HookType.Command,
            command: 'test-command',
            timeout: 30000,
          },
          eventName: HookEventName.BeforeTool,
          success: true,
          output: { decision: 'allow' },
          duration: 100,
        },
      ];

      const aggregated = aggregator.aggregateResults(
        results,
        HookEventName.BeforeTool,
      );

      expect(aggregated.success).toBe(false);
      expect(aggregated.allOutputs).toHaveLength(1);
      expect(aggregated.errors).toHaveLength(1);
      expect(aggregated.errors[0].message).toBe('Hook failed');
      expect(aggregated.totalDuration).toBe(150);
    });

    it('should report failure when a hook result has success=false without an explicit error', () => {
      const results: HookExecutionResult[] = [
        {
          hookConfig: {
            type: HookType.Command,
            command: 'test-command',
            timeout: 30000,
          },
          eventName: HookEventName.BeforeTool,
          success: false,
          duration: 75,
        },
        {
          hookConfig: {
            type: HookType.Command,
            command: 'test-command',
            timeout: 30000,
          },
          eventName: HookEventName.BeforeTool,
          success: true,
          output: { decision: 'allow' },
          duration: 25,
        },
      ];

      const aggregated = aggregator.aggregateResults(
        results,
        HookEventName.BeforeTool,
      );

      expect(aggregated.success).toBe(false);
      expect(aggregated.errors).toHaveLength(0);
      expect(aggregated.allOutputs).toHaveLength(1);
      expect(aggregated.totalDuration).toBe(100);
    });

    it('should handle blocking decisions with OR logic', () => {
      const results: HookExecutionResult[] = [
        {
          hookConfig: {
            type: HookType.Command,
            command: 'test-command',
            timeout: 30000,
          },
          eventName: HookEventName.BeforeTool,
          success: true,
          output: { decision: 'allow', reason: 'Hook 1 allowed' },
          duration: 100,
        },
        {
          hookConfig: {
            type: HookType.Command,
            command: 'test-command',
            timeout: 30000,
          },
          eventName: HookEventName.BeforeTool,
          success: true,
          output: { decision: 'block', reason: 'Hook 2 blocked' },
          duration: 150,
        },
      ];

      const aggregated = aggregator.aggregateResults(
        results,
        HookEventName.BeforeTool,
      );

      expect(aggregated.success).toBe(true);
      expect(aggregated.finalOutput?.decision).toBe('block');
      expect(aggregated.finalOutput?.reason).toBe(
        'Hook 1 allowed\nHook 2 blocked',
      );
    });

    it('should handle continue=false with precedence', () => {
      const results: HookExecutionResult[] = [
        {
          hookConfig: {
            type: HookType.Command,
            command: 'test-command',
            timeout: 30000,
          },
          eventName: HookEventName.BeforeTool,
          success: true,
          output: { decision: 'allow', continue: true },
          duration: 100,
        },
        {
          hookConfig: {
            type: HookType.Command,
            command: 'test-command',
            timeout: 30000,
          },
          eventName: HookEventName.BeforeTool,
          success: true,
          output: {
            decision: 'allow',
            continue: false,
            stopReason: 'Stop requested',
          },
          duration: 150,
        },
      ];

      const aggregated = aggregator.aggregateResults(
        results,
        HookEventName.BeforeTool,
      );

      expect(aggregated.success).toBe(true);
      expect(aggregated.finalOutput?.continue).toBe(false);
      expect(aggregated.finalOutput?.stopReason).toBe('Stop requested');
    });
  });

  describe('BeforeToolSelection merge strategy', () => {
    const toolChoiceResult = (
      ...toolChoices: Array<
        BeforeToolSelectionOutput['hookSpecificOutput']['toolChoice']
      >
    ): HookExecutionResult[] =>
      toolChoices.map((toolChoice) =>
        createHookExecutionResult({
          hookSpecificOutput: {
            hookEventName: 'BeforeToolSelection',
            toolChoice,
          },
        } as BeforeToolSelectionOutput),
      );

    it('none mode wins over required and intersects allowedToolNames', () => {
      const aggregated = aggregator.aggregateResults(
        toolChoiceResult(
          { mode: 'required', allowedToolNames: ['read_file', 'write_file'] },
          { mode: 'none', allowedToolNames: ['read_file', 'bash'] },
        ),
        HookEventName.BeforeToolSelection,
      );

      expect(aggregated.success).toBe(true);
      const output = aggregated.finalOutput as BeforeToolSelectionOutput;
      expect(output.hookSpecificOutput?.toolChoice?.mode).toBe('none');
      expect(
        output.hookSpecificOutput?.toolChoice?.allowedToolNames,
      ).toStrictEqual(['read_file']);
    });

    it('required mode wins over auto when no hook chose none', () => {
      const aggregated = aggregator.aggregateResults(
        toolChoiceResult({ mode: 'auto' }, { mode: 'required' }),
        HookEventName.BeforeToolSelection,
      );

      const output = aggregated.finalOutput as BeforeToolSelectionOutput;
      expect(output.hookSpecificOutput?.toolChoice?.mode).toBe('required');
    });

    it('auto mode when every hook chose auto; disjoint allowlists intersect to empty', () => {
      const aggregated = aggregator.aggregateResults(
        toolChoiceResult(
          { mode: 'auto', allowedToolNames: ['read_file'] },
          { mode: 'auto', allowedToolNames: ['write_file'] },
        ),
        HookEventName.BeforeToolSelection,
      );

      const output = aggregated.finalOutput as BeforeToolSelectionOutput;
      expect(output.hookSpecificOutput?.toolChoice?.mode).toBe('auto');
      expect(
        output.hookSpecificOutput?.toolChoice?.allowedToolNames,
      ).toStrictEqual([]);
    });

    it('omitted allowedToolNames stays unrestricted even when another hook supplied a list', () => {
      const aggregated = aggregator.aggregateResults(
        toolChoiceResult(
          { mode: 'auto' },
          { mode: 'auto', allowedToolNames: ['read_file'] },
        ),
        HookEventName.BeforeToolSelection,
      );

      const output = aggregated.finalOutput as BeforeToolSelectionOutput;
      expect(output.hookSpecificOutput?.toolChoice?.mode).toBe('auto');
      expect(
        output.hookSpecificOutput?.toolChoice?.allowedToolNames,
      ).toStrictEqual(['read_file']);
    });

    it('preserves an explicit empty allowedToolNames list as most restrictive', () => {
      const aggregated = aggregator.aggregateResults(
        toolChoiceResult(
          { mode: 'required', allowedToolNames: [] },
          { mode: 'required', allowedToolNames: ['read_file'] },
        ),
        HookEventName.BeforeToolSelection,
      );

      const output = aggregated.finalOutput as BeforeToolSelectionOutput;
      expect(
        output.hookSpecificOutput?.toolChoice?.allowedToolNames,
      ).toStrictEqual([]);
    });

    it('canonicalizes and sorts the intersected allowlist for deterministic output', () => {
      const aggregated = aggregator.aggregateResults(
        toolChoiceResult(
          {
            mode: 'required',
            allowedToolNames: ['write_file', 'READ_FILE'],
          },
          {
            mode: 'required',
            allowedToolNames: ['read_file', 'bash'],
          },
        ),
        HookEventName.BeforeToolSelection,
      );

      const output = aggregated.finalOutput as BeforeToolSelectionOutput;
      expect(
        output.hookSpecificOutput?.toolChoice?.allowedToolNames,
      ).toStrictEqual(['read_file']);
    });

    it('produces auto mode when no hook supplied a toolChoice', () => {
      const aggregated = aggregator.aggregateResults(
        toolChoiceResult(undefined, undefined),
        HookEventName.BeforeToolSelection,
      );

      const output = aggregated.finalOutput as BeforeToolSelectionOutput;
      expect(output.hookSpecificOutput?.toolChoice?.mode).toBe('auto');
    });
  });
  describe('BeforeModel/AfterModel merge strategy', () => {
    it('should use field replacement strategy', () => {
      const results: HookExecutionResult[] = [
        {
          hookConfig: {
            type: HookType.Command,
            command: 'test-command',
            timeout: 30000,
          },
          eventName: HookEventName.BeforeModel,
          success: true,
          output: {
            decision: 'allow',
            hookSpecificOutput: {
              hookEventName: 'BeforeModel',
              llm_request: { model: 'model1', config: {}, contents: [] },
            },
          },
          duration: 100,
        },
        {
          hookConfig: {
            type: HookType.Command,
            command: 'test-command',
            timeout: 30000,
          },
          eventName: HookEventName.BeforeModel,
          success: true,
          output: {
            decision: 'block',
            hookSpecificOutput: {
              hookEventName: 'BeforeModel',
              llm_request: { model: 'model2', config: {}, contents: [] },
            },
          },
          duration: 150,
        },
      ];

      const aggregated = aggregator.aggregateResults(
        results,
        HookEventName.BeforeModel,
      );

      expect(aggregated.success).toBe(true);
      expect(aggregated.finalOutput?.decision).toBe('block'); // Later value wins
      const output = aggregated.finalOutput as BeforeModelOutput;
      const llmRequest = output.hookSpecificOutput?.llm_request;
      expect(llmRequest?.['model']).toBe('model2'); // Later value wins
    });
  });

  describe('extractAdditionalContext', () => {
    it('should extract additional context from hook outputs', () => {
      const results: HookExecutionResult[] = [
        {
          hookConfig: {
            type: HookType.Command,
            command: 'test-command',
            timeout: 30000,
          },
          eventName: HookEventName.AfterTool,
          success: true,
          output: {
            hookSpecificOutput: {
              hookEventName: 'AfterTool',
              additionalContext: 'Context from hook 1',
            },
          },
          duration: 100,
        },
        {
          hookConfig: {
            type: HookType.Command,
            command: 'test-command',
            timeout: 30000,
          },
          eventName: HookEventName.AfterTool,
          success: true,
          output: {
            hookSpecificOutput: {
              hookEventName: 'AfterTool',
              additionalContext: 'Context from hook 2',
            },
          },
          duration: 150,
        },
      ];

      const aggregated = aggregator.aggregateResults(
        results,
        HookEventName.AfterTool,
      );

      expect(aggregated.success).toBe(true);
      expect(
        aggregated.finalOutput?.hookSpecificOutput?.['additionalContext'],
      ).toBe('Context from hook 1\nContext from hook 2');
    });
  });
});
