/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionClientOwner } from '../session/session-client-owner.js';
import type { ProviderActivationIntent } from './config-types.js';
import type { ProviderActivationResult } from './providerActivationExecutor.js';

export type ActivationPreflightToken = Readonly<object>;
export type AgentActivationPreflightResult = ProviderActivationResult & {
  readonly token?: ActivationPreflightToken;
};
export interface AgentActivationOperation {
  preflight(
    intent: ProviderActivationIntent,
  ): Promise<AgentActivationPreflightResult>;
  dispose(): void | Promise<void>;
  streamHistory(): ReturnType<SessionClientOwner['clients']['streamHistory']>;
  readonly sessionClient: {
    runImageOperation: SessionClientOwner['runImageOperation'];
    workspaceDirectories(): readonly string[];
    refreshAuth(authMethod?: string): Promise<void>;
  };
}
export interface ActivationPreflight {
  readonly operation: AgentActivationOperation;
  readonly token: ActivationPreflightToken;
}
