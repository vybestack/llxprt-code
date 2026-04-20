/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Utility functions for the geminiStream module.
 *
 * Contains:
 * - Pure utility functions (stateless input→output transformations)
 * - Config-bound utilities (depend on runtime config state)
 * - Micro-helpers that enable large functions to stay under 80 lines
 *
 * None of these functions call React hooks.
 */

import {
  type Config,
  getCodeAssistServer,
  UserTierId,
  UnauthorizedError,
  getErrorMessage,
  parseAndFormatApiError,
  type ToolCallRequestInfo,
  DEFAULT_AGENT_ID,
  type ThinkingBlock,
} from '@vybestack/llxprt-code-core';
import { type Part, type PartListUnion, FinishReason } from '@google/genai';
import { type LoadedSettings } from '../../../config/settings.js';
import {
  type HistoryItemWithoutId,
  type HistoryItemGemini,
  type HistoryItemGeminiContent,
  MessageType,
  type SlashCommandProcessorResult,
} from '../../types.js';
import { findLastSafeSplitPoint } from '../../utils/markdownUtilities.js';
import { SHELL_COMMAND_NAME, SHELL_NAME } from '../../constants.js';
import { type UseHistoryManagerReturn } from '../useHistoryManager.js';

// ─── Re-exported constant ────────────────────────────────────────────────────

export const SYSTEM_NOTICE_EVENT = 'system_notice' as const;

// ─── Pure utility functions ───────────────────────────────────────────────────

/**
 * Merges an array of PartListUnions into a single flat Part[].
 */
export function mergePartListUnions(list: PartListUnion[]): PartListUnion {
  const resultParts: Part[] = [];
  for (const item of list) {
    if (Array.isArray(item)) {
      for (const part of item) {
        if (typeof part === 'string') {
          resultParts.push({ text: part });
        } else {
          resultParts.push(part);
        }
      }
    } else if (typeof item === 'string') {
      resultParts.push({ text: item });
    } else {
      resultParts.push(item);
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
 * Separates a flat Part[] into functionCalls, functionResponses, and otherParts.
 * Used to maintain proper history ordering: functionCalls go to 'model' role,
 * functionResponses + otherParts go to 'user' role.
 */
export function splitPartsByRole(parts: Part[]): {
  functionCalls: Part[];
  functionResponses: Part[];
  otherParts: Part[];
} {
  const functionCalls: Part[] = [];
  const functionResponses: Part[] = [];
  const otherParts: Part[] = [];

  for (const part of parts) {
    if (part && typeof part === 'object' && 'functionCall' in part) {
      functionCalls.push(part);
    } else if (part && typeof part === 'object' && 'functionResponse' in part) {
      functionResponses.push(part);
    } else {
      otherParts.push(part);
    }
  }

  return { functionCalls, functionResponses, otherParts };
}

/**
 * Filters primary tools to those that are NOT client-initiated (Gemini-bound tools).
 */
export function collectGeminiTools<
  T extends { request: { isClientInitiated?: boolean } },
>(primaryTools: T[]): T[] {
  return primaryTools.filter((t) => !t.request.isClientInitiated);
}

/**
 * Maps a FinishReason to a user-visible message string.
 * Returns undefined for normal stop reasons (STOP, UNSPECIFIED).
 */
export function buildFinishReasonMessage(
  reason: FinishReason,
): string | undefined {
  const finishReasonMessages: Record<FinishReason, string | undefined> = {
    [FinishReason.FINISH_REASON_UNSPECIFIED]: undefined,
    [FinishReason.STOP]: undefined,
    [FinishReason.MAX_TOKENS]: 'Response truncated due to token limits.',
    [FinishReason.SAFETY]: 'Response stopped due to safety reasons.',
    [FinishReason.RECITATION]: 'Response stopped due to recitation policy.',
    [FinishReason.LANGUAGE]: 'Response stopped due to unsupported language.',
    [FinishReason.BLOCKLIST]: 'Response stopped due to forbidden terms.',
    [FinishReason.PROHIBITED_CONTENT]:
      'Response stopped due to prohibited content.',
    [FinishReason.SPII]:
      'Response stopped due to sensitive personally identifiable information.',
    [FinishReason.OTHER]: 'Response stopped for other reasons.',
    [FinishReason.MALFORMED_FUNCTION_CALL]:
      'Response stopped due to malformed function call.',
    [FinishReason.IMAGE_SAFETY]:
      'Response stopped due to image safety violations.',
    [FinishReason.UNEXPECTED_TOOL_CALL]:
      'Response stopped due to unexpected tool call.',
    [FinishReason.IMAGE_PROHIBITED_CONTENT]:
      'Response stopped due to prohibited content.',
    [FinishReason.NO_IMAGE]: 'Response stopped due to no image.',
  };
  return finishReasonMessages[reason];
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
): HistoryItemGemini | HistoryItemGeminiContent {
  const existingProfileName = (
    currentItem as HistoryItemGemini | HistoryItemGeminiContent | undefined
  )?.profileName;
  const profileName = liveProfileName ?? existingProfileName;
  return {
    type: (currentItem?.type as 'gemini' | 'gemini_content') ?? 'gemini',
    text: sanitizedCombined,
    ...(profileName != null ? { profileName } : {}),
    ...(thinkingBlocks.length > 0
      ? { thinkingBlocks: [...thinkingBlocks] }
      : {}),
  } as HistoryItemGemini | HistoryItemGeminiContent;
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
  fullTextItem: HistoryItemGemini | HistoryItemGeminiContent;
  afterItem: HistoryItemGeminiContent;
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
  } as HistoryItemGemini | HistoryItemGeminiContent;

  const afterItem: HistoryItemGeminiContent = {
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
  config: Config,
  onAuthError: () => void,
  timestamp: number,
): boolean {
  if (error instanceof UnauthorizedError) {
    onAuthError();
    return true;
  }
  const isAbortError = error instanceof Error && error.name === 'AbortError';
  if (!isAbortError) {
    addItem(
      {
        type: MessageType.ERROR,
        text: parseAndFormatApiError(
          getErrorMessage(error) || 'Unknown error',
          undefined,
          config.getModel(),
        ),
      },
      timestamp,
    );
  }
  return false;
}

// ─── Config-bound utilities ────────────────────────────────────────────────────
// These depend on runtime config state and are NOT pure functions.

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
  config: Config,
): boolean {
  try {
    const settingsService = config.getSettingsService();
    if (settingsService) {
      const enabled = settingsService.get('ui.showCitations');
      if (enabled !== undefined) {
        return enabled as boolean;
      }
    }
  } catch {
    // Fall through to other methods
  }

  const enabled = (settings?.merged as { ui?: { showCitations?: boolean } })?.ui
    ?.showCitations;
  if (enabled !== undefined) {
    return enabled;
  }

  const server = getCodeAssistServer(config);
  return (server && server.userTier !== UserTierId.FREE) ?? false;
}

/**
 * Gets the current profile name from config's settings service.
 * Reads the live value rather than relying on React state, ensuring
 * profile changes via slash commands are immediately reflected.
 */
export function getCurrentProfileName(config: Config): string | null {
  try {
    const settingsService = config.getSettingsService();
    if (
      settingsService &&
      typeof settingsService.getCurrentProfileName === 'function'
    ) {
      return settingsService.getCurrentProfileName() ?? null;
    }
  } catch {
    // Fall through if settings service unavailable
  }
  return null;
}
