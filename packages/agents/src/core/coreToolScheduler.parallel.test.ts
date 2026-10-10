/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { installSchedulerToolFixture } from './__tests__/scheduler-tool-owner-fixture.js';

import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi } from 'bun:test';
import { CoreToolScheduler } from './coreToolScheduler.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';

describe('CoreToolScheduler Buffered Parallel Execution', () => {
  const fixtureRoot = installSchedulerToolFixture();
  it('should execute tool calls in parallel but publish results in order', async () => {
    const completionOrder: number[] = [];
    const publishOrder: number[] = [];

    const executeFn = vi
      .fn()
      .mockImplementation(async (args: { call: number }) => {
        // Tool 1 takes longest (100ms)
        if (args.call === 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          completionOrder.push(1);
          return { llmContent: 'First call done' };
        }
        // Tool 2 completes first (20ms)
        if (args.call === 2) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          completionOrder.push(2);
          return { llmContent: 'Second call done' };
        }
        // Tool 3 completes second (50ms)
        if (args.call === 3) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          completionOrder.push(3);
          return { llmContent: 'Third call done' };
        }
        return { llmContent: 'default' };
      });

    const mockTool = new MockTool({ name: 'mockTool', execute: executeFn });

    const onToolCallsUpdate = vi.fn();

    const fixture = fixtureRoot([mockTool], {
      sessionId: 'test-session-id',
      approvalMode: ApprovalMode.YOLO,
      interactive: false,
    });

    const scheduler = new CoreToolScheduler({
      config: fixture.config,
      telemetry: fixture.settingsOwner.telemetry,
      readExecutionPolicy: () =>
        fixture.settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        fixture.settingsOwner.readToolGovernance(
          fixture.config.getExcludeTools() ?? [],
        ),
      messageBus: fixture.messageBus,
      toolRegistry: fixture.selection,
      onAllToolCallsComplete: vi.fn(),
      onToolCallsUpdate: (calls) => {
        onToolCallsUpdate(calls);
        calls.forEach((call) => {
          if (call.status === 'success') {
            const callNum = (call.request.args as { call: number }).call;
            if (!publishOrder.includes(callNum)) {
              publishOrder.push(callNum);
            }
          }
        });
      },
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const signal = new AbortController().signal;

    // Schedule 3 tool calls
    await scheduler.schedule(
      [
        {
          callId: 'call1',
          name: 'mockTool',
          args: { call: 1 },
          isClientInitiated: false,
          prompt_id: 'test',
        },
        {
          callId: 'call2',
          name: 'mockTool',
          args: { call: 2 },
          isClientInitiated: false,
          prompt_id: 'test',
        },
        {
          callId: 'call3',
          name: 'mockTool',
          args: { call: 3 },
          isClientInitiated: false,
          prompt_id: 'test',
        },
      ],
      signal,
    );

    // Wait for all calls to complete
    await waitFor(() => {
      expect(completionOrder.length).toBe(3);
      expect(publishOrder.length).toBe(3);
    });

    // Verify parallel execution (completion order != request order)
    expect(completionOrder).toStrictEqual([2, 3, 1]); // Fastest to slowest

    // Verify ordered publishing (publish order == request order)
    expect(publishOrder).toStrictEqual([1, 2, 3]); // Request order maintained
  });

  it('should handle errors in parallel execution without blocking subsequent results', async () => {
    const completionOrder: number[] = [];
    const publishOrder: number[] = [];

    const executeFn = vi
      .fn()
      .mockImplementation(async (args: { call: number }) => {
        if (args.call === 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          completionOrder.push(1);
          return { llmContent: 'First call done' };
        }
        if (args.call === 2) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          completionOrder.push(2);
          throw new Error('Tool 2 failed');
        }
        if (args.call === 3) {
          await new Promise((resolve) => setTimeout(resolve, 30));
          completionOrder.push(3);
          return { llmContent: 'Third call done' };
        }
        return { llmContent: 'default' };
      });

    const mockTool = new MockTool({ name: 'mockTool', execute: executeFn });

    const onToolCallsUpdate = vi.fn();

    const fixture = fixtureRoot([mockTool], {
      sessionId: 'test-session-id',
      approvalMode: ApprovalMode.YOLO,
      interactive: false,
    });

    const scheduler = new CoreToolScheduler({
      config: fixture.config,
      telemetry: fixture.settingsOwner.telemetry,
      readExecutionPolicy: () =>
        fixture.settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        fixture.settingsOwner.readToolGovernance(
          fixture.config.getExcludeTools() ?? [],
        ),
      messageBus: fixture.messageBus,
      toolRegistry: fixture.selection,
      onAllToolCallsComplete: vi.fn(),
      onToolCallsUpdate: (calls) => {
        onToolCallsUpdate(calls);
        calls.forEach((call) => {
          if (call.status === 'success' || call.status === 'error') {
            const callNum = (call.request.args as { call: number }).call;
            if (!publishOrder.includes(callNum)) {
              publishOrder.push(callNum);
            }
          }
        });
      },
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const signal = new AbortController().signal;

    await scheduler.schedule(
      [
        {
          callId: 'call1',
          name: 'mockTool',
          args: { call: 1 },
          isClientInitiated: false,
          prompt_id: 'test',
        },
        {
          callId: 'call2',
          name: 'mockTool',
          args: { call: 2 },
          isClientInitiated: false,
          prompt_id: 'test',
        },
        {
          callId: 'call3',
          name: 'mockTool',
          args: { call: 3 },
          isClientInitiated: false,
          prompt_id: 'test',
        },
      ],
      signal,
    );

    // Wait for all calls to complete
    await waitFor(() => {
      expect(completionOrder.length).toBe(3);
      expect(publishOrder.length).toBe(3);
    });

    // Verify parallel execution
    expect(completionOrder).toStrictEqual([2, 3, 1]); // Fastest to slowest

    // Verify ordered publishing despite error in tool 2
    expect(publishOrder).toStrictEqual([1, 2, 3]); // Request order maintained
  });
});
