/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Per-connection state for the credential proxy.
 *
 * Extracted from credential-proxy-server.ts so the handler signature and the
 * state it receives can be referenced without importing the server, and to
 * keep that file inside its max-lines budget.
 *
 * @plan PLAN-20260731-GHBROKER.P19
 * @requirement REQ-002
 */

import type { ConcurrentDispatchRegistry } from './concurrent-dispatch-registry.js';
import type { ResponseWriter } from './response-writer.js';

export interface ConnectionState {
  /** Unique incrementing ID assigned at connect time for audit-log correlation. */
  id: number;
  /**
   * True when the connection presented a valid capability token. Sandbox
   * connections have enumeration operations restricted (empty arrays returned)
   * to prevent credential discovery.
   */
  isSandboxConnection: boolean;
  /**
   * Protocol version negotiated during handshake. A v1 client negotiates
   * down to 1; a v2 client negotiates up to 2. Used to gate frame sizes:
   * v1 clients must never receive a frame larger than 64 KiB.
   *
   * @plan PLAN-20260731-GHBROKER.P05
   * @requirement REQ-006
   * @pseudocode 002-frame-and-cancel.md lines 67-76
   */
  negotiatedVersion: number;
  /**
   * Registry of concurrently-dispatched operations, replacing the former
   * inFlight serialization chain. Holds AbortControllers for abort-on-close.
   *
   * @plan PLAN-20260731-GHBROKER.P03
   * @requirement REQ-005
   * @pseudocode 001-concurrent-dispatch.md lines 1-9
   */
  pending: ConcurrentDispatchRegistry;
  /**
   * Version-aware response writer for this connection. Handles v1 frame-size
   * guard (RESPONSE_TOO_LARGE) and the single-write invariant.
   *
   * @plan PLAN-20260731-GHBROKER.P05
   * @requirement REQ-006
   * @pseudocode 002-frame-and-cancel.md lines 67-76
   */
  writer: ResponseWriter;
}
