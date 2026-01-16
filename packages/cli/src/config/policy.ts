/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type PolicyEngineConfig,
  type ApprovalMode,
  type PolicyEngine,
  type MessageBus,
  type PolicySettings,
  createPolicyEngineConfig as createCorePolicyEngineConfig,
  createPolicyUpdater as createCorePolicyUpdater,
} from '@vybestack/llxprt-code-core';
import { type Settings } from './settings.js';

export async function createPolicyEngineConfig(
  settings: Settings,
  approvalMode: ApprovalMode,
): Promise<PolicyEngineConfig> {
  // Explicitly construct PolicySettings from Settings to ensure type safety
  // and avoid accidental leakage of other settings properties.
  //
  // Handle both legacy (settings.allowedTools) and new (settings.tools.allowed) structures
  // to ensure compatibility during the transition period
  const allowedTools =
    settings.tools?.allowed || settings.allowedTools || undefined;
  const excludeTools =
    settings.tools?.exclude || settings.excludeTools || undefined;

  const policySettings: PolicySettings = {
    mcp: settings.mcp,
    tools: {
      allowed: allowedTools,
      exclude: excludeTools,
    },
    mcpServers: settings.mcpServers,
  };

  return createCorePolicyEngineConfig(policySettings, approvalMode);
}

export function createPolicyUpdater(
  policyEngine: PolicyEngine,
  messageBus: MessageBus,
) {
  return createCorePolicyUpdater(policyEngine, messageBus);
}
