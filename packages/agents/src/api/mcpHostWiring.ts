/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { coreEvents, openBrowserSecurely } from '@vybestack/llxprt-code-core';
import { registerMcpHostServices } from '@vybestack/llxprt-code-mcp/host/hostServices.js';

export function wireMcpHostServices(): void {
  registerMcpHostServices({
    emitFeedback: (...args) => coreEvents.emitFeedback(...args),
    openBrowser: openBrowserSecurely,
  });
}
