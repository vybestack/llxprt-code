/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { TrustTransitionLifecycle } from './trust-transition-lifecycle.js';
import type { WorkspaceTrustReadPort } from './workspace-trust-reader.js';
import type {
  WorkspaceTrustInputs,
  WorkspaceTrustWritePort,
} from './workspace-trust-mutation.js';
import type {
  TrustTransitionSubscriber,
  WorkspaceTrustSettlementPort,
  WorkspaceTrustSubscriptionPort,
  WorkspaceTrustTransition,
} from './workspace-trust-transition.js';

export class WorkspaceTrustLifecycle
  implements
    WorkspaceTrustReadPort,
    WorkspaceTrustWritePort,
    WorkspaceTrustSubscriptionPort,
    WorkspaceTrustSettlementPort
{
  private localTrust: boolean | undefined;
  private ideTrust: boolean | undefined;
  private generation = 0;
  private disposing = false;
  private disposal: Promise<void> | undefined;
  private readonly revocations = new Set<() => void>();
  private readonly admissions = new Set<
    (transition: WorkspaceTrustTransition) => void
  >();
  private readonly subscribers = new Set<TrustTransitionSubscriber>();
  private readonly lifecycle = new TrustTransitionLifecycle<{
    transition: WorkspaceTrustTransition;
    subscribers: readonly TrustTransitionSubscriber[];
  }>({
    synchronousSteps: ({ transition }) => [
      ...(transition.trusted ? [] : [...this.revocations]),
      ...[...this.admissions].map((subscriber) => () => subscriber(transition)),
    ],
    transition: ({ transition, subscribers }) =>
      this.publishTransition(transition, subscribers),
  });

  constructor(initial: WorkspaceTrustInputs = {}) {
    this.localTrust = initial.localTrust;
    this.ideTrust = initial.ideTrust;
  }

  isTrustedFolder(): boolean {
    return this.ideTrust ?? this.localTrust ?? true;
  }

  getIdeTrust(): boolean | undefined {
    return this.ideTrust;
  }

  setTrustedFolderLive(trusted: boolean): Promise<void> {
    if (this.disposing)
      return Promise.reject(new Error('Workspace trust lifecycle is disposed'));
    const previous = this.isTrustedFolder();
    this.localTrust = trusted;
    return this.reconcile(previous);
  }

  setIdeTrustLive(trusted: boolean | undefined): Promise<void> {
    if (this.disposing)
      return Promise.reject(new Error('Workspace trust lifecycle is disposed'));
    const previous = this.isTrustedFolder();
    this.ideTrust = trusted;
    return this.reconcile(previous);
  }

  private reconcile(previous: boolean): Promise<void> {
    const trusted = this.isTrustedFolder();
    if (previous === trusted) return Promise.resolve();
    const generation = ++this.generation;
    const isCurrent = (): boolean =>
      !this.disposing && generation === this.generation;
    return this.lifecycle.apply({
      transition: {
        trusted,
        generation,
        isCurrent,
        commitIfCurrent: (publish) => {
          if (!isCurrent()) return false;
          publish();
          return true;
        },
      },
      subscribers: [...this.subscribers],
    });
  }

  subscribeTrustRevocation(subscriber: () => void): () => void {
    this.assertActive();
    this.revocations.add(subscriber);
    return () => {
      this.revocations.delete(subscriber);
    };
  }

  subscribeTrustTransition(subscriber: TrustTransitionSubscriber): () => void {
    this.assertActive();
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  subscribeTrustChange(
    subscriber: (transition: WorkspaceTrustTransition) => void,
  ): () => void {
    this.assertActive();
    this.admissions.add(subscriber);
    return () => {
      this.admissions.delete(subscriber);
    };
  }

  private async publishTransition(
    transition: WorkspaceTrustTransition,
    subscribers: readonly TrustTransitionSubscriber[],
  ): Promise<void> {
    const results = await Promise.allSettled(
      subscribers.map(async (subscriber) => subscriber(transition)),
    );
    const failures: unknown[] = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Trust subscribers failed');
    }
  }

  whenSettled(): Promise<void> {
    return this.lifecycle.whenSettled();
  }

  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal;
    this.disposing = true;
    this.generation++;
    this.lifecycle.beginDisposal();
    this.revocations.clear();
    this.admissions.clear();
    this.subscribers.clear();
    this.disposal = this.lifecycle.whenSettled();
    return this.disposal;
  }

  private assertActive(): void {
    if (this.disposing)
      throw new Error('Workspace trust lifecycle is disposed');
  }
}
