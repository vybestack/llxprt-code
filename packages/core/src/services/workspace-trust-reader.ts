/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface WorkspaceTrustReader {
  isTrustedFolder(): boolean;
}

export interface WorkspaceTrustReadPort extends WorkspaceTrustReader {
  getIdeTrust(): boolean | undefined;
}
