/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Confirmation response, routing, and stale-correlation tests extracted from
 * the original monolithic confirmation-coordinator.test.ts so no file-level
 * max-lines disable is needed.
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
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/config.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import type { WaitingToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { ToolCallConfirmationDetails } from '@vybestack/llxprt-code-tools';
import type { EditorCallbacks } from './confirmation-coordinator.js';
import {
  makeAbortSignal,
  makeStatusMutator,
  makeSchedulerAccessor,
  makeMockConfig,
  makeConfirmationDetails,
  makeWaitingToolCall,
  makeValidatingToolCall,
  createCoordinator,
} from './confirmation-coordinator-test-helpers.js';

describe('ConfirmationCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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
      const { coordinator } = createCoordinator({
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

      // modifyWithEditor is mocked at module scope

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

    it('UI ProceedOnce publishes one bus response and invokes original onConfirm once', async () => {
      const config = makeMockConfig({
        getPolicyEngine: vi.fn().mockReturnValue({
          evaluate: vi.fn().mockReturnValue(PolicyDecision.ASK),
        }),
        getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.DEFAULT),
        getAllowedTools: vi.fn().mockReturnValue([]),
        isInteractive: vi.fn().mockReturnValue(true),
      });
      const originalOnConfirm = vi.fn().mockResolvedValue(undefined);
      const validatingCall = makeValidatingToolCall('call-1');
      validatingCall.invocation.shouldConfirmExecute = vi
        .fn()
        .mockResolvedValue({
          type: 'exec' as const,
          title: 'Run cmd',
          command: 'echo',
          onConfirm: originalOnConfirm,
        });
      const statusMutator = makeStatusMutator();
      const schedulerAccessor = makeSchedulerAccessor([
        {
          ...validatingCall,
          status: 'awaiting_approval' as const,
          confirmationDetails: makeConfirmationDetails('call-1', 'corr-1'),
        },
      ]);
      const { coordinator, messageBus } = createCoordinator({
        config,
        statusMutator,
        schedulerAccessor,
      });
      const signal = makeAbortSignal();
      coordinator.registerSignal('call-1', signal);

      await coordinator.evaluateAndRoute(validatingCall, signal);
      const wrappedDetails = statusMutator.setAwaitingApproval.mock
        .calls[0]?.[1] as ToolCallConfirmationDetails;
      await wrappedDetails.onConfirm(ToolConfirmationOutcome.ProceedOnce);

      expect(messageBus.respondToConfirmation).not.toHaveBeenCalled();
      expect(
        messageBus.publish.mock.calls.filter(
          ([message]) =>
            (message as { type?: unknown }).type ===
            MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        ),
      ).toHaveLength(1);
      expect(originalOnConfirm).toHaveBeenCalledOnce();
      expect(schedulerAccessor.attemptExecution).toHaveBeenCalledOnce();
    });

    it('ModifyWithEditor re-confirmation invokes original onConfirm once', async () => {
      const config = makeMockConfig({
        getPolicyEngine: vi.fn().mockReturnValue({
          evaluate: vi.fn().mockReturnValue(PolicyDecision.ASK),
        }),
        getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.DEFAULT),
        getAllowedTools: vi.fn().mockReturnValue([]),
        isInteractive: vi.fn().mockReturnValue(true),
      });
      const originalOnConfirm = vi.fn().mockResolvedValue(undefined);
      const modifyContext = {
        getFilePath: vi.fn().mockReturnValue('/tmp/file.txt'),
        getCurrentContent: vi.fn().mockResolvedValue('old content'),
        getProposedContent: vi.fn().mockResolvedValue('new content'),
        createUpdatedParams: vi.fn().mockReturnValue({ content: 'updated' }),
      };
      const validatingCall = makeValidatingToolCall('call-1');
      validatingCall.tool = {
        ...validatingCall.tool,
        getModifyContext: vi.fn().mockReturnValue(modifyContext),
      } as unknown as typeof validatingCall.tool;
      const editDetails = {
        type: 'edit' as const,
        title: 'Edit file',
        fileDiff: '--- a\n+++ b',
        fileName: 'file.txt',
        filePath: '/tmp/file.txt',
        originalContent: 'old',
        newContent: 'new',
        correlationId: 'corr-1',
        onConfirm: originalOnConfirm,
      } as ToolCallConfirmationDetails;
      validatingCall.invocation.shouldConfirmExecute = vi
        .fn()
        .mockResolvedValue(editDetails);
      const statusMutator = makeStatusMutator();
      const waitingCall = {
        ...validatingCall,
        status: 'awaiting_approval' as const,
        confirmationDetails: editDetails,
      };
      const schedulerAccessor = makeSchedulerAccessor([waitingCall]);
      const editorCallbacks: EditorCallbacks = {
        getPreferredEditor: vi.fn().mockReturnValue('vscode'),
        onEditorClose: vi.fn(),
        onEditorOpen: vi.fn(),
      };
      const { coordinator } = createCoordinator({
        config,
        statusMutator,
        schedulerAccessor,
        editorCallbacks,
      });
      const signal = makeAbortSignal();
      coordinator.registerSignal('call-1', signal);

      await coordinator.evaluateAndRoute(validatingCall, signal);
      const initialDetails = statusMutator.setAwaitingApproval.mock
        .calls[0]?.[1] as ToolCallConfirmationDetails;
      await initialDetails.onConfirm(ToolConfirmationOutcome.ModifyWithEditor);
      const awaitingCalls = statusMutator.setAwaitingApproval.mock.calls;
      const reconfirmDetails = awaitingCalls[awaitingCalls.length - 1]?.[1] as
        | ToolCallConfirmationDetails
        | undefined;
      expect(reconfirmDetails).toBeDefined();
      await reconfirmDetails?.onConfirm(ToolConfirmationOutcome.ProceedOnce);
      await vi.waitFor(() => {
        expect(schedulerAccessor.attemptExecution).toHaveBeenCalledOnce();
      });

      expect(originalOnConfirm).toHaveBeenCalledOnce();
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

      // modifyWithEditor is mocked at module scope

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
