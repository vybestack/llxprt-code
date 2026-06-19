/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Part } from '@google/genai';

/**
 * Synthetic thought signature used when a functionCall part lacks one.
 * This bypasses Gemini 3.x validation without containing actual reasoning.
 *
 * @see https://ai.google.dev/gemini-api/docs/thought-signatures
 */
export const SYNTHETIC_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';

/**
 * Content structure matching Gemini API format.
 *
 * `parts` is modeled as optional because Gemini history payloads cross
 * provider/runtime boundaries and may omit it despite the declared type.
 */
interface Content {
  role: string;
  parts?: Part[];
}

/**
 * Part with optional thoughtSignature
 */
interface PartWithThoughtSignature extends Part {
  thoughtSignature?: string;
}

/**
 * Part with optional thought property (Gemini's thinking content)
 */
interface PartWithThought extends Part {
  thought?: boolean;
  text?: string;
}

function hasTextPart(parts: Part[] | undefined): boolean {
  if (!parts) {
    return false;
  }
  return parts.some(
    (part) =>
      'text' in part && typeof part.text === 'string' && part.text.length > 0,
  );
}

function findActiveLoopStart(requestContents: Content[]): number {
  for (let i = requestContents.length - 1; i >= 0; i--) {
    const content = requestContents[i];
    if (content.role === 'user' && hasTextPart(content.parts)) {
      return i;
    }
  }
  return -1;
}

function firstFunctionCallNeedsSignature(parts: Part[]): boolean {
  const firstFunctionCall = parts.find(
    (part) => 'functionCall' in part && Boolean(part.functionCall),
  );
  if (!firstFunctionCall) {
    return false;
  }
  const partWithSig = firstFunctionCall as PartWithThoughtSignature;
  return !isNonEmpty(partWithSig.thoughtSignature);
}

/**
 * Returns true when the value is a non-empty string (truthy under old || semantics).
 * Empty string, null, and undefined are treated as missing.
 */
function isNonEmpty(value: string | undefined): boolean {
  return typeof value === 'string' && value.length > 0;
}

function contentNeedsSignatureModification(
  requestContents: Content[],
  activeLoopStartIndex: number,
): boolean {
  for (let i = activeLoopStartIndex; i < requestContents.length; i++) {
    const content = requestContents[i];
    if (
      content.role === 'model' &&
      content.parts &&
      firstFunctionCallNeedsSignature(content.parts)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Ensures that all functionCall parts in the "active loop" have a thoughtSignature.
 *
 * The active loop is defined as all content from the last user message with text
 * (not a functionResponse) to the end of the history. Gemini 3.x requires that
 * the first functionCall part in each model turn within this active loop has
 * a thoughtSignature property.
 *
 * @param requestContents - The conversation history to process
 * @returns A new array with thoughtSignatures ensured (shallow copy if modified)
 */
export function ensureActiveLoopHasThoughtSignatures(
  requestContents: Content[],
): Content[] {
  const activeLoopStartIndex = findActiveLoopStart(requestContents);

  if (activeLoopStartIndex === -1) {
    return requestContents;
  }

  if (
    !contentNeedsSignatureModification(requestContents, activeLoopStartIndex)
  ) {
    return requestContents;
  }

  const newContents = requestContents.slice();

  for (let i = activeLoopStartIndex; i < newContents.length; i++) {
    const content = newContents[i];
    if (content.role !== 'model' || !content.parts) {
      continue;
    }
    const updatedContent = withFirstFunctionCallSignature(content);
    if (updatedContent) {
      newContents[i] = updatedContent;
    }
  }

  return newContents;
}

function withFirstFunctionCallSignature(content: Content): Content | null {
  const signatureResult = applySignatureToFirstFunctionCall(content.parts!);
  return signatureResult.modified
    ? { ...content, parts: signatureResult.parts }
    : null;
}

function applySignatureToFirstFunctionCall(parts: Part[]): {
  modified: boolean;
  parts: Part[];
} {
  const newParts = parts.slice();
  for (let j = 0; j < newParts.length; j++) {
    const part = newParts[j];
    if ('functionCall' in part && Boolean(part.functionCall)) {
      const partWithSig = part as PartWithThoughtSignature;
      if (!isNonEmpty(partWithSig.thoughtSignature)) {
        newParts[j] = {
          ...part,
          thoughtSignature: SYNTHETIC_THOUGHT_SIGNATURE,
        } as PartWithThoughtSignature;
        return { modified: true, parts: newParts };
      }
      // Only the first functionCall in the turn gets a signature
      return { modified: false, parts: newParts };
    }
  }
  return { modified: false, parts: newParts };
}

function partHasThoughtContent(part: Part): boolean {
  const partWithThought = part as PartWithThought;
  const partWithSig = part as PartWithThoughtSignature;
  return (
    partWithThought.thought === true ||
    (typeof partWithSig.thoughtSignature === 'string' &&
      partWithSig.thoughtSignature.length > 0)
  );
}

function contentHasThoughtContent(
  contents: Content[],
  lastModelTurnIndex: number,
  policy: 'all' | 'allButLast',
): boolean {
  return contents.some((content, i) => {
    if (content.role !== 'model' || !content.parts) {
      return false;
    }
    if (policy === 'allButLast' && i === lastModelTurnIndex) {
      return false;
    }
    return content.parts.some((part) => partHasThoughtContent(part));
  });
}

/**
 * Strips thought content from history before sending to the API.
 * Gemini returns parts with `thought: true` for reasoning content,
 * and these should not be sent back in subsequent requests.
 *
 * Also removes thoughtSignature properties to clean up the history.
 *
 * @param contents - The conversation history
 * @param policy - How to strip thoughts: 'all' removes all, 'allButLast' keeps last model turn, 'none' keeps all
 * @returns A new array with thought content stripped according to policy
 */
export function stripThoughtsFromHistory(
  contents: Content[],
  policy: 'all' | 'allButLast' | 'none' = 'all',
): Content[] {
  if (policy === 'none') {
    return contents;
  }

  let lastModelTurnIndex = -1;
  if (policy === 'allButLast') {
    for (let i = contents.length - 1; i >= 0; i--) {
      if (contents[i].role === 'model') {
        lastModelTurnIndex = i;
        break;
      }
    }
  }

  if (!contentHasThoughtContent(contents, lastModelTurnIndex, policy)) {
    return contents;
  }

  const newContents: Content[] = [];

  for (let i = 0; i < contents.length; i++) {
    const content = contents[i];
    const stripped = stripContentThoughts(
      content,
      policy,
      lastModelTurnIndex,
      i,
    );
    if (stripped) {
      newContents.push(stripped);
    }
  }

  return newContents;
}

function stripContentThoughts(
  content: Content,
  policy: 'all' | 'allButLast',
  lastModelTurnIndex: number,
  index: number,
): Content | null {
  if (content.role !== 'model' || !content.parts) {
    return content;
  }
  if (policy === 'allButLast' && index === lastModelTurnIndex) {
    return content;
  }

  const filteredParts = content.parts
    .filter((part) => {
      const partWithThought = part as PartWithThought;
      return partWithThought.thought !== true;
    })
    .map((part) => {
      const partWithSig = part as PartWithThoughtSignature;
      if (
        typeof partWithSig.thoughtSignature === 'string' &&
        partWithSig.thoughtSignature.length > 0
      ) {
        const { thoughtSignature: _, ...restPart } = partWithSig;
        return restPart as Part;
      }
      return part;
    });

  if (filteredParts.length === 0) {
    return null;
  }
  return {
    ...content,
    parts: filteredParts,
  };
}
