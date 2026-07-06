/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Utility functions for the agentStream module.
 *
 * Contains:
 * - Pure utility functions (stateless input→output transformations)
 * - runtime-bound utilities (depend on runtime config state)
 * - Micro-helpers that enable large functions to stay under 80 lines
 *
 * None of these functions call React hooks.
 */

import {
  type CanonicalFinishReason,
  getCodeAssistServer,
  UserTierId,
  UnauthorizedError,
  getErrorMessage,
  parseAndFormatApiError,
  type ToolCallRequestInfo,
  DEFAULT_AGENT_ID,
  type ThinkingBlock,
} from '@vybestack/llxprt-code-core';
import {
  AllBucketsExhaustedError,
  isAuthBucketFailureReason,
} from '@vybestack/llxprt-code-providers';
import { type Part, type PartListUnion } from '@google/genai';
import { type LoadedSettings } from '../../../config/settings.js';
import {
  type HistoryItemWithoutId,
  type HistoryItemAi,
  type HistoryItemAiContent,
  MessageType,
  type SlashCommandProcessorResult,
} from '../../types.js';
import { findLastSafeSplitPoint } from '../../utils/markdownUtilities.js';
import { SHELL_COMMAND_NAME, SHELL_NAME } from '../../constants.js';
import { type UseHistoryManagerReturn } from '../useHistoryManager.js';
import {
  getActiveProviderNameForApiError,
  getErrorFallbackModel,
  type ApiErrorRuntimeInfo,
} from '../../../utils/apiErrorFormatting.js';
import { REFUSAL_NOTICE_MESSAGE } from '../../../utils/refusalNotice.js';
import type { StreamRuntime } from '../../cliUiRuntime.js';

// ─── Re-exported constant ────────────────────────────────────────────────────

export const SYSTEM_NOTICE_EVENT = 'system_notice' as const;

/**
 * @issue:2329 — Re-export of the shared safety-classifier refusal notice text.
 * Kept for back-compat with existing imports (e.g. test files). The canonical
 * definition lives in utils/refusalNotice.ts (sourced from core).
 */
export { REFUSAL_NOTICE_MESSAGE } from '../../../utils/refusalNotice.js';

// ─── Pure utility functions ───────────────────────────────────────────────────

/**
 * Adds a part (string or Part object) to the result array.
 */
function addPartToResult(part: string | Part, resultParts: Part[]): void {
  if (typeof part === 'string') {
    resultParts.push({ text: part });
  } else {
    resultParts.push(part);
  }
}

/**
 * Merges an array of PartListUnions into a single flat Part[].
 */
export function mergePartListUnions(list: PartListUnion[]): PartListUnion {
  const resultParts: Part[] = [];
  for (const item of list) {
    if (Array.isArray(item)) {
      for (const part of item) {
        addPartToResult(part, resultParts);
      }
    } else {
      addPartToResult(item, resultParts);
    }
  }
  return resultParts;
}

/**
 * Merges pending history item and pending tool call group for display,
 * deduplicating overlapping tool call IDs and preferring shell command entries
 * from the pending history item.
 */
export function mergePendingToolGroupsForDisplay(
  pendingHistoryItem: HistoryItemWithoutId | null | undefined,
  pendingToolCallGroupDisplay: HistoryItemWithoutId | null | undefined,
): HistoryItemWithoutId[] {
  if (
    pendingHistoryItem?.type === 'tool_group' &&
    pendingToolCallGroupDisplay?.type === 'tool_group'
  ) {
    const schedulerToolCallIds = new Set(
      pendingToolCallGroupDisplay.tools.map((tool) => tool.callId),
    );

    const overlappingCallIds = new Set(
      pendingHistoryItem.tools
        .filter((tool) => schedulerToolCallIds.has(tool.callId))
        .map((tool) => tool.callId),
    );

    if (overlappingCallIds.size === 0) {
      return [pendingHistoryItem, pendingToolCallGroupDisplay];
    }

    const filteredPendingTools = pendingHistoryItem.tools.filter(
      (tool) => !overlappingCallIds.has(tool.callId),
    );

    const overlappingShellTools = pendingHistoryItem.tools.filter(
      (tool) =>
        overlappingCallIds.has(tool.callId) &&
        (tool.name === SHELL_COMMAND_NAME || tool.name === SHELL_NAME),
    );
    const overlappingShellCallIds = new Set(
      overlappingShellTools.map((tool) => tool.callId),
    );
    const filteredSchedulerTools = pendingToolCallGroupDisplay.tools.filter(
      (tool) => !overlappingShellCallIds.has(tool.callId),
    );

    const mergedItems: HistoryItemWithoutId[] = [];

    if (filteredPendingTools.length > 0 || overlappingShellTools.length > 0) {
      mergedItems.push({
        ...pendingHistoryItem,
        tools: [...filteredPendingTools, ...overlappingShellTools],
      });
    }

    if (filteredSchedulerTools.length > 0) {
      mergedItems.push({
        ...pendingToolCallGroupDisplay,
        tools: filteredSchedulerTools,
      });
    }

    return mergedItems;
  }

  return [pendingHistoryItem, pendingToolCallGroupDisplay].filter(
    (i): i is HistoryItemWithoutId => i !== undefined && i !== null,
  );
}

/**
 * Filters primary tools to those that are NOT client-initiated (model-bound tools).
 */
export function collectAgentTools<
  T extends { request: { isClientInitiated?: boolean } },
>(primaryTools: T[]): T[] {
  return primaryTools.filter((t) => t.request.isClientInitiated !== true);
}

/**
 * Maps a finish reason to a user-visible message string.
 * Returns undefined for normal stop reasons ('stop', undefined).
 *
 * Primary classification is on the canonical finish reason. Finer-grained
 * legacy messages (recitation, language, blocklist, etc.) are surfaced when
 * the raw provider stop reason string identifies a specific sub-case.
 */
export function buildFinishReasonMessage(
  reason: CanonicalFinishReason | undefined,
  rawStopReason?: string,
): string | undefined {
  switch (reason) {
    case 'max_tokens':
      return 'Response truncated due to token limits.';
    case 'safety':
      return resolveSafetyMessage(rawStopReason);
    case 'refusal':
      return REFUSAL_NOTICE_MESSAGE;
    case 'error':
      return resolveErrorMessage(rawStopReason);
    case 'stop':
    case 'tool_calls':
    case undefined:
      return undefined;
    case 'other':
    default:
      return resolveOtherMessage(rawStopReason);
  }
}

function resolveSafetyMessage(
  rawStopReason: string | undefined,
): string | undefined {
  switch (rawStopReason) {
    case 'RECITATION':
      return 'Response stopped due to recitation policy.';
    case 'BLOCKLIST':
      return 'Response stopped due to forbidden terms.';
    case 'PROHIBITED_CONTENT':
    case 'IMAGE_PROHIBITED_CONTENT':
      return 'Response stopped due to prohibited content.';
    case 'SPII':
      return 'Response stopped due to sensitive personally identifiable information.';
    case 'IMAGE_SAFETY':
      return 'Response stopped due to image safety violations.';
    default:
      return 'Response stopped due to safety reasons.';
  }
}

function resolveErrorMessage(
  rawStopReason: string | undefined,
): string | undefined {
  if (rawStopReason === 'MALFORMED_FUNCTION_CALL') {
    return 'Response stopped due to malformed function call.';
  }
  if (rawStopReason === 'UNEXPECTED_TOOL_CALL') {
    return 'Response stopped due to unexpected tool call.';
  }
  return 'Response stopped due to a model error.';
}

function resolveOtherMessage(
  rawStopReason: string | undefined,
): string | undefined {
  if (rawStopReason === 'LANGUAGE') {
    return 'Response stopped due to unsupported language.';
  }
  if (rawStopReason === 'NO_IMAGE') {
    return 'Response stopped due to no image.';
  }
  return 'Response stopped for other reasons.';
}

/**
 * @issue:2329 — Returns a refusal-specific notice when the raw provider stop
 * reason indicates the model's safety classifier refused the request.
 * Returns undefined for all other stop reasons, allowing callers to fall back
 * to the generic {@link buildFinishReasonMessage}.
 */
export function buildRefusalNoticeMessage(
  stopReason: string | undefined,
): string | undefined {
  if (stopReason === 'refusal') {
    return REFUSAL_NOTICE_MESSAGE;
  }
  return undefined;
}

/**
 * Deduplicates ToolCallRequestInfo[] by callId, preserving insertion order.
 * Addresses issue #1040 where duplicate ToolCallRequest events cause the same
 * command to execute twice.
 */
export function deduplicateToolCallRequests(
  requests: ToolCallRequestInfo[],
): ToolCallRequestInfo[] {
  const seenCallIds = new Set<string>();
  return requests.filter((request) => {
    if (seenCallIds.has(request.callId)) {
      return false;
    }
    seenCallIds.add(request.callId);
    return true;
  });
}

/**
 * Creates a ThinkingBlock from a thought event, deduplicating against existing blocks.
 * Returns null if the thought is empty or already present in existingBlocks.
 */
export function buildThinkingBlock(
  thoughtText: string,
  existingBlocks: ThinkingBlock[],
): ThinkingBlock | null {
  if (!thoughtText) {
    return null;
  }
  const alreadyHasThought = existingBlocks.some(
    (tb) => tb.thought === thoughtText,
  );
  if (alreadyHasThought) {
    return null;
  }
  return {
    type: 'thinking',
    thought: thoughtText,
    sourceField: 'thought',
  };
}

/**
 * Builds the full-split pending history item for the no-split case in
 * handleContentEvent. Preserves the existing item's type and profileName.
 *
 * Profile name precedence: liveProfileName takes priority when present;
 * existingProfileName (from the current pending item) is used as a fallback
 * when liveProfileName is null/undefined.
 */
export function buildFullSplitItem(
  currentItem: HistoryItemWithoutId | null,
  sanitizedCombined: string,
  liveProfileName: string | null,
  thinkingBlocks: ThinkingBlock[],
): HistoryItemAi | HistoryItemAiContent {
  const existingProfileName = (
    currentItem as HistoryItemAi | HistoryItemAiContent | undefined
  )?.profileName;
  const profileName = liveProfileName ?? existingProfileName;
  const type =
    currentItem?.type === 'gemini_content' ? 'gemini_content' : 'gemini';
  return {
    type,
    text: sanitizedCombined,
    ...(profileName != null ? { profileName } : {}),
    ...(thinkingBlocks.length > 0
      ? { thinkingBlocks: [...thinkingBlocks] }
      : {}),
  } as HistoryItemAi | HistoryItemAiContent;
}

/**
 * Computes the markdown-safe split point and returns the before/after split and
 * resulting pending item. Used by handleContentEvent to keep the function under
 * 80 lines.
 *
 * Returns the data needed to update state — the caller performs the mutations.
 */
export function buildSplitContent(
  sanitizedCombined: string,
  liveProfileName: string | null,
  existingProfileName: string | null | undefined,
  thinkingBlocks: ThinkingBlock[],
  pendingType: 'gemini' | 'gemini_content',
): {
  splitPoint: number;
  beforeText: string;
  afterText: string;
  fullTextItem: HistoryItemAi | HistoryItemAiContent;
  afterItem: HistoryItemAiContent;
} {
  const splitPoint = findLastSafeSplitPoint(sanitizedCombined);
  const beforeText = sanitizedCombined.substring(0, splitPoint);
  const afterText = sanitizedCombined.substring(splitPoint);

  const profileName = liveProfileName ?? existingProfileName ?? null;
  const profileNameProp = profileName != null ? { profileName } : {};
  const thinkingProp =
    thinkingBlocks.length > 0 ? { thinkingBlocks: [...thinkingBlocks] } : {};

  const fullTextItem = {
    type: pendingType,
    text: sanitizedCombined,
    ...profileNameProp,
    ...thinkingProp,
  } as HistoryItemAi | HistoryItemAiContent;

  const afterItem: HistoryItemAiContent = {
    type: 'gemini_content',
    text: afterText,
    ...profileNameProp,
  };

  return { splitPoint, beforeText, afterText, fullTextItem, afterItem };
}

/**
 * Dispatches a slash command result, calling the appropriate side effect.
 *
 * NOTE: This function is side-effecting — it may call `scheduleToolCalls`
 * and therefore has async behavior. It is placed in streamUtils for convenience
 * but is NOT a pure function.
 *
 * Returns an object indicating how the caller should proceed.
 */
export async function processSlashCommandResult(
  result: SlashCommandProcessorResult,
  scheduleToolCalls: (
    requests: ToolCallRequestInfo[],
    signal: AbortSignal,
  ) => Promise<void> | void,
  prompt_id: string,
  abortSignal: AbortSignal,
): Promise<{ queryToSend: PartListUnion | null; shouldProceed: boolean }> {
  switch (result.type) {
    case 'schedule_tool': {
      const { toolName, toolArgs } = result;
      const toolCallRequest: ToolCallRequestInfo = {
        callId: `${toolName}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: toolName,
        args: toolArgs,
        isClientInitiated: true,
        prompt_id,
        agentId: DEFAULT_AGENT_ID,
      };
      await scheduleToolCalls([toolCallRequest], abortSignal);
      return { queryToSend: null, shouldProceed: false };
    }
    case 'submit_prompt': {
      return { queryToSend: result.content, shouldProceed: true };
    }
    case 'handled': {
      return { queryToSend: null, shouldProceed: false };
    }
    default: {
      const unreachable: never = result;
      throw new Error(`Unhandled slash command result type: ${unreachable}`);
    }
  }
}

/**
 * Formats and adds an error item from the submitQuery catch block.
 * Handles UnauthorizedError, AbortError, and generic errors.
 *
 * Returns true if onAuthError was triggered (caller should return early).
 */
export function handleSubmissionError(
  error: unknown,
  addItem: UseHistoryManagerReturn['addItem'],
  runtime: StreamRuntime,
  onAuthError: () => void,
  timestamp: number,
): boolean {
  if (error instanceof UnauthorizedError) {
    onAuthError();
    return true;
  }
  if (error instanceof AllBucketsExhaustedError) {
    const hasAuthReason = Object.values(error.bucketFailureReasons).some((r) =>
      isAuthBucketFailureReason(r),
    );
    if (hasAuthReason) {
      addItem(
        {
          type: MessageType.ERROR,
          text: error.message,
        },
        timestamp,
      );
      onAuthError();
      return true;
    }
  }
  const isAbortError = error instanceof Error && error.name === 'AbortError';
  if (!isAbortError) {
    const apiErrorInfo = buildApiErrorInfo(runtime);
    const providerName = getActiveProviderNameForApiError(apiErrorInfo);
    const fallbackModel = getErrorFallbackModel(apiErrorInfo, providerName);
    addItem(
      {
        type: MessageType.ERROR,
        text: parseAndFormatApiError(
          getErrorMessage(error) || 'Unknown error',
          undefined,
          fallbackModel,
          providerName,
        ),
      },
      timestamp,
    );
  }
  return false;
}

// ─── runtime-bound utilities ────────────────────────────────────────────────────
// These depend on runtime config state and are NOT pure functions.

/**
 * Builds a narrow adapter satisfying {@link ApiErrorRuntimeInfo} from the
 * nested StreamRuntime, so API-error helpers receive focused capability
 * objects rather than a flat aggregate.
 */
export function buildApiErrorInfo(runtime: StreamRuntime): ApiErrorRuntimeInfo {
  return {
    getProviderManager: () => runtime.model.getProviderManager(),
    getProvider: () => runtime.model.getProvider(),
    getSettingsService: () => runtime.settings.getSettingsService(),
    getModel: () => runtime.model.getModel(),
  };
}

/**
 * Determines whether citations should be shown.
 * Uses a fallback precedence chain:
 * 1. settingsService.get('ui.showCitations')
 * 2. settings.merged.ui.showCitations
 * 3. userTier !== FREE (tier-based default)
 * 4. false (final default)
 */
export function showCitations(
  settings: LoadedSettings,
  runtime: StreamRuntime,
): boolean {
  try {
    const enabled = runtime.settings
      .getSettingsService()
      .get('ui.showCitations');
    if (enabled !== undefined) {
      return enabled as boolean;
    }
  } catch {
    // Fall through to other methods
  }

  const enabled = settings.merged.ui.showCitations;
  if (enabled !== undefined) {
    return enabled;
  }

  const server = getCodeAssistServer({
    getAgentClient: () => runtime.agentClientSource.getAgentClient(),
  });
  return server != null && server.userTier !== UserTierId.FREE;
}

/**
 * Gets the current profile name from config's settings service.
 * Reads the live value rather than relying on React state, ensuring
 * profile changes via slash commands are immediately reflected.
 */
export function getCurrentProfileName(runtime: StreamRuntime): string | null {
  try {
    return (
      runtime.settings.getSettingsService().getCurrentProfileName() ?? null
    );
  } catch {
    // Fall through if settings service unavailable
  }
  return null;
}
