/**
 * Ported from opencode (https://github.com/opencodenpm/opencode).
 * Original by opencode contributors.
 * Adapted for llxprt-code by Vybestack.
 */

// Similarity thresholds for block anchor fallback matching
const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0;
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3;

/**
 * Type definition for replacer functions that generate potential matches
 */
export type Replacer = (
  content: string,
  find: string,
) => Generator<string, void, unknown>;

/**
 * Levenshtein distance algorithm implementation
 */
export function levenshtein(a: string, b: string): number {
  // Handle empty strings
  if (a === '' || b === '') {
    return Math.max(a.length, b.length);
  }
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}

/**
 * Helper function to escape special regex characters
 */
const escapeRegExp = (str: string): string =>
  str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ESCAPE_SEQUENCE_PATTERN = /\\(n|t|r|'|"|`|\\|\$)/g;
const ESCAPE_SEQUENCE_TEST_PATTERN = /\\(n|t|r|'|"|`|\\|\$)/;

const unescapeEscapedSequences = (str: string): string =>
  str.replace(ESCAPE_SEQUENCE_PATTERN, (_match, capturedChar: string) => {
    switch (capturedChar) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case "'":
        return "'";
      case '"':
        return '"';
      case '`':
        return '`';
      case '\\':
        return '\\';
      case '$':
        return '$';
      default:
        return capturedChar;
    }
  });

/**
 * Simple exact match replacer
 */
export const SimpleReplacer: Replacer = function* (_content, find) {
  yield find;
};

/**
 * Replacer that matches lines with trimmed content
 */
export const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split('\n');
  const searchLines = find.split('\n');

  if (searchLines[searchLines.length - 1] === '') {
    searchLines.pop();
  }

  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true;

    for (let j = 0; j < searchLines.length; j++) {
      const originalTrimmed = originalLines[i + j].trim();
      const searchTrimmed = searchLines[j].trim();

      if (originalTrimmed !== searchTrimmed) {
        matches = false;
        break;
      }
    }

    if (matches) {
      let matchStartIndex = 0;
      for (let k = 0; k < i; k++) {
        matchStartIndex += originalLines[k].length + 1;
      }

      let matchEndIndex = matchStartIndex;
      for (let k = 0; k < searchLines.length; k++) {
        matchEndIndex += originalLines[i + k].length;
        if (k < searchLines.length - 1) {
          matchEndIndex += 1; // Add newline character except for the last line
        }
      }

      yield content.substring(matchStartIndex, matchEndIndex);
    }
  }
};

/**
 * Replacer that matches blocks using first and last line anchors with fuzzy middle content
 */
export const BlockAnchorReplacer: Replacer = function* (content, find) {
  const originalLines = content.split('\n');
  const searchLines = find.split('\n');

  if (searchLines.length < 3) {
    return;
  }

  if (searchLines[searchLines.length - 1] === '') {
    searchLines.pop();
  }

  const firstLineSearch = searchLines[0].trim();
  const lastLineSearch = searchLines[searchLines.length - 1].trim();
  const searchBlockSize = searchLines.length;

  // Collect all candidate positions where both anchors match
  const candidates: Array<{ startLine: number; endLine: number }> = [];
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLineSearch) {
      continue;
    }

    // Look for the matching last line after this first line
    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLineSearch) {
        candidates.push({ startLine: i, endLine: j });
        break; // Only match the first occurrence of the last line
      }
    }
  }

  // Return immediately if no candidates
  if (candidates.length === 0) {
    return;
  }

  // Handle single candidate scenario (using relaxed threshold)
  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0];
    const actualBlockSize = endLine - startLine + 1;

    let similarity = 0;
    const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2); // Middle lines only

    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim();
        const searchLine = searchLines[j].trim();
        const maxLen = Math.max(originalLine.length, searchLine.length);
        if (maxLen === 0) {
          continue;
        }
        const distance = levenshtein(originalLine, searchLine);
        similarity += (1 - distance / maxLen) / linesToCheck;

        // Exit early when threshold is reached
        if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
          break;
        }
      }
    } else {
      // No middle lines to compare, just accept based on anchors
      similarity = 1.0;
    }

    if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
      let matchStartIndex = 0;
      for (let k = 0; k < startLine; k++) {
        matchStartIndex += originalLines[k].length + 1;
      }
      let matchEndIndex = matchStartIndex;
      for (let k = startLine; k <= endLine; k++) {
        matchEndIndex += originalLines[k].length;
        if (k < endLine) {
          matchEndIndex += 1; // Add newline character except for the last line
        }
      }
      yield content.substring(matchStartIndex, matchEndIndex);
    }
    return;
  }

  // Calculate similarity for multiple candidates
  let bestMatch: { startLine: number; endLine: number } | null = null;
  let maxSimilarity = -1;

  for (const candidate of candidates) {
    const { startLine, endLine } = candidate;
    const actualBlockSize = endLine - startLine + 1;

    let similarity = 0;
    const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2); // Middle lines only

    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim();
        const searchLine = searchLines[j].trim();
        const maxLen = Math.max(originalLine.length, searchLine.length);
        if (maxLen === 0) {
          continue;
        }
        const distance = levenshtein(originalLine, searchLine);
        similarity += 1 - distance / maxLen;
      }
      similarity /= linesToCheck; // Average similarity
    } else {
      // No middle lines to compare, just accept based on anchors
      similarity = 1.0;
    }

    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      bestMatch = candidate;
    }
  }

  // Threshold judgment
  if (maxSimilarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD && bestMatch) {
    const { startLine, endLine } = bestMatch;
    let matchStartIndex = 0;
    for (let k = 0; k < startLine; k++) {
      matchStartIndex += originalLines[k].length + 1;
    }
    let matchEndIndex = matchStartIndex;
    for (let k = startLine; k <= endLine; k++) {
      matchEndIndex += originalLines[k].length;
      if (k < endLine) {
        matchEndIndex += 1;
      }
    }
    yield content.substring(matchStartIndex, matchEndIndex);
  }
};

/**
 * Replacer that normalizes whitespace before matching
 */
export const WhitespaceNormalizedReplacer: Replacer = function* (
  content,
  find,
) {
  const normalizeWhitespace = (text: string) =>
    text.replace(/\s+/g, ' ').trim();
  const normalizedFind = normalizeWhitespace(find);

  // Handle single line matches
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (normalizeWhitespace(line) === normalizedFind) {
      yield line;
    } else {
      // Only check for substring matches if the full line doesn't match
      const normalizedLine = normalizeWhitespace(line);
      if (normalizedLine.includes(normalizedFind)) {
        // Find the actual substring in the original line that matches
        const words = find.trim().split(/\s+/);
        if (words.length > 0) {
          const pattern = words.map((word) => escapeRegExp(word)).join('\\s+');
          try {
            const regex = new RegExp(pattern);
            const match = line.match(regex);
            if (match) {
              yield match[0];
            }
          } catch {
            // Invalid regex pattern, skip
          }
        }
      }
    }
  }

  // Handle multi-line matches
  const findLines = find.split('\n');
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length).join('\n');
      if (normalizeWhitespace(block) === normalizedFind) {
        yield block;
      }
    }
  }
};

/**
 * Replacer that matches content regardless of indentation level
 */
export const IndentationFlexibleReplacer: Replacer = function* (content, find) {
  const removeIndentation = (text: string) => {
    const lines = text.split('\n');
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
    if (nonEmptyLines.length === 0) return text;

    const minIndent = Math.min(
      ...nonEmptyLines.map((line) => {
        const match = line.match(/^(\s*)/);
        return match ? match[1].length : 0;
      }),
    );

    return lines
      .map((line) => (line.trim().length === 0 ? line : line.slice(minIndent)))
      .join('\n');
  };

  const normalizedFind = removeIndentation(find);
  const contentLines = content.split('\n');
  const findLines = find.split('\n');

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join('\n');
    if (removeIndentation(block) === normalizedFind) {
      yield block;
    }
  }
};

/**
 * Replacer that handles escape sequences
 */
export const EscapeNormalizedReplacer: Replacer = function* (content, find) {
  // Only apply escape sequence processing if the find string actually contains escaped sequences
  // This prevents corrupting content with actual tab characters, newlines, etc.
  if (!ESCAPE_SEQUENCE_TEST_PATTERN.test(find)) {
    // No escape sequences to process, don't use this replacer
    return;
  }

  const unescapedFind = unescapeEscapedSequences(find);

  // Try direct match with unescaped find string
  if (content.includes(unescapedFind)) {
    yield unescapedFind;
  }

  // Also try finding escaped versions in content that match unescaped find
  const lines = content.split('\n');
  const findLines = unescapedFind.split('\n');

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join('\n');
    const unescapedBlock = unescapeEscapedSequences(block);

    if (unescapedBlock === unescapedFind) {
      yield block;
    }
  }
};

/**
 * Replacer that yields all exact matches for handling multiple occurrences
 */
export const MultiOccurrenceReplacer: Replacer = function* (content, find) {
  // This replacer yields all exact matches, allowing the replace function
  // to handle multiple occurrences based on replaceAll parameter
  let startIndex = 0;

  while (true) {
    const index = content.indexOf(find, startIndex);
    if (index === -1) break;

    yield find;
    startIndex = index + find.length;
  }
};

/**
 * Replacer that tries to match trimmed versions of the find string
 */
export const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
  const trimmedFind = find.trim();

  if (trimmedFind === find) {
    // Already trimmed, no point in trying
    return;
  }

  // Check if the original find contains actual tab characters
  // If it does, we should NOT use this replacer as it might preserve them incorrectly
  if (find.includes('\t')) {
    return;
  }

  // Try to find the trimmed version
  if (content.includes(trimmedFind)) {
    yield trimmedFind;
  }

  // Also try finding blocks where trimmed content matches
  const lines = content.split('\n');
  const findLines = find.split('\n');

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join('\n');

    if (block.trim() === trimmedFind) {
      yield block;
    }
  }
};

/**
 * Replacer that uses first and last lines as context anchors with similarity checking
 */
export const ContextAwareReplacer: Replacer = function* (content, find) {
  const findLines = find.split('\n');
  if (findLines.length < 3) {
    // Need at least 3 lines to have meaningful context
    return;
  }

  // Remove trailing empty line if present
  if (findLines[findLines.length - 1] === '') {
    findLines.pop();
  }

  const contentLines = content.split('\n');

  // Extract first and last lines as context anchors
  const firstLine = findLines[0].trim();
  const lastLine = findLines[findLines.length - 1].trim();

  // Find blocks that start and end with the context anchors
  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== firstLine) continue;

    // Look for the matching last line
    for (let j = i + 2; j < contentLines.length; j++) {
      if (contentLines[j].trim() === lastLine) {
        // Found a potential context block
        const blockLines = contentLines.slice(i, j + 1);
        const block = blockLines.join('\n');

        // Check if the middle content has reasonable similarity
        // (simple heuristic: at least 50% of non-empty lines should match when trimmed)
        if (blockLines.length === findLines.length) {
          let matchingLines = 0;
          let totalNonEmptyLines = 0;

          for (let k = 1; k < blockLines.length - 1; k++) {
            const blockLine = blockLines[k].trim();
            const findLine = findLines[k].trim();

            if (blockLine.length > 0 || findLine.length > 0) {
              totalNonEmptyLines++;
              if (blockLine === findLine) {
                matchingLines++;
              }
            }
          }

          if (
            totalNonEmptyLines === 0 ||
            matchingLines / totalNonEmptyLines >= 0.5
          ) {
            yield block;
            break; // Only match the first occurrence
          }
        }
        break;
      }
    }
  }
};

/**
 * Main fuzzy replace function that tries multiple replacement strategies
 * @param content - The content to search in
 * @param oldString - The string to find and replace
 * @param newString - The replacement string
 * @param replaceAll - Whether to replace all occurrences (default: false)
 * @returns Object with result and occurrences count, or null if no replacement was made
 */
export function fuzzyReplace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): { result: string; occurrences: number } | null {
  if (oldString === newString) {
    return null;
  }

  const oldStringHasEscapes = ESCAPE_SEQUENCE_TEST_PATTERN.test(oldString);
  const newStringHasEscapes = ESCAPE_SEQUENCE_TEST_PATTERN.test(newString);

  let notFound = true;

  for (const replacer of [
    SimpleReplacer,
    LineTrimmedReplacer,
    BlockAnchorReplacer,
    WhitespaceNormalizedReplacer,
    IndentationFlexibleReplacer,
    EscapeNormalizedReplacer,
    TrimmedBoundaryReplacer,
    ContextAwareReplacer,
    MultiOccurrenceReplacer,
  ]) {
    for (const search of replacer(content, oldString)) {
      const index = content.indexOf(search);
      if (index === -1) continue;
      notFound = false;

      const shouldUnescapeReplacement =
        (oldStringHasEscapes || newStringHasEscapes) && !search.includes('\\');

      // Prepare the replacement string - convert escape sequences when the match
      // represents real characters (no backslashes in the matched content)
      const finalReplacement = shouldUnescapeReplacement
        ? unescapeEscapedSequences(newString)
        : newString;

      if (replaceAll) {
        const result = content.replaceAll(search, finalReplacement);
        const occurrences = content.split(search).length - 1;
        return { result, occurrences };
      }
      const lastIndex = content.lastIndexOf(search);
      if (index !== lastIndex) continue;
      const result =
        content.substring(0, index) +
        finalReplacement +
        content.substring(index + search.length);
      return { result, occurrences: 1 };
    }
  }

  if (notFound) {
    return null;
  }

  // Found multiple matches but couldn't replace (ambiguous)
  return null;
}
