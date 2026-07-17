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
  logger: DebugLogger,
): BackendAttemptContext | null {
  if (!observer) return null;
  const attemptId = `${profileName}#${subProfile.name}#${attemptIndex}`;
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

export async function* yieldWithBackendMetrics(
  delegateProvider: IProvider,
  resolvedOptions: GenerateChatOptions,
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  startTime: number,
  hooks: BackendMetricsHooks,
  lifecycleObserver?: AttemptLifecycleObserver,
  attemptCtx?: BackendAttemptContext | null,
): AsyncGenerator<IContent> {
  try {
    const chunks: IContent[] = [];
    for await (const chunk of delegateProvider.generateChatCompletion(
      resolvedOptions,
    )) {
      chunks.push(chunk);
      yield chunk;
    }
    const tokensUsed = BackendMetricsCollector.extractTokenCount(chunks);
    if (tokensUsed > 0) {
      hooks.updateTPM(subProfile.name, tokensUsed);
    }
    hooks.recordRequestSuccess(subProfile.name, startTime, tokensUsed);
    if (lifecycleObserver && attemptCtx) {
      notifyBackendEnd(
        lifecycleObserver,
        attemptCtx,
        subProfile,
        'success',
        undefined,
      );
    }
  } catch (error) {
    try {
      hooks.recordRequestFailure(
        subProfile.name,
        startTime,
        error instanceof Error ? error : new Error(String(error)),
      );
    } catch (hookError) {
      // Swallow hook failure so the original provider error is preserved
      void hookError;
    }
    if (lifecycleObserver && attemptCtx) {
      try {
        notifyBackendEnd(
          lifecycleObserver,
          attemptCtx,
          subProfile,
          'error',
          error instanceof Error ? error.message : String(error),
        );
      } catch (notifyError) {
        // Swallow lifecycle notification failure
        void notifyError;
      }
    }
    throw error;
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
    hooks.updateTPM(subProfile.name, tokensUsed);
  }
  hooks.recordRequestSuccess(subProfile.name, startTime, tokensUsed);
  notifyBackendResult(lifecycleObserver, attemptCtx, subProfile, 'success');
}

export interface BackendAttemptLifecycleState {
  lifecycleObserver: AttemptLifecycleObserver | undefined;
  attemptCtx: BackendAttemptContext | null;
}
