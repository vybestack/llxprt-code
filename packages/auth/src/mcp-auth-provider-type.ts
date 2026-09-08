/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How an MCP server authenticates (#3305).
 *
 * Lives here rather than in `core` so that `@vybestack/llxprt-code-mcp` can
 * reach it without depending on `core`, which value-imports `mcp` and would
 * therefore form a runtime cycle. This package is a dependency-graph leaf, so
 * both `core` and `mcp` can depend on it.
 */
export enum AuthProviderType {
  DYNAMIC_DISCOVERY = 'dynamic_discovery',
  GOOGLE_CREDENTIALS = 'google_credentials',
  SERVICE_ACCOUNT_IMPERSONATION = 'service_account_impersonation',
}
