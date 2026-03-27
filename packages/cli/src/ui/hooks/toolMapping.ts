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
import type { TrackedToolCall } from './useReactToolScheduler.js';

const logger = DebugLogger.getLogger('llxprt:cli:tool-mapping');

/**
 * Maps a CoreToolScheduler status to the UI's ToolCallStatus enum.
 * Memoized as a constant map for better performance.
 */
const STATUS_MAP: Record<CoreStatus, ToolCallStatus> = {
  validating: ToolCallStatus.Executing,
  awaiting_approval: ToolCallStatus.Confirming,
  executing: ToolCallStatus.Executing,
  success: ToolCallStatus.Success,
  cancelled: ToolCallStatus.Canceled,
  error: ToolCallStatus.Error,
  scheduled: ToolCallStatus.Pending,
};

export function mapCoreStatusToDisplayStatus(
  coreStatus: CoreStatus,
): ToolCallStatus {
  const mappedStatus = STATUS_MAP[coreStatus];
  if (mappedStatus !== undefined) {
    return mappedStatus;
  }

  logger.warn(() => `Unknown core status encountered: ${coreStatus}`);
  return ToolCallStatus.Error;
}

/**
 * Transforms `TrackedToolCall` objects into `HistoryItemToolGroup` objects for UI display.
 * LLxprt enhancement: Includes agentId handling for subagent support.
 *
 * agentId precedence: response.agentId > request.agentId > DEFAULT_AGENT_ID
 */
export function mapToDisplay(
  toolOrTools: TrackedToolCall[] | TrackedToolCall,
): HistoryItemToolGroup {
  const toolCalls = Array.isArray(toolOrTools) ? toolOrTools : [toolOrTools];

  // LLxprt-specific: Determine group agentId (3-level precedence)
  const groupAgentId =
    toolCalls
      .map((trackedCall) => {
        const responseAgentId =
          'response' in trackedCall ? trackedCall.response?.agentId : undefined;
        return responseAgentId ?? trackedCall.request.agentId;
      })
      .find(
        (agentId): agentId is string =>
          typeof agentId === 'string' && agentId.trim().length > 0,
      ) ?? DEFAULT_AGENT_ID;

  const toolDisplays = toolCalls.map(
    (trackedCall): IndividualToolCallDisplay => {
      let displayName: string;
      let description: string;
      let renderOutputAsMarkdown = false;

      if (trackedCall.status === 'error') {
        displayName =
          trackedCall.tool === undefined
            ? trackedCall.request.name
            : trackedCall.tool.displayName;
        description = JSON.stringify(trackedCall.request.args);
      } else {
        displayName = trackedCall.tool.displayName;
        description = trackedCall.invocation.getDescription();
        renderOutputAsMarkdown = trackedCall.tool.isOutputMarkdown;
      }

      const baseDisplayProperties: Omit<
        IndividualToolCallDisplay,
        'status' | 'resultDisplay' | 'confirmationDetails'
      > = {
        callId: trackedCall.request.callId,
        name: displayName,
        description,
        renderOutputAsMarkdown,
      };

      switch (trackedCall.status) {
        case 'success': {
          logger.debug(
            `mapToDisplay: success call ${trackedCall.request.callId}, toolName=${trackedCall.request.name}, resultDisplay type: ${typeof trackedCall.response.resultDisplay}, hasValue: ${!!trackedCall.response.resultDisplay}`,
          );
          const outputFile = (
            trackedCall.response as { outputFile?: string | undefined }
          ).outputFile;
          return {
            ...baseDisplayProperties,
            status: mapCoreStatusToDisplayStatus(trackedCall.status),
            resultDisplay: trackedCall.response.resultDisplay,
            confirmationDetails: undefined,
            outputFile,
          };
        }
        case 'error':
          return {
            ...baseDisplayProperties,
            status: mapCoreStatusToDisplayStatus(trackedCall.status),
            resultDisplay: trackedCall.response.resultDisplay,
            confirmationDetails: undefined,
          };
        case 'cancelled':
          return {
            ...baseDisplayProperties,
            status: mapCoreStatusToDisplayStatus(trackedCall.status),
            resultDisplay: trackedCall.response.resultDisplay,
            confirmationDetails: undefined,
          };
        case 'awaiting_approval':
          return {
            ...baseDisplayProperties,
            status: mapCoreStatusToDisplayStatus(trackedCall.status),
            resultDisplay: undefined,
            confirmationDetails: trackedCall.confirmationDetails,
          };
        case 'executing': {
          const executingCall = trackedCall;
          return {
            ...baseDisplayProperties,
            status: mapCoreStatusToDisplayStatus(trackedCall.status),
            resultDisplay: executingCall.liveOutput ?? undefined,
            confirmationDetails: undefined,
            ptyId: executingCall.pid,
          };
        }
        case 'validating': // Fallthrough
        case 'scheduled':
          return {
            ...baseDisplayProperties,
            status: mapCoreStatusToDisplayStatus(trackedCall.status),
            resultDisplay: undefined,
            confirmationDetails: undefined,
          };
        default: {
          const exhaustiveCheck: never = trackedCall;
          return {
            callId: (exhaustiveCheck as TrackedToolCall).request.callId,
            name: 'Unknown Tool',
            description: 'Encountered an unknown tool call state.',
            status: ToolCallStatus.Error,
            resultDisplay: 'Unknown tool call state',
            confirmationDetails: undefined,
            renderOutputAsMarkdown: false,
          };
        }
      }
    },
  );

  return {
    type: 'tool_group',
    agentId: groupAgentId,
    tools: toolDisplays,
  };
}
