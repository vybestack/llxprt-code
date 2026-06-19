/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const RESERVED_NAMES = ['.', '..', 'con', 'prn', 'aux', 'nul'];
const MAX_LENGTH = 255;

/**
 * Make names filesystem-safe.
 */
export function sanitizePathComponent(component: string): string {
  if (!component || component.length === 0) {
    return '';
  }

  // Check for reserved names first (before any transformation)
  if (RESERVED_NAMES.includes(component)) {
    return `reserved-${component}`;
  }

  // Apply sanitization rules:
  // a. Convert to lowercase
  let result = component.toLowerCase();

  // b. Replace sequences of chars that are not alphanumeric, dot, or hyphen with a single hyphen.
  result = replaceUnsafeChars(result);

  // c. Remove leading and trailing hyphens
  result = trimHyphens(result);

  // d. IF result is empty after sanitization
  if (result.length === 0) {
    return 'unknown';
  }

  // Check length limits
  if (result.length > MAX_LENGTH) {
    result = result.substring(0, MAX_LENGTH);
  }

  // Check reserved names again after transformation
  if (RESERVED_NAMES.includes(result)) {
    return `reserved-${result}`;
  }

  return result;
}

/** Replace sequences of chars that are not alphanumeric, dot, or hyphen with a single hyphen. */
function replaceUnsafeChars(input: string): string {
  let result = '';
  let inUnsafeRun = false;
  for (const char of input) {
    if (isAllowedChar(char)) {
      result += char;
      inUnsafeRun = false;
    } else if (!inUnsafeRun) {
      result += '-';
      inUnsafeRun = true;
    }
  }
  return result;
}

function isAllowedChar(char: string): boolean {
  return /^[a-z0-9.-]$/.test(char);
}

/** Remove leading and trailing hyphens. */
function trimHyphens(input: string): string {
  let start = 0;
  let end = input.length;
  while (start < end && input[start] === '-') {
    start++;
  }
  while (end > start && input[end - 1] === '-') {
    end--;
  }
  return input.slice(start, end);
}

/**
 * Convert tool names to kebab-case.
 */
export function convertToKebabCase(toolName: string): string {
  if (!toolName || toolName.length === 0) {
    return '';
  }

  // Handle special case: all uppercase
  if (toolName === toolName.toUpperCase() && isAllUppercase(toolName)) {
    return toolName.toLowerCase();
  }

  // Replace underscores and dots with hyphens
  const processedName = replaceSeparators(toolName);

  // Convert case with digit/uppercase handling
  const result = convertCase(processedName);

  // Clean up: collapse multiple hyphens and trim
  return trimHyphens(result.replace(/-+/g, '-'));
}

function isAllUppercase(name: string): boolean {
  return /^[A-Z]+$/.test(name);
}

function replaceSeparators(name: string): string {
  return name.replace(/[_.]/g, '-');
}

function isUpper(char: string): boolean {
  return /^[A-Z]$/.test(char);
}

function isLower(char: string): boolean {
  return /^[a-z]$/.test(char);
}

function isDigit(char: string): boolean {
  return /^[0-9]$/.test(char);
}

/** Convert case: insert hyphens before uppercase/digit boundaries. */
function convertCase(processedName: string): string {
  let result = '';
  let previousWasLowercase = false;
  let previousWasDigit = false;

  for (let i = 0; i < processedName.length; i++) {
    const char = processedName[i];
    const nextChar = i + 1 < processedName.length ? processedName[i + 1] : '';

    if (char === '-') {
      result += char;
      previousWasLowercase = false;
      previousWasDigit = false;
    } else if (isUpper(char)) {
      const conversion = convertUpperCaseChar(
        char,
        nextChar,
        previousWasLowercase,
        previousWasDigit,
        result,
      );
      result = conversion.result;
      previousWasLowercase = false;
      previousWasDigit = false;
    } else if (isLower(char)) {
      result += char;
      previousWasLowercase = true;
      previousWasDigit = false;
    } else if (isDigit(char)) {
      const conversion = convertDigitChar(char, previousWasDigit, result);
      result = conversion.result;
      previousWasLowercase = false;
      previousWasDigit = true;
    }
  }

  return result;
}

interface ConversionResult {
  result: string;
}

function convertUpperCaseChar(
  char: string,
  nextChar: string,
  previousWasLowercase: boolean,
  previousWasDigit: boolean,
  result: string,
): ConversionResult {
  const nextIsLower = nextChar !== '' && isLower(nextChar);
  if (
    shouldAddHyphenBeforeUpper(
      previousWasLowercase,
      previousWasDigit,
      result,
      nextIsLower,
    )
  ) {
    result += '-';
  }
  result += char.toLowerCase();
  return { result };
}

function shouldAddHyphenBeforeUpper(
  previousWasLowercase: boolean,
  previousWasDigit: boolean,
  result: string,
  nextIsLower: boolean,
): boolean {
  if (previousWasLowercase) {
    return true;
  }
  if (previousWasDigit && result.length > 0) {
    return true;
  }
  return result.length > 0 && nextIsLower && !result.endsWith('-');
}

function convertDigitChar(
  char: string,
  previousWasDigit: boolean,
  result: string,
): ConversionResult {
  if (result.length > 0 && !result.endsWith('-') && !previousWasDigit) {
    result += '-';
  }
  result += char;
  return { result };
}
