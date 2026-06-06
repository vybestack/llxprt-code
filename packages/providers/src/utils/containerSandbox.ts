/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export function isContainerSandbox(): boolean {
  const sandbox = process.env.SANDBOX;
  if (!sandbox) {
    return false;
  }
  return sandbox !== 'sandbox-exec';
}
