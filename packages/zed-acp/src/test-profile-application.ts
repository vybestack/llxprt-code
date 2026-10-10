/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentProfileApplication } from '@vybestack/llxprt-code-agents';

export const unusedProfileApplication: AgentProfileApplication = {
  isApplying: () => false,
  cancelAndJoin: async () => {},
  load: async () => {
    throw new Error('Unexpected bootstrap profile load in session test');
  },
  applySnapshot: async () => {
    throw new Error('Unexpected bootstrap profile application in session test');
  },
};
