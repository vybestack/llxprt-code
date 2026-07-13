/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '../debug/DebugLogger.js';
import { getErrorMessage } from '../utils/errors.js';

const MAX_TRUST_FAILURES = 100;
const HOOK_INITIALIZATION_TIMEOUT_MS = 30_000;

export interface LiveTrustTransitionDependencies {
  downgradeApprovalMode(): void;
  removeTrustedPolicyRules(): void;
  updateTrustPolicy(trusted: boolean): void;
  transitionMcp(trusted: boolean): Promise<void> | undefined;
  initializeHooks(): Promise<void> | undefined;
  emitTrustChanged(trusted: boolean): void;
}

export class LiveTrustTransitionLifecycle {
  private static readonly logger = new DebugLogger(
    'llxprt:config:live-trust-transition',
  );

  private transitionChain: Promise<void> = Promise.resolve();
  private failures: unknown[] = [];
  private readonly abortController = new AbortController();
  private disposing = false;

  constructor(private readonly dependencies: LiveTrustTransitionDependencies) {}

  apply(trusted: boolean): void {
    if (!trusted) {
      this.dependencies.downgradeApprovalMode();
    }
    this.runSynchronousStep(() => this.dependencies.removeTrustedPolicyRules());
    this.runSynchronousStep(() => this.dependencies.updateTrustPolicy(trusted));
    this.enqueue(trusted);
    this.runSynchronousStep(() => this.dependencies.emitTrustChanged(trusted));
  }

  private runSynchronousStep(step: () => void): void {
    try {
      step();
    } catch (error) {
      LiveTrustTransitionLifecycle.logger.error(
        `Trust step failed: ${getErrorMessage(error)}`,
      );
      this.retainFailures([error]);
    }
  }

  private enqueue(trusted: boolean): void {
    if (this.disposing) {
      return;
    }
    this.transitionChain = this.transitionChain.then(async () => {
      const failures: unknown[] = [];
      try {
        await this.dependencies.transitionMcp(trusted);
      } catch (error) {
        LiveTrustTransitionLifecycle.logger.error(
          `Error during trust transition side-effects: ${getErrorMessage(error)}`,
        );
        failures.push(error);
      }
      if (!this.disposing) {
        try {
          const initialization = this.dependencies.initializeHooks();
          if (initialization) {
            await waitForHookInitialization(
              initialization,
              this.abortController.signal,
            );
          }
        } catch (error) {
          const initializationWasCancelled =
            this.abortController.signal.aborted &&
            error instanceof DOMException &&
            error.name === 'AbortError';
          if (!initializationWasCancelled) {
            LiveTrustTransitionLifecycle.logger.error(
              `Error re-initializing hooks during trust transition: ${getErrorMessage(error)}`,
            );
            failures.push(error);
          }
        }
      }
      this.retainFailures(failures);
    });
  }

  private retainFailures(failures: readonly unknown[]): void {
    this.failures = [...this.failures, ...failures].slice(-MAX_TRUST_FAILURES);
  }

  async whenSettled(): Promise<void> {
    await this.transitionChain;
    const failures = this.failures.splice(0);
    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Trust transition failed');
    }
  }

  beginDisposal(): void {
    this.disposing = true;
    this.abortController.abort();
  }
}

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}

function waitForHookInitialization(
  initialization: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(abortError('Hook initialization was cancelled'));
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      finish(() => reject(abortError('Hook initialization was cancelled')));
    };
    const finish = (settle: () => void): void => {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
      settle();
    };
    const timeoutId = setTimeout(() => {
      finish(() => reject(new Error('Hook initialization timed out')));
    }, HOOK_INITIALIZATION_TIMEOUT_MS);
    signal.addEventListener('abort', onAbort, { once: true });
    initialization.then(
      () => finish(resolve),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}
