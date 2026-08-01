/**
 * Re-embeds the canonical trusted-marker snippet from
 * .github/scripts/ocr-trusted-marker.cjs into all four github-script
 * bodies in .github/workflows/ocr-review.yml. The snippet text (between
 * the BEGIN/END sentinels, inclusive) is indented by 12 spaces to match
 * the YAML inline-script indentation.
 *
 * The replacement is EXACT and self-verifying: rather than matching any
 * text between two sentinel-shaped lines (which is fragile against a body
 * line that happens to look like a sentinel), it locates the previously
 * embedded block by finding each BEGIN sentinel at exactly 12-space
 * indent, then walks line-by-line to the matching END sentinel at the
 * same indent, replaces that precise span, and verifies the result
 * contains exactly four copies of the canonical snippet.
 */

/* eslint-env node */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODULE_PATH = path.join(
  ROOT,
  '.github',
  'scripts',
  'ocr-trusted-marker.cjs',
);
const WORKFLOW_PATH = path.join(ROOT, '.github', 'workflows', 'ocr-review.yml');

const BEGIN = '// --- BEGIN OCR TRUSTED MARKER SNIPPET ---';
const END = '// --- END OCR TRUSTED MARKER SNIPPET ---';
const INDENT = '            ';

/**
 * Drop a trailing carriage return so sentinel comparisons succeed on a
 * CRLF checkout without rewriting the file's line endings.
 * @param {string} line - a single line, possibly CRLF-terminated
 * @returns {string} the line without a trailing carriage return
 */
function stripCarriageReturn(line) {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}
const EXPECTED_SITES = 4;

/**
 * Extract the snippet text (BEGIN..END inclusive) from the module source.
 * @param {string} content - full module source
 * @returns {string} the snippet including sentinel lines
 */
function extractSnippet(rawContent) {
  // Normalize CRLF so sentinel lines compare equal on a Windows checkout;
  // the workflow this feeds is LF-only per .gitattributes.
  const content = rawContent.replace(/\r\n/g, '\n');
  const beginIdx = content.indexOf(BEGIN);
  const endIdx = content.indexOf(END);
  if (beginIdx < 0) {
    throw new Error('BEGIN sentinel not found in module');
  }
  if (endIdx < beginIdx) {
    throw new Error('END sentinel not found or precedes BEGIN in module');
  }
  return content.slice(beginIdx, endIdx + END.length);
}

/**
 * Indent every non-empty line of the snippet by 12 spaces.
 * @param {string} text - snippet text (unindented)
 * @returns {string} 12-space-indented snippet
 */
function indentSnippet(text) {
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? INDENT + line : line))
    .join('\n');
}

/**
 * Find all embedded snippet blocks in the workflow by locating each
 * line that is EXACTLY INDENT + BEGIN, then walking forward line-by-line
 * to the next line that is EXACTLY INDENT + END. This avoids the lazy-
 * regex pitfall where a body line shaped like the END sentinel would
 * truncate the match.
 *
 * Returns an array of { startLine, endLine } pairs (0-based line indices,
 * inclusive) for every embedded block.
 * @param {string} workflow - full workflow source
 * @returns {Array<{startLine: number, endLine: number}>}
 */
function findEmbeddedBlocks(workflow) {
  const lines = workflow.split('\n').map(stripCarriageReturn);
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === INDENT + BEGIN) {
      let j = i + 1;
      while (j < lines.length && lines[j] !== INDENT + END) {
        j += 1;
      }
      if (j >= lines.length) {
        throw new Error(
          'Unterminated embedded snippet: BEGIN sentinel at line ' +
            (i + 1) +
            ' has no matching END sentinel at ' +
            INDENT.length +
            '-space indent.',
        );
      }
      blocks.push({ startLine: i, endLine: j });
      i = j;
    }
  }
  return blocks;
}

/**
 * Re-embed the canonical snippet into the workflow source.
 *
 * Pure function: takes the module content and workflow content, returns
 * the re-embedded workflow content. Throws on any structural violation.
 * @param {string} moduleContent - .github/scripts/ocr-trusted-marker.cjs
 * @param {string} workflowContent - .github/workflows/ocr-review.yml
 * @returns {string} the updated workflow content
 */
function reEmbed(moduleContent, rawWorkflowContent) {
  const snippet = extractSnippet(moduleContent);
  const indentedSnippet = indentSnippet(snippet);

  // The workflow is LF-only per .gitattributes. Normalizing here keeps the
  // sentinel matching, the splice and the post-write verification all
  // consistent on a CRLF checkout instead of failing with "found 0".
  const workflowContent = rawWorkflowContent.replace(/\r\n/g, '\n');
  const blocks = findEmbeddedBlocks(workflowContent);
  if (blocks.length !== EXPECTED_SITES) {
    throw new Error(
      'Expected ' +
        EXPECTED_SITES +
        ' embedded snippet sites, found ' +
        blocks.length +
        '. Aborting.',
    );
  }

  // Replace each block precisely. Work backwards so earlier indices
  // remain valid as we splice.
  const lines = workflowContent.split('\n');
  const indentedLines = indentedSnippet.split('\n');
  for (let k = blocks.length - 1; k >= 0; k--) {
    const { startLine, endLine } = blocks[k];
    lines.splice(startLine, endLine - startLine + 1, ...indentedLines);
  }

  const result = lines.join('\n');

  // Self-verify: the result must contain exactly EXPECTED_SITES copies
  // of the exact indented snippet.
  const snippetCount = countOccurrences(result, indentedSnippet);
  if (snippetCount !== EXPECTED_SITES) {
    throw new Error(
      'Self-verification failed: expected ' +
        EXPECTED_SITES +
        ' occurrences of the exact indented snippet, found ' +
        snippetCount +
        '.',
    );
  }

  // Verify sentinel balance.
  const beginCount = countOccurrences(result, INDENT + BEGIN);
  const endCount = countOccurrences(result, INDENT + END);
  if (beginCount !== EXPECTED_SITES || endCount !== EXPECTED_SITES) {
    throw new Error(
      'Self-verification failed: BEGIN sentinels = ' +
        beginCount +
        ', END sentinels = ' +
        endCount +
        ' (expected ' +
        EXPECTED_SITES +
        ' each).',
    );
  }

  return result;
}

/**
 * Count non-overlapping occurrences of needle in haystack.
 * @param {string} haystack
 * @param {string} needle
 * @returns {number}
 */
function countOccurrences(haystack, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count += 1;
    pos += needle.length;
  }
  return count;
}

// Export for testing.
module.exports = {
  reEmbed,
  extractSnippet,
  indentSnippet,
  findEmbeddedBlocks,
  BEGIN,
  END,
  INDENT,
  EXPECTED_SITES,
};

// CLI entry point — only run when executed directly, not when required.
if (require.main === module) {
  const moduleContent = fs.readFileSync(MODULE_PATH, 'utf8');
  const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  const updated = reEmbed(moduleContent, workflowContent);
  if (updated !== workflowContent) {
    fs.writeFileSync(WORKFLOW_PATH, updated, 'utf8');
    console.log(
      'Re-embedded canonical snippet into ' + EXPECTED_SITES + ' sites.',
    );
  } else {
    console.log('All ' + EXPECTED_SITES + ' sites already up to date.');
  }
}
