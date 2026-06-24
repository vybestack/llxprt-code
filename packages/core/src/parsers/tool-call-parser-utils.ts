/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export function isTruthyLikeValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (value === false || value === 0 || value === '') {
    return false;
  }
  if (typeof value === 'number' && Number.isNaN(value)) {
    return false;
  }
  return true;
}

export function toTruthyString(value: unknown): string {
  if (isTruthyLikeValue(value)) {
    return String(value);
  }
  return '';
}

export function truthyJsonValueOrEmptyObject(value: unknown): unknown {
  return isTruthyLikeValue(value) ? value : {};
}

export function parseScalarValue(value: string): string | number | boolean {
  if (looksNumeric(value)) {
    return Number(value);
  }
  const lower = value.toLowerCase();
  if (lower === 'true' || lower === 'false') {
    return lower === 'true';
  }
  return value;
}

function looksNumeric(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  let start = 0;
  if (value[0] === '-') {
    if (value.length === 1) {
      return false;
    }
    start = 1;
  }

  const integerEnd = readDigits(value, start);
  if (integerEnd === start) {
    return false;
  }

  if (integerEnd === value.length) {
    return true;
  }

  if (value[integerEnd] !== '.') {
    return false;
  }

  const fractionStart = integerEnd + 1;
  const fractionEnd = readDigits(value, fractionStart);
  return fractionEnd > fractionStart && fractionEnd === value.length;
}

function readDigits(value: string, start: number): number {
  let index = start;
  while (index < value.length && isDigitCode(value.charCodeAt(index))) {
    index++;
  }
  return index;
}

function isDigitCode(code: number): boolean {
  return code >= 48 && code <= 57;
}

export function readQuotedAttributeValue(
  text: string,
  startIndex: number,
  quote: string,
): { value: string; nextIndex: number } {
  let value = '';
  let escaped = false;
  let index = startIndex;

  while (index < text.length) {
    const char = text.charAt(index);
    index++;
    if (escaped) {
      value += char;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === quote) {
      return { value: value.trim(), nextIndex: index };
    } else {
      value += char;
    }
  }

  return { value: value.trim(), nextIndex: index };
}

export function parseAttributeValue(value: string): unknown {
  if (value.startsWith('{') || value.startsWith('[')) {
    try {
      return JSON.parse(value);
    } catch {
      // fall through to scalar handling
    }
  }
  return parseScalarValue(value);
}
