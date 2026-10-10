/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { installSchedulerToolFixture } from './__tests__/scheduler-tool-owner-fixture.js';

import { describe, it, expect, vi } from 'bun:test';
import { CoreToolScheduler } from './coreToolScheduler.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type {
  ContextAwareTool,
  ToolContext,
} from '@vybestack/llxprt-code-tools';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';

describe('CoreToolScheduler context-aware tools', () => {
  const fixtureRoot = installSchedulerToolFixture();
  it('injects agentId into ContextAwareTool context', async () => {
    class ContextAwareMockTool extends MockTool implements ContextAwareTool {
      context?: ToolContext;

      constructor(name: string) {
        super(name);
      }
    }

    const contextAwareTool = new ContextAwareMockTool('context-tool');
    contextAwareTool.executeFn.mockResolvedValue({
      llmContent: 'ok',
      returnDisplay: 'ok',
    });

    const fixture = fixtureRoot([contextAwareTool], {
      sessionId: 'session-123',
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
      onAllToolCallsComplete: vi.fn(),
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    const abortController = new AbortController();
    const request = {
      callId: 'ctx-1',
      name: 'context-tool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-ctx',
      agentId: 'agent-sub-42',
    };

    await scheduler.schedule([request], abortController.signal);

    expect(contextAwareTool.context).toStrictEqual({
      sessionId: 'session-123',
      agentId: 'agent-sub-42',
      interactiveMode: true,
    });
  });
});
