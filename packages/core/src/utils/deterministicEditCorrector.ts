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
 * Deterministic edit correction utilities that fix common LLM escaping issues
 * without requiring additional LLM calls.
 */

/**
 * Common escape sequences that LLMs often over-escape
 */
const ESCAPE_PATTERNS = [
  { overEscaped: /\\\\n/g, correct: '\n' }, // \\n -> \n (newline)
  { overEscaped: /\\\\t/g, correct: '\t' }, // \\t -> \t (tab)
  { overEscaped: /\\\\r/g, correct: '\r' }, // \\r -> \r (carriage return)
  { overEscaped: /\\\\"/g, correct: '"' }, // \\" -> " (quote)
  { overEscaped: /\\\\'/g, correct: "'" }, // \\' -> ' (single quote)
  { overEscaped: /\\\\\\/g, correct: '\\' }, // \\\\ -> \\ (backslash)
];

/**
 * Patterns for template literal escaping issues
 */
const TEMPLATE_LITERAL_PATTERNS = [
  // Over-escaped template literal backticks: \\` -> `
  { overEscaped: /\\\\`/g, correct: '`' },
  // Over-escaped template literal expressions: \\${ -> ${
  { overEscaped: /\\\\\$\{/g, correct: '${' },
];

/**
 * Normalizes whitespace differences between strings
 */
function normalizeWhitespace(str: string): string {
  return str
    .replace(/\r\n/g, '\n') // Normalize line endings
    .replace(/\r/g, '\n') // Convert Mac line endings
    .replace(/[ \t]+$/gm, '') // Remove trailing whitespace on each line
    .replace(/\n{3,}/g, '\n\n'); // Collapse multiple blank lines to max 2
}

/**
 * Calculates similarity between two strings using Levenshtein distance
 * Returns a score between 0 and 1 (1 being identical)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;

  if (len1 === 0) return len2 === 0 ? 1 : 0;
  if (len2 === 0) return 0;

  const matrix: number[][] = [];

  // Initialize first column
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }

  // Initialize first row
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  // Calculate Levenshtein distance
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost, // substitution
      );
    }
  }

  const distance = matrix[len1][len2];
  const maxLength = Math.max(len1, len2);
  return 1 - distance / maxLength;
}

/**
 * Fixes common over-escaping issues in a string
 */
function fixOverEscaping(str: string): string {
  let result = str;

  // Apply common escape fixes
  for (const pattern of ESCAPE_PATTERNS) {
    result = result.replace(pattern.overEscaped, pattern.correct);
  }

  // Apply template literal fixes
  for (const pattern of TEMPLATE_LITERAL_PATTERNS) {
    result = result.replace(pattern.overEscaped, pattern.correct);
  }

  return result;
}

/**
 * Attempts to find the best match for a snippet in file content
 * by fixing escaping and whitespace issues
 */
export function correctOldStringMismatch(
  fileContent: string,
  problematicSnippet: string,
): string {
  // First, try exact match
  if (fileContent.includes(problematicSnippet)) {
    return problematicSnippet;
  }

  // Try fixing over-escaping in the snippet
  const unescapedSnippet = fixOverEscaping(problematicSnippet);
  if (fileContent.includes(unescapedSnippet)) {
    return unescapedSnippet;
  }

  // Try normalizing whitespace
  const normalizedSnippet = normalizeWhitespace(unescapedSnippet);
  const normalizedContent = normalizeWhitespace(fileContent);

  if (normalizedContent.includes(normalizedSnippet)) {
    // Find the actual text in the original file that matches
    const startIdx = normalizedContent.indexOf(normalizedSnippet);
    if (startIdx !== -1) {
      // Map back to original content (approximate)
      return findOriginalMatch(fileContent, normalizedSnippet, startIdx);
    }
  }

  // Try fuzzy matching for similar content
  const bestMatch = findBestFuzzyMatch(fileContent, unescapedSnippet);
  if (bestMatch && calculateSimilarity(unescapedSnippet, bestMatch) > 0.8) {
    return bestMatch;
  }

  // If all else fails, return the original
  return problematicSnippet;
}

/**
 * Finds the original text in file content that corresponds to a normalized match
 */
function findOriginalMatch(
  originalContent: string,
  normalizedMatch: string,
  _approximateStart: number,
): string {
  // This is a simplified approach - in practice, you might need more sophisticated mapping
  const lines = originalContent.split('\n');
  const matchLines = normalizedMatch.split('\n');

  let bestMatch = '';
  let bestScore = 0;

  // Search for the best matching sequence of lines
  for (let i = 0; i <= lines.length - matchLines.length; i++) {
    const candidate = lines.slice(i, i + matchLines.length).join('\n');
    const score = calculateSimilarity(
      normalizeWhitespace(candidate),
      normalizedMatch,
    );

    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  return bestScore > 0.8 ? bestMatch : normalizedMatch;
}

/**
 * Finds the best fuzzy match for a snippet in file content
 */
function findBestFuzzyMatch(
  fileContent: string,
  snippet: string,
): string | null {
  const snippetLength = snippet.length;
  const margin = Math.floor(snippetLength * 0.2); // Allow 20% size difference

  let bestMatch = '';
  let bestScore = 0;

  // Slide through the content looking for similar segments
  for (let i = 0; i < fileContent.length - snippetLength + margin; i++) {
    for (
      let len = Math.max(1, snippetLength - margin);
      len <= Math.min(fileContent.length - i, snippetLength + margin);
      len++
    ) {
      const candidate = fileContent.substring(i, i + len);
      const score = calculateSimilarity(snippet, candidate);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
    }
  }

  return bestScore > 0.8 ? bestMatch : null;
}

/**
 * Adjusts the new_string to align with corrections made to old_string
 */
export function correctNewString(
  originalOldString: string,
  correctedOldString: string,
  originalNewString: string,
): string {
  if (originalOldString === correctedOldString) {
    return originalNewString;
  }

  // Check for escape corrections
  const originalUnescaped = fixOverEscaping(originalOldString);

  if (originalUnescaped === correctedOldString) {
    // The correction was to unescape - apply same to new string
    return fixOverEscaping(originalNewString);
  }

  // Check for whitespace normalization
  const originalNormalized = normalizeWhitespace(originalOldString);
  const correctedNormalized = normalizeWhitespace(correctedOldString);

  if (originalNormalized === correctedNormalized) {
    // The correction was whitespace - apply similar normalization
    return applyWhitespaceCorrections(
      originalOldString,
      correctedOldString,
      originalNewString,
    );
  }

  // For more complex corrections, try to identify patterns
  const patterns = identifyPatternDifferences(
    originalOldString,
    correctedOldString,
  );
  return applyPatterns(originalNewString, patterns);
}

/**
 * Applies whitespace corrections from old string to new string
 */
function applyWhitespaceCorrections(
  originalOld: string,
  correctedOld: string,
  originalNew: string,
): string {
  // Identify leading/trailing whitespace changes
  const oldLeading = originalOld.match(/^\s*/)?.[0] || '';
  const correctedLeading = correctedOld.match(/^\s*/)?.[0] || '';
  const oldTrailing = originalOld.match(/\s*$/)?.[0] || '';
  const correctedTrailing = correctedOld.match(/\s*$/)?.[0] || '';

  let result = originalNew;

  // Apply leading whitespace correction
  if (oldLeading !== correctedLeading) {
    result = result.replace(/^\s*/, correctedLeading);
  }

  // Apply trailing whitespace correction
  if (oldTrailing !== correctedTrailing) {
    result = result.replace(/\s*$/, correctedTrailing);
  }

  return result;
}

/**
 * Identifies pattern differences between original and corrected strings
 */
function identifyPatternDifferences(
  original: string,
  corrected: string,
): Array<{ pattern: RegExp; replacement: string }> {
  const patterns: Array<{ pattern: RegExp; replacement: string }> = [];

  // Check for quote style changes
  if (original.includes('\\"') && corrected.includes('"')) {
    patterns.push({ pattern: /\\"/g, replacement: '"' });
  }
  if (original.includes("\\'") && corrected.includes("'")) {
    patterns.push({ pattern: /\\'/g, replacement: "'" });
  }

  // Check for newline style changes
  if (original.includes('\\n') && corrected.includes('\n')) {
    patterns.push({ pattern: /\\n/g, replacement: '\n' });
  }

  // Check for tab style changes
  if (original.includes('\\t') && corrected.includes('\t')) {
    patterns.push({ pattern: /\\t/g, replacement: '\t' });
  }

  return patterns;
}

/**
 * Applies identified patterns to a string
 */
function applyPatterns(
  str: string,
  patterns: Array<{ pattern: RegExp; replacement: string }>,
): string {
  let result = str;

  for (const { pattern, replacement } of patterns) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

/**
 * Fixes escaping issues in new_string
 */
export function correctNewStringEscaping(
  oldString: string,
  potentiallyProblematicNewString: string,
): string {
  // Apply standard unescaping
  let corrected = fixOverEscaping(potentiallyProblematicNewString);

  // Check for specific patterns that indicate over-escaping
  // If the old string has actual newlines but new string has escaped ones
  if (
    oldString.includes('\n') &&
    potentiallyProblematicNewString.includes('\\n')
  ) {
    corrected = corrected.replace(/\\n/g, '\n');
  }

  if (
    oldString.includes('\t') &&
    potentiallyProblematicNewString.includes('\\t')
  ) {
    corrected = corrected.replace(/\\t/g, '\t');
  }

  // Handle template literals specifically
  if (oldString.includes('`') || oldString.includes('${')) {
    corrected = corrected.replace(/\\`/g, '`').replace(/\\\${/g, '${');
  }

  // Validate that the correction didn't break syntax (basic check)
  if (isLikelySyntaxError(corrected)) {
    // If we might have broken syntax, return original
    return potentiallyProblematicNewString;
  }

  return corrected;
}

/**
 * Basic check for likely syntax errors
 */
function isLikelySyntaxError(str: string): boolean {
  // Count quotes and check for balance
  const singleQuotes = (str.match(/'/g) || []).length;
  const doubleQuotes = (str.match(/"/g) || []).length;
  const backticks = (str.match(/`/g) || []).length;

  // Odd number of quotes often indicates a problem
  // (though this is a simplified check)
  if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0 || backticks % 2 !== 0) {
    // But it might be intentional in some cases, so don't be too strict
    // Only flag if it looks really wrong
    const hasUnclosedString = /["'`][^"'`]*$/.test(str);
    if (hasUnclosedString) {
      return true;
    }
  }

  return false;
}
