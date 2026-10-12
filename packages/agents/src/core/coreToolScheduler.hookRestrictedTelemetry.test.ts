/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'bun:test';

const __actual = {
  ...(await import('@vybestack/llxprt-code-core/telemetry/loggers.js')),
};
void vi.mock('@vybestack/llxprt-code-core/telemetry/loggers.js', () => {
  const result = __actual as
    | typeof import('@vybestack/llxprt-code-core/telemetry/loggers.js')
    | Promise<
        typeof import('@vybestack/llxprt-code-core/telemetry/loggers.js')
      >;
  if (result instanceof Promise) {
    return result.then((actual) => ({
      ...actual,
      logToolCall: vi.fn(),
    }));
  }
  return {
    ...result,
    logToolCall: vi.fn(),
  };
});

import { CoreToolScheduler } from './coreToolScheduler.js';
import { createSchedulerPolicyFixture } from './__tests__/scheduler-policy-fixture.js';
import { ApprovalMode } from '../index.js';
import { logToolCall } from '@vybestack/llxprt-code-core/telemetry/loggers.js';
import type { ToolRegistry } from '../index.js';
function createToolRegistry(): ToolRegistry {
  return {
    getTool: vi.fn().mockReturnValue(null),
    getAllToolNames: vi
      .fn()
      .mockReturnValue(['read_file', 'run_shell_command']),
    getFunctionDeclarations: vi.fn().mockReturnValue([]),
    getAllTools: vi.fn().mockReturnValue([]),
  } as unknown as ToolRegistry;
}

describe('CoreToolScheduler hook-restricted telemetry', () => {
  it('drops hook-restricted blocked calls before scheduler callbacks and telemetry', async () => {
    const onAllToolCallsComplete = vi.fn();
    const { config, settingsOwner, messageBus } = createSchedulerPolicyFixture({
      getSessionId: () => 'hook-restricted-session',
      getApprovalMode: () => ApprovalMode.YOLO,
      getEnableHooks: () => false,
      getModel: () => 'test-model',
      isInteractive: () => false,
    });
    const scheduler = new CoreToolScheduler({
      config,
      telemetry: settingsOwner.telemetry,
      readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () => settingsOwner.readToolGovernance([]),
      messageBus,
      toolRegistry: createToolRegistry(),
      onAllToolCallsComplete,
      getPreferredEditor: () => undefined,
      onEditorClose: vi.fn(),
      toolContextInteractiveMode: false,
    });

    await scheduler.schedule(
      [
        {
          callId: 'blocked-call',
          name: 'run_shell_command',
          args: { command: 'echo blocked' },
          isClientInitiated: false,
          prompt_id: 'prompt-id-1',
          hookRestrictedAllowedTools: ['read_file'],
        },
      ],
      new AbortController().signal,
    );

    expect(onAllToolCallsComplete).not.toHaveBeenCalled();
    expect(logToolCall).not.toHaveBeenCalled();
  });
});
