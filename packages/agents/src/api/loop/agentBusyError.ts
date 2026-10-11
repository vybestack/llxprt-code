/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export class AgentBusyError extends Error {
  readonly code = 'busy';

  constructor(message = 'Agent already has an active turn') {
    super(message);
    this.name = 'AgentBusyError';
  }
}
