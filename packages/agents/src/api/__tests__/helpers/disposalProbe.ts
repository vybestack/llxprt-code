/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P13
 * @requirement:REQ-016
 *
 * Structural readers for the error `Agent.dispose()` rejects with when a
 * teardown step fails. They check the shape (`name`, `errors`, `message`)
 * without importing the aggregate class, and read no state of any production
 * object.
 */

interface RecordLike {
  readonly [key: string]: unknown;
}

function asRecord(v: unknown): RecordLike | null {
  return typeof v === 'object' && v !== null ? (v as RecordLike) : null;
}

/**
 * Cast-free structural predicate: is `e` an AggregateDisposeError? True iff `e`
 * is an Error whose `name === 'AggregateDisposeError'` and which carries an
 * iterable `errors` array.
 */
export function isAggregateDisposeError(e: unknown): boolean {
  if (!(e instanceof Error)) {
    return false;
  }
  if (e.name !== 'AggregateDisposeError') {
    return false;
  }
  return Array.isArray(aggregateErrors(e));
}

/**
 * Cast-free accessor for the aggregate's `errors` array. Returns an empty
 * readonly array when the shape does not match (never throws).
 */
export function aggregateErrors(e: unknown): readonly unknown[] {
  const rec = asRecord(e);
  if (rec === null) {
    return [];
  }
  const errs = rec['errors'];
  return Array.isArray(errs) ? errs : [];
}

/**
 * Cast-free accessor for the aggregate error's human-readable `message`.
 * Returns the Error.message when `e` is an Error, else the empty string.
 * Lets specs assert the aggregate's summary text (count + joined detail)
 * without importing the AggregateDisposeError class.
 */
export function aggregateMessage(e: unknown): string {
  return e instanceof Error ? e.message : '';
}
