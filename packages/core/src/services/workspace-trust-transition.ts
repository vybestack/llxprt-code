/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface WorkspaceTrustTransition {
  readonly trusted: boolean;
  readonly generation: number;
  isCurrent(): boolean;
  /** Publish a prepared result synchronously only while this generation is current. */
  commitIfCurrent(publish: () => void): boolean;
}

export type TrustTransitionSubscriber = (
  transition: WorkspaceTrustTransition,
) => Promise<void>;

export interface WorkspaceTrustSubscriptionPort {
  subscribeTrustTransition(subscriber: TrustTransitionSubscriber): () => void;
}

export interface WorkspaceTrustRefreshPort {
  subscribeTrustTransition(subscriber: () => Promise<void>): () => void;
}

export interface WorkspaceTrustSettlementPort {
  whenSettled(): Promise<void>;
  dispose(): Promise<void>;
}
