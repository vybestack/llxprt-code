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
import { PLACEHOLDER_MODEL, UNCONFIGURED_PROVIDER } from '../config/models.js';

export interface RuntimeStateConfigSource {
  getSessionId?(): string | undefined;
  getProvider?(): string | undefined;
  getModel?(): string | undefined;
  getContentGeneratorConfig?(): { model?: string } | undefined;
  getEphemeralSetting?(key: string): unknown;
  getProxy?(): string | undefined;
}

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

function resolveRuntimeId(
  config: RuntimeStateConfigSource,
  explicitId?: string,
): string {
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

function resolveProvider(
  config: RuntimeStateConfigSource,
  override?: string,
): string {
  if (override) {
    return override;
  }
  if (typeof config.getProvider === 'function') {
    const provider = config.getProvider();
    if (typeof provider === 'string' && provider.trim() !== '') {
      return provider.trim();
    }
  }
  return UNCONFIGURED_PROVIDER;
}

function resolveModel(
  config: RuntimeStateConfigSource,
  contentModel: string | undefined,
  override?: string,
): string {
  if (override) {
    return override;
  }
  if (contentModel) {
    return contentModel;
  }
  if (typeof config.getModel === 'function') {
    const model = config.getModel();
    if (typeof model === 'string' && model.length > 0) {
      return model;
    }
  }
  return PLACEHOLDER_MODEL;
}

/**
 * Creates an AgentRuntimeState using the current Config snapshot.
 *
 * This is a migration helper: it reads legacy Config data once, converts it to
 * runtime state, and returns an immutable snapshot for stateless operation.
 */
export function createAgentRuntimeStateFromConfig(
  config: RuntimeStateConfigSource,
  options: RuntimeStateFromConfigOptions = {},
): AgentRuntimeState {
  const contentConfig =
    typeof config.getContentGeneratorConfig === 'function'
      ? config.getContentGeneratorConfig()
      : undefined;

  const overrides = options.overrides ?? {};
  const provider = resolveProvider(config, overrides.provider);
  const model = resolveModel(config, contentConfig?.model, overrides.model);

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
