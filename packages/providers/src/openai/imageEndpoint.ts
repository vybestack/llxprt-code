/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Loopback profiles use the deployed MLX image dialect. */
export function isLocalImageEndpoint(baseUrl: string): boolean {
  const hostname = new URL(baseUrl).hostname.toLowerCase();
  return (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    hostname.startsWith('127.')
  );
}
