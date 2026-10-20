/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Config } from '@vybestack/llxprt-code-core';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type {
  ToolPublication,
  ToolSelection,
} from '@vybestack/llxprt-code-tools';
import { AgentActivationBootstrap } from './activationPreflightState.js';
import type { Agent } from './agent.js';
import type { AgentAdoptionIntent } from './config-types.js';
export type PrepareSessionTools = (
  tools: Pick<ToolSelection, 'getAllTools'> & ToolPublication,
) => void;
export function fromConfig(
  config: Config,
  settingsService: SettingsService,
  intent: AgentAdoptionIntent,
  credentialAuthority: CredentialAuthority,
): Promise<Agent> {
  return AgentActivationBootstrap.adopt(
    config,
    settingsService,
    intent,
    credentialAuthority,
  );
}
