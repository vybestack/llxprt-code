/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { installSchedulerToolFixture } from './__tests__/scheduler-tool-owner-fixture.js';

import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi } from 'bun:test';
import type { ToolCall, CompletedToolCall } from './coreToolScheduler.js';
import { CoreToolScheduler } from './coreToolScheduler.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';

describe('CoreToolScheduler YOLO mode', () => {
  const fixtureRoot = installSchedulerToolFixture();
  it('should execute tool requiring confirmation directly without waiting', async () => {
    // Arrange
    const mockTool = new MockTool({ name: 'mockTool' });
    mockTool.executeFn.mockResolvedValue({
      llmContent: 'Tool executed',
      returnDisplay: 'Tool executed',
    });
    // This tool would normally require confirmation.
    mockTool.shouldConfirm = true;

    const onAllToolCallsComplete = vi
      .fn<(calls: CompletedToolCall[]) => Promise<void>>()
      .mockResolvedValue(undefined);
    const onToolCallsUpdate = vi.fn();

    // Configure the scheduler for YOLO mode.
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
      onAllToolCallsComplete,
      onToolCallsUpdate,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request = {
      callId: '1',
      name: 'mockTool',
      args: { param: 'value' },
      isClientInitiated: false,
      prompt_id: 'prompt-id-yolo',
    };

    // Act
    await scheduler.schedule([request], abortController.signal);
    await waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });

    // Assert
    // 1. The tool's execute method was called directly.
    const executeCall =
      mockTool.executeFn.mock.calls[mockTool.executeFn.mock.calls.length - 1];
    expect(executeCall[0]).toStrictEqual({ param: 'value' });
    expect(executeCall[1]).toBeInstanceOf(AbortSignal);

    // 2. The tool call status never entered 'awaiting_approval'.
    const statusUpdates = onToolCallsUpdate.mock.calls
      .flatMap((call) => (call[0] as ToolCall[]).map(({ status }) => status))
      .filter(Boolean);
    expect(statusUpdates).not.toContain('awaiting_approval');
    expect(statusUpdates).toStrictEqual([
      'validating',
      'scheduled',
      'executing',
      'success',
    ]);

    // 3. The final callback indicates the tool call was successful.
    expect(onAllToolCallsComplete).toHaveBeenCalled();
    const completedCalls = onAllToolCallsComplete.mock.calls[0][0];
    expect(completedCalls).toHaveLength(1);
    const completedCall = completedCalls[0];
    expect(completedCall.status).toBe('success');
    expect(completedCall.response.resultDisplay).toBe('Tool executed');
  });
});
