/**
 * @plan:PLAN-20260608-ISSUE1585.P05
 * @requirement:REQ-API-001, REQ-TEMPORARY-INTERFACES
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Package-local double-escape detection and repair utilities.
 *
 * Handles tool call parameters that arrive double-stringified
 * (e.g., Qwen models, GLM-4.5). This is a self-contained copy
 * with core DebugLogger replaced by a no-op to maintain zero
 * core imports.
 */

const noop = {
  debug: (_msg: string) => {},
  error: (_msg: string) => {},
  warn: (_msg: string) => {},
};

/**
 * Detects if a tool format should use double-escape handling.
 * @param toolFormat - The tool format to check.
 * @returns true if the format typically needs double-escape handling.
 */
export function shouldUseDoubleEscapeHandling(toolFormat: string): boolean {
  return toolFormat === 'qwen';
}

/**
 * Fixes stringified values in a parsed object by parsing any string values
 * that contain valid JSON objects or arrays.
 */
function fixStringifiedValues(parsed: Record<string, unknown>): {
  fixed: Record<string, unknown>;
  wasDoubleEscaped: boolean;
} {
  const fixed = { ...parsed };
  let wasDoubleEscaped = false;
  for (const [key, value] of Object.entries(fixed)) {
    if (typeof value !== 'string') {
      continue;
    }
    try {
      const testParse = JSON.parse(value);
      if (typeof testParse === 'object') {
        fixed[key] = testParse;
        wasDoubleEscaped = true;
      }
    } catch {
      // Keep original value if can't parse
    }
  }
  return { fixed, wasDoubleEscaped };
}

/**
 * Checks whether a single value is a JSON string that encodes an object.
 */
function isStringifiedValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const testParse = JSON.parse(value);
    return typeof testParse === 'object';
  } catch {
    return false;
  }
}

/**
 * Checks if a JSON string appears to be double-stringified.
 * @param jsonString - The JSON string to check.
 * @returns Object with detection results and corrected value if applicable.
 */
export function detectDoubleEscaping(jsonString: string): {
  isDoubleEscaped: boolean;
  correctedValue?: unknown;
  originalValue: string;
  detectionDetails: {
    firstParse?: string;
    secondParse?: unknown;
    error?: string;
  };
} {
  const result: {
    isDoubleEscaped: boolean;
    correctedValue?: unknown;
    originalValue: string;
    detectionDetails: {
      firstParse?: string;
      secondParse?: unknown;
      error?: string;
    };
  } = {
    isDoubleEscaped: false,
    correctedValue: undefined,
    originalValue: jsonString,
    detectionDetails: {},
  };

  try {
    const parsed = JSON.parse(jsonString);

    if (typeof parsed === 'string') {
      result.detectionDetails.firstParse = parsed;

      try {
        const doubleParsed = JSON.parse(parsed);
        result.isDoubleEscaped = true;
        result.correctedValue = doubleParsed;
        result.detectionDetails.secondParse = doubleParsed;
      } catch {
        result.correctedValue = parsed;
      }
    } else if (typeof parsed === 'object' && parsed !== null) {
      const hasStringifiedValues =
        Object.values(parsed).some(isStringifiedValue);

      if (hasStringifiedValues) {
        const { fixed, wasDoubleEscaped } = fixStringifiedValues(parsed);
        result.isDoubleEscaped = wasDoubleEscaped;
        result.correctedValue = fixed;
      } else {
        result.correctedValue = parsed;
      }
    } else {
      result.correctedValue = parsed;
    }
  } catch (parseError) {
    result.detectionDetails.error = String(parseError);
  }

  return result;
}

/**
 * Detects double-escaping in streaming tool call chunks.
 * @param chunk - The streaming chunk to analyze.
 * @returns true if double-escaping patterns are detected.
 */
export function detectDoubleEscapingInChunk(chunk: string): boolean {
  const backslashBracket = String.raw`\\[`;
  const doubleBackslash = String.raw`\\\\`;
  const backslashQuote = String.raw`\\"`;
  const startPattern = String.raw`"\\`;
  const endPattern = String.raw`\\"`;

  const doubleEscapeMarkers = [
    backslashBracket,
    doubleBackslash,
    backslashQuote,
  ];
  const hasMarker = doubleEscapeMarkers.some((marker) =>
    chunk.includes(marker),
  );
  const hasWrappedPattern =
    chunk.startsWith(startPattern) && chunk.endsWith(endPattern);

  return hasMarker || hasWrappedPattern;
}

/**
 * Processes tool call parameters, fixing double-escaping if detected.
 * @param parametersString - The JSON string containing tool parameters.
 * @param toolName - Name of the tool (for context).
 * @param format - The tool format being used (optional).
 * @returns Processed parameters object.
 */
export function processToolParameters(
  parametersString: string,
  toolName: string,
  format?: string,
): unknown {
  if (!parametersString.trim()) {
    return {};
  }

  return tryMultipleParsingStrategies(parametersString, toolName, format);
}

/**
 * Try multiple parsing strategies to handle tool parameters.
 */
function tryMultipleParsingStrategies(
  parametersString: string,
  toolName: string,
  format?: string,
): unknown {
  // Strategy 1: Direct JSON parsing
  try {
    const parsed = JSON.parse(parametersString);
    if (typeof parsed === 'string' && parsed.trim() === '') {
      return {};
    }
    if (typeof parsed === 'string' && parsed.trim().startsWith('{')) {
      // Might be double-escaped, continue to strategy 2
    } else {
      return parsed;
    }
  } catch {
    // Continue to next strategy
  }

  // Strategy 2: Detect and repair double escaping
  const detection = detectDoubleEscaping(parametersString);
  const formatLabel = format ?? 'auto';
  if (detection.correctedValue !== undefined) {
    if (detection.isDoubleEscaped) {
      noop.error(
        `[${formatLabel}] Fixed double-escaped parameters for ${toolName}`,
      );
    }

    void formatLabel;
    const converted = convertStringNumbersToNumbers(detection.correctedValue);
    if (typeof converted === 'string' && converted.trim() === '') {
      return {};
    }
    return converted;
  }

  // Strategy 3: Return original string (last resort)
  if (detection.detectionDetails.error) {
    noop.error(`[${formatLabel}] Failed to parse parameters for ${toolName}`);
  }

  return parametersString;
}

/**
 * Converts string numbers to actual numbers in an object.
 * Needed for models that stringify numeric parameters.
 */
function convertStringNumbersToNumbers(obj: unknown): unknown {
  if (obj == null) return obj;

  if (typeof obj === 'string') {
    // Only convert strings matching decimal number syntax (not hex, octal,
    // whitespace-padded, etc.) to preserve the original regex semantics.
    if (isDecimalNumberString(obj)) {
      const num = Number(obj);
      if (Number.isFinite(num)) return num;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(convertStringNumbersToNumbers);
  }

  if (
    typeof obj === 'object' &&
    Object.getPrototypeOf(obj) === Object.prototype
  ) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = convertStringNumbersToNumbers(value);
    }
    return result;
  }

  return obj;
}

/**
 * Equivalent to /^-?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/ without using a regex.
 * Accepts: "123", "-45", "3.14", ".5", "-0.1", "1e5", "3.14E-10"
 * Rejects: "0xff", "  123  ", "Infinity", "NaN", "", "abc"
 */
function isDecimalNumberString(value: string): boolean {
  if (value.length === 0) return false;
  let s = value;
  if (s[0] === '-') s = s.slice(1);
  if (s.length === 0) return false;

  // Split mantissa and optional exponent at 'e' or 'E'
  let mantissa = s;
  let expPart = '';
  let hasExponent = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === 'e' || s[i] === 'E') {
      mantissa = s.slice(0, i);
      expPart = s.slice(i + 1);
      hasExponent = true;
      break;
    }
  }

  // Validate exponent: optional sign, then one or more digits
  if (hasExponent) {
    if (expPart[0] === '+' || expPart[0] === '-') expPart = expPart.slice(1);
    if (!allDigits(expPart)) return false;
  }

  // Validate mantissa: \d+ or \d*\.\d+
  const dotIdx = mantissa.indexOf('.');
  if (dotIdx !== -1) {
    const intPart = mantissa.slice(0, dotIdx);
    const fracPart = mantissa.slice(dotIdx + 1);
    if (mantissa.indexOf('.', dotIdx + 1) !== -1) return false;
    if (intPart.length > 0 && !allDigits(intPart)) return false;
    if (fracPart.length === 0 || !allDigits(fracPart)) return false;
  } else if (mantissa.length === 0 || !allDigits(mantissa)) {
    return false;
  }
  return true;
}

function allDigits(s: string): boolean {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] < '0' || s[i] > '9') return false;
  }
  return true;
}

/**
 * Logs double-escaping detection in streaming chunks (no-op in tools package).
 * @param chunk - The chunk that contains potential double-escaping.
 * @param toolName - Name of the tool.
 * @param format - The tool format.
 */
export function logDoubleEscapingInChunk(
  _chunk: string,
  _toolName: string,
  format: string,
): void {
  // No-op in tools package: core's DebugLogger is not available.
  // Detection logic still runs in detectDoubleEscapingInChunk above.
  void format;
}
