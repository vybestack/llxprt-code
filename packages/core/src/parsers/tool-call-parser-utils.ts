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
  // eslint-disable-next-line sonarjs/regular-expr -- Static scalar-number regex preserves existing attribute parsing behavior.
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  const lower = value.toLowerCase();
  if (lower === 'true' || lower === 'false') {
    return lower === 'true';
  }
  return value;
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
