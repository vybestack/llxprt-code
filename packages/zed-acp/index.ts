/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Public surface of the ACP (Agent Client Protocol) client.
 *
 * This package is a peer client of the Agent API, not part of the CLI. A host
 * launches it with a `Config` and, optionally, its own process-exit cleanup;
 * the ndjson transport over stdio and session lifecycle are owned here.
 */

export {
  runZedIntegration,
  type ExitCleanupCallback,
} from './src/runZedIntegration.js';
export { ZedAgent } from './src/zedIntegration.js';
export type { ZedSessionProviderInputs } from './src/zed-session-agent.js';
