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

  const getLiveSetting = <T>(
    key: string,
    snapshotValue: T | undefined,
  ): T | undefined => {
    // First check the live settings service for runtime changes
    const settingsService = options.providerRuntime?.settingsService;
    if (settingsService) {
      const liveValue = settingsService.get(key) as T | undefined;
      if (liveValue !== undefined) {
        return liveValue;
      }
    }
    // Fall back to snapshot value if no live override
    return snapshotValue;
  };

  const ephemerals = {
    compressionThreshold: (): number => {
      const liveThreshold = getLiveSetting<number>(
        'compression-threshold',
        options.settings.compressionThreshold,
      );
      const normalized =
        typeof liveThreshold === 'number' && Number.isFinite(liveThreshold)
          ? Math.min(Math.max(liveThreshold, 0), 1)
          : undefined;
      return normalized ?? EPHEMERAL_DEFAULTS.compressionThreshold;
    },
    contextLimit: (): number => {
      // Check live settings first, then snapshot
      const liveLimit = getLiveSetting<number>(
        'context-limit',
        options.settings.contextLimit,
      );
      const liveOverride =
        typeof liveLimit === 'number' &&
        Number.isFinite(liveLimit) &&
        liveLimit > 0
          ? liveLimit
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
        getLiveSetting(
          'reasoning.enabled',
          options.settings['reasoning.enabled'],
        ) ?? EPHEMERAL_DEFAULTS.reasoning.enabled,
      includeInContext: (): boolean =>
        getLiveSetting(
          'reasoning.includeInContext',
          options.settings['reasoning.includeInContext'],
        ) ?? EPHEMERAL_DEFAULTS.reasoning.includeInContext,
      includeInResponse: (): boolean =>
        getLiveSetting(
          'reasoning.includeInResponse',
          options.settings['reasoning.includeInResponse'],
        ) ?? EPHEMERAL_DEFAULTS.reasoning.includeInResponse,
      format: (): 'native' | 'field' =>
        (getLiveSetting(
          'reasoning.format',
          options.settings['reasoning.format'],
        ) as 'native' | 'field' | undefined) ??
        EPHEMERAL_DEFAULTS.reasoning.format,
      stripFromContext: (): 'all' | 'allButLast' | 'none' =>
        (getLiveSetting(
          'reasoning.stripFromContext',
          options.settings['reasoning.stripFromContext'],
        ) as 'all' | 'allButLast' | 'none' | undefined) ??
        EPHEMERAL_DEFAULTS.reasoning.stripFromContext,
      effort: (): 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined =>
        getLiveSetting(
          'reasoning.effort',
          options.settings['reasoning.effort'],
        ) as 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined,
      maxTokens: (): number | undefined => {
        const maxTokensValue = getLiveSetting(
          'reasoning.maxTokens',
          options.settings['reasoning.maxTokens'],
        );
        return typeof maxTokensValue === 'number' ? maxTokensValue : undefined;
      },
      adaptiveThinking: (): boolean | undefined => {
        const adaptiveThinkingValue = getLiveSetting(
          'reasoning.adaptiveThinking',
          options.settings['reasoning.adaptiveThinking'],
        );
        return typeof adaptiveThinkingValue === 'boolean'
          ? adaptiveThinkingValue
          : undefined;
      },
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
