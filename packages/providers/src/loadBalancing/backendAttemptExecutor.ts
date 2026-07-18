/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { GenerateChatOptions } from '../IProvider.js';
import type { ProviderManager } from '../ProviderManager.js';
import type {
  ResolvedSubProfile,
  LoadBalancerSubProfile,
  FailoverSettings,
} from './loadBalancerTypes.js';
import type { AttemptLifecycleObserver } from '../logging/attemptLifecycle.js';
import type {
  BackendAttemptContext,
  BackendMetricsHooks,
} from './backendLifecycleNotifier.js';
import {
  notifyBackendResult,
  recordBackendSuccess,
} from './backendLifecycleNotifier.js';
import type { DelegateAttempt } from './delegateAttempt.js';
import {
  cleanupDelegateAttempt,
  createDelegateAttempt,
  requireTransportAttempt,
} from './delegateAttempt.js';
import { wrapWithTimeout } from './streamTimeout.js';
import type { CircuitBreakerManager } from './circuitBreakerManager.js';

export interface BackendAttemptDeps {
  readonly logger: DebugLogger;
  readonly circuitBreaker: CircuitBreakerManager;
  readonly providerManager: ProviderManager;
  markActiveSelection(name: string): void;
  buildResolvedOptions(
    subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
    options: GenerateChatOptions,
  ): GenerateChatOptions;
  getMetricsHooks(): BackendMetricsHooks;
  incrementStats(name: string): void;
}

export interface BackendAttemptParams {
  readonly subProfile: ResolvedSubProfile | LoadBalancerSubProfile;
  readonly options: GenerateChatOptions;
  readonly settings: FailoverSettings;
  readonly startTime: number;
  readonly chunksYielded: { value: boolean };
  readonly lifecycleObserver: AttemptLifecycleObserver | undefined;
  /** Factory that starts the backend attempt lifecycle. Called only
   * after setup checks pass, immediately before the actual delegate
   * generateChatCompletion invocation — so setup failures (missing
   * provider, exhausted transport budget) do NOT emit phantom lifecycle
   * start events. Returns the context needed for the terminal record. */
  readonly startBackendAttempt: () => BackendAttemptContext | null;
  readonly deps: BackendAttemptDeps;
}

/**
 * Validate that the backend is ready for an attempt. May throw on setup
 * failure (missing provider or exhausted transport budget). Does NOT
 * emit lifecycle events or invoke the delegate — callers can safely
 * failover when this throws without leaving a phantom lifecycle record.
 *
 * Returns the resolved options and delegate provider so the caller can
 * start the lifecycle and invoke the delegate immediately after.
 */
function resolveBackendDelegate(
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  options: GenerateChatOptions,
  deps: BackendAttemptDeps,
): {
  resolvedOptions: GenerateChatOptions;
  delegateProvider: NonNullable<
    ReturnType<ProviderManager['getProviderByName']>
  >;
} {
  const resolvedOptions = deps.buildResolvedOptions(subProfile, options);
  const delegateProvider = deps.providerManager.getProviderByName(
    subProfile.providerName,
  );
  if (!delegateProvider) {
    throw new Error(`Provider "${subProfile.providerName}" not found`);
  }
  requireTransportAttempt(resolvedOptions);
  return { resolvedOptions, delegateProvider };
}

/**
 * Invoke the delegate provider and wrap the resulting iterator with
 * timeout handling. This is the point where a real transport attempt
 * begins — lifecycle start must have already been emitted.
 */
function startDelegateIterator(
  delegateProvider: NonNullable<
    ReturnType<ProviderManager['getProviderByName']>
  >,
  resolvedOptions: GenerateChatOptions,
  settings: FailoverSettings,
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  deps: BackendAttemptDeps,
): { attempt: DelegateAttempt; iterator: AsyncGenerator<IContent> } {
  const attempt = createDelegateAttempt(resolvedOptions);
  const rawIterator = delegateProvider.generateChatCompletion(attempt.options);
  const iterator = wrapWithTimeout(
    rawIterator,
    settings.timeoutMs,
    subProfile.name,
    deps.logger,
    {
      signal: attempt.linked.controller.signal,
      cancel: () => attempt.linked.controller.abort(),
    },
  );
  return { attempt, iterator };
}

/**
 * Execute a single backend attempt within the failover loop, collecting
 * chunks, recording success/failure metrics, and emitting terminal
 * lifecycle notifications.
 *
 * Extracted from LoadBalancingProvider to keep the main class under the
 * max-lines limit while preserving identical behavior.
 */
export async function* executeBackendAttempt(
  params: BackendAttemptParams,
): AsyncGenerator<IContent> {
  const {
    subProfile,
    options,
    settings,
    startTime,
    chunksYielded,
    lifecycleObserver,
    startBackendAttempt,
    deps,
  } = params;

  deps.markActiveSelection(subProfile.name);
  const chunks: IContent[] = [];
  let attemptCtx: BackendAttemptContext | null = null;
  let terminalEmitted = false;

  const { resolvedOptions, delegateProvider } = resolveBackendDelegate(
    subProfile,
    options,
    deps,
  );
  attemptCtx = startBackendAttempt();

  try {
    const prepared = startDelegateIterator(
      delegateProvider,
      resolvedOptions,
      settings,
      subProfile,
      deps,
    );
    for await (const chunk of cleanupDelegateAttempt(
      prepared.attempt,
      prepared.iterator,
    )) {
      chunksYielded.value = true;
      chunks.push(chunk);
      yield chunk;
    }
    recordBackendSuccess(
      subProfile,
      startTime,
      chunks,
      deps.getMetricsHooks(),
      lifecycleObserver,
      attemptCtx,
    );
    terminalEmitted = true;
    deps.incrementStats(subProfile.name);
    deps.circuitBreaker.recordBackendSuccess(subProfile.name);
    deps.logger.debug(
      () => `[LB:failover] Success on backend: ${subProfile.name}`,
    );
  } catch (error) {
    const isAbort =
      error instanceof Error &&
      (error.name === 'AbortError' ||
        (error as NodeJS.ErrnoException).code === 'ABORT_ERR');
    notifyBackendResult(
      lifecycleObserver,
      attemptCtx,
      subProfile,
      isAbort ? 'aborted' : 'error',
      error instanceof Error ? error.message : String(error),
    );
    terminalEmitted = true;
    throw error;
  } finally {
    if (!terminalEmitted) {
      notifyBackendResult(
        lifecycleObserver,
        attemptCtx,
        subProfile,
        'aborted',
        'consumer early close',
      );
    }
  }
}
