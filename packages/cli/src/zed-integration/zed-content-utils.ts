/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ContractContent,
  ContractPart,
  ContractPartListUnion,
} from '@vybestack/llxprt-code-core';

/**
 * Structural input for {@link extractToolResultText}: the LLM-content and
 * display fields of a tool execution result. Both the core `ToolResult` and
 * the public `AgentToolExecResult` (from `@vybestack/llxprt-code-agents`)
 * satisfy it, so Zed code can pass either without casts.
 */
export interface ToolResultTextInput {
  readonly llmContent?: unknown;
  readonly returnDisplay?: unknown;
}

/**
 * Extracts visible text from legacy ContractPart[] — filters thought parts and joins
 * text segments. Local replacement for the retired core helper
 * getResponseTextFromParts (which migrated to ContentBlock[]).
 */
function isHiddenThoughtPart(part: ContractPart): boolean {
  return 'thought' in part && part.thought === true;
}

function getResponseTextFromPartsLocal(
  parts: ContractPart[],
): string | undefined {
  const textSegments = parts
    .filter((part) => !isHiddenThoughtPart(part))
    .map((part) => part.text)
    .filter((text): text is string => typeof text === 'string');
  if (textSegments.length === 0) {
    return undefined;
  }
  return textSegments.join('');
}

export function extractToolResultText(
  toolResult: ToolResultTextInput,
): string | null {
  // llmContent is a ContractPartListUnion at runtime for every producer (core tools
  // and the public agent handle projection); the structural input widens it
  // to unknown so both result types are accepted.
  const textFromLlmContent = extractTextFromPartList(
    toolResult.llmContent as ContractPartListUnion | undefined,
  );
  if (textFromLlmContent !== null) {
    return textFromLlmContent;
  }

  if (typeof toolResult.returnDisplay === 'string') {
    const trimmed = toolResult.returnDisplay.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return null;
}

export function extractTextFromPartList(
  llmContent: ContractPartListUnion | undefined,
): string | null {
  if (llmContent === undefined) {
    return null;
  }

  if (typeof llmContent === 'string') {
    const trimmed = llmContent.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  const parts = normalizeToParts(llmContent);
  const text = getResponseTextFromPartsLocal(parts);
  if (text !== undefined) {
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  for (const part of parts) {
    const response = part.functionResponse?.response;
    const extracted = extractOutputString(response);
    if (extracted !== null) {
      return extracted;
    }
  }

  return null;
}

export function normalizeToParts(input: ContractPartListUnion): ContractPart[] {
  if (typeof input === 'string') {
    return [{ text: input }];
  }

  if (Array.isArray(input)) {
    return input.flatMap((item) =>
      normalizeToParts(item as ContractPartListUnion),
    );
  }

  if (isContent(input)) {
    return input.parts ?? [];
  }

  return [input];
}

export function extractOutputString(response: unknown): string | null {
  if (response === undefined || response === null) {
    return null;
  }

  if (typeof response === 'string') {
    const trimmed = response.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof response !== 'object') {
    return null;
  }

  const responseRecord = response as Record<string, unknown>;

  const output = responseRecord.output;
  if (typeof output === 'string') {
    const trimmed = output.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  if (responseRecord.content !== undefined) {
    const contentParts = normalizeToParts(
      responseRecord.content as ContractPartListUnion,
    );
    const text = getResponseTextFromPartsLocal(contentParts);
    if (text !== undefined) {
      const trimmed = text.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return null;
}

function isContent(value: unknown): value is ContractContent {
  if (value === undefined || value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ContractContent>;
  return Array.isArray(candidate.parts);
}
