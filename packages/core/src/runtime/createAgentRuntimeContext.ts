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
  preserveThreshold: 0.2,
  topPreserveThreshold: 0.2,
  /** @plan PLAN-20251202-THINKING.P03b @requirement REQ-THINK-006 */
  reasoning: {
    enabled: true, // REQ-THINK-006.1
    includeInContext: false, // REQ-THINK-006.2
    includeInResponse: true, // REQ-THINK-006.3
    format: 'field' as const, // REQ-THINK-006.4
    stripFromContext: 'none' as const, // REQ-THINK-006.5
  },
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

  const ephemerals = {
    compressionThreshold: (): number =>
      options.settings.compressionThreshold ??
      EPHEMERAL_DEFAULTS.compressionThreshold,
    contextLimit: (): number => {
      const liveOverride =
        typeof options.settings.contextLimit === 'number' &&
        Number.isFinite(options.settings.contextLimit) &&
        options.settings.contextLimit > 0
          ? options.settings.contextLimit
          : undefined;
      return tokenLimit(options.state.model, liveOverride);
    },
    preserveThreshold: (): number =>
      options.settings.preserveThreshold ??
      EPHEMERAL_DEFAULTS.preserveThreshold,
    topPreserveThreshold: (): number =>
      options.settings.topPreserveThreshold ??
      EPHEMERAL_DEFAULTS.topPreserveThreshold,
    toolFormatOverride: (): string | undefined =>
      options.settings.toolFormatOverride,
    /**
     * @plan PLAN-20251202-THINKING.P03b
     * @requirement REQ-THINK-006
     */
    reasoning: {
      enabled: (): boolean =>
        options.settings['reasoning.enabled'] ??
        EPHEMERAL_DEFAULTS.reasoning.enabled,
      includeInContext: (): boolean =>
        options.settings['reasoning.includeInContext'] ??
        EPHEMERAL_DEFAULTS.reasoning.includeInContext,
      includeInResponse: (): boolean =>
        options.settings['reasoning.includeInResponse'] ??
        EPHEMERAL_DEFAULTS.reasoning.includeInResponse,
      format: (): 'native' | 'field' =>
        (options.settings['reasoning.format'] as 'native' | 'field') ??
        EPHEMERAL_DEFAULTS.reasoning.format,
      stripFromContext: (): 'all' | 'allButLast' | 'none' =>
        (options.settings['reasoning.stripFromContext'] as
          | 'all'
          | 'allButLast'
          | 'none') ?? EPHEMERAL_DEFAULTS.reasoning.stripFromContext,
      effort: (): 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined =>
        options.settings['reasoning.effort'] as
          | 'minimal'
          | 'low'
          | 'medium'
          | 'high'
          | 'xhigh'
          | undefined,
      maxTokens: (): number | undefined =>
        typeof options.settings['reasoning.maxTokens'] === 'number'
          ? options.settings['reasoning.maxTokens']
          : undefined,
    },
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
