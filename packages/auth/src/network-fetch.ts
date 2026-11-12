/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Optional per-request transport controls for an owned network fetch. */
export interface NetworkFetchOptions {
  readonly headersTimeoutMs?: number;
}

/** A fetch implementation that accepts transport-specific request options. */
export type NetworkFetch = (
  input: Request | URL | string,
  init?: RequestInit,
  options?: NetworkFetchOptions,
) => Promise<Response>;
