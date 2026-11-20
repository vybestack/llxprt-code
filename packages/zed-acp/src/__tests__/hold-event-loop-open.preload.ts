/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Preloaded into the ACP server process by the process-lifecycle test
 * (`bun --preload`). It keeps the event loop busy for the whole process
 * lifetime, standing in for anything that outlives an ACP connection in a real
 * run: a provider's persistent connection, an MCP transport, a timer.
 */
setInterval(() => {}, 60_000);
