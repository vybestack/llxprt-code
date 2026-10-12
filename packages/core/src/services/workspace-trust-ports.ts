/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WorkspaceTrustReadPort } from './workspace-trust-reader.js';
import type { WorkspaceTrustView } from './workspace-trust-view.js';
import type { WorkspaceTrustWritePort } from './workspace-trust-mutation.js';
import type {
  WorkspaceTrustRefreshPort,
  WorkspaceTrustSubscriptionPort,
} from './workspace-trust-transition.js';

export interface WorkspaceTrustControlPort
  extends WorkspaceTrustReadPort,
    WorkspaceTrustView,
    WorkspaceTrustWritePort,
    WorkspaceTrustSubscriptionPort {
  whenSettled(): Promise<void>;
}

export interface WorkspaceTrustRuntimePort
  extends WorkspaceTrustView,
    WorkspaceTrustWritePort,
    WorkspaceTrustRefreshPort {}
