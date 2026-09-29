/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerMcpAuthFactories } from '@vybestack/llxprt-code-mcp/auth/mcp-auth-factory.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition.js';

/** Threads plugin-contributed MCP auth factories into the transport registry. */
export function wireMcpAuthFactories(
  providerContributions: ProviderContributionRegistry,
): void {
  registerMcpAuthFactories(
    providerContributions
      .getMcpAuthFactories()
      .map((registered) => registered.contribution),
  );
}
