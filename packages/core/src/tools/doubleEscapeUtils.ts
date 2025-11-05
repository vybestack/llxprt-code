/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Utility functions for detecting and handling double-escaped tool calls
 * Used by providers that need to work with models that double-escape JSON parameters
 * (e.g., Qwen models, GLM-4.5 models)
 */

import { DebugLogger } from '../debug/index.js';

const logger = new DebugLogger('llxprt:tools:doubleEscape');

/**
 * Detects if a tool format should use double-escape handling
 * @param toolFormat - The tool format to check
 * @returns true if the format typically needs double-escape handling
 */
export function shouldUseDoubleEscapeHandling(toolFormat: string): boolean {
  // Qwen format needs double-escape handling (includes GLM-4.5 which uses qwen format)
  return toolFormat === 'qwen';
}

/**
 * Checks if a JSON string appears to be double-stringified
 * @param jsonString - The JSON string to check
 * @returns Object with detection results and corrected value if applicable
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

      // Arguments were stringified, let's check if they're double-stringified
      try {
        const doubleParsed = JSON.parse(parsed);
        result.isDoubleEscaped = true;
        result.correctedValue = doubleParsed;
        result.detectionDetails.secondParse = doubleParsed;

        logger.error(() => `Detected double-stringified JSON parameters`, {
          firstParse: parsed,
          secondParse: doubleParsed,
          originalLength: jsonString.length,
        });
      } catch (_secondParseError) {
        // Not double-stringified, just single stringified
        logger.debug(() => `JSON parameters are single-stringified (normal)`);
        result.correctedValue = parsed;
      }
    } else if (typeof parsed === 'object' && parsed !== null) {
      // Check if it's an object with stringified values (common pattern)
      const hasStringifiedValues = Object.values(parsed).some((value) => {
        if (typeof value === 'string') {
          try {
            const testParse = JSON.parse(value);
            // If we can parse it and it's an array or object, it's likely stringified
            return typeof testParse === 'object';
          } catch {
            return false;
          }
        }
        return false;
      });

      if (hasStringifiedValues) {
        // Fix stringified values
        const fixed = { ...parsed };
        for (const [key, value] of Object.entries(fixed)) {
          if (typeof value === 'string') {
            try {
              const testParse = JSON.parse(value);
              if (typeof testParse === 'object') {
                fixed[key] = testParse;
                result.isDoubleEscaped = true;
              }
            } catch {
              // Keep original value if can't parse
            }
          }
        }
        result.correctedValue = fixed;
        if (result.isDoubleEscaped) {
          logger.error(() => `Fixed stringified parameter values`, {
            original: parsed,
            fixed,
          });
        }
      } else {
        result.correctedValue = parsed;
      }
    } else {
      // Already parsed correctly
      result.correctedValue = parsed;
    }
  } catch (parseError) {
    result.detectionDetails.error = String(parseError);
    logger.error(() => `Failed to parse JSON parameters:`, parseError);
  }

  return result;
}

/**
 * Detects double-escaping in streaming tool call chunks
 * @param chunk - The streaming chunk to analyze
 * @returns true if double-escaping patterns are detected
 */
export function detectDoubleEscapingInChunk(chunk: string): boolean {
  // Check for common double-escaping patterns in streaming chunks
  // Using String.raw to avoid eslint no-useless-escape issues
  const backslashBracket = String.raw`\\[`;
  const doubleBackslash = String.raw`\\\\`;
  const backslashQuote = String.raw`\\"`;
  const startPattern = String.raw`"\\`;
  const endPattern = String.raw`\\"`;

  return (
    chunk.includes(backslashBracket) ||
    chunk.includes(doubleBackslash) ||
    chunk.includes(backslashQuote) ||
    (chunk.startsWith(startPattern) && chunk.endsWith(endPattern))
  );
}

/**
 * Processes tool call parameters, fixing double-escaping if detected
 * @param parametersString - The JSON string containing tool parameters
 * @param toolName - Name of the tool (for logging)
 * @param format - The tool format being used (for context)
 * @returns Processed parameters object
 */
export function processToolParameters(
  parametersString: string,
  toolName: string,
  format: string,
): unknown {
  if (!parametersString.trim()) {
    return {};
  }

  // Only apply double-escape handling for formats that need it
  if (!shouldUseDoubleEscapeHandling(format)) {
    // For formats that don't need double-escape handling, parse the JSON string
    try {
      return JSON.parse(parametersString);
    } catch (e) {
      logger.debug(() => `Failed to parse tool parameters as JSON: ${e}`);
      return parametersString; // Return as-is if not valid JSON
    }
  }

  // Apply double-escape detection and fixing for qwen format
  const detection = detectDoubleEscaping(parametersString);

  if (detection.isDoubleEscaped) {
    logger.error(
      () => `[${format}] Fixed double-escaped parameters for ${toolName}`,
      {
        tool: toolName,
        format,
        originalLength: parametersString.length,
        fixed: true,
      },
    );
    // Convert string numbers to actual numbers for qwen format
    return convertStringNumbersToNumbers(detection.correctedValue);
  } else if (detection.detectionDetails.error) {
    logger.error(
      () => `[${format}] Failed to parse parameters for ${toolName}`,
      {
        tool: toolName,
        format,
        error: detection.detectionDetails.error,
      },
    );
    // Return the string as-is if parsing fails
    return parametersString;
  }

  // Convert string numbers to actual numbers for qwen format
  const normalized = detection.correctedValue;
  if (typeof normalized === 'string') {
    const trimmed = normalized.trim();
    if (trimmed.length === 0) {
      return {};
    }
  }

  return convertStringNumbersToNumbers(normalized);
}

/**
 * Converts string numbers to actual numbers in an object
 * This is needed for qwen models that stringify numeric parameters
 * @param obj - The object to fix
 * @returns The object with numeric strings converted to numbers
 */
function convertStringNumbersToNumbers(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    // Check if it's a numeric string
    if (/^-?\d+$/.test(obj)) {
      // Integer
      const num = parseInt(obj, 10);
      if (!isNaN(num)) return num;
    } else if (/^-?\d*\.?\d+$/.test(obj)) {
      // Float
      const num = parseFloat(obj);
      if (!isNaN(num)) return num;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(convertStringNumbersToNumbers);
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = convertStringNumbersToNumbers(value);
    }
    return result;
  }

  return obj;
}

/**
 * Logs double-escaping detection in streaming chunks (for debugging)
 * @param chunk - The chunk that contains potential double-escaping
 * @param toolName - Name of the tool
 * @param format - The tool format
 */
export function logDoubleEscapingInChunk(
  chunk: string,
  toolName: string,
  format: string,
): void {
  // Only log for formats that use double-escape handling
  if (
    shouldUseDoubleEscapeHandling(format) &&
    detectDoubleEscapingInChunk(chunk)
  ) {
    logger.error(
      () =>
        `[${format}] Detected potential double-escaping in streaming chunk for ${toolName}`,
      {
        chunk,
        tool: toolName,
        format,
        pattern: 'Contains escaped quotes that suggest double-stringification',
      },
    );
  }
}
