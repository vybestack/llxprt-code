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
} from '../reasoning/reasoning-behavior-parsing.js';
import {
  resolveReasoningConfiguration,
  type ReasoningResolution,
  type ResolvedReasoningConfiguration,
} from '../reasoning/reasoning-config-resolver.js';
import { hasExplicitReasoningField } from './openaiReasoningDialect.js';

export interface OpenAIChatReasoningInput {
  readonly body: Record<string, unknown>;
  readonly modelBehavior: Readonly<Record<string, unknown>>;
  readonly baseUrl: string | undefined;
  readonly model: string;
  readonly providerName: string;
  readonly logger: DebugLogger;
}

interface ParsedReasoningBehavior {
  readonly reasoning: {
    readonly enabled?: boolean;
    readonly effort?: ReasoningEffort;
    readonly budgetTokens?: number;
  };
  readonly effortWireFormat: ReasoningEffortWireFormat;
  readonly enabledWireFormat: ReasoningEnabledWireFormat;
  readonly effortMap?: ReasoningEffortMap;
  readonly enabledMap?: ReasoningEnabledMap;
}

/** Resolve and apply generic reasoning settings to an OpenAI Chat body. */
export function applyOpenAIChatReasoning(
  input: OpenAIChatReasoningInput,
): void {
  if (hasExplicitReasoningField(input.body)) {
    return;
  }

  const behavior = parseReasoningBehavior(input.modelBehavior);
  const resolved = resolveReasoningConfiguration({
    nativeAdapter: 'openai-chat',
    chatBaseUrl: input.baseUrl,
    reasoning: behavior.reasoning,
    effortWireFormat: behavior.effortWireFormat,
    enabledWireFormat: behavior.enabledWireFormat,
    effortMap: behavior.effortMap,
    enabledMap: behavior.enabledMap,
  });

  warnForDroppedReasoning(input, behavior, resolved);
  applyResolvedReasoning(input.body, resolved);
}

function parseReasoningBehavior(
  modelBehavior: Readonly<Record<string, unknown>>,
): ParsedReasoningBehavior {
  const enabled = readOptionalBoolean(
    modelBehavior['reasoning.enabled'],
    'reasoning.enabled',
  );
  const effort = readOptionalEffort(modelBehavior['reasoning.effort']);
  const budgetTokens = readOptionalPositiveInteger(
    modelBehavior['reasoning.budgetTokens'],
    'reasoning.budgetTokens',
  );
  const effortWireFormat = readEffortWireFormat(
    modelBehavior['reasoning.effortWireFormat'],
  );
  const enabledWireFormat = readEnabledWireFormat(
    modelBehavior['reasoning.enabledWireFormat'],
  );
  const effortMap = readEffortMap(modelBehavior['reasoning.effortMap']);
  const enabledMap = readEnabledMap(modelBehavior['reasoning.enabledMap']);

  return {
    reasoning: { enabled, effort, budgetTokens },
    effortWireFormat,
    enabledWireFormat,
    effortMap,
    enabledMap,
  };
}

function warnForDroppedReasoning(
  input: OpenAIChatReasoningInput,
  behavior: ParsedReasoningBehavior,
  resolved: ResolvedReasoningConfiguration,
): void {
  if (behavior.reasoning.effort !== undefined) {
    warnForOutcome(
      input,
      'reasoning.effort',
      resolved.effortFormat,
      resolved.effort,
    );
  }
  // A direct budget is consumed in Chat only by the anthropic-budget effort
  // format; any other format drops it even when an effort was emitted from
  // reasoning.effort or no effort outcome exists at all (issue #3255).
  if (
    behavior.reasoning.budgetTokens !== undefined &&
    resolved.effortFormat !== 'anthropic-budget'
  ) {
    warnDropped(input, {
      setting: 'reasoning.budgetTokens',
      selectedFormat: resolved.effortFormat,
      reason: 'budget-not-supported',
      detail:
        'direct budgets are only supported by the anthropic-budget effort format',
    });
  }
  if (behavior.reasoning.enabled !== undefined) {
    warnForOutcome(
      input,
      'reasoning.enabled',
      resolved.enabledFormat,
      resolved.enabled,
    );
  }
}

function warnForOutcome(
  input: OpenAIChatReasoningInput,
  setting: 'reasoning.effort' | 'reasoning.enabled',
  selectedFormat: string,
  outcome: ReasoningResolution<string | number | boolean>,
): void {
  if (outcome.state !== 'suppressed' && outcome.state !== 'unrepresentable') {
    return;
  }
  warnDropped(input, {
    setting,
    selectedFormat,
    reason: outcome.reason,
    detail: describeDroppedReason(outcome),
  });
}

interface DroppedSettingWarning {
  readonly setting: string;
  readonly selectedFormat: string;
  readonly reason: string;
  readonly detail: string;
}

function warnDropped(
  input: OpenAIChatReasoningInput,
  warning: DroppedSettingWarning,
): void {
  input.logger.warn(
    () =>
      `OpenAI Chat omitted configured ${warning.setting} because ${warning.detail}`,
    {
      provider: input.providerName,
      model: input.model,
      selectedFormat: warning.selectedFormat,
      setting: warning.setting,
      reason: warning.reason,
    },
  );
}

type DroppedOutcome = Extract<
  ReasoningResolution<string | number | boolean>,
  { readonly state: 'suppressed' } | { readonly state: 'unrepresentable' }
>;

/** Reason-accurate prose for why the outcome was dropped. */
function describeDroppedReason(outcome: DroppedOutcome): string {
  switch (outcome.reason) {
    case 'reasoning-disabled':
      return 'reasoning is explicitly disabled';
    case 'effort-map-null':
      return 'its effort map entry is null';
    case 'enabled-map-null':
      return 'its enabled map entry is null';
    case 'effort-format-none':
      return "the effort format is set to 'none'";
    case 'enabled-format-none':
      return "the enabled format is set to 'none'";
    case 'effort-format-undetected':
      return 'the effort format could not be detected for this endpoint';
    case 'enabled-format-undetected':
      return 'the enabled format could not be detected for this endpoint';
    case 'numeric-effort-map-required':
      return 'the anthropic-budget effort format requires a numeric effort map entry';
    case 'enabled-map-required':
      return 'the enabled format has no emitted effort or map value to represent it';
    default: {
      // Exhaustiveness guard: a new drop reason must add prose above.
      const exhaustive: never = outcome;
      throw new Error(
        `unhandled dropped reasoning outcome: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

interface RenderedReasoningFields {
  reasoning?: Record<string, unknown>;
  thinking?: Record<string, unknown>;
  templateKwargs?: Record<string, unknown>;
  reasoningEffort?: string;
}

function applyResolvedReasoning(
  body: Record<string, unknown>,
  resolved: ResolvedReasoningConfiguration,
): void {
  const fields: RenderedReasoningFields = {};
  if (
    resolved.effortFormat === 'template-kwargs' ||
    resolved.enabledFormat === 'template-kwargs'
  ) {
    const templateKwargs = readMergeableTemplateKwargs(body);
    if (templateKwargs !== undefined) {
      fields.templateKwargs = templateKwargs;
    }
  }

  applyResolvedEffort(fields, resolved);
  applyResolvedEnabled(fields, resolved);
  writeRenderedReasoning(body, fields);
}

function applyResolvedEffort(
  fields: RenderedReasoningFields,
  resolved: ResolvedReasoningConfiguration,
): void {
  if (resolved.effort.state !== 'emitted') {
    return;
  }

  switch (resolved.effortFormat) {
    case 'openai':
      if (typeof resolved.effort.value === 'string') {
        fields.reasoningEffort = resolved.effort.value;
      }
      break;
    case 'openrouter':
      if (typeof resolved.effort.value === 'string') {
        fields.reasoning = { effort: resolved.effort.value };
      }
      break;
    case 'template-kwargs':
      if (typeof resolved.effort.value === 'string') {
        fields.templateKwargs = {
          ...fields.templateKwargs,
          reasoning_effort: resolved.effort.value,
        };
      }
      break;
    case 'anthropic-budget':
      if (typeof resolved.effort.value === 'number') {
        fields.thinking = {
          type: 'enabled',
          budget_tokens: resolved.effort.value,
        };
      }
      break;
    // The resolver rejects the remaining effort formats (openai-responses,
    // anthropic, gemini) for the openai-chat adapter before this switch
    // runs, so only the safe default is needed here.
    case 'none':
    default:
      break;
  }
}

function applyResolvedEnabled(
  fields: RenderedReasoningFields,
  resolved: ResolvedReasoningConfiguration,
): void {
  if (resolved.enabled.state !== 'emitted') {
    return;
  }

  switch (resolved.enabledFormat) {
    case 'openai':
      if (typeof resolved.enabled.value === 'string') {
        fields.reasoningEffort = resolved.enabled.value;
      }
      break;
    case 'openrouter':
      if (typeof resolved.enabled.value === 'boolean') {
        fields.reasoning = {
          enabled: resolved.enabled.value,
          ...fields.reasoning,
        };
      }
      break;
    case 'thinking':
      if (typeof resolved.enabled.value === 'string') {
        fields.thinking = {
          ...fields.thinking,
          type: resolved.enabled.value,
        };
      }
      break;
    case 'template-kwargs':
      if (typeof resolved.enabled.value === 'boolean') {
        fields.templateKwargs = {
          ...fields.templateKwargs,
          enable_thinking: resolved.enabled.value,
        };
      }
      break;
    // The resolver rejects the remaining enabled formats (openai-responses,
    // gemini) for the openai-chat adapter before this switch runs, so only
    // the safe default is needed here.
    case 'none':
    default:
      break;
  }
}

function writeRenderedReasoning(
  body: Record<string, unknown>,
  fields: RenderedReasoningFields,
): void {
  if (fields.reasoning !== undefined) {
    body['reasoning'] = fields.reasoning;
  }
  if (fields.thinking !== undefined) {
    body['thinking'] = fields.thinking;
  }
  if (fields.reasoningEffort !== undefined) {
    body['reasoning_effort'] = fields.reasoningEffort;
  }
  if (fields.templateKwargs !== undefined) {
    body['chat_template_kwargs'] = fields.templateKwargs;
  }
}

function readMergeableTemplateKwargs(
  body: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const value = body['chat_template_kwargs'];
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error('chat_template_kwargs must be an object');
  }
  return { ...value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
