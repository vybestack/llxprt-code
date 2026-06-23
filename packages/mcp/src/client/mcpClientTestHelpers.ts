/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared types and helpers for mcp-client tests.
 * Extracted during #2092 lint hardening to replace inline `any` casts
 * with properly typed access to transport internals.
 */

export type TransportWithInternals = {
  _authProvider?: unknown;
  _requestInit?: {
    headers?: Record<string, string>;
  };
};

/**
 * Extracts the internal `_authProvider` from a transport instance.
 * The field is private in the SDK; this helper centralizes the access.
 */
export function getTransportAuthProvider(
  transport: unknown,
): unknown | undefined {
  return (transport as TransportWithInternals)._authProvider;
}

/**
 * Extracts the internal `_requestInit.headers` from a transport instance.
 * The field is private in the SDK; this helper centralizes the access.
 */
export function getTransportHeaders(
  transport: unknown,
): Record<string, string> | undefined {
  return (transport as TransportWithInternals)._requestInit?.headers;
}
