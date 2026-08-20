/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  isGemini2Model,
  isGemini3Model,
} from '@vybestack/llxprt-code-core/config/models.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { ReasoningEffort } from '@vybestack/llxprt-code-settings';
import {
  resolveReasoningConfiguration,
  type ReasoningResolution,
  type ResolvedReasoningConfiguration,
} from '../reasoning/reasoning-config-resolver.js';
import {
  mapReasoningEffortToThinkingLevel,
  type ReasoningConfig,
} from './geminiReasoningConfig.js';

interface GeminiReasoningTranslationInput {
  readonly requestConfig: Record<string, unknown>;
  readonly reasoningConfig: ReasoningConfig;
  readonly model: string;
  readonly logger: DebugLogger;
}

type NativeThinkingLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/** Apply the one resolved generic reasoning representation owned by Gemini. */
export function applyGeminiReasoningTranslation(
  input: GeminiReasoningTranslationInput,
): void {
  if (hasOwn(input.requestConfig, 'thinkingConfig')) {
    return;
  }

  const resolved = resolveReasoningConfiguration({
    nativeAdapter: 'gemini',
    reasoning: {
      enabled: input.reasoningConfig.enabled,
      effort: input.reasoningConfig.effort,
    },
    effortWireFormat: input.reasoningConfig.effortWireFormat,
    enabledWireFormat: input.reasoningConfig.enabledWireFormat,
    effortMap: input.reasoningConfig.effortMap,
    enabledMap: input.reasoningConfig.enabledMap,
  });

  if (input.reasoningConfig.enabled === false) {
    // Disablement suppresses a configured effort; report it before the
    // native disablement path returns (issue #3255).
    warnForResolvedOutcome(
      input,
      'reasoning.effort',
      resolved.effortFormat,
      resolved.effort,
    );
    applyDisabledThinking(input, resolved);
    return;
  }

  warnForResolvedOutcome(
    input,
    'reasoning.effort',
    resolved.effortFormat,
    resolved.effort,
  );
  warnForResolvedOutcome(
    input,
    'reasoning.enabled',
    resolved.enabledFormat,
    resolved.enabled,
  );

  if (input.reasoningConfig.enabled !== true) {
    warnForUnenabledValues(input, resolved);
    return;
  }

  // Budget translation belongs to Gemini 2 and level translation to
  // Gemini 3; any other generation has no native reasoning representation,
  // so configured values are omitted with a warning (issue #3255).
  if (isGemini3Model(input.model)) {
    applyGemini3Thinking(input, resolved);
    return;
  }

  if (isGemini2Model(input.model)) {
    applyBudgetThinking(input, resolved);
    return;
  }

  warnUnsupportedGeneration(input, resolved);
}

function warnUnsupportedGeneration(
  input: GeminiReasoningTranslationInput,
  resolved: ResolvedReasoningConfiguration,
): void {
  if (input.reasoningConfig.enabled !== undefined) {
    warnDropped(
      input,
      'reasoning.enabled',
      resolved.enabledFormat,
      'model-generation-unsupported',
    );
  }
  if (
    input.reasoningConfig.effort !== undefined &&
    resolved.effort.state === 'emitted'
  ) {
    warnDropped(
      input,
      'reasoning.effort',
      resolved.effortFormat,
      'model-generation-unsupported',
    );
  }
  if (input.reasoningConfig.maxTokens !== undefined) {
    warnDropped(
      input,
      'reasoning.maxTokens',
      'gemini',
      'model-generation-unsupported',
    );
  }
}

function applyDisabledThinking(
  input: GeminiReasoningTranslationInput,
  resolved: ResolvedReasoningConfiguration,
): void {
  if (resolved.enabled.state !== 'emitted') {
    warnForResolvedOutcome(
      input,
      'reasoning.enabled',
      resolved.enabledFormat,
      resolved.enabled,
    );
    return;
  }

  // The disabled path permits only a genuine disable representation: a
  // thinking level or a true boolean enables thinking, so neither can
  // express reasoning.enabled=false (issue #3255).
  if (typeof resolved.enabled.value === 'string') {
    if (!isGemini3Model(input.model)) {
      throw unsupportedNativeLevelError(resolved.enabled.value, input.model);
    }
    warnDropped(
      input,
      'reasoning.enabled',
      resolved.enabledFormat,
      'gemini-3-disablement-unrepresentable',
    );
    return;
  }

  if (resolved.enabled.value === true) {
    warnDropped(
      input,
      'reasoning.enabled',
      resolved.enabledFormat,
      disablementReason(input.model),
    );
    return;
  }

  if (isGemini2Model(input.model)) {
    input.requestConfig['thinkingConfig'] = { thinkingBudget: 0 };
    return;
  }

  warnDropped(
    input,
    'reasoning.enabled',
    resolved.enabledFormat,
    disablementReason(input.model),
  );
}

function disablementReason(model: string): string {
  return isGemini3Model(model)
    ? 'gemini-3-disablement-unrepresentable'
    : 'gemini-disablement-unrepresentable';
}

function applyGemini3Thinking(
  input: GeminiReasoningTranslationInput,
  resolved: ResolvedReasoningConfiguration,
): void {
  // Explicit effort wins over a mapped enabled level: both resolve into
  // the same thinkingLevel control, so the configured effort (or its map
  // remap) is the authoritative value and the enabled map level only
  // covers effort-absent configuration (issue #3255).
  const effortLevel = readResolvedEffortLevel(input, resolved.effort);
  const mappedEnabledLevel =
    effortLevel === undefined
      ? readMappedEnabledLevel(input, resolved.enabled)
      : undefined;
  const thinkingLevel = effortLevel ?? mappedEnabledLevel;
  input.requestConfig['thinkingConfig'] = {
    includeThoughts: true,
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
  };

  if (input.reasoningConfig.maxTokens !== undefined) {
    warnDropped(
      input,
      'reasoning.maxTokens',
      'gemini',
      'gemini-3-max-tokens-unrepresentable',
    );
  }
}

function applyBudgetThinking(
  input: GeminiReasoningTranslationInput,
  resolved: ResolvedReasoningConfiguration,
): void {
  if (resolved.enabled.state === 'emitted') {
    if (typeof resolved.enabled.value === 'string') {
      throw unsupportedNativeLevelError(resolved.enabled.value, input.model);
    }
    if (resolved.enabled.value === false) {
      input.requestConfig['thinkingConfig'] = { thinkingBudget: 0 };
      return;
    }
  }

  if (
    resolved.effort.state === 'emitted' &&
    typeof resolved.effort.value === 'string' &&
    isNativeThinkingLevel(resolved.effort.value)
  ) {
    throw unsupportedNativeLevelError(resolved.effort.value, input.model);
  }
  if (input.reasoningConfig.effort !== undefined) {
    warnDropped(
      input,
      'reasoning.effort',
      resolved.effortFormat,
      'gemini-2-effort-unrepresentable',
    );
  }

  input.requestConfig['thinkingConfig'] = {
    includeThoughts: true,
    thinkingBudget: input.reasoningConfig.maxTokens ?? -1,
  };
}

function readMappedEnabledLevel(
  input: GeminiReasoningTranslationInput,
  enabled: ReasoningResolution<string | boolean>,
): NativeThinkingLevel | undefined {
  if (enabled.state !== 'emitted' || typeof enabled.value !== 'string') {
    return undefined;
  }
  return readNativeThinkingLevel(enabled.value, input.model);
}

function readResolvedEffortLevel(
  input: GeminiReasoningTranslationInput,
  effort: ReasoningResolution<string | number>,
): NativeThinkingLevel | undefined {
  if (effort.state !== 'emitted') {
    return undefined;
  }
  if (typeof effort.value !== 'string') {
    throw new Error('Gemini reasoning effort must resolve to a string');
  }
  if (isNativeThinkingLevel(effort.value)) {
    return effort.value;
  }

  const genericEffort = readGenericEffort(effort.value);
  if (genericEffort === undefined) {
    throw unsupportedNativeLevelError(effort.value, input.model);
  }
  const mapped = mapReasoningEffortToThinkingLevel(genericEffort);
  if (mapped === undefined || !isNativeThinkingLevel(mapped)) {
    throw unsupportedNativeLevelError(effort.value, input.model);
  }
  return mapped;
}

function readGenericEffort(value: string): ReasoningEffort | undefined {
  switch (value) {
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return value;
    default:
      return undefined;
  }
}

function readNativeThinkingLevel(
  value: string,
  model: string,
): NativeThinkingLevel {
  if (isNativeThinkingLevel(value)) {
    return value;
  }
  throw unsupportedNativeLevelError(value, model);
}

function isNativeThinkingLevel(value: string): value is NativeThinkingLevel {
  return value === 'LOW' || value === 'MEDIUM' || value === 'HIGH';
}

function unsupportedNativeLevelError(value: string, model: string): Error {
  return new Error(
    `native Gemini thinking level '${value}' is not supported by the Gemini adapter for model '${model}'`,
  );
}

function warnForResolvedOutcome(
  input: GeminiReasoningTranslationInput,
  genericSetting: 'reasoning.effort' | 'reasoning.enabled',
  format: string,
  outcome: ReasoningResolution<string | number | boolean>,
): void {
  if (outcome.state !== 'suppressed' && outcome.state !== 'unrepresentable') {
    return;
  }
  const configured =
    genericSetting === 'reasoning.effort'
      ? input.reasoningConfig.effort !== undefined
      : input.reasoningConfig.enabled !== undefined;
  if (configured) {
    warnDropped(input, genericSetting, format, outcome.reason);
  }
}

function warnForUnenabledValues(
  input: GeminiReasoningTranslationInput,
  resolved: ResolvedReasoningConfiguration,
): void {
  if (
    input.reasoningConfig.effort !== undefined &&
    resolved.effort.state !== 'suppressed' &&
    resolved.effort.state !== 'unrepresentable'
  ) {
    warnDropped(
      input,
      'reasoning.effort',
      resolved.effortFormat,
      'reasoning-not-enabled',
    );
  }
  if (input.reasoningConfig.maxTokens !== undefined) {
    warnDropped(
      input,
      'reasoning.maxTokens',
      'gemini',
      'reasoning-not-enabled',
    );
  }
}

function warnDropped(
  input: GeminiReasoningTranslationInput,
  genericSetting: string,
  format: string,
  reason: string,
): void {
  input.logger.warn(
    () =>
      `Gemini omitted configured ${genericSetting} for model ${input.model} using format '${format}' because ${reason}`,
    {
      provider: 'gemini',
      model: input.model,
      format,
      genericSetting,
      reason,
    },
  );
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
