/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251028-STATELESS6.P06
 * @requirement REQ-STAT6-001.1, REQ-STAT6-001.3, REQ-STAT6-002.2, REQ-STAT6-002.3
 * @pseudocode agent-runtime-context.md lines 64-81
 *
 * Factory for creating immutable agent runtime contexts.
 */

import { HistoryService } from '../services/history/HistoryService.js';
import type {
  AgentRuntimeContext,
  AgentRuntimeContextFactoryOptions,
} from './AgentRuntimeContext.js';
import type { ProviderRuntimeContext } from './providerRuntimeContext.js';
import { tokenLimit } from '../core/tokenLimits.js';

const EPHEMERAL_DEFAULTS = {
  compressionThreshold: 0.8,
  contextLimit: 60_000,
  preserveThreshold: 0.2,
} as const;

export function createAgentRuntimeContext(
  options: AgentRuntimeContextFactoryOptions,
): AgentRuntimeContext {
  if (!options.provider) {
    throw new Error(
      'AgentRuntimeContext requires a provider adapter. Supply options.provider.',
    );
  }
  if (!options.telemetry) {
    throw new Error(
      'AgentRuntimeContext requires a telemetry adapter. Supply options.telemetry.',
    );
  }
  if (!options.tools) {
    throw new Error(
      'AgentRuntimeContext requires a tools view. Supply options.tools.',
    );
  }
  if (!options.providerRuntime) {
    throw new Error(
      'AgentRuntimeContext requires a provider runtime context. Supply options.providerRuntime.',
    );
  }

  const history = options.history ?? new HistoryService();

  const contextLimitOverride =
    typeof options.settings.contextLimit === 'number' &&
    Number.isFinite(options.settings.contextLimit) &&
    options.settings.contextLimit > 0
      ? options.settings.contextLimit
      : undefined;

  const resolvedContextLimit = tokenLimit(
    options.state.model,
    contextLimitOverride,
  );

  const ephemerals = {
    compressionThreshold: (): number =>
      options.settings.compressionThreshold ??
      EPHEMERAL_DEFAULTS.compressionThreshold,
    contextLimit: (): number => resolvedContextLimit,
    preserveThreshold: (): number =>
      options.settings.preserveThreshold ??
      EPHEMERAL_DEFAULTS.preserveThreshold,
    toolFormatOverride: (): string | undefined =>
      options.settings.toolFormatOverride,
  };

  const providerRuntime = Object.freeze({
    ...options.providerRuntime,
    metadata: options.providerRuntime.metadata
      ? Object.freeze({ ...options.providerRuntime.metadata })
      : undefined,
  }) as ProviderRuntimeContext;

  const context: AgentRuntimeContext = {
    state: options.state,
    history,
    ephemerals,
    telemetry: options.telemetry,
    provider: options.provider,
    tools: options.tools,
    providerRuntime,
  };

  return Object.freeze(context);
}
