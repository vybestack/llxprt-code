import { buildToolGovernance } from '@vybestack/llxprt-code-tools';
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
import { HistoryMediaOwnership } from '../storage/history-media-ownership.js';
import type {
  AgentRuntimeContext,
  AgentRuntimeContextFactoryOptions,
  AgentRuntimeProviderAdapter,
  ReadonlySettingsSnapshot,
} from './AgentRuntimeContext.js';
import {
  resolveEffectiveContextLimit,
  resolveProviderReportedLimit,
} from '../core/tokenLimits.js';
/** @plan PLAN-20260211-COMPRESSION.P12 */
import {
  getSettingSpec,
  validateSetting,
} from '@vybestack/llxprt-code-settings';

const EPHEMERAL_DEFAULTS = Object.freeze({
  compressionThreshold: 0.85,
  preserveThreshold: 0.4,
  topPreserveThreshold: 0.2,
  /** @plan PLAN-20251202-THINKING.P03b @requirement REQ-THINK-006 */
  reasoning: Object.freeze({
    enabled: true, // REQ-THINK-006.1
    includeInContext: true, // REQ-THINK-006.2
    includeInResponse: true, // REQ-THINK-006.3
    format: 'field' as const, // REQ-THINK-006.4
    stripFromContext: 'none' as const, // REQ-THINK-006.5
    fieldName: 'reasoning_content' as const, // issue #2488
  }),
} as const);

/**
 * Widened view of factory options used at the external boundary so the
 * validation checks below are honestly typed as potentially undefined.
 * The declared AgentRuntimeContextFactoryOptions marks these required,
 * but callers may omit them; validate against this widened shape first.
 */
type BoundaryFactoryOptions = {
  provider?: unknown;
  telemetry?: unknown;
  tools?: unknown;
  providerRuntime?: unknown;
};

/**
 * Validate required top-level options and throw if any are missing.
 */
function validateRequiredOptions(options: BoundaryFactoryOptions): void {
  if (options.provider == null) {
    throw new Error(
      'AgentRuntimeContext requires a provider adapter. Supply options.provider.',
    );
  }
  if (options.telemetry == null) {
    throw new Error(
      'AgentRuntimeContext requires a telemetry adapter. Supply options.telemetry.',
    );
  }
  if (options.tools == null) {
    throw new Error(
      'AgentRuntimeContext requires a tools view. Supply options.tools.',
    );
  }
  if (options.providerRuntime == null) {
    throw new Error(
      'AgentRuntimeContext requires a provider runtime context. Supply options.providerRuntime.',
    );
  }
}

/**
 * Create the getLiveSetting closure that checks the live settings service
 * before falling back to snapshot values.
 */
function createGetLiveSetting(
  options: AgentRuntimeContextFactoryOptions,
): <K extends keyof ReadonlySettingsSnapshot>(
  key: K,
  snapshotValue: ReadonlySettingsSnapshot[K],
) => ReadonlySettingsSnapshot[K] {
  return (key, snapshotValue) =>
    options.readRuntimeSettings?.()[key] ?? snapshotValue;
}

/**
 * Resolve a usable context limit from the active provider, if any.
 * Delegates positive-finite validation to the shared
 * `resolveProviderReportedLimit` (issue #2270 DRY) so the acceptance predicate
 * lives in exactly one place. Returns undefined when the provider is
 * unavailable or does not report a usable limit, so callers fall back to the
 * model-name lookup.
 */
function resolveProviderContextLimit(
  provider: AgentRuntimeProviderAdapter,
): number | undefined {
  try {
    return resolveProviderReportedLimit(
      provider.getActiveProvider().getContextLimit?.(),
    );
  } catch {
    return undefined;
  }
}

function resolveSemanticMediaPurgeSetting(
  getLiveSetting: ReturnType<typeof createGetLiveSetting>,
  options: AgentRuntimeContextFactoryOptions,
): 'off' | 'remove' | 'summary' {
  const value = getLiveSetting(
    'media.semantic-purge',
    options.settings['media.semantic-purge'],
  );
  const validation = validateSetting('media.semantic-purge', value ?? 'off');
  if (!validation.success) {
    throw new Error(
      "Invalid media.semantic-purge setting: expected 'off', 'remove', or 'summary'",
    );
  }
  if (
    validation.value === 'off' ||
    validation.value === 'remove' ||
    validation.value === 'summary'
  ) {
    return validation.value;
  }
  throw new Error('Semantic media purge validator returned an invalid value');
}

/**
 * Build compression-related ephemeral accessors.
 */
function buildCompressionEphemerals(
  getLiveSetting: ReturnType<typeof createGetLiveSetting>,
  options: AgentRuntimeContextFactoryOptions,
) {
  return {
    compressionThreshold: (): number => {
      const liveThreshold = getLiveSetting(
        'compressionThreshold',
        options.settings.compressionThreshold,
      );
      const normalized =
        typeof liveThreshold === 'number' && Number.isFinite(liveThreshold)
          ? Math.min(Math.max(liveThreshold, 0), 1)
          : undefined;
      return normalized ?? EPHEMERAL_DEFAULTS.compressionThreshold;
    },
    contextLimit: (): number => {
      const liveLimit = getLiveSetting(
        'contextLimit',
        options.settings.contextLimit,
      );
      const providerContextLimit = resolveProviderContextLimit(
        options.provider,
      );
      return resolveEffectiveContextLimit(
        options.state.model,
        liveLimit,
        providerContextLimit,
      );
    },
    preserveThreshold: (): number =>
      getLiveSetting('preserveThreshold', options.settings.preserveThreshold) ??
      EPHEMERAL_DEFAULTS.preserveThreshold,
    topPreserveThreshold: (): number =>
      getLiveSetting(
        'topPreserveThreshold',
        options.settings.topPreserveThreshold,
      ) ?? EPHEMERAL_DEFAULTS.topPreserveThreshold,
    toolFormatOverride: (): string | undefined =>
      getLiveSetting('toolFormatOverride', options.settings.toolFormatOverride),
    /** @plan PLAN-20260211-COMPRESSION.P12 */
    compressionStrategy: (): string => {
      const live = getLiveSetting(
        'compressionStrategy',
        options.settings.compressionStrategy,
      );
      const fallback = getSettingSpec('compression.strategy')?.default;
      if (live !== undefined) return live;
      if (typeof fallback !== 'string')
        throw new Error('Missing compression strategy default');
      return fallback;
    },
    /** @plan PLAN-20260211-COMPRESSION.P12 */
    compressionProfile: (): string | undefined =>
      getLiveSetting('compressionProfile', options.settings.compressionProfile),
    ...buildDensityEphemerals(getLiveSetting, options),
    compressionVerification: (): boolean => {
      const value = getLiveSetting(
        'compressionVerification',
        options.settings.compressionVerification,
      );
      return typeof value === 'boolean' ? value : false;
    },
    semanticMediaPurge: (): 'off' | 'remove' | 'summary' =>
      resolveSemanticMediaPurgeSetting(getLiveSetting, options),
  };
}

/**
 * Build density-related ephemeral accessors.
 * @plan PLAN-20260211-HIGHDENSITY.P15
 * @requirement REQ-HD-009.5
 * @pseudocode settings-factory.md lines 90-121
 */
function buildDensityEphemerals(
  getLiveSetting: ReturnType<typeof createGetLiveSetting>,
  options: AgentRuntimeContextFactoryOptions,
) {
  return {
    /**
     * @plan PLAN-20260211-HIGHDENSITY.P15
     * @requirement REQ-HD-009.5
     * @pseudocode settings-factory.md lines 90-121
     */
    densityReadWritePruning: (): boolean => {
      const value = getLiveSetting(
        'compression.density.readWritePruning',
        options.settings['compression.density.readWritePruning'],
      );
      return typeof value === 'boolean' ? value : true;
    },
    densityFileDedupe: (): boolean => {
      const value = getLiveSetting(
        'compression.density.fileDedupe',
        options.settings['compression.density.fileDedupe'],
      );
      return typeof value === 'boolean' ? value : true;
    },
    densityRecencyPruning: (): boolean => {
      const value = getLiveSetting(
        'compression.density.recencyPruning',
        options.settings['compression.density.recencyPruning'],
      );
      return typeof value === 'boolean' ? value : false;
    },
    densityRecencyRetention: (): number => {
      const value = getLiveSetting(
        'compression.density.recencyRetention',
        options.settings['compression.density.recencyRetention'],
      );
      return typeof value === 'number' && value >= 1 ? value : 3;
    },
    densityCompressHeadroom: (): number => {
      const value = getLiveSetting(
        'compression.density.compressHeadroom',
        options.settings['compression.density.compressHeadroom'],
      );
      return typeof value === 'number' && value > 0 && value <= 1 ? value : 0.6;
    },
    densityOptimizeThreshold: (): number | undefined => {
      const value = getLiveSetting(
        'compression.density.optimizeThreshold',
        options.settings['compression.density.optimizeThreshold'],
      );
      return typeof value === 'number' && value >= 0 && value <= 1
        ? value
        : undefined;
    },
  };
}

/**
 * Build reasoning ephemeral accessors.
 * @plan PLAN-20251202-THINKING.P03b
 * @requirement REQ-THINK-006
 */
function buildReasoningEphemerals(
  getLiveSetting: ReturnType<typeof createGetLiveSetting>,
  options: AgentRuntimeContextFactoryOptions,
) {
  return {
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
      getLiveSetting(
        'reasoning.format',
        options.settings['reasoning.format'],
      ) ?? EPHEMERAL_DEFAULTS.reasoning.format,
    stripFromContext: (): 'all' | 'allButLast' | 'none' =>
      getLiveSetting(
        'reasoning.stripFromContext',
        options.settings['reasoning.stripFromContext'],
      ) ?? EPHEMERAL_DEFAULTS.reasoning.stripFromContext,
    fieldName: (): string =>
      getLiveSetting(
        'reasoning.fieldName',
        options.settings['reasoning.fieldName'],
      ) ?? EPHEMERAL_DEFAULTS.reasoning.fieldName,
    effort: ():
      | 'minimal'
      | 'low'
      | 'medium'
      | 'high'
      | 'xhigh'
      | 'max'
      | undefined =>
      getLiveSetting('reasoning.effort', options.settings['reasoning.effort']),
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
  };
}

function freezeProviderRuntime(
  providerRuntime: AgentRuntimeContextFactoryOptions['providerRuntime'],
) {
  return Object.freeze({
    ...providerRuntime,
    metadata: providerRuntime.metadata
      ? Object.freeze({ ...providerRuntime.metadata })
      : undefined,
  });
}

export function createAgentRuntimeContext(
  options: AgentRuntimeContextFactoryOptions,
): AgentRuntimeContext {
  validateRequiredOptions(options);

  const history = options.history ?? new HistoryService();
  if (options.mediaStore !== undefined) {
    history.registerMediaOwner(new HistoryMediaOwnership(options.mediaStore));
  }

  const getLiveSetting = createGetLiveSetting(options);

  const ephemerals = {
    ...buildCompressionEphemerals(getLiveSetting, options),
    reasoning: buildReasoningEphemerals(getLiveSetting, options),
  };

  const providerRuntime = freezeProviderRuntime(options.providerRuntime);

  const context: AgentRuntimeContext = {
    readPromptPolicy: () =>
      options.readRuntimeSettings?.().promptPolicy ??
      options.settings.promptPolicy ??
      {},
    readCompletionBudgetSetting: () =>
      options.readRuntimeSettings?.().maxOutputTokens ??
      options.settings.maxOutputTokens,
    readPromptCachingPolicy: () =>
      options.readRuntimeSettings?.().promptCaching ??
      options.settings.promptCaching,
    readToolExecutionPolicy: () => {
      const policy =
        options.readRuntimeSettings?.().toolExecutionPolicy ??
        options.settings.toolExecutionPolicy;
      if (policy === undefined)
        throw new Error('Runtime requires explicit tool execution policy');
      return policy;
    },
    readToolGovernance: () => {
      const policy =
        options.readRuntimeSettings?.().tools ?? options.settings.tools;
      return buildToolGovernance({
        getEphemeralSettings: () => ({
          'tools.allowed': policy?.allowed,
          'tools.disabled': policy?.disabled,
        }),
      });
    },
    readStreamTimeoutPolicy: () =>
      options.readRuntimeSettings?.().streamTimeoutPolicy ??
      options.settings.streamTimeoutPolicy ??
      {},
    showCitations: () =>
      options.readRuntimeSettings?.().showCitations ??
      options.settings.showCitations ??
      false,
    tokenUsageLoggingEnabled:
      options.readRuntimeSettings?.().tokenUsageLoggingEnabled ??
      options.settings.tokenUsageLoggingEnabled ??
      true,
    prepareProviderInvocation: options.prepareProviderInvocation,
    state: options.state,
    history,
    ephemerals,
    telemetry: options.telemetry,
    requestDiagnostics: options.requestDiagnostics,
    provider: options.provider,
    tools: options.tools,
    providerRuntime,
    promptEstimator: options.promptEstimator,
    ...(options.mediaStore === undefined
      ? {}
      : { mediaStore: options.mediaStore }),
    ...(options.mediaAdmission === undefined
      ? {}
      : { mediaAdmission: options.mediaAdmission }),
    ...(options.mediaResolver === undefined
      ? {}
      : { mediaResolver: options.mediaResolver }),
  };

  return Object.freeze(context);
}
