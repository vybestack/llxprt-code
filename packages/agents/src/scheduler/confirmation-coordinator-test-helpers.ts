/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared helpers for confirmation coordinator test files. Extracted from the
 * original monolithic confirmation-coordinator.test.ts so no file-level
 * max-lines disable is needed.
 *
 * Note: vi.mock('@vybestack/llxprt-code-tools', ...) must be duplicated in each
 * test file that exercises the modify-with-editor flow because vi.mock is
 * hoisted by vitest on a per-file basis and cannot be shared.
 */

import { vi } from 'vitest';
import {
  ConfirmationCoordinator,
  type StatusMutator,
  type SchedulerAccessor,
  type EditorCallbacks,
} from './confirmation-coordinator.js';
import type { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import type { ToolCallConfirmationDetails } from '@vybestack/llxprt-code-tools';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/config.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import type {
  WaitingToolCall,
  ToolCall,
} from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';

export function makeAbortSignal(aborted = false): AbortSignal {
  const controller = new AbortController();
  if (aborted) controller.abort();
  return controller.signal;
}

export function makeStatusMutator(): StatusMutator {
  return {
    setSuccess: vi.fn(),
    setError: vi.fn(),
    setCancelled: vi.fn(),
    setAwaitingApproval: vi.fn(),
    setScheduled: vi.fn(),
    setExecuting: vi.fn(),
    setValidating: vi.fn(),
    setArgs: vi.fn(),
    setOutcome: vi.fn(),
    approve: vi.fn(),
  };
}

export function makeSchedulerAccessor(
  toolCalls: ToolCall[] = [],
): SchedulerAccessor {
  return {
    attemptExecution: vi.fn().mockResolvedValue(undefined),
    getToolCalls: vi.fn().mockReturnValue(toolCalls),
  };
}

export function makeEditorCallbacks(): EditorCallbacks {
  return {
    getPreferredEditor: vi.fn().mockReturnValue(undefined),
    onEditorClose: vi.fn(),
    onEditorOpen: vi.fn(),
  };
}

export function makeMessageBus() {
  const handlers: Map<string, Array<(msg: unknown) => void>> = new Map();
  const bus = {
    subscribe: vi
      .fn()
      .mockImplementation((type: string, handler: (msg: unknown) => void) => {
        if (!handlers.has(type)) handlers.set(type, []);
        handlers.get(type)!.push(handler);
        return () => {
          const arr = handlers.get(type) ?? [];
          const idx = arr.indexOf(handler);
          if (idx >= 0) arr.splice(idx, 1);
        };
      }),
    publish: vi.fn((msg: { type?: string; [key: string]: unknown }) => {
      if (typeof msg.type === 'string') {
        (handlers.get(msg.type) ?? []).forEach((handler) => handler(msg));
      }
    }),
    emit: (type: string, msg: unknown) => {
      (handlers.get(type) ?? []).forEach((h) => h(msg));
    },
    respondToConfirmation: vi.fn(
      (
        correlationId: string,
        outcome: ToolConfirmationOutcome,
        payload?: unknown,
      ) => {
        bus.publish({
          type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
          correlationId,
          outcome,
          payload,
        });
      },
    ),
  };
  return bus;
}

export function makeMockConfig(overrides: Partial<Config> = {}): Config {
  return {
    getSessionId: () => 'test-session-id',
    getPolicyEngine: vi.fn().mockReturnValue({
      evaluate: vi.fn().mockReturnValue(PolicyDecision.ASK_USER),
    }),
    getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.DEFAULT),
    getAllowedTools: vi.fn().mockReturnValue([]),
    isInteractive: vi.fn().mockReturnValue(true),
    getEnableHooks: () => false,
    getHookSystem: () => null,
    ...overrides,
  } as unknown as Config;
}

export function makeConfirmationDetails(
  _callId = 'call-1',
  correlationId = 'corr-1',
): ToolCallConfirmationDetails {
  return {
    type: 'exec',
    title: 'Run command',
    command: 'echo test',
    rootCommand: 'echo',
    correlationId,
    onConfirm: vi.fn().mockResolvedValue(undefined),
  } as unknown as ToolCallConfirmationDetails;
}

export function makeWaitingToolCall(
  callId = 'call-1',
  correlationId = 'corr-1',
): WaitingToolCall {
  return {
    status: 'awaiting_approval',
    request: {
      callId,
      name: 'testTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-1',
    },
    tool: {
      name: 'testTool',
      displayName: 'Test Tool',
    } as WaitingToolCall['tool'],
    invocation: {
      shouldConfirmExecute: vi.fn().mockResolvedValue(false),
    } as unknown as WaitingToolCall['invocation'],
    confirmationDetails: makeConfirmationDetails(callId, correlationId),
  };
}

export function makeValidatingToolCall(callId = 'call-1') {
  return {
    status: 'validating' as const,
    request: {
      callId,
      name: 'testTool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'prompt-1',
    },
    tool: {
      name: 'testTool',
      displayName: 'Test Tool',
    } as WaitingToolCall['tool'],
    invocation: {
      shouldConfirmExecute: vi.fn().mockResolvedValue({
        type: 'exec' as const,
        title: 'Run command',
        command: 'echo test',
        rootCommand: 'echo',
        correlationId: 'corr-1',
        onConfirm: vi.fn().mockResolvedValue(undefined),
      } as unknown as ToolCallConfirmationDetails),
    } as unknown as WaitingToolCall['invocation'],
  };
}

export function createCoordinator(
  overrides: {
    statusMutator?: StatusMutator;
    schedulerAccessor?: SchedulerAccessor;
    editorCallbacks?: EditorCallbacks;
    config?: Config;
    toolCalls?: ToolCall[];
  } = {},
) {
  const messageBus = makeMessageBus();
  const config = overrides.config ?? makeMockConfig();
  const statusMutator = overrides.statusMutator ?? makeStatusMutator();
  const schedulerAccessor =
    overrides.schedulerAccessor ??
    makeSchedulerAccessor(overrides.toolCalls ?? []);
  const editorCallbacks = overrides.editorCallbacks ?? makeEditorCallbacks();
  const onToolNotification = vi.fn().mockResolvedValue(undefined);

  const coordinator = new ConfirmationCoordinator(
    messageBus as unknown as MessageBus,
    config,
    statusMutator,
    schedulerAccessor,
    editorCallbacks,
    onToolNotification,
  );
  coordinator.subscribe();

  return {
    coordinator,
    messageBus,
    statusMutator,
    schedulerAccessor,
    editorCallbacks,
    config,
    onToolNotification,
  };
}
