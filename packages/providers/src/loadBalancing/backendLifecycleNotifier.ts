/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AttemptLifecycleObserver } from '../logging/attemptLifecycle.js';
import type {
  ResolvedSubProfile,
  LoadBalancerSubProfile,
} from './loadBalancerTypes.js';
import { resolveSubProfileModel } from './subProfileHelpers.js';
import { BackendMetricsCollector } from './backendMetrics.js';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';

export interface BackendAttemptContext {
  attemptId: string;
  attemptIndex: number;
  startMs: number;
}

export type BackendAttemptStatus = 'success' | 'error' | 'aborted';

export interface BackendMetricsHooks {
  updateTPM: (profileName: string, tokensUsed: number) => void;
  recordRequestSuccess: (
    profileName: string,
    startTime: number,
    tokensUsed: number,
  ) => void;
  recordRequestFailure: (
    profileName: string,
    startTime: number,
    error: Error,
  ) => void;
}

export function notifyBackendStart(
  observer: AttemptLifecycleObserver | undefined,
  profileName: string,
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  attemptIndex: number,
  idSequence: number,
  logger: DebugLogger,
): BackendAttemptContext | null {
  if (!observer) return null;
  // Global idSequence provides uniqueness; attemptIndex is request-local
  // so the lifecycle observer sees 0-based indexes per request.
  const attemptId = `${profileName}#${subProfile.name}#${idSequence}`;
  const startMs = performance.now();
  try {
    observer.onAttemptStart({
      requestStartMs: startMs,
      attemptId,
      attemptIndex,
      providerName: subProfile.providerName,
      modelName: resolveSubProfileModel(subProfile),
    });
  } catch (err) {
    logger.debug(
      () =>
        `LB lifecycle onAttemptStart failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { attemptId, attemptIndex, startMs };
}

export function notifyBackendEnd(
  observer: AttemptLifecycleObserver | undefined,
  ctx: BackendAttemptContext,
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  status: BackendAttemptStatus,
  errorMessage: string | undefined,
): void {
  if (!observer) return;
  try {
    observer.onAttemptEnd({
      attemptId: ctx.attemptId,
      attemptIndex: ctx.attemptIndex,
      start: ctx.startMs,
      completionMs: performance.now(),
      firstTokenMs: null,
      lastTokenMs: null,
      status,
      providerName: subProfile.providerName,
      modelName: resolveSubProfileModel(subProfile),
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      thoughtsTokens: 0,
      toolTokens: 0,
      errorMessage,
    });
  } catch (err) {
    // Swallow lifecycle observer errors — they must not break the stream
    void err;
  }
}

export function notifyBackendResult(
  observer: AttemptLifecycleObserver | undefined,
  ctx: BackendAttemptContext | null,
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  status: BackendAttemptStatus,
  errorMessage?: string,
): void {
  if (!observer || !ctx) return;
  notifyBackendEnd(observer, ctx, subProfile, status, errorMessage);
}

function invokeHookSafely(hook: () => void): void {
  try {
    hook();
  } catch (hookError) {
    void hookError;
  }
}

function notifyTerminalSafely(
  lifecycleObserver: AttemptLifecycleObserver | undefined,
  attemptCtx: BackendAttemptContext | null | undefined,
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  status: BackendAttemptStatus,
  errorMessage?: string,
): void {
  if (!lifecycleObserver || !attemptCtx) return;
  const ctx = attemptCtx;
  invokeHookSafely(() =>
    notifyBackendEnd(lifecycleObserver, ctx, subProfile, status, errorMessage),
  );
}

function recordSuccessMetrics(
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  startTime: number,
  tokensUsed: number,
  hooks: BackendMetricsHooks,
  lifecycleObserver: AttemptLifecycleObserver | undefined,
  attemptCtx: BackendAttemptContext | null | undefined,
): void {
  if (tokensUsed > 0) {
    invokeHookSafely(() => hooks.updateTPM(subProfile.name, tokensUsed));
  }
  invokeHookSafely(() =>
    hooks.recordRequestSuccess(subProfile.name, startTime, tokensUsed),
  );
  notifyTerminalSafely(lifecycleObserver, attemptCtx, subProfile, 'success');
}

function recordFailureMetrics(
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  startTime: number,
  error: unknown,
  hooks: BackendMetricsHooks,
  lifecycleObserver: AttemptLifecycleObserver | undefined,
  attemptCtx: BackendAttemptContext | null | undefined,
): void {
  invokeHookSafely(() =>
    hooks.recordRequestFailure(
      subProfile.name,
      startTime,
      error instanceof Error ? error : new Error(String(error)),
    ),
  );
  const status: BackendAttemptStatus =
    error instanceof Error && error.name === 'AbortError' ? 'aborted' : 'error';
  notifyTerminalSafely(
    lifecycleObserver,
    attemptCtx,
    subProfile,
    status,
    error instanceof Error ? error.message : String(error),
  );
}

export async function* yieldWithBackendMetrics(
  delegateProvider: IProvider,
  resolvedOptions: GenerateChatOptions,
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  startTime: number,
  hooks: BackendMetricsHooks,
  lifecycleObserver?: AttemptLifecycleObserver,
  attemptCtx?: BackendAttemptContext | null,
): AsyncGenerator<IContent> {
  let terminalEmitted = false;
  try {
    const chunks: IContent[] = [];
    for await (const chunk of delegateProvider.generateChatCompletion(
      resolvedOptions,
    )) {
      chunks.push(chunk);
      yield chunk;
    }
    const tokensUsed = BackendMetricsCollector.extractTokenCount(chunks);
    recordSuccessMetrics(
      subProfile,
      startTime,
      tokensUsed,
      hooks,
      lifecycleObserver,
      attemptCtx,
    );
    terminalEmitted = true;
  } catch (error) {
    recordFailureMetrics(
      subProfile,
      startTime,
      error,
      hooks,
      lifecycleObserver,
      attemptCtx,
    );
    terminalEmitted = true;
    throw error;
  } finally {
    // If the consumer closed the iterator early without an error path,
    // finalize as aborted exactly once so the attempt always gets a
    // terminal record.
    if (!terminalEmitted) {
      notifyTerminalSafely(
        lifecycleObserver,
        attemptCtx,
        subProfile,
        'aborted',
        'consumer early close',
      );
    }
  }
}

export function recordBackendSuccess(
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  startTime: number,
  chunks: IContent[],
  hooks: BackendMetricsHooks,
  lifecycleObserver: AttemptLifecycleObserver | undefined,
  attemptCtx: BackendAttemptContext | null,
): void {
  const tokensUsed = BackendMetricsCollector.extractTokenCount(chunks);
  if (tokensUsed > 0) {
    invokeHookSafely(() => hooks.updateTPM(subProfile.name, tokensUsed));
  }
  invokeHookSafely(() =>
    hooks.recordRequestSuccess(subProfile.name, startTime, tokensUsed),
  );
  notifyBackendResult(lifecycleObserver, attemptCtx, subProfile, 'success');
}

export interface BackendAttemptLifecycleState {
  lifecycleObserver: AttemptLifecycleObserver | undefined;
  attemptCtx: BackendAttemptContext | null;
}
