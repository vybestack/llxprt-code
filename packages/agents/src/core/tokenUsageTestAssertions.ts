/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Narrowing assertions for token-usage log records, for use in tests.
 *
 * A discriminated union needs narrowing before its variant fields can be read,
 * and doing that with `if (parsed?.record_type === 'x') { expect(...) }` puts
 * every assertion inside a conditional. A conditional assertion silently passes
 * when the condition is false, so a test can go green having checked nothing —
 * which is why `jest/no-conditional-expect` forbids it.
 *
 * These helpers throw on the wrong shape, so narrowing happens once and every
 * assertion after it is unconditional and actually runs. Each variant has its own
 * function because the discriminant check is what performs the narrowing, so a
 * shared generic would need a type assertion to stand in for it.
 */

import {
  parseTokenUsageLogRecord,
  type SerializedTokenUsageLogRecord,
} from './tokenUsageRecords.js';

function parseOrThrow(value: unknown): SerializedTokenUsageLogRecord {
  const parsed = parseTokenUsageLogRecord(value);
  if (parsed === null) {
    throw new Error(
      `Expected a parseable token-usage record, got ${JSON.stringify(value)}`,
    );
  }
  return parsed;
}

function wrongType(
  expected: string,
  actual: SerializedTokenUsageLogRecord,
): Error {
  return new Error(
    `Expected a ${expected} record, got record_type=${actual.record_type}`,
  );
}

/** Assert the record is a turn record and return it narrowed. */
export function expectTurnRecord(value: unknown) {
  const parsed = parseOrThrow(value);
  if (parsed.record_type !== 'turn') throw wrongType('turn', parsed);
  return parsed;
}

/** Assert the record is a compression lifecycle record and return it narrowed. */
export function expectCompressionRecord(value: unknown) {
  const parsed = parseOrThrow(value);
  if (parsed.record_type !== 'compression')
    throw wrongType('compression', parsed);
  return parsed;
}

/** Assert the record is a provider-switch record and return it narrowed. */
export function expectProviderSwitchRecord(value: unknown) {
  const parsed = parseOrThrow(value);
  if (parsed.record_type !== 'provider_switch')
    throw wrongType('provider_switch', parsed);
  return parsed;
}

/** Assert the record is a model-switch record and return it narrowed. */
export function expectModelSwitchRecord(value: unknown) {
  const parsed = parseOrThrow(value);
  if (parsed.record_type !== 'model_switch')
    throw wrongType('model_switch', parsed);
  return parsed;
}

/** Assert the record is a session-resume record and return it narrowed. */
export function expectSessionResumeRecord(value: unknown) {
  const parsed = parseOrThrow(value);
  if (parsed.record_type !== 'session_resume')
    throw wrongType('session_resume', parsed);
  return parsed;
}

/** Assert the record is a context-truncation record and return it narrowed. */
export function expectContextTruncationRecord(value: unknown) {
  const parsed = parseOrThrow(value);
  if (parsed.record_type !== 'context_truncation')
    throw wrongType('context_truncation', parsed);
  return parsed;
}
