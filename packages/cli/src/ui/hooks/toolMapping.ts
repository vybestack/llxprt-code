/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Status as CoreStatus,
  DEFAULT_AGENT_ID,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import {
  ToolCallStatus,
  type HistoryItemToolGroup,
  type IndividualToolCallDisplay,
} from '../types.js';
import type {
  TrackedCompletedToolCall,
  TrackedExecutingToolCall,
  TrackedScheduledToolCall,
  TrackedToolCall,
  TrackedValidatingToolCall,
  TrackedWaitingToolCall,
} from './useReactToolScheduler.js';

const logger = DebugLogger.getLogger('llxprt:cli:tool-mapping');

/**
 * Maps a CoreToolScheduler status to the UI's ToolCallStatus enum.
 * Memoized as a constant map for better performance.
 */
const STATUS_MAP = {
  validating: ToolCallStatus.Executing,
  awaiting_approval: ToolCallStatus.Confirming,
  executing: ToolCallStatus.Executing,
  success: ToolCallStatus.Success,
  cancelled: ToolCallStatus.Canceled,
  error: ToolCallStatus.Error,
  scheduled: ToolCallStatus.Pending,
} satisfies Record<CoreStatus, ToolCallStatus>;

const STATUS_LOOKUP: Readonly<Record<string, ToolCallStatus | undefined>> =
  STATUS_MAP;

export function mapCoreStatusToDisplayStatus(
  coreStatus: CoreStatus,
): ToolCallStatus {
  const mappedStatus = STATUS_LOOKUP[coreStatus];
  if (mappedStatus !== undefined) {
    return mappedStatus;
  }

  logger.warn(() => `Unknown core status encountered: ${coreStatus}`);
  return ToolCallStatus.Error;
}

/**
 * Determines the group agentId with 3-level precedence:
 * response.agentId > request.agentId > DEFAULT_AGENT_ID
 */
function determineGroupAgentId(toolCalls: TrackedToolCall[]): string {
  return (
    toolCalls
      .map((trackedCall) => {
        const responseAgentId =
          'response' in trackedCall ? trackedCall.response.agentId : undefined;
        return responseAgentId ?? trackedCall.request.agentId;
      })
      .find(
        (agentId): agentId is string =>
          typeof agentId === 'string' && agentId.trim().length > 0,
      ) ?? DEFAULT_AGENT_ID
  );
}

function getDisplayName(trackedCall: TrackedToolCall): string {
  if (trackedCall.status === 'error') {
    return trackedCall.tool === undefined
      ? trackedCall.request.name
      : trackedCall.tool.displayName;
  }
  return trackedCall.tool.displayName;
}

function getDescription(trackedCall: TrackedToolCall): string {
  if (trackedCall.status === 'error') {
    return JSON.stringify(trackedCall.request.args);
  }
  return trackedCall.invocation.getDescription();
}

function getRenderOutputAsMarkdown(trackedCall: TrackedToolCall): boolean {
  if (trackedCall.status === 'error') {
    return false;
  }
  return trackedCall.tool.isOutputMarkdown;
}

function getBaseDisplayProperties(
  trackedCall: TrackedToolCall,
): Omit<
  IndividualToolCallDisplay,
  'status' | 'resultDisplay' | 'confirmationDetails'
> {
  return {
    callId: trackedCall.request.callId,
    name: getDisplayName(trackedCall),
    description: getDescription(trackedCall),
    renderOutputAsMarkdown: getRenderOutputAsMarkdown(trackedCall),
  };
}

function buildSuccessDisplay(
  trackedCall: Extract<TrackedCompletedToolCall, { status: 'success' }>,
): IndividualToolCallDisplay {
  logger.debug(
    `mapToDisplay: success call ${trackedCall.request.callId}, toolName=${trackedCall.request.name}, resultDisplay type: ${typeof trackedCall.response.resultDisplay}, hasValue: ${Boolean(trackedCall.response.resultDisplay)}`,
  );
  const baseProperties = getBaseDisplayProperties(trackedCall);
  return {
    ...baseProperties,
    status: mapCoreStatusToDisplayStatus(trackedCall.status),
    resultDisplay: trackedCall.response.resultDisplay,
    confirmationDetails: undefined,
    outputFile: trackedCall.response.outputFile,
  };
}

function buildErrorCancelledDisplay(
  trackedCall: Extract<
    TrackedCompletedToolCall,
    { status: 'error' | 'cancelled' }
  >,
): IndividualToolCallDisplay {
  const baseProperties = getBaseDisplayProperties(trackedCall);
  return {
    ...baseProperties,
    status: mapCoreStatusToDisplayStatus(trackedCall.status),
    resultDisplay: trackedCall.response.resultDisplay,
    confirmationDetails: undefined,
  };
}

function buildAwaitingApprovalDisplay(
  trackedCall: TrackedWaitingToolCall,
): IndividualToolCallDisplay {
  const baseProperties = getBaseDisplayProperties(trackedCall);
  const confirmationDetails =
    'onConfirm' in trackedCall.confirmationDetails
      ? trackedCall.confirmationDetails
      : undefined;

  return {
    ...baseProperties,
    status: mapCoreStatusToDisplayStatus(trackedCall.status),
    resultDisplay: undefined,
    confirmationDetails,
  };
}

function buildExecutingDisplay(
  trackedCall: TrackedExecutingToolCall,
): IndividualToolCallDisplay {
  const baseProperties = getBaseDisplayProperties(trackedCall);
  return {
    ...baseProperties,
    status: mapCoreStatusToDisplayStatus(trackedCall.status),
    resultDisplay: trackedCall.liveOutput ?? undefined,
    confirmationDetails: undefined,
    ptyId: trackedCall.pid,
  };
}

function buildScheduledDisplay(
  trackedCall: TrackedScheduledToolCall | TrackedValidatingToolCall,
): IndividualToolCallDisplay {
  const baseProperties = getBaseDisplayProperties(trackedCall);
  return {
    ...baseProperties,
    status: mapCoreStatusToDisplayStatus(trackedCall.status),
    resultDisplay: undefined,
    confirmationDetails: undefined,
  };
}

function buildUnknownDisplay(
  trackedCall: TrackedToolCall,
): IndividualToolCallDisplay {
  return {
    callId: trackedCall.request.callId,
    name: 'Unknown Tool',
    description: 'Encountered an unknown tool call state.',
    status: ToolCallStatus.Error,
    resultDisplay: 'Unknown tool call state',
    confirmationDetails: undefined,
    renderOutputAsMarkdown: false,
  };
}

function mapTrackedCallToDisplay(
  trackedCall: TrackedToolCall,
): IndividualToolCallDisplay {
  switch (trackedCall.status) {
    case 'success':
      return buildSuccessDisplay(trackedCall);
    case 'error':
    case 'cancelled':
      return buildErrorCancelledDisplay(trackedCall);
    case 'awaiting_approval':
      return buildAwaitingApprovalDisplay(trackedCall);
    case 'executing':
      return buildExecutingDisplay(trackedCall);
    case 'validating':
    case 'scheduled':
      return buildScheduledDisplay(trackedCall);
    default: {
      const exhaustiveCheck: never = trackedCall;
      return buildUnknownDisplay(exhaustiveCheck as TrackedToolCall);
    }
  }
}

/**
 * Transforms `TrackedToolCall` objects into `HistoryItemToolGroup` objects for UI display.
 * LLxprt enhancement: Includes agentId handling for subagent support.
 */
export function mapToDisplay(
  toolOrTools: TrackedToolCall[] | TrackedToolCall,
): HistoryItemToolGroup {
  const toolCalls = Array.isArray(toolOrTools) ? toolOrTools : [toolOrTools];
  const groupAgentId = determineGroupAgentId(toolCalls);
  const toolDisplays = toolCalls.map(mapTrackedCallToDisplay);

  return {
    type: 'tool_group',
    agentId: groupAgentId,
    tools: toolDisplays,
  };
}
