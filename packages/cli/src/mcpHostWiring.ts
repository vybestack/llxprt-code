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
import { coreEvents, openBrowserSecurely } from '@vybestack/llxprt-code-core';

export function wireMcpHostServices(): void {
  registerMcpHostServices({
    emitFeedback: (...args) => coreEvents.emitFeedback(...args),
    openBrowser: openBrowserSecurely,
  });
}
