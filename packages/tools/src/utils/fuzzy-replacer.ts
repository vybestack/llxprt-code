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
    Array.from({ length: b.length + 1 }, (_, j) => {
      if (i === 0) return j;
      if (j === 0) return i;
      return 0;
    }),
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
const SPECIAL_CHARS = [
  '.',
  '*',
  '+',
  '?',
  '^',
  '$',
  '{',
  '}',
  '(',
  ')',
  '|',
  '[',
  ']',
  '\\',
];

const escapeRegExp = (str: string): string =>
  SPECIAL_CHARS.reduce(
    (escaped, char) => escaped.split(char).join(`\\${char}`),
    str,
  );

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
 * Checks whether searchLines match originalLines starting at offset i (trimmed comparison).
 */
function trimmedLinesMatchAt(
  originalLines: string[],
  searchLines: string[],
  i: number,
): boolean {
  for (let j = 0; j < searchLines.length; j++) {
    const originalTrimmed = originalLines[i + j].trim();
    const searchTrimmed = searchLines[j].trim();

    if (originalTrimmed !== searchTrimmed) {
      return false;
    }
  }
  return true;
}

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
    if (trimmedLinesMatchAt(originalLines, searchLines, i)) {
      const { matchStartIndex, matchEndIndex } = computeLineRangeCharIndices(
        originalLines,
        i,
        i + searchLines.length - 1,
      );
      yield content.substring(matchStartIndex, matchEndIndex);
    }
  }
};

/**
 * Collects candidate positions where both first and last anchor lines match.
 */
function collectAnchorCandidates(
  originalLines: string[],
  firstLineSearch: string,
  lastLineSearch: string,
): Array<{ startLine: number; endLine: number }> {
  const candidates: Array<{ startLine: number; endLine: number }> = [];
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLineSearch) {
      continue;
    }
    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLineSearch) {
        candidates.push({ startLine: i, endLine: j });
        break;
      }
    }
  }
  return candidates;
}

/**
 * Computes the character range [startIndex, endIndex) for a line range in the content.
 */
function computeLineRangeCharIndices(
  originalLines: string[],
  startLine: number,
  endLine: number,
): { matchStartIndex: number; matchEndIndex: number } {
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
  return { matchStartIndex, matchEndIndex };
}

/**
 * Computes average similarity of middle lines between a content block and search block.
 * Returns 1.0 if no middle lines to compare (anchor-only match).
 */
function computeMiddleSimilarity(
  originalLines: string[],
  searchLines: string[],
  startLine: number,
  searchBlockSize: number,
  actualBlockSize: number,
): number {
  const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2);
  if (linesToCheck <= 0) {
    return 1.0;
  }

  const middleLinePairs = collectMiddleLinePairs(
    originalLines,
    searchLines,
    startLine,
    searchBlockSize,
    actualBlockSize,
  );

  return accumulateSimilarity(middleLinePairs, linesToCheck);
}

/**
 * Collects the (originalLine, searchLine) pairs from the middle of a block.
 */
function collectMiddleLinePairs(
  originalLines: string[],
  searchLines: string[],
  startLine: number,
  searchBlockSize: number,
  actualBlockSize: number,
): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const limit = Math.min(searchBlockSize - 1, actualBlockSize - 1);
  for (let j = 1; j < limit; j++) {
    pairs.push([originalLines[startLine + j], searchLines[j]]);
  }
  return pairs;
}

/**
 * Accumulates similarity from line pairs, stopping early once the threshold is reached.
 */
function accumulateSimilarity(
  pairs: Array<[string, string]>,
  linesToCheck: number,
): number {
  let similarity = 0;
  const reachedThreshold = () =>
    similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD;
  for (const [originalLine, searchLine] of pairs) {
    if (reachedThreshold()) {
      break;
    }
    const contribution = linePairContribution(
      originalLine,
      searchLine,
      linesToCheck,
    );
    if (contribution !== null) {
      similarity += contribution;
    }
  }
  return similarity;
}

/**
 * Computes the similarity contribution for a pair of lines, or null if the lines
 * are both empty (and thus should be skipped).
 */
function linePairContribution(
  originalLine: string,
  searchLine: string,
  linesToCheck: number,
): number | null {
  const trimmedOriginal = originalLine.trim();
  const trimmedSearch = searchLine.trim();
  const maxLen = Math.max(trimmedOriginal.length, trimmedSearch.length);
  if (maxLen === 0) {
    return null;
  }
  const distance = levenshtein(trimmedOriginal, trimmedSearch);
  return (1 - distance / maxLen) / linesToCheck;
}

/**
 * Computes average similarity of middle lines for multiple-candidate scoring.
 * Returns 1.0 if no middle lines to compare (anchor-only match).
 */
function computeAverageMiddleSimilarity(
  originalLines: string[],
  searchLines: string[],
  startLine: number,
  searchBlockSize: number,
  actualBlockSize: number,
): number {
  const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2);
  if (linesToCheck <= 0) {
    return 1.0;
  }

  let similarity = 0;
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
  similarity /= linesToCheck;
  return similarity;
}

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

  const candidates = collectAnchorCandidates(
    originalLines,
    firstLineSearch,
    lastLineSearch,
  );

  if (candidates.length === 0) {
    return;
  }

  // Handle single candidate scenario (using relaxed threshold)
  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0];
    const actualBlockSize = endLine - startLine + 1;
    const similarity = computeMiddleSimilarity(
      originalLines,
      searchLines,
      startLine,
      searchBlockSize,
      actualBlockSize,
    );

    if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
      const { matchStartIndex, matchEndIndex } = computeLineRangeCharIndices(
        originalLines,
        startLine,
        endLine,
      );
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
    const similarity = computeAverageMiddleSimilarity(
      originalLines,
      searchLines,
      startLine,
      searchBlockSize,
      actualBlockSize,
    );

    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      bestMatch = candidate;
    }
  }

  if (maxSimilarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD && bestMatch) {
    const { startLine, endLine } = bestMatch;
    const { matchStartIndex, matchEndIndex } = computeLineRangeCharIndices(
      originalLines,
      startLine,
      endLine,
    );
    yield content.substring(matchStartIndex, matchEndIndex);
  }
};

/**
 * Attempts to yield a whitespace-normalized substring match for a single line.
 */
function* yieldWhitespaceSubstringMatches(
  line: string,
  normalizedLine: string,
  normalizedFind: string,
  find: string,
): Generator<string, void, unknown> {
  if (!normalizedLine.includes(normalizedFind)) {
    return;
  }
  const words = find.trim().split(/\s+/);
  if (words.length === 0) {
    return;
  }
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
    const normalizedLine = normalizeWhitespace(line);
    if (normalizedLine === normalizedFind) {
      yield line;
      continue;
    }
    yield* yieldWhitespaceSubstringMatches(
      line,
      normalizedLine,
      normalizedFind,
      find,
    );
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
 * Collects all start indices where `find` occurs in `content`.
 */
function findAllOccurrences(content: string, find: string): number[] {
  const indices: number[] = [];
  let startIndex = 0;
  while (startIndex <= content.length) {
    const index = content.indexOf(find, startIndex);
    if (index === -1) {
      break;
    }
    indices.push(index);
    startIndex = index + find.length;
  }
  return indices;
}

/**
 * Replacer that yields all exact matches for handling multiple occurrences
 */
export const MultiOccurrenceReplacer: Replacer = function* (content, find) {
  // This replacer yields all exact matches, allowing the replace function
  // to handle multiple occurrences based on replaceAll parameter
  const occurrences = findAllOccurrences(content, find);
  for (const _index of occurrences) {
    yield find;
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
 * Counts matching and total non-empty middle lines between block and find lines.
 */
function countMiddleLineMatches(
  blockLines: string[],
  findLines: string[],
): { matchingLines: number; totalNonEmptyLines: number } {
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
  return { matchingLines, totalNonEmptyLines };
}

/**
 * Determines whether a candidate context block matches by middle-line similarity.
 */
function isMatchingContextBlock(
  blockLines: string[],
  findLines: string[],
): boolean {
  if (blockLines.length !== findLines.length) {
    return false;
  }
  const { matchingLines, totalNonEmptyLines } = countMiddleLineMatches(
    blockLines,
    findLines,
  );
  return totalNonEmptyLines === 0 || matchingLines / totalNonEmptyLines >= 0.5;
}

/**
 * Searches for the first context block starting at `startIndex` whose first and last
 * anchor lines match and whose middle content is sufficiently similar. Returns the
 * joined block string, or null if no match.
 */
function findContextBlockFromIndex(
  contentLines: string[],
  startIndex: number,
  firstLine: string,
  lastLine: string,
  findLines: string[],
): string | null {
  for (let j = startIndex + 2; j < contentLines.length; j++) {
    if (contentLines[j].trim() !== lastLine) {
      continue;
    }
    const blockLines = contentLines.slice(startIndex, j + 1);
    if (isMatchingContextBlock(blockLines, findLines)) {
      return blockLines.join('\n');
    }
    return null;
  }
  return null;
}

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
    if (contentLines[i].trim() !== firstLine) {
      continue;
    }

    const block = findContextBlockFromIndex(
      contentLines,
      i,
      firstLine,
      lastLine,
      findLines,
    );
    if (block !== null) {
      yield block;
    }
  }
};

/**
 * The ordered list of replacement strategies tried by fuzzyReplace.
 */
const REPLACERS: Replacer[] = [
  SimpleReplacer,
  LineTrimmedReplacer,
  BlockAnchorReplacer,
  WhitespaceNormalizedReplacer,
  IndentationFlexibleReplacer,
  EscapeNormalizedReplacer,
  TrimmedBoundaryReplacer,
  ContextAwareReplacer,
  MultiOccurrenceReplacer,
];

/**
 * Builds the final replacement string, unescaping escape sequences when
 * the matched content has no backslashes but the find/new strings do.
 */
function buildFinalReplacement(
  search: string,
  newString: string,
  oldStringHasEscapes: boolean,
  newStringHasEscapes: boolean,
): string {
  const shouldUnescape =
    (oldStringHasEscapes || newStringHasEscapes) && !search.includes('\\');
  return shouldUnescape ? unescapeEscapedSequences(newString) : newString;
}

/**
 * Attempts a single replacement using the given search match.
 * Returns the result object, or null if this search is not actionable.
 */
function trySingleReplacement(
  content: string,
  search: string,
  finalReplacement: string,
): { result: string; occurrences: number } | null {
  const index = content.indexOf(search);
  if (index === -1) {
    return null;
  }
  const lastIndex = content.lastIndexOf(search);
  if (index !== lastIndex) {
    return null;
  }
  const result =
    content.substring(0, index) +
    finalReplacement +
    content.substring(index + search.length);
  return { result, occurrences: 1 };
}

/**
 * Attempts a replace-all using the given search match.
 */
function tryReplaceAll(
  content: string,
  search: string,
  finalReplacement: string,
): { result: string; occurrences: number } {
  const result = content.replaceAll(search, () => finalReplacement);
  const occurrences = content.split(search).length - 1;
  return { result, occurrences };
}

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

  for (const replacer of REPLACERS) {
    for (const search of replacer(content, oldString)) {
      const index = content.indexOf(search);
      if (index === -1) continue;
      notFound = false;

      const finalReplacement = buildFinalReplacement(
        search,
        newString,
        oldStringHasEscapes,
        newStringHasEscapes,
      );

      if (replaceAll) {
        return tryReplaceAll(content, search, finalReplacement);
      }
      const single = trySingleReplacement(content, search, finalReplacement);
      if (single) {
        return single;
      }
    }
  }

  if (notFound) {
    return null;
  }

  // Found multiple matches but couldn't replace (ambiguous)
  return null;
}
