/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251027-STATELESS5.P05
 * @requirement REQ-STAT5-002.3
 * @pseudocode runtime-state.md lines 114-138
 *
 * Helper functions for constructing AgentRuntimeState instances from legacy
 * Config objects during the Phase 5 migration period.
 */

import { createAgentRuntimeState } from './AgentRuntimeState.js';
import type {
  AgentRuntimeState,
  RuntimeStateParams,
} from './AgentRuntimeState.js';
import type { Config } from '../config/config.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';

/**
 * Options when deriving runtime state from Config.
 */
export interface RuntimeStateFromConfigOptions {
  runtimeId?: string;
  overrides?: Partial<Omit<RuntimeStateParams, 'runtimeId'>>;
}

function isValidUrl(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string') {
    return false;
  }
  try {
    new URL(candidate);
    return true;
  } catch {
    return false;
  }
}

function resolveRuntimeId(config: Config, explicitId?: string): string {
  if (explicitId) {
    return explicitId;
  }
  if (typeof config.getSessionId === 'function') {
    const sessionId = config.getSessionId();
    if (sessionId) {
      return sessionId;
    }
  }
  return `runtime-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * Creates an AgentRuntimeState using the current Config snapshot.
 *
 * This is a migration helper: it reads legacy Config data once, converts it to
 * runtime state, and returns an immutable snapshot for stateless operation.
 */
export function createAgentRuntimeStateFromConfig(
  config: Config,
  options: RuntimeStateFromConfigOptions = {},
): AgentRuntimeState {
  const contentConfig =
    typeof config.getContentGeneratorConfig === 'function'
      ? config.getContentGeneratorConfig()
      : undefined;

  const overrides = options.overrides ?? {};
  const provider =
    overrides.provider ??
    (typeof config.getProvider === 'function'
      ? (config.getProvider() ?? undefined)
      : undefined) ??
    'gemini';

  const model =
    overrides.model ??
    contentConfig?.model ??
    (typeof config.getModel === 'function'
      ? (config.getModel() ?? undefined)
      : undefined) ??
    DEFAULT_GEMINI_MODEL;

  const baseUrlCandidate =
    overrides.baseUrl ??
    (typeof config.getEphemeralSetting === 'function'
      ? config.getEphemeralSetting('base-url')
      : undefined);
  const baseUrl = isValidUrl(baseUrlCandidate) ? baseUrlCandidate : undefined;

  const proxyUrl =
    overrides.proxyUrl ??
    (typeof config.getProxy === 'function' ? config.getProxy() : undefined);

  const modelParams = overrides.modelParams;

  const sessionId =
    overrides.sessionId ??
    (typeof config.getSessionId === 'function'
      ? config.getSessionId()
      : undefined);

  const runtimeId = resolveRuntimeId(config, options.runtimeId);

  return createAgentRuntimeState({
    runtimeId,
    provider,
    model,
    baseUrl,
    proxyUrl,
    modelParams,
    sessionId,
  });
}
