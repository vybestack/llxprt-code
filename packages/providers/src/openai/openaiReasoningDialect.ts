/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OpenAI-compatible reasoning collision detection retained for issue #2896.
 * Request translation itself lives in the shared reasoning resolver and the
 * OpenAI Chat reasoning module (issue #3255); this file only decides whether
 * a body already carries an explicit reasoning representation.
 */

/**
 * Top-level wire fields that express reasoning intent on an OpenAI-compatible
 * Chat Completions body. Automatic translation also treats the nested
 * `chat_template_kwargs.reasoning_effort`, `enable_thinking`, and
 * `output_config.effort` fields as explicit representations.
 */
export const REASONING_WIRE_KEYS: readonly string[] = [
  'reasoning',
  'thinking',
  'reasoning_effort',
  'parse_reasoning',
];

/** True when the body already carries an explicit reasoning representation. */
export function hasExplicitReasoningField(
  body: Readonly<Record<string, unknown>>,
): boolean {
  if (REASONING_WIRE_KEYS.some((key) => hasOwnProperty(body, key))) {
    return true;
  }

  const templateKwargs = body['chat_template_kwargs'];
  if (
    isRecord(templateKwargs) &&
    (hasOwnProperty(templateKwargs, 'reasoning_effort') ||
      hasOwnProperty(templateKwargs, 'enable_thinking'))
  ) {
    return true;
  }

  // An own `output_config.effort` is an explicit native reasoning effort
  // (issue #3255). Unrelated output_config siblings alone are not: the own
  // property check, not the shape of output_config, decides.
  const outputConfig = body['output_config'];
  return (
    isRecord(outputConfig) &&
    Object.prototype.hasOwnProperty.call(outputConfig, 'effort')
  );
}

function hasOwnProperty(
  value: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
