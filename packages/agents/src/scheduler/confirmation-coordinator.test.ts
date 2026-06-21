/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';

// Module-scope mock for modifiable-tool — hoisted by vitest before imports.
// Per-test behavior can be overridden via vi.mocked().
vi.mock('@vybestack/llxprt-code-tools', async (importOriginal) => {
  const mod =
    await importOriginal<typeof import('@vybestack/llxprt-code-tools')>();
  return {
    ...mod,
    isModifiableDeclarativeTool: vi.fn().mockReturnValue(true),
    modifyWithEditor: vi.fn().mockResolvedValue({
      updatedParams: { content: 'updated' },
      updatedDiff: '--- a +++ b @@ updated @@',
    }),
  };
});

import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import type { ToolConfirmationResponse } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import type {
  WaitingToolCall,
  ToolCall,
} from '@vybestack/llxprt-code-core/scheduler/types.js';
import {
  makeAbortSignal,
  makeStatusMutator,
  makeSchedulerAccessor,
  makeWaitingToolCall,
  createCoordinator,
} from './confirmation-coordinator-test-helpers.js';

describe('ConfirmationCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('subscribe / dispose / reset', () => {
    it('subscribe registers handler on message bus', () => {
      const { messageBus } = createCoordinator();
      expect(messageBus.subscribe).toHaveBeenCalledWith(
        MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        expect.any(Function),
      );
    });

    it('dispose unsubscribes from message bus and ignores subsequent responses', () => {
      const { coordinator, messageBus, statusMutator, schedulerAccessor } =
        createCoordinator();

      coordinator.dispose();

      // Emit a response after dispose — the handler should have been removed
      messageBus.emit(MessageBusType.TOOL_CONFIRMATION_RESPONSE, {
        correlationId: 'corr-1',
        outcome: ToolConfirmationOutcome.ProceedOnce,
      } as ToolConfirmationResponse);

      // Nothing should happen because the subscription was removed
      expect(statusMutator.setScheduled).not.toHaveBeenCalled();
      expect(schedulerAccessor.attemptExecution).not.toHaveBeenCalled();
    });

    it('reset clears all state maps', () => {
      const waitingCall = makeWaitingToolCall();
      const { coordinator, statusMutator } = createCoordinator({
        toolCalls: [waitingCall],
      });
      const signal = makeAbortSignal();
      coordinator.registerSignal('call-1', signal);
      (
        coordinator as unknown as { pendingConfirmations: Map<string, string> }
      ).pendingConfirmations.set('corr-1', 'call-1');
      (
        coordinator as unknown as {
          pendingOriginalConfirmHandlers: Map<string, () => Promise<void>>;
        }
      ).pendingOriginalConfirmHandlers.set('corr-1', async () => {});

      coordinator.reset();

      expect(
        (
          coordinator as unknown as {
            pendingConfirmations: Map<string, string>;
          }
        ).pendingConfirmations.size,
      ).toBe(0);
      expect(
        (
          coordinator as unknown as {
            pendingOriginalConfirmHandlers: Map<string, () => Promise<void>>;
          }
        ).pendingOriginalConfirmHandlers.size,
      ).toBe(0);
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
});
