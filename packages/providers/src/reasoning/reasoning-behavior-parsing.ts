/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ReasoningEffort,
  ReasoningEffortMap,
  ReasoningEffortWireFormat,
  ReasoningEnabledMap,
  ReasoningEnabledWireFormat,
} from '@vybestack/llxprt-code-settings';

/**
 * Provider-independent readers for generic reasoning model-behavior values
 * (issue #3255). Every adapter parses the invocation snapshot through this
 * module so validation cannot drift between providers; provider-specific
 * parsing (summary, include, native thinking) stays in provider files.
 */

/** Single source of generic effort literals for validation and map keys. */
export const REASONING_EFFORTS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly ReasoningEffort[];

const EFFORT_WIRE_FORMATS = [
  'auto',
  'openai',
  'openai-responses',
  'anthropic',
  'anthropic-budget',
  'openrouter',
  'gemini',
  'template-kwargs',
  'none',
] as const satisfies readonly ReasoningEffortWireFormat[];

const ENABLED_WIRE_FORMATS = [
  'auto',
  'openai',
  'openai-responses',
  'openrouter',
  'thinking',
  'gemini',
  'template-kwargs',
  'none',
] as const satisfies readonly ReasoningEnabledWireFormat[];

/** Numeric effort-map values are explicit budgets with a hard floor. */
const MIN_MAPPED_BUDGET_TOKENS = 1024;

/**
 * Read the invocation model-behavior record. A missing record reads as
 * empty; anything but a plain JSON object fails fast.
 */
export function readModelBehaviorRecord(
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (value === undefined) {
    return {};
  }
  if (isPlainRecord(value)) {
    return value;
  }
  throw new Error('invocation model behavior must be a JSON object');
}

/** Model behavior wins over a provided fallback; undefined falls through. */
export function selectBehaviorValue(
  modelBehavior: Readonly<Record<string, unknown>>,
  key: string,
  fallback: unknown,
): unknown {
  const value = modelBehavior[key];
  return value === undefined ? fallback : value;
}

export function readOptionalBoolean(
  value: unknown,
  setting: string,
): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') {
    return value;
  }
  throw new Error(`${setting} must be a boolean`);
}

export function readOptionalEffort(
  value: unknown,
): ReasoningEffort | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string' && isReasoningEffort(value)) {
    return value;
  }
  throw new Error(
    `reasoning.effort must be one of ${quotedList(REASONING_EFFORTS)}`,
  );
}

export function readOptionalPositiveInteger(
  value: unknown,
  setting: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  throw new Error(`${setting} must be a positive integer`);
}

export function readEffortWireFormat(
  value: unknown,
): ReasoningEffortWireFormat {
  if (value === undefined) {
    return 'auto';
  }
  if (typeof value === 'string' && isEffortWireFormat(value)) {
    return value;
  }
  throw new Error(
    `reasoning.effortWireFormat must be one of ${quotedList(EFFORT_WIRE_FORMATS)}`,
  );
}

export function readEnabledWireFormat(
  value: unknown,
): ReasoningEnabledWireFormat {
  if (value === undefined) {
    return 'auto';
  }
  if (typeof value === 'string' && isEnabledWireFormat(value)) {
    return value;
  }
  throw new Error(
    `reasoning.enabledWireFormat must be one of ${quotedList(ENABLED_WIRE_FORMATS)}`,
  );
}

/**
 * Parse `reasoning.effortMap`. The value must be a plain record (arrays and
 * class/Map instances are rejected), every key must be a generic effort, and
 * mapped strings normalize to their trimmed value.
 */
export function readEffortMap(value: unknown): ReasoningEffortMap | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isPlainRecord(value)) {
    throw new Error('reasoning.effortMap must be a JSON object');
  }

  const result: {
    -readonly [Effort in ReasoningEffort]?: string | number | null;
  } = {};
  for (const [key, rawMappedValue] of Object.entries(value)) {
    if (!isReasoningEffort(key)) {
      throw new Error(`reasoning.effortMap contains unsupported key '${key}'`);
    }
    result[key] = readEffortMapValue(rawMappedValue);
  }
  return result;
}

/**
 * Parse `reasoning.enabledMap` under the same plain-record contract as
 * {@link readEffortMap}.
 */
export function readEnabledMap(
  value: unknown,
): ReasoningEnabledMap | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isPlainRecord(value)) {
    throw new Error('reasoning.enabledMap must be a JSON object');
  }

  const result: {
    -readonly [Key in 'true' | 'false']?: string | boolean | null;
  } = {};
  for (const [key, rawMappedValue] of Object.entries(value)) {
    if (key !== 'true' && key !== 'false') {
      throw new Error(`reasoning.enabledMap contains unsupported key '${key}'`);
    }
    result[key] = readEnabledMapValue(rawMappedValue);
  }
  return result;
}

export function isReasoningEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value);
}

function isEffortWireFormat(value: string): value is ReasoningEffortWireFormat {
  return (EFFORT_WIRE_FORMATS as readonly string[]).includes(value);
}

function isEnabledWireFormat(
  value: string,
): value is ReasoningEnabledWireFormat {
  return (ENABLED_WIRE_FORMATS as readonly string[]).includes(value);
}

function readEffortMapValue(value: unknown): string | number | null {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed !== '') {
      return trimmed;
    }
  } else if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_MAPPED_BUDGET_TOKENS
  ) {
    return value;
  }
  throw new Error(
    `reasoning.effortMap values must be non-empty strings, integer budgets of at least ${MIN_MAPPED_BUDGET_TOKENS}, or null`,
  );
}

function readEnabledMapValue(value: unknown): string | boolean | null {
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed !== '') {
      return trimmed;
    }
  }
  throw new Error(
    'reasoning.enabledMap values must be non-empty strings, booleans, or null',
  );
}

/**
 * Plain records only: arrays and class/Map instances (whose entries do not
 * serialize as JSON keys) fail fast instead of being silently accepted.
 * Internal to the providers package; adapters parsing provider-local
 * records reuse it so the plain-record contract cannot drift.
 */
export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function quotedList(values: readonly string[]): string {
  const quoted = values.map((value) => `'${value}'`);
  return quoted.length <= 1
    ? quoted.join('')
    : `${quoted.slice(0, -1).join(', ')}, or ${quoted[quoted.length - 1]}`;
}
