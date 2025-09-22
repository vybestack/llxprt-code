/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GeminiClient } from '../core/client.js';
import { EditToolParams, EditTool } from '../tools/edit.js';
import { WriteFileTool } from '../tools/write-file.js';
import { ReadFileTool } from '../tools/read-file.js';
import { ReadManyFilesTool } from '../tools/read-many-files.js';
import { GrepTool } from '../tools/grep.js';
import { LruCache } from './LruCache.js';
import {
  isFunctionResponse,
  isFunctionCall,
} from '../utils/messageInspectors.js';
import { promises as fsPromises } from 'fs';
import {
  correctOldStringMismatch as deterministicCorrectOldString,
  correctNewString as deterministicCorrectNewString,
  correctNewStringEscaping as deterministicCorrectNewStringEscaping,
} from './deterministicEditCorrector.js';

const MAX_CACHE_SIZE = 50;

// Cache for ensureCorrectEdit results
const editCorrectionCache = new LruCache<string, CorrectedEditResult>(
  MAX_CACHE_SIZE,
);

// Cache for ensureCorrectFileContent results
const fileContentCorrectionCache = new LruCache<string, string>(MAX_CACHE_SIZE);

/**
 * Defines the structure of the parameters within CorrectedEditResult
 */
interface CorrectedEditParams {
  file_path: string;
  old_string: string;
  new_string: string;
}

/**
 * Defines the result structure for ensureCorrectEdit.
 */
export interface CorrectedEditResult {
  params: CorrectedEditParams;
  occurrences: number;
}

/**
 * Extracts the timestamp from the .id value, which is in format
 * <tool.name>-<timestamp>-<uuid>
 * @param fcnId the ID value of a functionCall or functionResponse object
 * @returns -1 if the timestamp could not be extracted, else the timestamp (as a number)
 */
function getTimestampFromFunctionId(fcnId: string): number {
  const idParts = fcnId.split('-');
  if (idParts.length > 2) {
    const timestamp = parseInt(idParts[1], 10);
    if (!isNaN(timestamp)) {
      return timestamp;
    }
  }
  return -1;
}

/**
 * Will look through the gemini client history and determine when the most recent
 * edit to a target file occurred. If no edit happened, it will return -1
 * @param filePath the path to the file
 * @param client the geminiClient, so that we can get the history
 * @returns a DateTime (as a number) of when the last edit occurred, or -1 if no edit was found.
 */
async function findLastEditTimestamp(
  filePath: string,
  client: GeminiClient,
): Promise<number> {
  const history = (await client.getHistory()) ?? [];

  // Tools that may reference the file path in their FunctionResponse `output`.
  const toolsInResp = new Set([
    WriteFileTool.Name,
    EditTool.Name,
    ReadManyFilesTool.Name,
    GrepTool.Name,
  ]);
  // Tools that may reference the file path in their FunctionCall `args`.
  const toolsInCall = new Set([...toolsInResp, ReadFileTool.Name]);

  // Iterate backwards to find the most recent relevant action.
  for (const entry of history.slice().reverse()) {
    if (!entry.parts) continue;

    for (const part of entry.parts) {
      let id: string | undefined;
      let content: unknown;

      // Check for a relevant FunctionCall with the file path in its arguments.
      if (
        isFunctionCall(entry) &&
        part.functionCall?.name &&
        toolsInCall.has(part.functionCall.name)
      ) {
        id = part.functionCall.id;
        content = part.functionCall.args;
      }
      // Check for a relevant FunctionResponse with the file path in its output.
      else if (
        isFunctionResponse(entry) &&
        part.functionResponse?.name &&
        toolsInResp.has(part.functionResponse.name)
      ) {
        const { response } = part.functionResponse;
        if (response && !('error' in response) && 'output' in response) {
          id = part.functionResponse.id;
          content = response.output;
        }
      }

      if (!id || content === undefined) continue;

      // Use the "blunt hammer" approach to find the file path in the content.
      // Note that the tool response data is inconsistent in their formatting
      // with successes and errors - so, we just check for the existence
      // as the best guess to if error/failed occurred with the response.
      const stringified = JSON.stringify(content);
      if (
        !stringified.includes('Error') && // only applicable for functionResponse
        !stringified.includes('Failed') && // only applicable for functionResponse
        stringified.includes(filePath)
      ) {
        return getTimestampFromFunctionId(id);
      }
    }
  }

  return -1;
}

/**
 * Attempts to correct edit parameters if the original old_string is not found.
 * It tries unescaping, and then LLM-based correction.
 * Results are cached to avoid redundant processing.
 *
 * @param currentContent The current content of the file.
 * @param originalParams The original EditToolParams
 * @param client The GeminiClient for LLM calls.
 * @returns A promise resolving to an object containing the (potentially corrected)
 *          EditToolParams (as CorrectedEditParams) and the final occurrences count.
 */
export async function ensureCorrectEdit(
  filePath: string,
  currentContent: string,
  originalParams: EditToolParams, // This is the EditToolParams from edit.ts, without \'corrected\'
  client: GeminiClient,
  abortSignal: AbortSignal,
): Promise<CorrectedEditResult> {
  const cacheKey = `${currentContent}---${originalParams.old_string}---${originalParams.new_string}`;
  const cachedResult = editCorrectionCache.get(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }

  let finalNewString = originalParams.new_string;
  const newStringPotentiallyEscaped =
    unescapeStringForGeminiBug(originalParams.new_string) !==
    originalParams.new_string;

  const expectedReplacements = originalParams.expected_replacements ?? 1;

  let finalOldString = originalParams.old_string;
  let occurrences = countOccurrences(currentContent, finalOldString);

  if (occurrences === expectedReplacements) {
    if (newStringPotentiallyEscaped) {
      finalNewString = await correctNewStringEscaping(
        client,
        finalOldString,
        originalParams.new_string,
        abortSignal,
      );
    }
  } else if (occurrences > expectedReplacements) {
    const expectedReplacements = originalParams.expected_replacements ?? 1;

    // If user expects multiple replacements, return as-is
    if (occurrences === expectedReplacements) {
      const result: CorrectedEditResult = {
        params: { ...originalParams },
        occurrences,
      };
      editCorrectionCache.set(cacheKey, result);
      return result;
    }

    // If user expects 1 but found multiple, try to correct (existing behavior)
    if (expectedReplacements === 1) {
      const result: CorrectedEditResult = {
        params: { ...originalParams },
        occurrences,
      };
      editCorrectionCache.set(cacheKey, result);
      return result;
    }

    // If occurrences don't match expected, return as-is (will fail validation later)
    const result: CorrectedEditResult = {
      params: { ...originalParams },
      occurrences,
    };
    editCorrectionCache.set(cacheKey, result);
    return result;
  } else {
    // occurrences is 0 or some other unexpected state initially
    const unescapedOldStringAttempt = unescapeStringForGeminiBug(
      originalParams.old_string,
    );
    occurrences = countOccurrences(currentContent, unescapedOldStringAttempt);

    if (occurrences === expectedReplacements) {
      finalOldString = unescapedOldStringAttempt;
      if (newStringPotentiallyEscaped) {
        finalNewString = await correctNewString(
          client,
          originalParams.old_string, // original old
          unescapedOldStringAttempt, // corrected old
          originalParams.new_string, // original new (which is potentially escaped)
          abortSignal,
        );
      }
    } else if (occurrences === 0) {
      if (filePath) {
        // In order to keep from clobbering edits made outside our system,
        // let's check if there was a more recent edit to the file than what
        // our system has done
        const lastEditedByUsTime = await findLastEditTimestamp(
          filePath,
          client,
        );

        // Add a 1-second buffer to account for timing inaccuracies. If the file
        // was modified more than a second after the last edit tool was run, we
        // can assume it was modified by something else.
        if (lastEditedByUsTime > 0) {
          const stats = await fsPromises.stat(filePath);
          const diff = stats.mtimeMs - lastEditedByUsTime;
          if (diff > 2000) {
            // Hard coded for 2 seconds
            // This file was edited sooner
            const result: CorrectedEditResult = {
              params: { ...originalParams },
              occurrences: 0, // Explicitly 0 as LLM failed
            };
            editCorrectionCache.set(cacheKey, result);
            return result;
          }
        }
      }

      const llmCorrectedOldString = await correctOldStringMismatch(
        client,
        currentContent,
        unescapedOldStringAttempt,
        abortSignal,
      );
      const llmOldOccurrences = countOccurrences(
        currentContent,
        llmCorrectedOldString,
      );

      if (llmOldOccurrences === expectedReplacements) {
        finalOldString = llmCorrectedOldString;
        occurrences = llmOldOccurrences;

        if (newStringPotentiallyEscaped) {
          const baseNewStringForLLMCorrection = unescapeStringForGeminiBug(
            originalParams.new_string,
          );
          finalNewString = await correctNewString(
            client,
            originalParams.old_string, // original old
            llmCorrectedOldString, // corrected old
            baseNewStringForLLMCorrection, // base new for correction
            abortSignal,
          );
        }
      } else {
        // LLM correction also failed for old_string
        const result: CorrectedEditResult = {
          params: { ...originalParams },
          occurrences: 0, // Explicitly 0 as LLM failed
        };
        editCorrectionCache.set(cacheKey, result);
        return result;
      }
    } else {
      // Unescaping old_string resulted in > 1 occurrence
      const result: CorrectedEditResult = {
        params: { ...originalParams },
        occurrences, // This will be > 1
      };
      editCorrectionCache.set(cacheKey, result);
      return result;
    }
  }

  const { targetString, pair } = trimPairIfPossible(
    finalOldString,
    finalNewString,
    currentContent,
    expectedReplacements,
  );
  finalOldString = targetString;
  finalNewString = pair;

  // Final result construction
  const result: CorrectedEditResult = {
    params: {
      file_path: originalParams.file_path,
      old_string: finalOldString,
      new_string: finalNewString,
    },
    occurrences: countOccurrences(currentContent, finalOldString), // Recalculate occurrences with the final old_string
  };
  editCorrectionCache.set(cacheKey, result);
  return result;
}

export async function ensureCorrectFileContent(
  content: string,
  client: GeminiClient,
  abortSignal: AbortSignal,
): Promise<string> {
  const cachedResult = fileContentCorrectionCache.get(content);
  if (cachedResult) {
    return cachedResult;
  }

  const contentPotentiallyEscaped =
    unescapeStringForGeminiBug(content) !== content;
  if (!contentPotentiallyEscaped) {
    fileContentCorrectionCache.set(content, content);
    return content;
  }

  const correctedContent = await correctStringEscaping(
    content,
    client,
    abortSignal,
  );
  fileContentCorrectionCache.set(content, correctedContent);
  return correctedContent;
}

// JSON schemas removed - using deterministic correction instead of LLM

export async function correctOldStringMismatch(
  _geminiClient: GeminiClient,
  fileContent: string,
  problematicSnippet: string,
  _abortSignal: AbortSignal,
): Promise<string> {
  // Use deterministic correction instead of LLM
  return deterministicCorrectOldString(fileContent, problematicSnippet);
}

/**
 * Adjusts the new_string to align with a corrected old_string, maintaining the original intent.
 */
export async function correctNewString(
  _geminiClient: GeminiClient,
  originalOldString: string,
  correctedOldString: string,
  originalNewString: string,
  _abortSignal: AbortSignal,
): Promise<string> {
  // Use deterministic correction instead of LLM
  return deterministicCorrectNewString(
    originalOldString,
    correctedOldString,
    originalNewString,
  );
}

export async function correctNewStringEscaping(
  _geminiClient: GeminiClient,
  oldString: string,
  potentiallyProblematicNewString: string,
  _abortSignal: AbortSignal,
): Promise<string> {
  // Use deterministic correction instead of LLM
  return deterministicCorrectNewStringEscaping(
    oldString,
    potentiallyProblematicNewString,
  );
}

export async function correctStringEscaping(
  potentiallyProblematicString: string,
  _client: GeminiClient,
  _abortSignal: AbortSignal,
): Promise<string> {
  // Use deterministic correction instead of LLM
  // This is a general string escaping correction without old_string context
  return deterministicCorrectNewStringEscaping(
    '',
    potentiallyProblematicString,
  );
}

function trimPairIfPossible(
  target: string,
  trimIfTargetTrims: string,
  currentContent: string,
  expectedReplacements: number,
) {
  const trimmedTargetString = target.trim();
  if (target.length !== trimmedTargetString.length) {
    const trimmedTargetOccurrences = countOccurrences(
      currentContent,
      trimmedTargetString,
    );

    if (trimmedTargetOccurrences === expectedReplacements) {
      const trimmedReactiveString = trimIfTargetTrims.trim();
      return {
        targetString: trimmedTargetString,
        pair: trimmedReactiveString,
      };
    }
  }

  return {
    targetString: target,
    pair: trimIfTargetTrims,
  };
}

/**
 * Unescapes a string that might have been overly escaped by an LLM.
 */
export function unescapeStringForGeminiBug(inputString: string): string {
  // Regex explanation:
  // \\ : Matches exactly one literal backslash character.
  // (n|t|r|'|"|`|\\|\n) : This is a capturing group. It matches one of the following:
  //   n, t, r, ', ", ` : These match the literal characters 'n', 't', 'r', single quote, double quote, or backtick.
  //                       This handles cases like "\\n", "\\`", etc.
  //   \\ : This matches a literal backslash. This handles cases like "\\\\" (escaped backslash).
  //   \n : This matches an actual newline character. This handles cases where the input
  //        string might have something like "\\\n" (a literal backslash followed by a newline).
  // g : Global flag, to replace all occurrences.

  return inputString.replace(
    /\\+(n|t|r|'|"|`|\\|\n)/g,
    (match, capturedChar) => {
      // 'match' is the entire erroneous sequence, e.g., if the input (in memory) was "\\\\`", match is "\\\\`".
      // 'capturedChar' is the character that determines the true meaning, e.g., '`'.

      switch (capturedChar) {
        case 'n':
          return '\n'; // Correctly escaped: \n (newline character)
        case 't':
          return '\t'; // Correctly escaped: \t (tab character)
        case 'r':
          return '\r'; // Correctly escaped: \r (carriage return character)
        case "'":
          return "'"; // Correctly escaped: ' (apostrophe character)
        case '"':
          return '"'; // Correctly escaped: " (quotation mark character)
        case '`':
          return '`'; // Correctly escaped: ` (backtick character)
        case '\\': // This handles when 'capturedChar' is a literal backslash
          return '\\'; // Replace escaped backslash (e.g., "\\\\") with single backslash
        case '\n': // This handles when 'capturedChar' is an actual newline
          return '\n'; // Replace the whole erroneous sequence (e.g., "\\\n" in memory) with a clean newline
        default:
          // This fallback should ideally not be reached if the regex captures correctly.
          // It would return the original matched sequence if an unexpected character was captured.
          return match;
      }
    },
  );
}

/**
 * Counts occurrences of a substring in a string
 */
export function countOccurrences(str: string, substr: string): number {
  if (substr === '') {
    return 0;
  }
  let count = 0;
  let pos = str.indexOf(substr);
  while (pos !== -1) {
    count++;
    pos = str.indexOf(substr, pos + substr.length); // Start search after the current match
  }
  return count;
}

export function resetEditCorrectorCaches_TEST_ONLY() {
  editCorrectionCache.clear();
  fileContentCorrectionCache.clear();
}
