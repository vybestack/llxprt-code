/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The signature every credential-proxy request handler shares.
 *
 * Kept out of credential-proxy-server.ts so the dispatch table type can be
 * referenced without importing the server, and to keep that file inside its
 * max-lines budget.
 *
 * @plan PLAN-20260731-GHBROKER.P19
 * @requirement REQ-002
 */

import type * as net from 'node:net';
import type { ConnectionState } from './credential-proxy-server.js';

export type ProxyRequestHandlerFn = (
  socket: net.Socket,
  id: string,
  payload: Record<string, unknown>,
  state: ConnectionState,
  signal: AbortSignal,
) => Promise<void> | void;
