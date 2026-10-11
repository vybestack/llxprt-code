/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '../debug/DebugLogger.js';
import { getErrorMessage } from '../utils/errors.js';

export interface TrustTransitionEffects<T> {
  synchronousSteps(transition: T): ReadonlyArray<() => void>;
  transition(transition: T): Promise<void> | undefined;
  afterEnqueue?(transition: T): void;
}

interface TransitionFailure {
  readonly sequence: number;
  readonly error: unknown;
}

export class TrustTransitionLifecycle<T> {
  private readonly logger = new DebugLogger(
    'llxprt:config:live-trust-transition',
  );
  private transitionChain: Promise<void> = Promise.resolve();
  private failures: readonly TransitionFailure[] = [];
  private readonly settlementReports = new Map<number, Promise<void>>();
  private transitionSequence = 0;
  private disposing = false;

  constructor(private readonly effects: TrustTransitionEffects<T>) {}

  apply(transition: T): Promise<void> {
    if (this.disposing) return Promise.resolve();
    const sequence = ++this.transitionSequence;
    this.enqueue(transition, sequence);
    for (const step of this.effects.synchronousSteps(transition)) {
      this.runSynchronousStep(step, sequence);
    }
    this.runSynchronousStep(
      () => this.effects.afterEnqueue?.(transition),
      sequence,
    );
    const settlement = this.reportTransition(sequence, this.transitionChain);
    void settlement.catch(() => undefined);
    return settlement;
  }

  private runSynchronousStep(step: () => void, sequence: number): void {
    try {
      step();
    } catch (error) {
      this.logger.error(`Trust step failed: ${getErrorMessage(error)}`);
      this.retainFailures([error], sequence);
    }
  }

  private enqueue(transition: T, sequence: number): void {
    if (this.disposing) return;
    this.transitionChain = this.transitionChain
      .catch((error: unknown) => {
        this.logger.error(
          `Unexpected trust transition chain failure: ${getErrorMessage(error)}`,
        );
        this.retainFailures([error], sequence);
      })
      .then(() => this.runTransition(transition, sequence));
  }

  private async runTransition(transition: T, sequence: number): Promise<void> {
    try {
      await this.effects.transition(transition);
    } catch (error) {
      this.logger.error(
        `Error during trust transition side-effects: ${getErrorMessage(error)}`,
      );
      this.retainFailures([error], sequence);
    }
  }

  private retainFailures(failures: readonly unknown[], sequence: number): void {
    this.failures = [
      ...this.failures,
      ...failures.map((error) => ({ sequence, error })),
    ];
  }

  private async reportTransition(
    sequence: number,
    transition: Promise<void>,
  ): Promise<void> {
    await transition;
    this.throwFailures(
      this.failures.filter((failure) => failure.sequence === sequence),
    );
  }

  private throwFailures(failures: readonly TransitionFailure[]): void {
    const errors = failures.map((failure) => failure.error);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Trust transition failed');
    }
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
    const failures = this.failures.filter(
      (failure) => failure.sequence <= snapshot,
    );
    this.failures = this.failures.filter(
      (failure) => failure.sequence > snapshot,
    );
    this.throwFailures(failures);
  }

  beginDisposal(): void {
    this.disposing = true;
  }
}
