/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RefusalRecovery } from './refusalTypes.js';

/**
 * Phase 1 recovery policy: no recovery. A refusal ends the logical request.
 * A later phase replaces this with a coordinator that retries the same
 * prepared request.
 */
export const terminalRefusalRecovery: RefusalRecovery = {
  decide: () => ({ action: 'stop' }),
};
