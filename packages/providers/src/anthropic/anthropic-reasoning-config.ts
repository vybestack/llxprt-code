/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type {
  ReasoningEffort,
  ReasoningEffortMap,
  ReasoningEffortWireFormat,
  ReasoningEnabledMap,
  ReasoningEnabledWireFormat,
} from '@vybestack/llxprt-code-settings';
import {
  readEffortMap,
  readEffortWireFormat,
  readEnabledMap,
  readEnabledWireFormat,
  readOptionalBoolean,
  readOptionalEffort,
  readOptionalPositiveInteger,
  selectBehaviorValue,
} from '../reasoning/reasoning-behavior-parsing.js';
import {
  resolveReasoningConfiguration,
  type ReasoningResolution,
  type ResolvedReasoningConfiguration,
} from '../reasoning/reasoning-config-resolver.js';
import {
  ANTHROPIC_LEGACY_DEFAULT_BUDGET_TOKENS,
  assertAdaptiveManualBudget,
  buildThinkingConfig,
  type AnthropicOutputConfigParameter,
  type AnthropicThinkingParameter,
} from './AnthropicRequestBuilder.js';
import {
  isFable5,
  supportsAdaptiveThinking,
  supportsDisabledThinking,
} from './AnthropicModelData.js';

export interface AnthropicReasoningFallbacks {
  readonly enabled?: unknown;
  readonly effort?: unknown;
  readonly budgetTokens?: unknown;
  readonly adaptiveThinking?: unknown;
  readonly effortWireFormat?: unknown;
  readonly enabledWireFormat?: unknown;
  readonly effortMap?: unknown;
  readonly enabledMap?: unknown;
}

export interface AnthropicReasoningSettings {
  readonly enabled?: boolean;
  readonly effort?: ReasoningEffort;
  readonly budgetTokens?: number;
  readonly adaptiveThinking?: boolean;
  readonly effortWireFormat: ReasoningEffortWireFormat;
  readonly enabledWireFormat: ReasoningEnabledWireFormat;
  readonly effortMap?: ReasoningEffortMap;
  readonly enabledMap?: ReasoningEnabledMap;
}

export type { AnthropicThinkingParameter };

export interface AnthropicNativeReasoningConfig {
  readonly thinking?: AnthropicThinkingParameter;
  readonly outputConfig?: AnthropicOutputConfigParameter;
}

interface NativeConfigInput {
  readonly settings: AnthropicReasoningSettings;
  readonly modelParams: Readonly<Record<string, unknown>>;
  readonly model: string;
  readonly providerName: string;
  readonly includeInResponse?: boolean;
  readonly logger: DebugLogger;
}

/** Strictly parse Anthropic reasoning behavior from the invocation snapshot. */
export function readAnthropicReasoningSettings(
  modelBehavior: Readonly<Record<string, unknown>>,
  fallbacks: AnthropicReasoningFallbacks,
): AnthropicReasoningSettings {
  return {
    enabled: readOptionalBoolean(
      selectBehaviorValue(
        modelBehavior,
        'reasoning.enabled',
        fallbacks.enabled,
      ),
      'reasoning.enabled',
    ),
    effort: readOptionalEffort(
      selectBehaviorValue(modelBehavior, 'reasoning.effort', fallbacks.effort),
    ),
    budgetTokens: readOptionalPositiveInteger(
      selectBehaviorValue(
        modelBehavior,
        'reasoning.budgetTokens',
        fallbacks.budgetTokens,
      ),
      'reasoning.budgetTokens',
    ),
    adaptiveThinking: readOptionalBoolean(
      selectBehaviorValue(
        modelBehavior,
        'reasoning.adaptiveThinking',
        fallbacks.adaptiveThinking,
      ),
      'reasoning.adaptiveThinking',
    ),
    effortWireFormat: readEffortWireFormat(
      selectBehaviorValue(
        modelBehavior,
        'reasoning.effortWireFormat',
        fallbacks.effortWireFormat,
      ),
    ),
    enabledWireFormat: readEnabledWireFormat(
      selectBehaviorValue(
        modelBehavior,
        'reasoning.enabledWireFormat',
        fallbacks.enabledWireFormat,
      ),
    ),
    effortMap: readEffortMap(
      selectBehaviorValue(
        modelBehavior,
        'reasoning.effortMap',
        fallbacks.effortMap,
      ),
    ),
    enabledMap: readEnabledMap(
      selectBehaviorValue(
        modelBehavior,
        'reasoning.enabledMap',
        fallbacks.enabledMap,
      ),
    ),
  };
}

/** Build the one native Anthropic reasoning representation for a request. */
export function buildAnthropicNativeReasoningConfig(
  input: NativeConfigInput,
): AnthropicNativeReasoningConfig {
  const explicit = readExplicitNativeConfig(input.modelParams);
  if (explicit.collision) {
    return {
      thinking: explicit.thinking,
      outputConfig: explicit.outputConfig,
    };
  }

  const resolved = resolveReasoningConfiguration({
    nativeAdapter: 'anthropic',
    reasoning: {
      enabled: input.settings.enabled,
      effort: input.settings.effort,
      budgetTokens: input.settings.budgetTokens,
    },
    effortWireFormat: input.settings.effortWireFormat,
    enabledWireFormat: input.settings.enabledWireFormat,
    effortMap: input.settings.effortMap,
    enabledMap: input.settings.enabledMap,
  });
  warnForDroppedReasoning(input, resolved);

  const translated =
    isLegacyAutoConfiguration(input.settings) &&
    input.settings.enabled !== undefined
      ? buildLegacyAutoConfig(input, resolved)
      : buildSelectedConfig(input, resolved);
  return {
    thinking: translated.thinking,
    outputConfig: mergeOutputConfig(
      explicit.outputConfig,
      translated.outputConfig,
    ),
  };
}

interface ExplicitNativeConfig extends AnthropicNativeReasoningConfig {
  readonly collision: boolean;
}

function readExplicitNativeConfig(
  modelParams: Readonly<Record<string, unknown>>,
): ExplicitNativeConfig {
  const hasThinking = hasOwn(modelParams, 'thinking');
  const hasOutputConfig = hasOwn(modelParams, 'output_config');
  const thinking = hasThinking
    ? readExplicitThinking(modelParams['thinking'])
    : undefined;
  const outputConfig = hasOutputConfig
    ? readExplicitOutputConfig(modelParams['output_config'])
    : undefined;
  return {
    collision:
      thinking !== undefined ||
      (outputConfig !== undefined && hasOwn(outputConfig, 'effort')),
    thinking,
    outputConfig,
  };
}

function readExplicitThinking(value: unknown): AnthropicThinkingParameter {
  if (!isRecord(value)) {
    throw new Error('thinking must be an object');
  }
  const type = value['type'];
  if (!hasNonEmptyString(type)) {
    throw new Error('thinking.type must be a non-empty string');
  }
  // A future or non-enumerated type string is still an explicit native
  // selection: pass the object through unchanged so forward-compatible
  // thinking modes keep working and generic translation stands down
  // (issue #3255).
  return { ...value, type };
}

function readExplicitOutputConfig(
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new Error('output_config must be an object');
  }
  if (hasOwn(value, 'effort') && !hasNonEmptyString(value['effort'])) {
    throw new Error('output_config.effort must be a non-empty string');
  }
  return { ...value };
}

function isLegacyAutoConfiguration(
  settings: AnthropicReasoningSettings,
): boolean {
  return (
    settings.effortWireFormat === 'auto' &&
    settings.enabledWireFormat === 'auto' &&
    settings.effortMap === undefined &&
    settings.enabledMap === undefined
  );
}

function buildLegacyAutoConfig(
  input: NativeConfigInput,
  resolved: ResolvedReasoningConfiguration,
): AnthropicNativeReasoningConfig {
  if (input.settings.enabled === false) {
    if (supportsDisabledThinking(input.model)) {
      return { thinking: { type: 'disabled' } };
    }
    warnUnsupportedDisablement(input, resolved.enabledFormat);
    return {};
  }

  // The caller guarantees enabled !== undefined, so reaching here means
  // enabled === true; no third state exists to guard.
  const effort = readNormalizedEffort(input.model, resolved);
  const existing = buildThinkingConfig({
    reasoningEnabled: true,
    reasoningBudgetTokens: input.settings.budgetTokens,
    adaptiveThinking: input.settings.adaptiveThinking,
    includeInResponse: input.includeInResponse,
    thinkingEffort: effort,
    model: input.model,
  });
  return {
    thinking: existing.thinking,
    outputConfig: existing.output_config,
  };
}

function buildSelectedConfig(
  input: NativeConfigInput,
  resolved: ResolvedReasoningConfiguration,
): AnthropicNativeReasoningConfig {
  const outputConfig = buildSelectedOutputConfig(input, resolved);
  const thinking = buildSelectedThinking(input, resolved);
  return { thinking, outputConfig };
}

function buildSelectedOutputConfig(
  input: NativeConfigInput,
  resolved: ResolvedReasoningConfiguration,
): Readonly<Record<string, unknown>> | undefined {
  const effort = readSelectedEffort(input, resolved);
  return effort === undefined ? undefined : { effort };
}

function buildSelectedThinking(
  input: NativeConfigInput,
  resolved: ResolvedReasoningConfiguration,
): AnthropicThinkingParameter | undefined {
  if (input.settings.enabled === false) {
    return buildDisabledThinking(input, resolved);
  }
  if (resolved.effortFormat === 'anthropic-budget') {
    return buildBudgetThinking(input, resolved);
  }
  if (input.settings.enabled === undefined) {
    return undefined;
  }

  const type = selectEnabledThinkingType(input, resolved);
  if (type === undefined) {
    return undefined;
  }
  if (type === 'adaptive') {
    return {
      type,
      display: input.includeInResponse === false ? 'omitted' : 'summarized',
    };
  }
  if (needsClaudeBudget(input.model)) {
    // Adaptive-capable models have no legacy budget default: refuse before
    // transport rather than fabricating one (issue #3255). Legacy budgeted
    // models keep the existing default below.
    assertAdaptiveManualBudget(input.model, input.settings.budgetTokens);
    return {
      type,
      budget_tokens:
        input.settings.budgetTokens ?? ANTHROPIC_LEGACY_DEFAULT_BUDGET_TOKENS,
      ...(input.includeInResponse === false ? { display: 'omitted' } : {}),
    };
  }
  return { type };
}

function buildDisabledThinking(
  input: NativeConfigInput,
  resolved: ResolvedReasoningConfiguration,
): AnthropicThinkingParameter | undefined {
  if (resolved.enabled.state !== 'emitted') {
    return undefined;
  }
  if (typeof resolved.enabled.value !== 'string') {
    throw new Error('Anthropic thinking enablement must resolve to a string');
  }
  if (resolved.enabled.value !== 'disabled') {
    throw new Error(
      `reasoning.enabledMap.false value '${resolved.enabled.value}' is not supported by the Anthropic adapter`,
    );
  }
  if (!supportsDisabledThinking(input.model)) {
    warnUnsupportedDisablement(input, resolved.enabledFormat);
    return undefined;
  }
  return { type: 'disabled' };
}

function buildBudgetThinking(
  input: NativeConfigInput,
  resolved: ResolvedReasoningConfiguration,
): AnthropicThinkingParameter | undefined {
  if (
    resolved.effort.state !== 'emitted' ||
    typeof resolved.effort.value !== 'number'
  ) {
    if (input.settings.enabled === true) {
      warn(input, {
        format: resolved.effortFormat,
        setting: 'reasoning.enabled',
        reason: 'budget-required',
      });
    }
    return undefined;
  }
  if (
    resolved.enabled.state === 'emitted' &&
    resolved.enabled.value !== 'enabled'
  ) {
    throw new Error(
      'anthropic-budget requires reasoning.enabledMap.true to resolve to enabled',
    );
  }
  return {
    type: 'enabled',
    budget_tokens: resolved.effort.value,
    ...(input.includeInResponse === false ? { display: 'omitted' } : {}),
  };
}

function selectEnabledThinkingType(
  input: NativeConfigInput,
  resolved: ResolvedReasoningConfiguration,
): 'adaptive' | 'enabled' | undefined {
  if (isFable5(input.model)) {
    return 'adaptive';
  }
  if (resolved.enabled.state !== 'emitted') {
    return undefined;
  }
  if (typeof resolved.enabled.value !== 'string') {
    throw new Error('Anthropic thinking enablement must resolve to a string');
  }
  if (
    input.settings.enabledMap?.true === undefined &&
    supportsAdaptiveThinking(input.model) &&
    input.settings.budgetTokens === undefined &&
    input.settings.adaptiveThinking !== false
  ) {
    return 'adaptive';
  }
  switch (resolved.enabled.value) {
    case 'adaptive':
    case 'enabled':
      return resolved.enabled.value;
    default:
      throw new Error(
        `reasoning.enabledMap.true value '${resolved.enabled.value}' is not supported by the Anthropic adapter`,
      );
  }
}

function needsClaudeBudget(model: string): boolean {
  return model.toLowerCase().startsWith('claude-');
}

function readSelectedEffort(
  input: NativeConfigInput,
  resolved: ResolvedReasoningConfiguration,
): string | undefined {
  const effort = readAnthropicEffort(resolved);
  if (effort === undefined) {
    return undefined;
  }
  const mappedEffort =
    input.settings.effort === undefined
      ? undefined
      : input.settings.effortMap?.[input.settings.effort];
  return typeof mappedEffort === 'string'
    ? effort
    : normalizeEffort(input.model, effort);
}

function readNormalizedEffort(
  model: string,
  resolved: ResolvedReasoningConfiguration,
): 'low' | 'medium' | 'high' | 'max' | undefined {
  const effort = readAnthropicEffort(resolved);
  return effort === undefined ? undefined : normalizeEffort(model, effort);
}

function readAnthropicEffort(
  resolved: ResolvedReasoningConfiguration,
): string | undefined {
  if (
    resolved.effortFormat !== 'anthropic' ||
    resolved.effort.state !== 'emitted'
  ) {
    return undefined;
  }
  if (typeof resolved.effort.value !== 'string') {
    throw new Error('Anthropic effort must resolve to a string');
  }
  return resolved.effort.value;
}

function normalizeEffort(
  model: string,
  effort: string,
): 'low' | 'medium' | 'high' | 'max' {
  switch (effort) {
    case 'minimal':
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'xhigh':
    case 'max':
      return supportsAdaptiveThinking(model) || !needsClaudeBudget(model)
        ? 'max'
        : 'high';
    default:
      throw new Error(
        `reasoning.effortMap produced unsupported Anthropic effort '${effort}'`,
      );
  }
}

function mergeOutputConfig(
  explicit: Readonly<Record<string, unknown>> | undefined,
  translated: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (explicit === undefined) {
    return translated;
  }
  if (translated === undefined) {
    return explicit;
  }
  return { ...explicit, ...translated };
}

function warnForDroppedReasoning(
  input: NativeConfigInput,
  resolved: ResolvedReasoningConfiguration,
): void {
  if (input.settings.effort !== undefined) {
    warnForOutcome(
      input,
      'reasoning.effort',
      resolved.effortFormat,
      resolved.effort,
    );
  } else if (input.settings.budgetTokens !== undefined) {
    warnForOutcome(
      input,
      'reasoning.budgetTokens',
      resolved.effortFormat,
      resolved.effort,
    );
  }
  if (input.settings.enabled !== undefined) {
    warnForOutcome(
      input,
      'reasoning.enabled',
      resolved.enabledFormat,
      resolved.enabled,
    );
  }
}

function warnForOutcome(
  input: NativeConfigInput,
  setting: string,
  format: string,
  outcome: ReasoningResolution<string | number | boolean>,
): void {
  if (outcome.state !== 'suppressed' && outcome.state !== 'unrepresentable') {
    return;
  }
  warn(input, { format, setting, reason: outcome.reason });
}

function warnUnsupportedDisablement(
  input: NativeConfigInput,
  format: string,
): void {
  warn(input, {
    format,
    setting: 'reasoning.enabled',
    reason: 'model-cannot-disable-thinking',
  });
}

function warn(
  input: NativeConfigInput,
  detail: {
    readonly format: string;
    readonly setting: string;
    readonly reason: string;
  },
): void {
  input.logger.warn(
    () =>
      `Anthropic omitted configured ${detail.setting} because ${detail.setting === 'reasoning.enabled' ? 'enabled' : 'effort'} format '${detail.format}' cannot emit it`,
    {
      providerName: input.providerName,
      model: input.model,
      format: detail.format,
      setting: detail.setting,
      reason: detail.reason,
    },
  );
}

function hasOwn(
  value: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
