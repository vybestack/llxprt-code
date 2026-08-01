/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Strict numeric-string recognizer.
 *
 * Accepts only strings that a human would write as a plain decimal or
 * scientific number — the same set the CLI `/set modelparam` and the
 * ModelConfigDialog expect for `type: 'number'` fields.
 *
 * Accepted shapes (at least one mantissa digit required):
 *   `.95`  `-.5`  `0.95`  `-0.95`  `12`  `-7`  `0`
 *   `1e-5`  `1.5e3`  `-2E+4`
 *
 * Rejected (non-exhaustive):
 *   `''`  `' '`  `.`  `-`  `-.`  `1.`  `1.2.3`  `abc`
 *   `1abc`  `0x10`  `Infinity`  `NaN`  `1_000`  `' 1'`
 *   `+1.5` — an explicit leading `+` is rejected on purpose, preserving the
 *   strictness of the scanner this replaced; `-` is the only accepted sign.
 *
 * This is deliberately stricter than `Number()` / `parseFloat()` to avoid
 * silently accepting hex literals, whitespace, underscores, or the special
 * float words `Infinity`/`NaN`.
 *
 * Syntactic validity does not imply a usable value: `1e400` is accepted here
 * but overflows to `Infinity`, so callers that need a usable number must also
 * check `Number.isFinite`.
 */
export function isStrictNumericString(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  let i = 0;

  // Optional leading minus sign.
  if (value[i] === '-') {
    i++;
  }

  // Integer part (digits before the decimal point).
  const integerStart = i;
  i = scanDigits(value, i);
  const hasIntegerDigits = i > integerStart;

  // Fractional part (digits after the decimal point).
  let hasFractionDigits = false;
  let hasDot = false;
  if (i < value.length && value[i] === '.') {
    hasDot = true;
    i++;
    const fractionStart = i;
    i = scanDigits(value, i);
    hasFractionDigits = i > fractionStart;
  }

  // Must have at least one mantissa digit (integer or fraction).
  // A dot without any digits on either side (e.g. '.') is not a number.
  if (!hasIntegerDigits && !hasFractionDigits) {
    return false;
  }

  // A trailing dot (e.g. '1.') is ambiguous and must not be accepted.
  if (hasDot && !hasFractionDigits) {
    return false;
  }

  // Optional exponent: e/E, optional sign, then required digits.
  if (i < value.length && (value[i] === 'e' || value[i] === 'E')) {
    i++;
    if (i < value.length && (value[i] === '+' || value[i] === '-')) {
      i++;
    }
    const exponentStart = i;
    i = scanDigits(value, i);
    if (i === exponentStart) {
      return false;
    }
  }

  // Everything must be consumed — no trailing garbage.
  return i === value.length;
}

function scanDigits(value: string, start: number): number {
  let i = start;
  while (i < value.length && value[i] >= '0' && value[i] <= '9') {
    i++;
  }
  return i;
}
