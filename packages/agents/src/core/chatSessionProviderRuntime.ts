import type { ProviderRequestCollaborators } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { splitPartsByRole } from './agenticLoop/loopHelpers.js';
import type { CompletedToolCall } from './coreToolScheduler.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { NoActiveProviderError } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { ANTHROPIC_DEFAULT_BASE_URL } from '@vybestack/llxprt-code-providers';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';

export function resolveProviderBaseUrl(
  provider: IProvider,
  baseUrl: string | undefined,
): string | undefined {
  // Load balancers: use the last-selected sub-profile's base URL so that
  // turns are stamped with the actual endpoint that generated them. This
  // enables cross-endpoint thinking-block stripping when a load balancer
  // rotates between Anthropic-compatible endpoints (e.g. z.ai and native
  // Anthropic).
  const lbProvider = provider as unknown as {
    getLastSelectedBaseUrl?: () => string | undefined;
  };
  if (typeof lbProvider.getLastSelectedBaseUrl === 'function') {
    const lbBaseUrl = lbProvider.getLastSelectedBaseUrl();
    if (lbBaseUrl) return lbBaseUrl;
  }
  // Native Anthropic without an explicit base URL defaults to
  // api.anthropic.com. Stamping turns with this default ensures they are
  // distinguishable from z.ai turns and can be stripped when switching.
  if (provider.name === 'anthropic') {
    return baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL;
  }
  return baseUrl;
}

export function initialProviderBaseUrl(
  provider: string,
  baseUrl: string | undefined,
): string | undefined {
  return (
    baseUrl ??
    (provider === 'anthropic' ? ANTHROPIC_DEFAULT_BASE_URL : undefined)
  );
}

export async function cleanupChatSessionProviderFiles(
  lifecycle: ProviderFileLifecycle | undefined,
  runtimeId: string,
): Promise<void> {
  if (lifecycle === undefined) return;
  const result = await lifecycle.cleanupScope('session', runtimeId);
  if (result.failed > 0) {
    throw new Error(
      `Provider file cleanup incomplete for session ${runtimeId}; files=${lifecycle
        .snapshot()
        .deletionFailures.map((failure) => failure.fileId)
        .join(',')}`,
    );
  }
  if (result.deferred > 0) {
    await lifecycle.waitForScopeCleanup('session', runtimeId);
  }
}

export function completedToolResponses(
  toolCalls: CompletedToolCall[],
  logger: DebugLogger,
): ContentBlock[] {
  const allBlocks = toolCalls.flatMap((toolCall): ContentBlock[] => {
    // Defensive for deserialized/test-cast tool responses that bypass the
    // static ToolCallResponseInfo contract.
    const response = toolCall.response as
      | { responseParts?: unknown }
      | undefined;
    const responseParts = response?.responseParts;
    if (!Array.isArray(responseParts)) {
      logger.warn(
        () =>
          `recordCompletedToolCalls: skipping tool call '${toolCall.request.callId}' because responseParts is not an array`,
      );
      return [];
    }
    return responseParts as ContentBlock[];
  });
  const { functionResponses } = splitPartsByRole(allBlocks);

  return functionResponses;
}

export function logChatInitialization(
  logger: DebugLogger,
  model: string,
  initialHistoryLength: number,
): void {
  logger.debug('ChatSession initialized:', {
    model,
    initialHistoryLength,
    hasHistoryService: true,
    hasRuntimeState: true,
  });
}

export function completedToolResponseIds(
  functionResponses: ContentBlock[],
): string[] {
  const responseCallIds = functionResponses
    .map((response) =>
      response.type === 'tool_response' ? response.callId : undefined,
    )
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  return responseCallIds;
}

export function chatResolvedBaseUrl(
  resolveProvider: () => IProvider,
  baseUrl: string | undefined,
): string | undefined {
  try {
    return resolveProviderBaseUrl(resolveProvider(), baseUrl);
  } catch (error) {
    if (error instanceof NoActiveProviderError) {
      return undefined;
    }
    throw error;
  }
}

export function tryReadActiveProvider(
  readActive: () => IProvider,
): IProvider | undefined {
  try {
    return readActive();
  } catch (error) {
    if (error instanceof NoActiveProviderError) {
      return undefined;
    }
    throw error;
  }
}

export function supportsChatCompletion(
  provider: IProvider | undefined,
): boolean {
  if (!provider) return false;
  return typeof provider.generateChatCompletion === 'function';
}

export function buildChatProviderRuntime(
  baseRuntime: ProviderRequestCollaborators,
  selectedRuntimeId: string,
  source: string,
  metadata: Record<string, unknown>,
): ProviderRequestCollaborators {
  return {
    ...baseRuntime,
    runtimeId: baseRuntime.runtimeId ?? selectedRuntimeId,
    metadata: {
      ...(baseRuntime.metadata ?? {}),
      source,
      ...metadata,
    },
  };
}
