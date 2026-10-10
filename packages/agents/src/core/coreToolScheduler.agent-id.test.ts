/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { installSchedulerToolFixture } from './__tests__/scheduler-tool-owner-fixture.js';

import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi } from 'bun:test';
import type { CompletedToolCall } from './coreToolScheduler.js';
import { CoreToolScheduler } from './coreToolScheduler.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';

describe('CoreToolScheduler agentId propagation', () => {
  const fixtureRoot = installSchedulerToolFixture();
  it('propagates agentId from request to completed call payloads', async () => {
    const mockTool = new MockTool('mockTool');
    mockTool.executeFn.mockResolvedValue({
      llmContent: 'Tool executed',
      returnDisplay: 'Tool executed',
    });

    const onAllToolCallsComplete = vi
      .fn<(calls: CompletedToolCall[]) => Promise<void>>()
      .mockResolvedValue(undefined);
    const onToolCallsUpdate = vi.fn();

    const fixture = fixtureRoot([mockTool], {
      sessionId: 'test-session-id',
      approvalMode: ApprovalMode.DEFAULT,
      interactive: true,
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
      callId: 'agent-call',
      name: 'mockTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-agent',
      agentId: 'agent-sub-123',
    };

    await scheduler.schedule([request], abortController.signal);

    await waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });

    const completedCalls = onAllToolCallsComplete.mock.calls[0][0];

    expect(completedCalls[0].request.agentId).toBe('agent-sub-123');
    expect(completedCalls[0].response.agentId).toBe('agent-sub-123');
  });

  it('prefers tool result metadata agentId when present', async () => {
    const mockTool = new MockTool('mockTool');
    mockTool.executeFn.mockResolvedValue({
      llmContent: 'Tool executed',
      returnDisplay: 'Tool executed',
      metadata: { agentId: 'agent-meta-456' },
    });

    const onAllToolCallsComplete = vi
      .fn<(calls: CompletedToolCall[]) => Promise<void>>()
      .mockResolvedValue(undefined);
    const fixture = fixtureRoot([mockTool], {
      sessionId: 'test-session-id',
      approvalMode: ApprovalMode.DEFAULT,
      interactive: true,
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
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request = {
      callId: 'agent-call-meta',
      name: 'mockTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-agent',
      agentId: 'agent-request-123',
    };

    await scheduler.schedule(request, abortController.signal);

    await waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });

    const lastCall = onAllToolCallsComplete.mock.lastCall;
    if (!lastCall) throw new Error('Missing completed tool calls');
    const [completedCalls] = lastCall;
    expect(completedCalls[0].status).toBe('success');
    expect(completedCalls[0].request.agentId).toBe('agent-request-123');
    expect(completedCalls[0].response.agentId).toBe('agent-meta-456');
  });

  it('defaults agentId when scheduler receives a request without one', async () => {
    const mockTool = new MockTool('mockTool');
    mockTool.executeFn.mockResolvedValue({
      llmContent: 'Tool executed',
      returnDisplay: 'Tool executed',
    });

    const onAllToolCallsComplete = vi
      .fn<(calls: CompletedToolCall[]) => Promise<void>>()
      .mockResolvedValue(undefined);
    const onToolCallsUpdate = vi.fn();

    const fixture = fixtureRoot([mockTool], {
      sessionId: 'test-session-id',
      approvalMode: ApprovalMode.DEFAULT,
      interactive: true,
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
    const requestWithoutAgent = {
      callId: 'no-agent-call',
      name: 'mockTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-default',
    };

    await scheduler.schedule([requestWithoutAgent], abortController.signal);

    await waitFor(() => {
      expect(onAllToolCallsComplete).toHaveBeenCalled();
    });

    const completedCalls = onAllToolCallsComplete.mock.calls[0][0];

    expect(completedCalls[0].request.agentId).toBe('primary');
    expect(completedCalls[0].response.agentId).toBe('primary');
  });
});
