/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';

export function requiresObservedSemanticPurgeCacheWrite(
  runtimeContext: AgentRuntimeContext,
  provider: IProvider,
): boolean {
  const promptCaching = runtimeContext.readPromptCachingPolicy();
  const validPromptCachingValues = new Set<unknown>([
    undefined,
    'off',
    '5m',
    '1h',
    '24h',
  ]);
  if (!validPromptCachingValues.has(promptCaching)) {
    throw new Error(
      `Invalid prompt-caching setting for semantic media purge: ${String(promptCaching)}`,
    );
  }
  return (
    provider.getMediaTransportCapabilities?.().explicitCacheBreakpoints ===
      true &&
    promptCaching !== undefined &&
    promptCaching !== 'off'
  );
}

export function beginSemanticMediaPurge(
  purge: SemanticMediaPurgeSession,
  runtimeContext: AgentRuntimeContext,
  desiredName: string,
  execution: AgentChatRecordingExecution | undefined,
): ReturnType<SemanticMediaPurgeSession['begin']> {
  if (!purge.isEnabled()) return Promise.resolve(undefined);
  const active = runtimeContext.provider.getActiveProvider();
  const provider =
    active.name === desiredName
      ? active
      : runtimeContext.provider.getProviderByName?.(desiredName);
  if (provider === undefined) {
    throw new Error(
      `Provider '${desiredName}' is unavailable for semantic media purge`,
    );
  }
  return purge.begin(
    requiresObservedSemanticPurgeCacheWrite(runtimeContext, provider),
    execution?.persistSemanticMediaPurge,
  );
}

export function createSemanticMediaPurgeSession(
  runtimeContext: AgentRuntimeContext,
  history: HistoryService,
): SemanticMediaPurgeSession {
  return new SemanticMediaPurgeSession({
    history,
    mode: () => runtimeContext.ephemerals.semanticMediaPurge(),
    persist: () => {
      throw new Error(
        'Semantic media purge requires an active session recording',
      );
    },
  });
}
