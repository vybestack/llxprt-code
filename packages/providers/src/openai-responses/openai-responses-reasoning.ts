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
import { toOpenAIResponsesWireEffort } from '../openai/openaiModelPolicy.js';
import {
  readEffortMap,
  readEffortWireFormat,
  readEnabledMap,
  readEnabledWireFormat,
  readModelBehaviorRecord,
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
import type { OpenAIResponsesRequest } from './OpenAIResponsesTypes.js';

export interface ResponsesReasoningFallbacks {
  readonly enabled?: unknown;
  readonly effort?: unknown;
  readonly budgetTokens?: unknown;
  readonly summary?: unknown;
  readonly includeInResponse?: unknown;
}

export interface OpenAIResponsesReasoningInput {
  readonly request: OpenAIResponsesRequest;
  readonly modelBehavior: unknown;
  readonly fallbacks: ResponsesReasoningFallbacks;
  readonly providerName: string;
  readonly logger: DebugLogger;
}

export interface AppliedOpenAIResponsesReasoning {
  readonly enabled: boolean | undefined;
  readonly effort: ReasoningEffort | undefined;
  readonly summary: string | undefined;
  readonly selected: boolean;
  readonly includeThinkingInResponse: boolean;
}

interface ParsedReasoningBehavior {
  readonly reasoning: {
    readonly enabled?: boolean;
    readonly effort?: ReasoningEffort;
    readonly budgetTokens?: number;
  };
  readonly summary?: string;
  readonly effortWireFormat: ReasoningEffortWireFormat;
  readonly enabledWireFormat: ReasoningEnabledWireFormat;
  readonly effortMap?: ReasoningEffortMap;
  readonly enabledMap?: ReasoningEnabledMap;
}

/** Resolve and apply generic reasoning settings to an OpenAI Responses body. */
export function applyOpenAIResponsesReasoning(
  input: OpenAIResponsesReasoningInput,
): AppliedOpenAIResponsesReasoning {
  // The behavior record is read once and shared by both paths so explicit
  // native reasoning does not reparse the snapshot (issue #3255).
  const modelBehavior = readModelBehaviorRecord(input.modelBehavior);
  const includeThinkingInResponse =
    selectBehaviorValue(
      modelBehavior,
      'reasoning.includeInResponse',
      input.fallbacks.includeInResponse,
    ) !== false;

  // Any own `reasoning` property copied from modelParams is explicit,
  // including null and non-object values: it must reach the wire exactly
  // unchanged, so translation stands down rather than overwriting it
  // (issue #3255). The own-property presence, not its shape, decides.
  if (Object.prototype.hasOwnProperty.call(input.request, 'reasoning')) {
    const explicitReasoning = input.request['reasoning'];
    return {
      enabled: undefined,
      effort: undefined,
      summary: isRecord(explicitReasoning)
        ? readOptionalSummary(explicitReasoning['summary'])
        : undefined,
      selected: isRecord(explicitReasoning)
        ? hasNonEmptyString(explicitReasoning['effort'])
        : false,
      includeThinkingInResponse,
    };
  }

  const behavior = parseReasoningBehavior(input, modelBehavior);
  const resolved = resolveReasoningConfiguration({
    nativeAdapter: 'openai-responses',
    reasoning: behavior.reasoning,
    effortWireFormat: behavior.effortWireFormat,
    enabledWireFormat: behavior.enabledWireFormat,
    effortMap: behavior.effortMap,
    enabledMap: behavior.enabledMap,
  });

  warnForDroppedReasoning(input, behavior, resolved);
  const selected = applyResolvedReasoning(input.request, resolved, behavior);
  applyReasoningSummary(input.request, behavior.summary);

  return {
    enabled: behavior.reasoning.enabled,
    effort: behavior.reasoning.effort,
    summary: behavior.summary,
    selected,
    includeThinkingInResponse,
  };
}

function parseReasoningBehavior(
  input: OpenAIResponsesReasoningInput,
  modelBehavior: Readonly<Record<string, unknown>>,
): ParsedReasoningBehavior {
  const enabled = readOptionalBoolean(
    selectBehaviorValue(
      modelBehavior,
      'reasoning.enabled',
      input.fallbacks.enabled,
    ),
    'reasoning.enabled',
  );
  const effort = readOptionalEffort(
    selectBehaviorValue(
      modelBehavior,
      'reasoning.effort',
      input.fallbacks.effort,
    ),
  );
  const budgetTokens = readOptionalPositiveInteger(
    selectBehaviorValue(
      modelBehavior,
      'reasoning.budgetTokens',
      input.fallbacks.budgetTokens,
    ),
    'reasoning.budgetTokens',
  );
  const summary = readOptionalSummary(
    selectBehaviorValue(
      modelBehavior,
      'reasoning.summary',
      input.fallbacks.summary,
    ),
  );

  return {
    reasoning: { enabled, effort, budgetTokens },
    summary,
    effortWireFormat: readEffortWireFormat(
      modelBehavior['reasoning.effortWireFormat'],
    ),
    enabledWireFormat: readEnabledWireFormat(
      modelBehavior['reasoning.enabledWireFormat'],
    ),
    effortMap: readEffortMap(modelBehavior['reasoning.effortMap']),
    enabledMap: readEnabledMap(modelBehavior['reasoning.enabledMap']),
  };
}

function readOptionalSummary(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function warnForDroppedReasoning(
  input: OpenAIResponsesReasoningInput,
  behavior: ParsedReasoningBehavior,
  resolved: ResolvedReasoningConfiguration,
): void {
  if (behavior.reasoning.effort !== undefined) {
    warnForOutcome(
      input,
      'reasoning.effort',
      'effort',
      resolved.effortFormat,
      resolved.effort,
    );
  }
  if (behavior.reasoning.budgetTokens !== undefined) {
    warnForDroppedBudget(input, resolved.effortFormat);
  }
  // Enabled-only configuration still selects reasoning output (the prior
  // executor requested encrypted thinking content for enabled=true), so a
  // dropped-enablement warning would be misleading (issue #3255).
  if (
    behavior.reasoning.enabled !== undefined &&
    behavior.reasoning.enabled !== true
  ) {
    warnForOutcome(
      input,
      'reasoning.enabled',
      'enabled',
      resolved.enabledFormat,
      resolved.enabled,
    );
  }
}

function warnForDroppedBudget(
  input: OpenAIResponsesReasoningInput,
  selectedFormat: string,
): void {
  input.logger.warn(
    () =>
      `OpenAI Responses omitted configured reasoning.budgetTokens because effort format '${selectedFormat}' cannot emit it`,
    {
      providerName: input.providerName,
      model: input.request.model,
      selectedFormat,
      setting: 'reasoning.budgetTokens',
      reason: 'budget-not-supported',
    },
  );
}

function warnForOutcome(
  input: OpenAIResponsesReasoningInput,
  setting: string,
  dimension: 'effort' | 'enabled',
  selectedFormat: string,
  outcome: ReasoningResolution<string | number | boolean>,
): void {
  if (outcome.state !== 'suppressed' && outcome.state !== 'unrepresentable') {
    return;
  }
  input.logger.warn(
    () =>
      `OpenAI Responses omitted configured ${setting} because ${dimension} format '${selectedFormat}' cannot emit it`,
    {
      providerName: input.providerName,
      model: input.request.model,
      selectedFormat,
      setting,
      reason: outcome.reason,
    },
  );
}

function applyResolvedReasoning(
  request: OpenAIResponsesRequest,
  resolved: ResolvedReasoningConfiguration,
  behavior: ParsedReasoningBehavior,
): boolean {
  let wireEffort: string | undefined;
  if (
    resolved.effortFormat === 'openai-responses' &&
    resolved.effort.state === 'emitted' &&
    typeof resolved.effort.value === 'string'
  ) {
    wireEffort = toOpenAIResponsesWireEffort(
      resolved.effort.value,
      request.model,
    );
  }
  if (
    resolved.enabledFormat === 'openai-responses' &&
    resolved.enabled.state === 'emitted' &&
    typeof resolved.enabled.value === 'string'
  ) {
    wireEffort = toOpenAIResponsesWireEffort(
      resolved.enabled.value,
      request.model,
    );
  }
  if (wireEffort !== undefined) {
    request.reasoning = { effort: wireEffort };
    return true;
  }

  // Enabled-only configuration selects reasoning output without fabricating
  // an effort, matching the prior executor's encrypted-content include
  // (issue #3255).
  return behavior.reasoning.enabled === true;
}

function applyReasoningSummary(
  request: OpenAIResponsesRequest,
  summary: string | undefined,
): void {
  if (summary === undefined || summary === 'none') {
    return;
  }
  request.reasoning = { ...request.reasoning, summary };
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
