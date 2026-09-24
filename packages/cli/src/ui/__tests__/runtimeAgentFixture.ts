/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { buildUiRuntimeFromSource } from '../cliUiRuntime.js';

type RuntimeAgent = Parameters<typeof buildUiRuntimeFromSource>[1];

/** Session owner for tests that only read borrowed Config-backed UI slices. */
export function createRuntimeAgent(): RuntimeAgent {
  return {
    agentClient: {
      hasChatInitialized: () => false,
      getHistoryService: () => null,
    } as RuntimeAgent['agentClient'],
    getMessageBus: () => {
      throw new Error('Unexpected session bus access');
    },
    scheduler: {
      acquire: async () => {
        throw new Error('Unexpected scheduler acquisition');
      },
      release: () => {
        throw new Error('Unexpected scheduler release');
      },
      setInteractiveSubagentSchedulerFactory: () => {
        throw new Error('Unexpected scheduler factory registration');
      },
    },
  };
}
