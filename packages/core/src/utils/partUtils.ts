/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Structural shape for legacy Google Part input — operates on `unknown` with
 * structural checks so NO @google/genai import is needed in this file.
 */
interface LegacyPartLike {
  text?: string;
  thought?: unknown;
  functionCall?: { name?: string } | undefined;
  functionResponse?: { name?: string } | undefined;
  inlineData?: { mimeType?: string } | undefined;
  fileData?: unknown;
  videoMetadata?: unknown;
  codeExecutionResult?: unknown;
  executableCode?: unknown;
}

function isEmptyPartValue(value: unknown): boolean {
  if (value === undefined || value === null || value === false || value === 0) {
    return true;
  }
  return typeof value === 'number' && Number.isNaN(value);
}

function isNonNullObject(value: unknown): value is LegacyPartLike {
  return typeof value === 'object' && value !== null;
}

/**
 * Converts a legacy PartListUnion-shaped value into a string.
 * If verbose is true, includes summary representations of non-text parts.
 */
export function partToString(
  value: unknown,
  options?: { verbose?: boolean },
): string {
  if (isEmptyPartValue(value)) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((part) => partToString(part, options)).join('');
  }

  if (!isNonNullObject(value)) {
    return '';
  }

  const part = value;

  if (options?.verbose === true) {
    if (part.videoMetadata !== undefined) {
      return `[Video Metadata]`;
    }
    if (part.thought !== undefined) {
      return `[Thought: ${part.thought}]`;
    }
    if (part.codeExecutionResult !== undefined) {
      return `[Code Execution Result]`;
    }
    if (part.executableCode !== undefined) {
      return `[Executable Code]`;
    }

    if (part.fileData !== undefined) {
      return `[File Data]`;
    }
    if (part.functionCall !== undefined) {
      return `[Function Call: ${part.functionCall.name}]`;
    }
    if (part.functionResponse !== undefined) {
      return `[Function Response: ${part.functionResponse.name}]`;
    }
    if (part.inlineData !== undefined) {
      return `<${part.inlineData.mimeType}>`;
    }
  }

  return part.text ?? '';
}

/**
 * Convert a legacy PartListUnion-shaped value to a verbose string representation.
 * This is the canonical replacement for the retired geminiRequest.partListUnionToString.
 */
export function partListUnionToString(value: unknown): string {
  return partToString(value, { verbose: true });
}
