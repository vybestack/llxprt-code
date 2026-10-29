/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';

/**
 * The provider lookups the purge path makes: the active provider, and a
 * by-name lookup used when the session targets a different profile.
 */
export interface PurgeProviderLookup {
  getActiveProvider(): IProvider;
  getProviderByName?(name: string): IProvider | undefined;
}

/**
 * What the semantic-purge start reads from the runtime: the provider lookups
 * and the prompt-caching policy that decides whether the observed cache write
 * must be observed first.
 */
export interface SemanticPurgeRuntime {
  readonly provider: PurgeProviderLookup;
  readonly readPromptCachingPolicy: () => unknown;
}

/** The session runtime members the purge start projects. */
export type SemanticPurgeSource = SemanticPurgeRuntime;

/**
 * Projects the two runtime members the purge start reads.
 */
export function semanticPurgeRuntime(
  context: SemanticPurgeSource,
): SemanticPurgeRuntime {
  return {
    provider: context.provider,
    readPromptCachingPolicy: context.readPromptCachingPolicy,
  };
}

export function requiresObservedSemanticPurgeCacheWrite(
  readPromptCachingPolicy: () => unknown,
  provider: IProvider,
): boolean {
  const promptCaching = readPromptCachingPolicy();
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
  runtime: SemanticPurgeRuntime,
  desiredName: string,
  execution: AgentChatRecordingExecution | undefined,
  signal?: AbortSignal,
): ReturnType<SemanticMediaPurgeSession['begin']> {
  if (!purge.isEnabled()) return Promise.resolve(undefined);
  const active = runtime.provider.getActiveProvider();
  const provider =
    active.name === desiredName
      ? active
      : runtime.provider.getProviderByName?.(desiredName);
  if (provider === undefined) {
    throw new Error(
      `Provider '${desiredName}' is unavailable for semantic media purge`,
    );
  }
  return purge.begin(
    requiresObservedSemanticPurgeCacheWrite(
      runtime.readPromptCachingPolicy,
      provider,
    ),
    execution?.persistSemanticMediaPurge,
    signal,
  );
}

export function createSemanticMediaPurgeSession(
  readMode: () => 'off' | 'remove' | 'summary',
  history: HistoryService,
): SemanticMediaPurgeSession {
  return new SemanticMediaPurgeSession({
    history,
    mode: readMode,
    persist: () => {
      throw new Error(
        'Semantic media purge requires an active session recording',
      );
    },
  });
}
