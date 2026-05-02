/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type PartListUnion,
  type Part,
  type GenerateContentResponse,
} from '@google/genai';

/**
 * Converts a PartListUnion into a string.
 * If verbose is true, includes summary representations of non-text parts.
 */
export function partToString(
  value: PartListUnion,
  options?: { verbose?: boolean },
): string {
  if (
    (value as unknown) === undefined ||
    (value as unknown) === null ||
    (value as unknown) === false ||
    (value as unknown) === 0 ||
    (typeof (value as unknown) === 'number' &&
      Number.isNaN(value as unknown as number))
  ) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((part) => partToString(part, options)).join('');
  }

  // Cast to Part, assuming it might contain project-specific fields
  const part = value as Part & {
    videoMetadata?: unknown;
    thought?: unknown;
    codeExecutionResult?: unknown;
    executableCode?: unknown;
  };

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

    // Standard Part fields
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
 * Safely extracts text from a GenerateContentResponse.
 * Unlike the .text getter on GenerateContentResponse, this function
 * handles cases where the response has no candidates or is safety-blocked
 * without throwing errors.
 *
 * @param response - The GenerateContentResponse to extract text from
 * @returns The concatenated text from the first candidate's parts, or null if unavailable
 */
export function getResponseText(
  response: GenerateContentResponse,
): string | null {
  if (response.candidates && response.candidates.length > 0) {
    const candidate = response.candidates[0];

    if (candidate.content?.parts && candidate.content.parts.length > 0) {
      return candidate.content.parts
        .filter((part) => part.text)
        .map((part) => part.text)
        .join('');
    }
  }
  return null;
}
