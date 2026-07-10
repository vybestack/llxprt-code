/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../index.js')>();
  return {
    ...actual,
    logToolCall: vi.fn(),
  };
});

import { CoreToolScheduler } from './coreToolScheduler.js';
import { ApprovalMode, logToolCall } from '../index.js';
import type { Config, ToolRegistry } from '../index.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';

function createMessageBus(): MessageBus {
  return {
    subscribe: vi.fn().mockReturnValue(() => undefined),
    publish: vi.fn(),
    respondToConfirmation: vi.fn(),
    requestConfirmation: vi.fn(),
    removeAllListeners: vi.fn(),
    listenerCount: vi.fn().mockReturnValue(0),
  } as unknown as MessageBus;
}

function createConfig(): Config {
  return {
    getSessionId: () => 'hook-restricted-session',
    getUsageStatisticsEnabled: () => true,
    getDebugMode: () => false,
    getApprovalMode: () => ApprovalMode.YOLO,
    getEphemeralSettings: () => ({}),
    getAllowedTools: () => [],
    getContentGeneratorConfig: () => ({ model: 'test-model' }),
    getMessageBus: () => createMessageBus(),
    getPolicyEngine: () => undefined,
    getEnableHooks: () => false,
    getHookSystem: () => null,
    getModel: () => 'test-model',
    isInteractive: () => false,
  } as unknown as Config;
}

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
    const config = createConfig();
    const scheduler = new CoreToolScheduler({
      config,
      messageBus: createMessageBus(),
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
