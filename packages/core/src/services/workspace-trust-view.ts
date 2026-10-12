/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WorkspaceTrustReader } from './workspace-trust-reader.js';
import type { WorkspaceTrustTransition } from './workspace-trust-transition.js';

export type TrustRevocationSubscriber = () => void;

export interface WorkspaceTrustView extends WorkspaceTrustReader {
  subscribeTrustRevocation(subscriber: TrustRevocationSubscriber): () => void;
  subscribeTrustChange(
    subscriber: (transition: WorkspaceTrustTransition) => void,
  ): () => void;
}
