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
/** @plan PLAN-20260211-COMPRESSION.P12 */
import { getSettingSpec } from '../settings/settingsRegistry.js';

const EPHEMERAL_DEFAULTS = {
  compressionThreshold: 0.5,
  preserveThreshold: 0.2,
  topPreserveThreshold: 0.2,
  /** @plan PLAN-20251202-THINKING.P03b @requirement REQ-THINK-006 */
  reasoning: {
    enabled: true, // REQ-THINK-006.1
    includeInContext: true, // REQ-THINK-006.2
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
    /** @plan PLAN-20260211-COMPRESSION.P12 */
    compressionStrategy: (): string => {
      const live = getLiveSetting<string>(
        'compression.strategy',
        options.settings.compressionStrategy,
      );
      return (
        live ?? (getSettingSpec('compression.strategy')?.default as string)
      );
    },
    /** @plan PLAN-20260211-COMPRESSION.P12 */
    compressionProfile: (): string | undefined =>
      getLiveSetting<string>(
        'compression.profile',
        options.settings.compressionProfile,
      ),
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P15
     * @requirement REQ-HD-009.5
     * @pseudocode settings-factory.md lines 90-121
     */
    densityReadWritePruning: (): boolean => {
      const value = getLiveSetting<boolean>(
        'compression.density.readWritePruning',
        options.settings['compression.density.readWritePruning'],
      );
      return typeof value === 'boolean' ? value : true;
    },
    densityFileDedupe: (): boolean => {
      const value = getLiveSetting<boolean>(
        'compression.density.fileDedupe',
        options.settings['compression.density.fileDedupe'],
      );
      return typeof value === 'boolean' ? value : true;
    },
    densityRecencyPruning: (): boolean => {
      const value = getLiveSetting<boolean>(
        'compression.density.recencyPruning',
        options.settings['compression.density.recencyPruning'],
      );
      return typeof value === 'boolean' ? value : false;
    },
    densityRecencyRetention: (): number => {
      const value = getLiveSetting<number>(
        'compression.density.recencyRetention',
        options.settings['compression.density.recencyRetention'],
      );
      return typeof value === 'number' && value >= 1 ? value : 3;
    },
    densityCompressHeadroom: (): number => {
      const value = getLiveSetting<number>(
        'compression.density.compressHeadroom',
        options.settings['compression.density.compressHeadroom'],
      );
      return typeof value === 'number' && value > 0 && value <= 1 ? value : 0.6;
    },
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
