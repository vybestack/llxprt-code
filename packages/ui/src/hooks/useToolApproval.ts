import { useCallback, useState, useRef, useEffect } from 'react';
import type {
  ToolApprovalDetails,
  ToolApprovalOutcome,
} from '../ui/modals/ToolApprovalModal';
import type { ToolCallConfirmationDetails } from '@vybestack/llxprt-code-core';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-core';
import type { ToolConfirmationType } from '../types/events';
import { getLogger } from '../lib/logger';

const logger = getLogger('nui:tool-approval');

/**
 * Function type for responding to tool confirmations
 */
export type RespondToConfirmationFn = (
  callId: string,
  outcome: ToolConfirmationOutcome,
) => void;

export interface PendingApproval extends ToolApprovalDetails {
  readonly correlationId: string;
}

export interface UseToolApprovalResult {
  readonly pendingApproval: PendingApproval | null;
  readonly queueApproval: (approval: PendingApproval) => void;
  readonly queueApprovalFromScheduler: (
    callId: string,
    toolName: string,
    confirmationDetails: ToolCallConfirmationDetails,
  ) => void;
  readonly handleDecision: (
    callId: string,
    outcome: ToolApprovalOutcome,
  ) => void;
  readonly clearApproval: () => void;
}

function mapOutcome(outcome: ToolApprovalOutcome): ToolConfirmationOutcome {
  switch (outcome) {
    case 'allow_once':
      return ToolConfirmationOutcome.ProceedOnce;
    case 'allow_always':
      return ToolConfirmationOutcome.ProceedAlways;
    case 'cancel':
      return ToolConfirmationOutcome.Cancel;
    default:
      return ToolConfirmationOutcome.Cancel;
  }
}

/**
 * Map CoreToolScheduler confirmation type to UI confirmation type
 */
function mapConfirmationType(type: string): ToolConfirmationType {
  switch (type) {
    case 'edit':
      return 'edit';
    case 'exec':
      return 'exec';
    case 'mcp':
      return 'mcp';
    case 'info':
      return 'info';
    default:
      return 'info';
  }
}

/**
 * Get question based on confirmation type
 */
function getQuestionForType(details: ToolCallConfirmationDetails): string {
  switch (details.type) {
    case 'edit':
      return 'Apply this change?';
    case 'exec':
      return `Allow execution of: '${details.rootCommand}'?`;
    case 'mcp':
      return `Allow execution of MCP tool "${details.toolName}" from server "${details.serverName}"?`;
    case 'info':
      return 'Do you want to proceed?';
    default:
      return 'Do you want to proceed?';
  }
}

/**
 * Get preview string from confirmation details
 */
function getPreviewForType(details: ToolCallConfirmationDetails): string {
  switch (details.type) {
    case 'edit':
      return details.fileDiff || `Edit: ${details.filePath}`;
    case 'exec':
      return details.command;
    case 'mcp':
      return `MCP Server: ${details.serverName}\nTool: ${details.toolDisplayName}`;
    case 'info':
      return details.prompt || '';
    default:
      return '';
  }
}

export function useToolApproval(
  respondToConfirmation: RespondToConfirmationFn | null,
): UseToolApprovalResult {
  const [pendingApproval, setPendingApproval] =
    useState<PendingApproval | null>(null);
  const approvalQueueRef = useRef<PendingApproval[]>([]);

  // Ref to track current pendingApproval to avoid stale closures
  const pendingApprovalRef = useRef<PendingApproval | null>(null);
  useEffect(() => {
    pendingApprovalRef.current = pendingApproval;
  }, [pendingApproval]);

  // Ref to track respondToConfirmation to avoid stale closures
  const respondToConfirmationRef = useRef<RespondToConfirmationFn | null>(
    respondToConfirmation,
  );
  useEffect(() => {
    respondToConfirmationRef.current = respondToConfirmation;
  }, [respondToConfirmation]);

  const processNextApproval = useCallback(() => {
    if (approvalQueueRef.current.length > 0) {
      const next = approvalQueueRef.current.shift();
      if (next) {
        setPendingApproval(next);
      }
    } else {
      setPendingApproval(null);
    }
  }, []);

  const queueApproval = useCallback(
    (approval: PendingApproval) => {
      approvalQueueRef.current.push(approval);
      // If no current pending approval, show this one
      if (pendingApproval === null) {
        processNextApproval();
      }
    },
    [pendingApproval, processNextApproval],
  );

  /**
   * Queue approval from CoreToolScheduler's waiting tool call
   */
  const queueApprovalFromScheduler = useCallback(
    (
      callId: string,
      toolName: string,
      confirmationDetails: ToolCallConfirmationDetails,
    ) => {
      const approval: PendingApproval = {
        callId,
        toolName,
        confirmationType: mapConfirmationType(confirmationDetails.type),
        question: getQuestionForType(confirmationDetails),
        preview: getPreviewForType(confirmationDetails),
        params: {}, // Params are embedded in confirmationDetails
        canAllowAlways: true, // Can be refined based on policy
        correlationId: String(
          (confirmationDetails as { correlationId?: string }).correlationId ??
            callId,
        ),
        coreDetails: confirmationDetails,
      };
      queueApproval(approval);
    },
    [queueApproval],
  );

  const handleDecision = useCallback(
    (callId: string, outcome: ToolApprovalOutcome) => {
      const currentApproval = pendingApprovalRef.current;
      const confirmFn = respondToConfirmationRef.current;
      logger.debug(
        'handleDecision called',
        'callId:',
        callId,
        'outcome:',
        outcome,
        'currentApproval:',
        currentApproval?.callId,
        'hasConfirmFn:',
        !!confirmFn,
      );

      if (!confirmFn) {
        logger.warn('handleDecision: no respondToConfirmation function');
        return;
      }
      if (!currentApproval) {
        logger.warn('handleDecision: no currentApproval');
        return;
      }
      if (currentApproval.callId !== callId) {
        logger.warn(
          'handleDecision: callId mismatch',
          'expected:',
          currentApproval.callId,
          'got:',
          callId,
        );
        return;
      }

      try {
        const coreOutcome = mapOutcome(outcome);
        logger.debug(
          'Calling respondToConfirmation',
          'callId:',
          callId,
          'outcome:',
          coreOutcome,
        );
        confirmFn(callId, coreOutcome);
        logger.debug('respondToConfirmation called successfully');

        // Move to next approval in queue
        processNextApproval();
      } catch (err) {
        logger.error('Error in handleDecision:', String(err));
      }
    },
    [processNextApproval],
  );

  const clearApproval = useCallback(() => {
    // Cancel all pending approvals
    const currentApproval = pendingApprovalRef.current;
    const confirmFn = respondToConfirmationRef.current;
    if (confirmFn && currentApproval) {
      logger.debug(
        'clearApproval: cancelling',
        'callId:',
        currentApproval.callId,
      );
      confirmFn(currentApproval.callId, ToolConfirmationOutcome.Cancel);
    }
    approvalQueueRef.current = [];
    setPendingApproval(null);
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      approvalQueueRef.current = [];
    };
  }, []);

  return {
    pendingApproval,
    queueApproval,
    queueApprovalFromScheduler,
    handleDecision,
    clearApproval,
  };
}
