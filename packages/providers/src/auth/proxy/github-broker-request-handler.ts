/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * RequestHandler type alias for credential proxy server operations.
 * Extracted so the broker and server share the same signature without a
 * circular dependency.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-003
 * @pseudocode 003-github-broker.md lines 01-11
 */

import type * as net from 'node:net';

/**
 * The signature of a request handler registered on the credential proxy
 * server. Matches the entries in CredentialProxyServer.requestHandlers.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-003
 * @pseudocode 003-github-broker.md lines 01-11
 */
export type RequestHandler = (
  socket: net.Socket,
  id: string,
  payload: Record<string, unknown>,
  state: {
    readonly id: number;
    readonly isSandboxConnection: boolean;
    readonly negotiatedVersion: number;
    readonly writer: {
      sendOk: (id: string, data: Record<string, unknown>) => void;
      sendError: (id: string, code: string, error: string) => void;
    };
  },
  signal: AbortSignal,
) => Promise<void> | void;
