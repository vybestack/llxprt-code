/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type {
  AttemptLifecycleObserver,
  AttemptStatus,
} from './logging/attemptLifecycle.js';
import {
  notifyRetryAttemptStart,
  notifyRetryAttemptEnd,
} from './retryLifecycleNotifier.js';

/**
 * Encapsulates lifecycle notification state for a single retry attempt,
 * reducing the line count of RetryOrchestrator.executeSingleAttempt.
 */
export class AttemptNotificationContext {
  constructor(
    private readonly observer: AttemptLifecycleObserver | undefined,
    private readonly shouldNotify: boolean,
    private readonly attemptIndex: number,
    private readonly attemptId: string,
    private readonly modelName: string,
    private readonly startMs: number,
    private readonly providerName: string,
    private readonly logger: DebugLogger,
  ) {}

  maybeNotifyStart(): void {
    if (!this.shouldNotify || !this.observer) return;
    notifyRetryAttemptStart(
      this.observer,
      this.attemptIndex,
      this.attemptId,
      this.startMs,
      this.providerName,
      this.modelName,
      this.logger,
    );
  }

  notifyEnd(status: AttemptStatus, errorMessage?: string): void {
    if (!this.shouldNotify || !this.observer) return;
    notifyRetryAttemptEnd(
      this.observer,
      this.attemptIndex,
      this.attemptId,
      this.modelName,
      status,
      this.startMs,
      this.providerName,
      this.logger,
      errorMessage,
    );
  }
}
