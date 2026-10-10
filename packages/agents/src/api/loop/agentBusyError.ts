/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export class AgentBusyError extends Error {
  readonly code = 'busy';

  constructor() {
    super('Agent already has an active turn');
    this.name = 'AgentBusyError';
  }
}
