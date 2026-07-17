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
  readonly attemptCtx: BackendAttemptContext | null;
  readonly deps: BackendAttemptDeps;
}

/**
 * Prepare the delegate attempt and timeout-wrapped iterator for a single
 * backend request.
 */
function prepareBackendAttempt(
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  options: GenerateChatOptions,
  settings: FailoverSettings,
  lifecycleObserver: AttemptLifecycleObserver | undefined,
  attemptCtx: BackendAttemptContext | null,
  deps: BackendAttemptDeps,
): { attempt: DelegateAttempt; iterator: AsyncGenerator<IContent> } {
  const resolvedOptions = deps.buildResolvedOptions(subProfile, options);
  const delegateProvider = deps.providerManager.getProviderByName(
    subProfile.providerName,
  );
  if (!delegateProvider) {
    notifyBackendResult(
      lifecycleObserver,
      attemptCtx,
      subProfile,
      'error',
      `Provider "${subProfile.providerName}" not found`,
    );
    throw new Error(`Provider "${subProfile.providerName}" not found`);
  }
  requireTransportAttempt(resolvedOptions);

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
    attemptCtx,
    deps,
  } = params;

  deps.logger.debug(
    () =>
      `[LB:failover] Trying backend: ${subProfile.name} (start time: ${startTime})`,
  );

  deps.markActiveSelection(subProfile.name);

  const { attempt, iterator } = prepareBackendAttempt(
    subProfile,
    options,
    settings,
    lifecycleObserver,
    attemptCtx,
    deps,
  );

  const chunks: IContent[] = [];
  let terminalEmitted = false;
  try {
    for await (const chunk of cleanupDelegateAttempt(attempt, iterator)) {
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
    // Early iterator close (consumer return without error) must
    // finalize as aborted exactly once.
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
