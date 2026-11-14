/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Thrown when a call needs user confirmation that the current mode cannot
 * ask for (non-interactive sessions). Typed so callers such as code mode can
 * tell "approval required" apart from a tool crash (issue #4084).
 */
export class ToolApprovalRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolApprovalRequiredError';
  }
}
