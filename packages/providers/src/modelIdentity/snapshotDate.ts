/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Vendor-neutral validation for dated model snapshots.
 *
 * Model IDs advertise snapshots as calendar dates. Accepting any digit run
 * would let a malformed lookalike such as `-20261345` resolve to a real model
 * family, so the digits are validated as an actual calendar date instead.
 */

const DAYS_IN_MONTH: readonly number[] = Object.freeze([
  31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
]);

const COMPACT_DATE = /^(\d{4})(\d{2})(\d{2})$/;
const HYPHENATED_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function isValidCalendarDate(
  year: number,
  month: number,
  day: number,
): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const maxDay =
    month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return day <= maxDay;
}

function matchesCalendarDate(match: RegExpExecArray | null): boolean {
  if (match === null) return false;
  return isValidCalendarDate(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  );
}

/** Whether `value` is a compact `YYYYMMDD` snapshot for a real date. */
export function isCompactDateSnapshot(value: string): boolean {
  return matchesCalendarDate(COMPACT_DATE.exec(value));
}

/** Whether `value` is a hyphenated `YYYY-MM-DD` snapshot for a real date. */
export function isHyphenatedDateSnapshot(value: string): boolean {
  return matchesCalendarDate(HYPHENATED_DATE.exec(value));
}
