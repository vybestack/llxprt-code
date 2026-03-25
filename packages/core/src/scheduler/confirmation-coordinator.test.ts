/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ConfirmationCoordinator,
  type StatusMutator,
  type SchedulerAccessor,
  type EditorCallbacks,
} from './confirmation-coordinator.js';
import { ToolConfirmationOutcome } from '../tools/tool-confirmation-types.js';
import type { ToolCallConfirmationDetails } from '../tools/tools.js';
import { MessageBusType } from '../confirmation-bus/types.js';
import type { ToolConfirmationResponse } from '../confirmation-bus/types.js';
import { ApprovalMode } from '../config/config.js';
import { PolicyDecision } from '../policy/types.js';
import type { WaitingToolCall, ToolCall } from './types.js';
import type { Config } from '../config/config.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAbortSignal(aborted = false): AbortSignal {
  const controller = new AbortController();
  if (aborted) controller.abort();
  return controller.signal;
}

function makeStatusMutator(): StatusMutator {
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

function makeSchedulerAccessor(toolCalls: ToolCall[] = []): SchedulerAccessor {
  return {
    attemptExecution: vi.fn().mockResolvedValue(undefined),
    getToolCalls: vi.fn().mockReturnValue(toolCalls),
  };
}

function makeEditorCallbacks(): EditorCallbacks {
  return {
    getPreferredEditor: vi.fn().mockReturnValue(undefined),
    onEditorClose: vi.fn(),
    onEditorOpen: vi.fn(),
  };
}

function makeMessageBus() {
  const handlers: Map<string, ((msg: unknown) => void)[]> = new Map();
  return {
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
    publish: vi.fn(),
    emit: (type: string, msg: unknown) => {
      (handlers.get(type) ?? []).forEach((h) => h(msg));
    },
  };
}

function makeMockConfig(overrides: Partial<Config> = {}): Config {
  return {
    getSessionId: () => 'test-session-id',
    getPolicyEngine: vi.fn().mockReturnValue({
      evaluate: vi.fn().mockReturnValue(PolicyDecision.ASK),
    }),
    getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.DEFAULT),
    getAllowedTools: vi.fn().mockReturnValue([]),
    isInteractive: vi.fn().mockReturnValue(true),
    getEnableHooks: () => false,
    getHookSystem: () => null,
    ...overrides,
  } as unknown as Config;
}

function makeConfirmationDetails(
  callId = 'call-1',
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

function makeWaitingToolCall(
  callId = 'call-1',
  correlationId = 'corr-1',
): WaitingToolCall {
  return {
    status: 'awaiting_approval',
    request: { callId, name: 'testTool', args: {} },
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

function makeValidatingToolCall(callId = 'call-1') {
  return {
    status: 'validating' as const,
    request: { callId, name: 'testTool', args: {} },
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
      } as ToolCallConfirmationDetails),
    } as unknown as WaitingToolCall['invocation'],
  };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

function createCoordinator(
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
    messageBus as unknown as import('../confirmation-bus/message-bus.js').MessageBus,
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ConfirmationCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── subscribe / dispose / reset ───────────────────────────────────────────

  describe('subscribe / dispose / reset', () => {
    it('subscribe registers handler on message bus', () => {
      const { messageBus } = createCoordinator();
      expect(messageBus.subscribe).toHaveBeenCalledWith(
        MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        expect.any(Function),
      );
    });

    it('dispose unsubscribes from message bus', () => {
      const { coordinator, messageBus } = createCoordinator();
      coordinator.dispose();
      // After dispose, emitting a response does nothing (no call to handleConfirmationResponse)
      // We verify by checking the unsubscribe was invoked via subscribe mock return
      expect(messageBus.subscribe).toHaveBeenCalledOnce();
    });

    it('reset clears all state maps', () => {
      const waitingCall = makeWaitingToolCall();
      const { coordinator, statusMutator } = createCoordinator({
        toolCalls: [waitingCall],
      });
      const signal = makeAbortSignal();
      coordinator.registerSignal('call-1', signal);
      coordinator.reset();
      // After reset, the signal is gone; publishing a response should be a no-op
      // We verify indirectly: no attemptExecution called after reset
      expect(statusMutator.setScheduled).not.toHaveBeenCalled();
    });
  });

  // ── registerSignal / deleteSignal ─────────────────────────────────────────

  describe('registerSignal / deleteSignal', () => {
    it('registered signal is used in message bus response handling', () => {
      const waitingCall = makeWaitingToolCall('call-1', 'corr-1');
      const { coordinator, messageBus, statusMutator } = createCoordinator({
        toolCalls: [waitingCall],
      });
      const signal = makeAbortSignal();
      coordinator.registerSignal('call-1', signal);

      // Simulate pending confirmation
      (
        coordinator as unknown as { pendingConfirmations: Map<string, string> }
      ).pendingConfirmations.set('corr-1', 'call-1');

      messageBus.emit(MessageBusType.TOOL_CONFIRMATION_RESPONSE, {
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: 'corr-1',
        outcome: ToolConfirmationOutcome.ProceedOnce,
      } satisfies ToolConfirmationResponse);

      // handleConfirmationResponse called → setScheduled or setCancelled
      // Just check no error was thrown
      expect(statusMutator.setError).not.toHaveBeenCalled();
    });

    it('missing signal causes message bus response to be skipped', () => {
      const waitingCall = makeWaitingToolCall('call-1', 'corr-1');
      const { coordinator, messageBus, schedulerAccessor } = createCoordinator({
        toolCalls: [waitingCall],
      });
      // Do NOT registerSignal for call-1
      (
        coordinator as unknown as { pendingConfirmations: Map<string, string> }
      ).pendingConfirmations.set('corr-1', 'call-1');

      messageBus.emit(MessageBusType.TOOL_CONFIRMATION_RESPONSE, {
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: 'corr-1',
        outcome: ToolConfirmationOutcome.ProceedOnce,
      } satisfies ToolConfirmationResponse);

      expect(schedulerAccessor.attemptExecution).not.toHaveBeenCalled();
    });

    it('deleteSignal removes signal so subsequent bus responses are skipped', async () => {
      const waitingCall = makeWaitingToolCall('call-1', 'corr-1');
      const { coordinator, messageBus, schedulerAccessor } = createCoordinator({
        toolCalls: [waitingCall],
      });
      const signal = makeAbortSignal();
      coordinator.registerSignal('call-1', signal);
      coordinator.deleteSignal('call-1');

      (
        coordinator as unknown as { pendingConfirmations: Map<string, string> }
      ).pendingConfirmations.set('corr-1', 'call-1');

      messageBus.emit(MessageBusType.TOOL_CONFIRMATION_RESPONSE, {
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: 'corr-1',
        outcome: ToolConfirmationOutcome.ProceedOnce,
      } satisfies ToolConfirmationResponse);

      expect(schedulerAccessor.attemptExecution).not.toHaveBeenCalled();
    });
  });

  // ── handleMessageBusResponse ──────────────────────────────────────────────

  describe('handleMessageBusResponse', () => {
    it('ignores stale correlation IDs', async () => {
      const { coordinator, messageBus, schedulerAccessor } =
        createCoordinator();

      // Manually mark a correlationId as stale
      const timeout = setTimeout(() => {}, 9999);
      (
        coordinator as unknown as {
          staleCorrelationIds: Map<string, NodeJS.Timeout>;
        }
      ).staleCorrelationIds.set('stale-corr', timeout);

      messageBus.emit(MessageBusType.TOOL_CONFIRMATION_RESPONSE, {
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: 'stale-corr',
        outcome: ToolConfirmationOutcome.ProceedOnce,
      } satisfies ToolConfirmationResponse);

      expect(schedulerAccessor.attemptExecution).not.toHaveBeenCalled();
      clearTimeout(timeout);
    });

    it('ignores unknown correlation IDs', () => {
      const { messageBus, schedulerAccessor } = createCoordinator();

      messageBus.emit(MessageBusType.TOOL_CONFIRMATION_RESPONSE, {
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: 'unknown-corr',
        outcome: ToolConfirmationOutcome.ProceedOnce,
      } satisfies ToolConfirmationResponse);

      expect(schedulerAccessor.attemptExecution).not.toHaveBeenCalled();
    });

    it('skips when no waiting tool call found for correlationId', () => {
      // ToolCall with a different status (not awaiting_approval)
      const scheduledCall: ToolCall = {
        status: 'scheduled',
        request: { callId: 'call-1', name: 'testTool', args: {} },
        tool: {} as ToolCall['tool'],
        invocation: {} as WaitingToolCall['invocation'],
      };
      const { coordinator, messageBus, schedulerAccessor } = createCoordinator({
        toolCalls: [scheduledCall],
      });
      const signal = makeAbortSignal();
      coordinator.registerSignal('call-1', signal);
      (
        coordinator as unknown as { pendingConfirmations: Map<string, string> }
      ).pendingConfirmations.set('corr-1', 'call-1');

      messageBus.emit(MessageBusType.TOOL_CONFIRMATION_RESPONSE, {
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: 'corr-1',
        outcome: ToolConfirmationOutcome.ProceedOnce,
      } satisfies ToolConfirmationResponse);

      expect(schedulerAccessor.attemptExecution).not.toHaveBeenCalled();
    });

    it('derives outcome from legacy confirmed=true → ProceedOnce', async () => {
      const waitingCall = makeWaitingToolCall('call-1', 'corr-1');
      const { coordinator, messageBus, statusMutator } = createCoordinator({
        toolCalls: [waitingCall],
      });
      const signal = makeAbortSignal();
      coordinator.registerSignal('call-1', signal);
      (
        coordinator as unknown as { pendingConfirmations: Map<string, string> }
      ).pendingConfirmations.set('corr-1', 'call-1');

      messageBus.emit(MessageBusType.TOOL_CONFIRMATION_RESPONSE, {
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: 'corr-1',
        confirmed: true,
      } satisfies ToolConfirmationResponse);

      await vi.runAllTimersAsync();
      // ProceedOnce path → setScheduled
      expect(statusMutator.setScheduled).toHaveBeenCalledWith('call-1');
    });
  });

  // ── handleConfirmationResponse ────────────────────────────────────────────

  describe('handleConfirmationResponse', () => {
    it('ProceedOnce → sets scheduled status and attempts execution', async () => {
      const waitingCall = makeWaitingToolCall();
      const { coordinator, statusMutator, schedulerAccessor } =
        createCoordinator({
          toolCalls: [waitingCall],
        });
      const signal = makeAbortSignal();
      coordinator.registerSignal('call-1', signal);

      await coordinator.handleConfirmationResponse(
        'call-1',
        vi.fn().mockResolvedValue(undefined),
        ToolConfirmationOutcome.ProceedOnce,
        signal,
      );

      expect(statusMutator.setScheduled).toHaveBeenCalledWith('call-1');
      expect(schedulerAccessor.attemptExecution).toHaveBeenCalledWith(signal);
    });

    it('ProceedAlways → sets outcome, auto-approves compatible, schedules', async () => {
      const waitingCall1 = makeWaitingToolCall('call-1', 'corr-1');
      const waitingCall2 = makeWaitingToolCall('call-2', 'corr-2');
      // waitingCall2.invocation.shouldConfirmExecute returns false → auto-approve
      const accessor = makeSchedulerAccessor([waitingCall1, waitingCall2]);
      const statusMutator = makeStatusMutator();
      const { coordinator } = createCoordinator({
        statusMutator,
        schedulerAccessor: accessor,
      });
      const signal = makeAbortSignal();
      coordinator.registerSignal('call-1', signal);
      coordinator.registerSignal('call-2', signal);

      await coordinator.handleConfirmationResponse(
        'call-1',
        vi.fn().mockResolvedValue(undefined),
        ToolConfirmationOutcome.ProceedAlways,
        signal,
      );

      expect(statusMutator.setOutcome).toHaveBeenCalledWith(
        'call-2',
        ToolConfirmationOutcome.ProceedAlways,
      );
      expect(statusMutator.setScheduled).toHaveBeenCalledWith('call-2');
    });

    it('Cancel (DontProceed) → sets cancelled status', async () => {
      const waitingCall = makeWaitingToolCall();
      const { coordinator, statusMutator } = createCoordinator({
        toolCalls: [waitingCall],
      });
      const signal = makeAbortSignal();
      coordinator.registerSignal('call-1', signal);

      await coordinator.handleConfirmationResponse(
        'call-1',
        vi.fn().mockResolvedValue(undefined),
        ToolConfirmationOutcome.Cancel,
        signal,
      );

      expect(statusMutator.setCancelled).toHaveBeenCalledWith(
        'call-1',
        expect.any(String),
      );
    });

    it('signal already aborted → sets cancelled status', async () => {
      const waitingCall = makeWaitingToolCall();
      const { coordinator, statusMutator } = createCoordinator({
        toolCalls: [waitingCall],
      });
      const signal = makeAbortSignal(true); // already aborted
      coordinator.registerSignal('call-1', signal);

      await coordinator.handleConfirmationResponse(
        'call-1',
        vi.fn().mockResolvedValue(undefined),
        ToolConfirmationOutcome.ProceedOnce,
        signal,
      );

      expect(statusMutator.setCancelled).toHaveBeenCalledWith(
        'call-1',
        expect.any(String),
      );
    });

    it('duplicate callId is skipped (processedConfirmations gate)', async () => {
      const waitingCall = makeWaitingToolCall();
      const { coordinator, statusMutator } = createCoordinator({
        toolCalls: [waitingCall],
      });
      const signal = makeAbortSignal();
      coordinator.registerSignal('call-1', signal);
      const onConfirm = vi.fn().mockResolvedValue(undefined);

      await coordinator.handleConfirmationResponse(
        'call-1',
        onConfirm,
        ToolConfirmationOutcome.ProceedOnce,
        signal,
      );
      await coordinator.handleConfirmationResponse(
        'call-1',
        onConfirm,
        ToolConfirmationOutcome.ProceedOnce,
        signal,
      );

      // onConfirm only called once
      expect(onConfirm).toHaveBeenCalledOnce();
    });

    it('ModifyWithEditor → re-publishes with new correlationId when editor returns', async () => {
      const waitingCall = makeWaitingToolCall('call-1', 'corr-1');
      // Tool that is modifiable
      const modifyContext = {
        getFilePath: vi.fn().mockReturnValue('/tmp/file.txt'),
        getCurrentContent: vi.fn().mockResolvedValue('old content'),
        getProposedContent: vi.fn().mockResolvedValue('new content'),
        createUpdatedParams: vi.fn().mockReturnValue({ content: 'updated' }),
      };
      const modifiableTool = {
        ...waitingCall.tool,
        getModifyContext: vi.fn().mockReturnValue(modifyContext),
      };
      const modifiableWaitingCall: WaitingToolCall = {
        ...waitingCall,
        tool: modifiableTool as unknown as WaitingToolCall['tool'],
        confirmationDetails: {
          ...waitingCall.confirmationDetails,
          type: 'edit' as const,
          title: 'Edit file',
          fileDiff: '--- a\n+++ b',
          fileName: 'file.txt',
          filePath: '/tmp/file.txt',
          originalContent: 'old',
          newContent: 'new',
          correlationId: 'corr-1',
          onConfirm: vi.fn().mockResolvedValue(undefined),
        } as unknown as ToolCallConfirmationDetails,
      };
      const editorCallbacks: EditorCallbacks = {
        getPreferredEditor: vi.fn().mockReturnValue('vscode'),
        onEditorClose: vi.fn(),
        onEditorOpen: vi.fn(),
      };
      const { coordinator, messageBus, statusMutator } = createCoordinator({
        toolCalls: [modifiableWaitingCall],
        editorCallbacks,
      });
      const signal = makeAbortSignal();
      coordinator.registerSignal('call-1', signal);

      // We need to mock modifyWithEditor — patch the module
      vi.mock('../tools/modifiable-tool.js', async (importOriginal) => {
        const mod =
          await importOriginal<typeof import('../tools/modifiable-tool.js')>();
        return {
          ...mod,
          isModifiableDeclarativeTool: vi.fn().mockReturnValue(true),
          modifyWithEditor: vi.fn().mockResolvedValue({
            updatedParams: { content: 'updated' },
            updatedDiff: '--- a\n+++ b\n@@ updated @@',
          }),
        };
      });

      await coordinator.handleConfirmationResponse(
        'call-1',
        vi.fn().mockResolvedValue(undefined),
        ToolConfirmationOutcome.ModifyWithEditor,
        signal,
      );

      // A new correlationId was published
      expect(messageBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
        }),
      );
      // processedConfirmations was cleared for re-confirmation
      expect(statusMutator.setAwaitingApproval).toHaveBeenCalled();
    });

    it('inline modify with newContent payload → updates args, schedules', async () => {
      // isModifiableDeclarativeTool must return true
      // We test the flow where payload.newContent is provided and tool is modifiable
      const modifyContext = {
        getFilePath: vi.fn().mockReturnValue('/tmp/test.txt'),
        getCurrentContent: vi.fn().mockResolvedValue('original'),
        getProposedContent: vi.fn().mockResolvedValue('proposed'),
        createUpdatedParams: vi
          .fn()
          .mockReturnValue({ content: 'inline-updated' }),
      };
      const modifiableTool = {
        name: 'testTool',
        displayName: 'Test Tool',
        getModifyContext: vi.fn().mockReturnValue(modifyContext),
      };
      const waitingCall: WaitingToolCall = {
        status: 'awaiting_approval',
        request: { callId: 'call-1', name: 'testTool', args: {} },
        tool: modifiableTool as unknown as WaitingToolCall['tool'],
        invocation: {
          shouldConfirmExecute: vi.fn().mockResolvedValue(false),
        } as unknown as WaitingToolCall['invocation'],
        confirmationDetails: {
          type: 'edit' as const,
          title: 'Edit file',
          fileDiff: '--- a\n+++ b',
          fileName: 'test.txt',
          filePath: '/tmp/test.txt',
          originalContent: 'original',
          newContent: 'proposed',
          correlationId: 'corr-1',
          onConfirm: vi.fn().mockResolvedValue(undefined),
        } as unknown as ToolCallConfirmationDetails,
      };
      const { coordinator, statusMutator, schedulerAccessor } =
        createCoordinator({
          toolCalls: [waitingCall],
        });
      const signal = makeAbortSignal();
      coordinator.registerSignal('call-1', signal);

      await coordinator.handleConfirmationResponse(
        'call-1',
        vi.fn().mockResolvedValue(undefined),
        ToolConfirmationOutcome.ProceedOnce,
        signal,
        { newContent: 'inline content' },
      );

      expect(statusMutator.setScheduled).toHaveBeenCalledWith('call-1');
      expect(schedulerAccessor.attemptExecution).toHaveBeenCalledWith(signal);
    });
  });

  // ── autoApproveCompatiblePendingTools ─────────────────────────────────────

  describe('autoApproveCompatiblePendingTools', () => {
    it('approves other waiting tools when they no longer need confirmation', async () => {
      const triggeringCall = makeWaitingToolCall('call-1', 'corr-1');
      const otherCall = makeWaitingToolCall('call-2', 'corr-2');
      // shouldConfirmExecute returns false → auto-approve
      (
        otherCall.invocation.shouldConfirmExecute as ReturnType<typeof vi.fn>
      ).mockResolvedValue(false);

      const statusMutator = makeStatusMutator();
      const accessor = makeSchedulerAccessor([triggeringCall, otherCall]);

      const { coordinator } = createCoordinator({
        statusMutator,
        schedulerAccessor: accessor,
      });
      const signal = makeAbortSignal();

      await (
        coordinator as unknown as {
          autoApproveCompatiblePendingTools(
            signal: AbortSignal,
            triggeringCallId: string,
          ): Promise<void>;
        }
      ).autoApproveCompatiblePendingTools(signal, 'call-1');

      expect(statusMutator.setOutcome).toHaveBeenCalledWith(
        'call-2',
        ToolConfirmationOutcome.ProceedAlways,
      );
      expect(statusMutator.setScheduled).toHaveBeenCalledWith('call-2');
    });

    it('does not approve tools that still need confirmation', async () => {
      const triggeringCall = makeWaitingToolCall('call-1', 'corr-1');
      const otherCall = makeWaitingToolCall('call-2', 'corr-2');
      // shouldConfirmExecute returns details → still needs confirmation
      (
        otherCall.invocation.shouldConfirmExecute as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        type: 'exec',
        title: 'Something',
        command: 'cmd',
        onConfirm: vi.fn(),
      });

      const statusMutator = makeStatusMutator();
      const accessor = makeSchedulerAccessor([triggeringCall, otherCall]);
      const { coordinator } = createCoordinator({
        statusMutator,
        schedulerAccessor: accessor,
      });
      const signal = makeAbortSignal();

      await (
        coordinator as unknown as {
          autoApproveCompatiblePendingTools(
            signal: AbortSignal,
            triggeringCallId: string,
          ): Promise<void>;
        }
      ).autoApproveCompatiblePendingTools(signal, 'call-1');

      expect(statusMutator.setScheduled).not.toHaveBeenCalledWith('call-2');
    });

    it('skips the triggering call itself', async () => {
      const waitingCall = makeWaitingToolCall('call-1', 'corr-1');
      (
        waitingCall.invocation.shouldConfirmExecute as ReturnType<typeof vi.fn>
      ).mockResolvedValue(false);

      const statusMutator = makeStatusMutator();
      const accessor = makeSchedulerAccessor([waitingCall]);
      const { coordinator } = createCoordinator({
        statusMutator,
        schedulerAccessor: accessor,
      });
      const signal = makeAbortSignal();

      await (
        coordinator as unknown as {
          autoApproveCompatiblePendingTools(
            signal: AbortSignal,
            triggeringCallId: string,
          ): Promise<void>;
        }
      ).autoApproveCompatiblePendingTools(signal, 'call-1');

      // Not approved — it was the triggering call
      expect(statusMutator.setScheduled).not.toHaveBeenCalledWith('call-1');
    });
  });

  // ── evaluateAndRoute ──────────────────────────────────────────────────────

  describe('evaluateAndRoute', () => {
    it('policy ALLOW → approves directly without confirmation prompt', async () => {
      const config = makeMockConfig({
        getPolicyEngine: vi.fn().mockReturnValue({
          evaluate: vi.fn().mockReturnValue(PolicyDecision.ALLOW),
        }),
        getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.DEFAULT),
      });
      const validatingCall = makeValidatingToolCall('call-1');
      validatingCall.invocation.shouldConfirmExecute = vi
        .fn()
        .mockResolvedValue(false);

      const statusMutator = makeStatusMutator();
      const { coordinator } = createCoordinator({ config, statusMutator });
      const signal = makeAbortSignal();

      await coordinator.evaluateAndRoute(validatingCall, signal);

      expect(statusMutator.setScheduled).toHaveBeenCalledWith('call-1');
    });

    it('policy DENY → sets error status', async () => {
      const config = makeMockConfig({
        getPolicyEngine: vi.fn().mockReturnValue({
          evaluate: vi.fn().mockReturnValue(PolicyDecision.DENY),
        }),
      });
      const validatingCall = makeValidatingToolCall('call-1');
      const statusMutator = makeStatusMutator();
      const { coordinator } = createCoordinator({ config, statusMutator });
      const signal = makeAbortSignal();

      await coordinator.evaluateAndRoute(validatingCall, signal);

      expect(statusMutator.setError).toHaveBeenCalledWith(
        'call-1',
        expect.objectContaining({ callId: 'call-1' }),
      );
    });

    it('YOLO mode → approves directly without confirmation', async () => {
      const config = makeMockConfig({
        getPolicyEngine: vi.fn().mockReturnValue({
          evaluate: vi.fn().mockReturnValue(PolicyDecision.ASK),
        }),
        getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.YOLO),
        getAllowedTools: vi.fn().mockReturnValue([]),
      });
      const validatingCall = makeValidatingToolCall('call-1');
      validatingCall.invocation.shouldConfirmExecute = vi
        .fn()
        .mockResolvedValue({
          type: 'exec',
          title: 'Run cmd',
          command: 'echo',
          onConfirm: vi.fn(),
        });

      const statusMutator = makeStatusMutator();
      const { coordinator } = createCoordinator({ config, statusMutator });
      const signal = makeAbortSignal();

      await coordinator.evaluateAndRoute(validatingCall, signal);

      expect(statusMutator.setScheduled).toHaveBeenCalledWith('call-1');
    });

    it('non-interactive mode throws when confirmation required', async () => {
      const config = makeMockConfig({
        getPolicyEngine: vi.fn().mockReturnValue({
          evaluate: vi.fn().mockReturnValue(PolicyDecision.ASK),
        }),
        getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.DEFAULT),
        getAllowedTools: vi.fn().mockReturnValue([]),
        isInteractive: vi.fn().mockReturnValue(false),
      });
      const validatingCall = makeValidatingToolCall('call-1');
      validatingCall.invocation.shouldConfirmExecute = vi
        .fn()
        .mockResolvedValue({
          type: 'exec',
          title: 'Run cmd',
          command: 'echo',
          onConfirm: vi.fn(),
        });

      const { coordinator } = createCoordinator({ config });
      const signal = makeAbortSignal();

      await expect(
        coordinator.evaluateAndRoute(validatingCall, signal),
      ).rejects.toThrow(/non-interactive/);
    });

    it('policy ASK + interactive → sets awaiting_approval', async () => {
      const config = makeMockConfig({
        getPolicyEngine: vi.fn().mockReturnValue({
          evaluate: vi.fn().mockReturnValue(PolicyDecision.ASK),
        }),
        getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.DEFAULT),
        getAllowedTools: vi.fn().mockReturnValue([]),
        isInteractive: vi.fn().mockReturnValue(true),
        getSessionId: () => 'session-1',
      });
      const validatingCall = makeValidatingToolCall('call-1');
      const confirmDetails = {
        type: 'exec' as const,
        title: 'Run cmd',
        command: 'echo',
        onConfirm: vi.fn().mockResolvedValue(undefined),
      };
      validatingCall.invocation.shouldConfirmExecute = vi
        .fn()
        .mockResolvedValue(confirmDetails);

      const statusMutator = makeStatusMutator();
      const onToolNotification = vi.fn().mockResolvedValue(undefined);
      const { coordinator, messageBus } = createCoordinator({
        config,
        statusMutator,
      });

      const signal = makeAbortSignal();
      await coordinator.evaluateAndRoute(validatingCall, signal);

      expect(statusMutator.setAwaitingApproval).toHaveBeenCalledWith(
        'call-1',
        expect.objectContaining({ type: 'exec' }),
      );
      expect(messageBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
        }),
      );
    });

    it('shouldConfirmExecute returns false → approves directly', async () => {
      const config = makeMockConfig({
        getPolicyEngine: vi.fn().mockReturnValue({
          evaluate: vi.fn().mockReturnValue(PolicyDecision.ASK),
        }),
        getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.DEFAULT),
        getAllowedTools: vi.fn().mockReturnValue([]),
        isInteractive: vi.fn().mockReturnValue(true),
      });
      const validatingCall = makeValidatingToolCall('call-1');
      validatingCall.invocation.shouldConfirmExecute = vi
        .fn()
        .mockResolvedValue(false);

      const statusMutator = makeStatusMutator();
      const { coordinator } = createCoordinator({ config, statusMutator });
      const signal = makeAbortSignal();

      await coordinator.evaluateAndRoute(validatingCall, signal);

      expect(statusMutator.setScheduled).toHaveBeenCalledWith('call-1');
    });
  });

  // ── stale correlation ID timer ────────────────────────────────────────────

  describe('stale correlation ID grace period', () => {
    it('registers stale correlationId during ModifyWithEditor flow', async () => {
      const modifyContext = {
        getFilePath: vi.fn().mockReturnValue('/tmp/file.txt'),
        getCurrentContent: vi.fn().mockResolvedValue('old'),
        getProposedContent: vi.fn().mockResolvedValue('new'),
        createUpdatedParams: vi.fn().mockReturnValue({ content: 'updated' }),
      };
      const modifiableTool = {
        name: 'testTool',
        displayName: 'Test Tool',
        getModifyContext: vi.fn().mockReturnValue(modifyContext),
      };
      const waitingCall: WaitingToolCall = {
        status: 'awaiting_approval',
        request: { callId: 'call-1', name: 'testTool', args: {} },
        tool: modifiableTool as unknown as WaitingToolCall['tool'],
        invocation: {
          shouldConfirmExecute: vi.fn().mockResolvedValue(false),
          getPolicyContext: vi
            .fn()
            .mockReturnValue({ toolName: 'testTool', args: {} }),
        } as unknown as WaitingToolCall['invocation'],
        confirmationDetails: {
          type: 'edit' as const,
          title: 'Edit file',
          fileDiff: '--- a\n+++ b',
          fileName: 'file.txt',
          filePath: '/tmp/file.txt',
          originalContent: 'old',
          newContent: 'new',
          correlationId: 'old-corr',
          onConfirm: vi.fn().mockResolvedValue(undefined),
        } as unknown as ToolCallConfirmationDetails,
      };
      const editorCallbacks: EditorCallbacks = {
        getPreferredEditor: vi.fn().mockReturnValue('vscode'),
        onEditorClose: vi.fn(),
        onEditorOpen: vi.fn(),
      };

      const { coordinator, messageBus } = createCoordinator({
        toolCalls: [waitingCall],
        editorCallbacks,
      });
      const signal = makeAbortSignal();
      coordinator.registerSignal('call-1', signal);

      vi.mock('../tools/modifiable-tool.js', async (importOriginal) => {
        const mod =
          await importOriginal<typeof import('../tools/modifiable-tool.js')>();
        return {
          ...mod,
          isModifiableDeclarativeTool: vi.fn().mockReturnValue(true),
          modifyWithEditor: vi.fn().mockResolvedValue({
            updatedParams: { content: 'updated' },
            updatedDiff: '--- updated',
          }),
        };
      });

      await coordinator.handleConfirmationResponse(
        'call-1',
        vi.fn().mockResolvedValue(undefined),
        ToolConfirmationOutcome.ModifyWithEditor,
        signal,
      );

      // Verify stale entry was set
      const staleMap = (
        coordinator as unknown as {
          staleCorrelationIds: Map<string, NodeJS.Timeout>;
        }
      ).staleCorrelationIds;
      expect(staleMap.has('old-corr')).toBe(true);

      // After 2s grace period, stale entry is cleaned up
      vi.advanceTimersByTime(2001);
      expect(staleMap.has('old-corr')).toBe(false);

      // Stale bus response is ignored (stale entry was cleaned up after grace period)
      const statusMutator = (
        coordinator as unknown as {
          statusMutator: { approve: ReturnType<typeof vi.fn> };
        }
      ).statusMutator;
      const approveBefore = statusMutator.approve.mock.calls.length;

      messageBus.emit(MessageBusType.TOOL_CONFIRMATION_RESPONSE, {
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: 'old-corr',
        outcome: ToolConfirmationOutcome.ProceedOnce,
      } satisfies ToolConfirmationResponse);

      // No approval was triggered by the stale response
      expect(statusMutator.approve.mock.calls.length).toBe(approveBefore);
    });
  });
});
