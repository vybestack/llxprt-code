/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '../debug/DebugLogger.js';
import { getErrorMessage } from '../utils/errors.js';

const HOOK_INITIALIZATION_TIMEOUT_MS = 30_000;

export interface LiveTrustTransitionDependencies {
  downgradeApprovalMode(): void;
  removeTrustedPolicyRules(): void;
  updateTrustPolicy(trusted: boolean): void;
  transitionMcp(trusted: boolean): Promise<void> | undefined;
  initializeHooks(signal: AbortSignal): Promise<void> | undefined;
  emitTrustChanged(trusted: boolean): void;
}

interface TransitionFailure {
  readonly sequence: number;
  readonly error: unknown;
}

export class LiveTrustTransitionLifecycle {
  private static readonly logger = new DebugLogger(
    'llxprt:config:live-trust-transition',
  );

  private transitionChain: Promise<void> = Promise.resolve();
  private failures: readonly TransitionFailure[] = [];
  private readonly settlementReports = new Map<number, Promise<void>>();
  private transitionSequence = 0;
  private readonly abortController = new AbortController();
  private disposing = false;

  constructor(private readonly dependencies: LiveTrustTransitionDependencies) {}

  apply(trusted: boolean): void {
    if (this.disposing) {
      return;
    }
    const sequence = ++this.transitionSequence;
    if (!trusted) {
      this.dependencies.downgradeApprovalMode();
    }
    this.runSynchronousStep(
      () => this.dependencies.removeTrustedPolicyRules(),
      sequence,
    );
    this.runSynchronousStep(
      () => this.dependencies.updateTrustPolicy(trusted),
      sequence,
    );
    this.enqueue(trusted, sequence);
    this.runSynchronousStep(
      () => this.dependencies.emitTrustChanged(trusted),
      sequence,
    );
  }

  private runSynchronousStep(step: () => void, sequence: number): void {
    try {
      step();
    } catch (error) {
      LiveTrustTransitionLifecycle.logger.error(
        `Trust step failed: ${getErrorMessage(error)}`,
      );
      this.retainFailures([error], sequence);
    }
  }

  private enqueue(trusted: boolean, sequence: number): void {
    if (this.disposing) {
      return;
    }
    this.transitionChain = this.transitionChain.then(() =>
      this.runTransition(trusted, sequence),
    );
  }

  private async runTransition(
    trusted: boolean,
    sequence: number,
  ): Promise<void> {
    if (this.disposing) {
      return;
    }
    const failures: unknown[] = [];
    await this.collectMcpFailure(trusted, failures);
    await this.collectHookFailure(failures);
    this.retainFailures(failures, sequence);
  }

  private async collectMcpFailure(
    trusted: boolean,
    failures: unknown[],
  ): Promise<void> {
    try {
      await this.dependencies.transitionMcp(trusted);
    } catch (error) {
      LiveTrustTransitionLifecycle.logger.error(
        `Error during trust transition side-effects: ${getErrorMessage(error)}`,
      );
      failures.push(error);
    }
  }

  private async collectHookFailure(failures: unknown[]): Promise<void> {
    if (this.disposing) {
      return;
    }
    try {
      await waitForHookInitialization(
        (signal) => this.dependencies.initializeHooks(signal),
        this.abortController.signal,
      );
    } catch (error) {
      const initializationWasCancelled =
        this.abortController.signal.aborted &&
        error instanceof DOMException &&
        error.name === 'AbortError';
      if (initializationWasCancelled) {
        return;
      }
      LiveTrustTransitionLifecycle.logger.error(
        `Error re-initializing hooks during trust transition: ${getErrorMessage(error)}`,
      );
      failures.push(error);
    }
  }

  private retainFailures(failures: readonly unknown[], sequence: number): void {
    this.failures = [
      ...this.failures,
      ...failures.map((error) => ({ sequence, error })),
    ];
  }

  async whenSettled(): Promise<void> {
    const snapshot = this.transitionSequence;
    const existingReport = this.settlementReports.get(snapshot);
    if (existingReport !== undefined) {
      await existingReport;
      return;
    }
    const report = this.reportSnapshot(snapshot, this.transitionChain);
    this.settlementReports.set(snapshot, report);
    try {
      await report;
    } finally {
      if (this.settlementReports.get(snapshot) === report) {
        this.settlementReports.delete(snapshot);
      }
    }
  }

  private async reportSnapshot(
    snapshot: number,
    transition: Promise<void>,
  ): Promise<void> {
    await transition;
    const failures = this.failures
      .filter((failure) => failure.sequence <= snapshot)
      .map((failure) => failure.error);
    this.failures = this.failures.filter(
      (failure) => failure.sequence > snapshot,
    );
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
  initialize: (signal: AbortSignal) => Promise<void> | undefined,
  lifecycleSignal: AbortSignal,
): Promise<void> {
  if (lifecycleSignal.aborted) {
    return Promise.reject(abortError('Hook initialization was cancelled'));
  }
  const operationController = new AbortController();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      lifecycleSignal.removeEventListener('abort', onAbort);
      settle();
    };
    const onAbort = () => {
      operationController.abort();
      finish(() => reject(abortError('Hook initialization was cancelled')));
    };
    const timeoutId = setTimeout(() => {
      operationController.abort();
      finish(() => reject(new Error('Hook initialization timed out')));
    }, HOOK_INITIALIZATION_TIMEOUT_MS);
    lifecycleSignal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve()
      .then(() => initialize(operationController.signal))
      .then(
        () => finish(resolve),
        (error: unknown) => finish(() => reject(error)),
      );
  });
}
