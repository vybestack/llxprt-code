/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity -- Phase 5: legacy provider boundary retained while larger decomposition continues. */

import type { Part } from '@google/genai';

/**
 * Synthetic thought signature used when a functionCall part lacks one.
 * This bypasses Gemini 3.x validation without containing actual reasoning.
 *
 * @see https://ai.google.dev/gemini-api/docs/thought-signatures
 */
export const SYNTHETIC_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';

/**
 * Content structure matching Gemini API format
 */
interface Content {
  role: string;
  parts: Part[];
}

/**
 * Part with optional thoughtSignature
 */
interface PartWithThoughtSignature extends Part {
  thoughtSignature?: string;
}

/**
 * Ensures that all functionCall parts in the "active loop" have a thoughtSignature.
 *
 * The active loop is defined as all content from the last user message with text
 * (not a functionResponse) to the end of the history. Gemini 3.x requires that
 * the first functionCall part in each model turn within this active loop has
 * a thoughtSignature property.
 *
 * This function:
 * 1. Finds the start of the active loop by locating the last user turn with text
 * 2. For each model turn in the active loop, ensures the first functionCall has a signature
 * 3. Preserves existing signatures if present
 * 4. Adds a synthetic signature if missing
 *
 * @param requestContents - The conversation history to process
 * @returns A new array with thoughtSignatures ensured (shallow copy if modified)
 */
export function ensureActiveLoopHasThoughtSignatures(
  requestContents: Content[],
): Content[] {
  // Find the start of the active loop by finding the last user turn
  // with a text message, i.e. that is not just a functionResponse.
  let activeLoopStartIndex = -1;
  for (let i = requestContents.length - 1; i >= 0; i--) {
    const content = requestContents[i];
    if (
      content.role === 'user' &&
      // Preserve old truthiness semantics: falsy text is treated as absent.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Gemini history payloads cross provider boundaries despite declared types.
      content.parts?.some(
        (part) =>
          'text' in part &&
          typeof part.text === 'string' &&
          part.text.length > 0,
      )
    ) {
      activeLoopStartIndex = i;
      break;
    }
  }

  // No active loop found - return unchanged
  if (activeLoopStartIndex === -1) {
    return requestContents;
  }

  // Track if any modifications are needed
  let needsModification = false;

  // Check if we need to modify anything
  for (let i = activeLoopStartIndex; i < requestContents.length; i++) {
    const content = requestContents[i];
    // Defensive runtime check: parts could be null/undefined despite type.
    // Cast to unknown to satisfy strict-boolean while preserving guard.

    if (content.role === 'model' && (content.parts as unknown) != null) {
      // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      for (const part of content.parts) {
        // Check for functionCall with truthy value (object with properties)

        // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        if ('functionCall' in part && Boolean(part.functionCall)) {
          const partWithSig = part as PartWithThoughtSignature;
          // eslint-disable-next-line no-extra-boolean-cast -- Preserve old truthiness semantics: empty signatures are missing.
          if (!Boolean(partWithSig.thoughtSignature)) {
            needsModification = true;
            break;
          }
          // Only the first functionCall matters, so break after checking it
          break;
        }
      }
    }
    if (needsModification) break;
  }

  // No modifications needed - return unchanged
  if (!needsModification) {
    return requestContents;
  }

  // Create shallow copy and modify
  const newContents = requestContents.slice();

  for (let i = activeLoopStartIndex; i < newContents.length; i++) {
    const content = newContents[i];
    // Defensive runtime check: parts could be null/undefined despite type.
    // Cast to unknown to satisfy strict-boolean while preserving guard.

    if (content.role === 'model' && (content.parts as unknown) != null) {
      const newParts = content.parts.slice();
      let modified = false;

      for (let j = 0; j < newParts.length; j++) {
        const part = newParts[j];

        // Check for functionCall with truthy value (object with properties)
        // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        if ('functionCall' in part && Boolean(part.functionCall)) {
          const partWithSig = part as PartWithThoughtSignature;
          // eslint-disable-next-line no-extra-boolean-cast -- Preserve old truthiness semantics: empty signatures are missing.
          if (!Boolean(partWithSig.thoughtSignature)) {
            // Create new part with signature
            newParts[j] = {
              ...part,
              thoughtSignature: SYNTHETIC_THOUGHT_SIGNATURE,
            } as PartWithThoughtSignature;
            modified = true;
          }
          // Only the first functionCall in the turn gets a signature
          break;
        }
      }

      if (modified) {
        newContents[i] = {
          ...content,
          parts: newParts,
        };
      }
    }
  }

  return newContents;
}

/**
 * Part with optional thought property (Gemini's thinking content)
 */
interface PartWithThought extends Part {
  thought?: boolean;
  text?: string;
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

  // Find the last model turn index if needed
  let lastModelTurnIndex = -1;
  if (policy === 'allButLast') {
    for (let i = contents.length - 1; i >= 0; i--) {
      if (contents[i].role === 'model') {
        lastModelTurnIndex = i;
        break;
      }
    }
  }

  let needsModification = false;

  // Check if we need to modify anything
  // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
  for (let i = 0; i < contents.length; i++) {
    const content = contents[i];
    // Defensive runtime check: parts could be null/undefined despite type.
    // Cast to unknown to satisfy strict-boolean while preserving guard.

    if (content.role !== 'model' || (content.parts as unknown) == null)
      continue;

    // Skip last model turn if policy is 'allButLast'
    if (policy === 'allButLast' && i === lastModelTurnIndex) continue;

    for (const part of content.parts) {
      const partWithThought = part as PartWithThought;
      const partWithSig = part as PartWithThoughtSignature;
      // Preserve old falsy semantics: thought===true or truthy thoughtSignature
      // (non-empty string) means present. null/undefined/'' treated as missing.
      if (
        partWithThought.thought === true ||
        (typeof partWithSig.thoughtSignature === 'string' &&
          partWithSig.thoughtSignature.length > 0)
      ) {
        needsModification = true;
        break;
      }
    }
    if (needsModification) break;
  }

  if (!needsModification) {
    return contents;
  }

  // Create new array with thoughts stripped
  const newContents: Content[] = [];

  // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
  for (let i = 0; i < contents.length; i++) {
    const content = contents[i];

    // Defensive runtime check: parts could be null/undefined despite type.
    // Cast to unknown to satisfy strict-boolean while preserving guard.

    if (content.role !== 'model' || (content.parts as unknown) == null) {
      newContents.push(content);
      continue;
    }

    // Skip stripping for last model turn if policy is 'allButLast'
    if (policy === 'allButLast' && i === lastModelTurnIndex) {
      newContents.push(content);
      continue;
    }

    // Filter out thought parts and remove thoughtSignature
    const filteredParts = content.parts
      .filter((part) => {
        const partWithThought = part as PartWithThought;
        // Preserve old falsy semantics: only filter out when thought===true
        return partWithThought.thought !== true;
      })
      .map((part) => {
        const partWithSig = part as PartWithThoughtSignature;
        // Preserve old truthiness semantics: only remove when signature is truthy string
        if (
          typeof partWithSig.thoughtSignature === 'string' &&
          partWithSig.thoughtSignature.length > 0
        ) {
          const { thoughtSignature: _, ...restPart } = partWithSig;
          return restPart as Part;
        }
        return part;
      });

    // Only add content if it has remaining parts
    if (filteredParts.length > 0) {
      newContents.push({
        ...content,
        parts: filteredParts,
      });
    }
  }

  return newContents;
}
