/**
 * Re-embeds the canonical trusted-marker snippet from
 * .github/scripts/ocr-trusted-marker.cjs into all four github-script
 * bodies in .github/workflows/ocr-review.yml. The snippet text (between
 * the BEGIN/END sentinels, inclusive) is indented by 12 spaces to match
 * the YAML inline-script indentation.
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

const extractSnippet = (content) => {
  const beginIdx = content.indexOf(BEGIN);
  const endIdx = content.indexOf(END);
  if (beginIdx < 0) {
    throw new Error('BEGIN sentinel not found in module');
  }
  if (endIdx < beginIdx) {
    throw new Error('END sentinel not found or precedes BEGIN in module');
  }
  return content.slice(beginIdx, endIdx + END.length);
};

const indent12 = (text) =>
  text
    .split('\n')
    .map((line) => (line.length > 0 ? '            ' + line : line))
    .join('\n');

const moduleContent = fs.readFileSync(MODULE_PATH, 'utf8');
const snippet = extractSnippet(moduleContent);
const indentedSnippet = indent12(snippet);

let workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
let count = 0;

// Replace each occurrence of the old indented snippet block.
// Match from the indented BEGIN to the indented END (inclusive).
const pattern =
  / {12}\/\/ --- BEGIN OCR TRUSTED MARKER SNIPPET ---[\s\S]*? {12}\/\/ --- END OCR TRUSTED MARKER SNIPPET ---/g;

workflow = workflow.replace(pattern, () => {
  count += 1;
  return indentedSnippet;
});

if (count !== 4) {
  throw new Error(
    'Expected 4 snippet sites, replaced ' + count + '. Aborting.',
  );
}

fs.writeFileSync(WORKFLOW_PATH, workflow, 'utf8');
console.log('Re-embedded canonical snippet into ' + count + ' sites.');
