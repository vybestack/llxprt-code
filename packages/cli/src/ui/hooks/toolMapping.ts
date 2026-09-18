/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Buffer } from 'node:buffer';

import {
  type Status as CoreStatus,
  DEFAULT_AGENT_ID,
  type FileDiff,
  type FileRead,
} from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import {
  ToolCallStatus,
  type HistoryItemToolGroup,
  type IndividualToolCallDisplay,
  type ToolResultRetention,
} from '../types.js';
import {
  boundResultDisplayForRetention,
  TOOL_RESULT_RETENTION_CAP_BYTES,
} from '../utils/toolResultRetention.js';
import type {
  TrackedCompletedToolCall,
  TrackedExecutingToolCall,
  TrackedScheduledToolCall,
  TrackedToolCall,
  TrackedValidatingToolCall,
  TrackedWaitingToolCall,
} from './useReactToolScheduler.js';

const logger = DebugLogger.getLogger('llxprt:cli:tool-mapping');

type StructuredToolResultDisplay = Exclude<
  IndividualToolCallDisplay['resultDisplay'],
  string | undefined
>;

/**
 * Bounds a structured display's long string fields on a shallow copy (issue
 * #3428): the scheduler's response that feeds the model is never mutated
 * (AC5). All bounded fields of ONE display share a single
 * TOOL_RESULT_RETENTION_CAP_BYTES budget spent in field order — FileDiff's
 * diff, original content, new content; FileRead's content — so the display
 * as a whole retains at most one cap, never one per field (AC1). Every
 * other field passes through untouched so the display keeps the shape its
 * renderer consumes (DiffRenderer needs the FileDiff object, not a
 * stringified body). Displays with no capped field — small diffs,
 * AnsiOutput line arrays — keep their original object and carry no
 * retention metadata.
 */
function boundStructuredDisplayForRetention(
  resultDisplay: StructuredToolResultDisplay,
): {
  resultDisplay: IndividualToolCallDisplay['resultDisplay'];
  retention: ToolResultRetention | undefined;
} {
  if (Array.isArray(resultDisplay)) {
    return { resultDisplay, retention: undefined };
  }
  const totals = { wasCapped: false, originalLength: 0 };
  // The remaining share of the display's one byte budget: each field
  // spends the bytes it actually retains, so a later oversized field sees
  // only what earlier fields left (down to nothing).
  let remainingBudgetBytes = TOOL_RESULT_RETENTION_CAP_BYTES;
  // Bounds one field value against the remaining budget, accumulating the
  // retention totals across every bounded field of the display.
  const boundField = (value: string): string => {
    const fieldBound = boundResultDisplayForRetention(
      value,
      remainingBudgetBytes,
    );
    totals.originalLength += fieldBound.originalLength;
    if (fieldBound.wasCapped) {
      totals.wasCapped = true;
    }
    remainingBudgetBytes -= Buffer.byteLength(fieldBound.text, 'utf8');
    return fieldBound.text;
  };
  // Each branch writes bounded strings back through the variant's own
  // declared field types, so the copy keeps the display's shape with every
  // write type-checked: the bounded value of a string field is a string.
  let bounded: FileDiff | FileRead;
  if ('fileDiff' in resultDisplay) {
    const diff: FileDiff = { ...resultDisplay };
    diff.fileDiff = boundField(diff.fileDiff);
    if (diff.originalContent !== null) {
      diff.originalContent = boundField(diff.originalContent);
    }
    diff.newContent = boundField(diff.newContent);
    bounded = diff;
  } else {
    const read: FileRead = { ...resultDisplay };
    read.content = boundField(read.content);
    bounded = read;
  }
  if (!totals.wasCapped) {
    return { resultDisplay, retention: undefined };
  }
  return {
    resultDisplay: bounded,
    retention: { capped: true, originalLength: totals.originalLength },
  };
}

/**
 * Bounds a display body to the shared retention cap at the moment it is
 * committed to UI state (issue #3428): string bodies head+tail, structured
 * bodies field-by-field. Only the display copy is capped; the scheduler
 * response that feeds the model is never touched here (AC5).
 */
function boundDisplayForRetention(
  resultDisplay: IndividualToolCallDisplay['resultDisplay'],
): {
  resultDisplay: IndividualToolCallDisplay['resultDisplay'];
  retention: ToolResultRetention | undefined;
} {
  if (resultDisplay === undefined) {
    return { resultDisplay, retention: undefined };
  }
  if (typeof resultDisplay === 'string') {
    const bounded = boundResultDisplayForRetention(resultDisplay);
    return {
      resultDisplay: bounded.text,
      retention: bounded.wasCapped
        ? { capped: true, originalLength: bounded.originalLength }
        : undefined,
    };
  }
  return boundStructuredDisplayForRetention(resultDisplay);
}

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

function hasInvocation(
  trackedCall: TrackedToolCall,
): trackedCall is TrackedToolCall & {
  invocation: { getDescription(): string };
} {
  return 'invocation' in trackedCall && trackedCall.invocation !== undefined;
}

function getDescription(trackedCall: TrackedToolCall): string {
  if (hasInvocation(trackedCall)) {
    return trackedCall.invocation.getDescription();
  }

  return trackedCall.response.error?.message ?? 'Tool execution failed';
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
  const { resultDisplay, retention } = boundDisplayForRetention(
    trackedCall.response.resultDisplay,
  );
  return {
    ...baseProperties,
    status: mapCoreStatusToDisplayStatus(trackedCall.status),
    resultDisplay,
    retention,
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
  const { resultDisplay, retention } = boundDisplayForRetention(
    trackedCall.response.resultDisplay,
  );
  return {
    ...baseProperties,
    status: mapCoreStatusToDisplayStatus(trackedCall.status),
    resultDisplay,
    retention,
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
