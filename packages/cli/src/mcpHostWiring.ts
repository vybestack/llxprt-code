/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Supplies the MCP package's host-owned feedback and browser capabilities.
 * Keeping this wiring at the application boundary preserves the one-way
 * `core` to `mcp` package dependency.
 */

import { registerMcpHostServices } from '@vybestack/llxprt-code-mcp/host/hostServices.js';
import { registerMcpAuthFactories } from '@vybestack/llxprt-code-mcp/auth/mcp-auth-factory.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition.js';
import { coreEvents, openBrowserSecurely } from '@vybestack/llxprt-code-core';

export function wireMcpHostServices(): void {
  registerMcpHostServices({
    emitFeedback: (...args) => coreEvents.emitFeedback(...args),
    openBrowser: openBrowserSecurely,
  });
}

/**
 * Threads plugin-contributed MCP auth provider factories into the transport's
 * startup registry (#2764). Registration replaces any previously wired set,
 * matching the `registerMcpHostServices` seam, so startup can run repeatedly
 * in one process and each run re-wires from the currently loaded plugins.
 */
export function wireMcpAuthFactories(
  providerContributions: ProviderContributionRegistry,
): void {
  registerMcpAuthFactories(
    providerContributions
      .getMcpAuthFactories()
      .map((registered) => registered.contribution),
  );
}
