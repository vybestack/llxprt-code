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
 * everything else — the ndjson transport over stdio, session lifecycle, and
 * runtime registration under {@link ZED_ACP_RUNTIME_ID} — is owned here.
 */

export {
  runZedIntegration,
  ZED_ACP_RUNTIME_ID,
  type ExitCleanupCallback,
} from './src/runZedIntegration.js';
export { ZedAgent } from './src/zedIntegration.js';
