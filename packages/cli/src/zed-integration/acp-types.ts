/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as acp from '@agentclientprotocol/sdk';

/**
 * The pinned ACP SDK (0.14.1) does not yet export `CloseSessionRequest`,
 * `DeleteSessionRequest`, or their responses, nor does its
 * `ClientCapabilities` type include the `session` field used for
 * config-option gating.  These local type aliases keep the integration
 * strongly-typed without resorting to `any`.
 */

export interface CloseSessionRequest {
  readonly sessionId: acp.SessionId;
}

export type CloseSessionResponse = Record<string, never>;

export interface DeleteSessionRequest {
  readonly sessionId: acp.SessionId;
}

export type DeleteSessionResponse = Record<string, never>;

export interface ClientCapabilitiesWithSession {
  readonly fs?: {
    readonly readTextFile?: boolean;
    readonly writeTextFile?: boolean;
  };
  readonly terminal?: boolean;
  readonly session?: {
    readonly configOptions?: boolean;
  };
}
