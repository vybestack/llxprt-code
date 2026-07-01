#!/usr/bin/env node
/**
 * Codemod: vitest/prefer-strict-equal
 *
 * Reads a list of file:line:col locations where ESLint flagged
 * `expect(...).toEqual(...)` (or aliases) and rewrites the callee name
 * to `toStrictEqual`.
 *
 * Usage:
 *   node scripts/codemods/pse-fix.mjs <locations-file>
 *
 * The locations file format is one entry per line:
 *   /abs/path/file.ts:LINE:COL
 *
 * COL is 1-based and points at the start of the callee identifier.
 */
import { Project, SyntaxKind } from 'ts-morph';
import { readFileSync } from 'node:fs';

const locFile = process.argv[2];
if (!locFile) {
  console.error('usage: pse-fix.mjs <locations-file>');
  process.exit(2);
}

const lines = readFileSync(locFile, 'utf8').split('\n').filter(Boolean);
const byFile = new Map();
for (const line of lines) {
  const m = line.match(/^(.*):(\d+):(\d+)$/);
  if (!m) continue;
  const [, file, ln, col] = m;
  if (!byFile.has(file)) byFile.set(file, []);
  byFile.get(file).push({ line: Number(ln), col: Number(col) });
}

/**
 * Attempt to rewrite a single `toEqual` callee to `toStrictEqual`.
 * Returns 'rewrote', 'skipped', or 'none' (not at an toEqual node).
 */
function processLocation(sf, line, col) {
  const full = sf.getFullText();
  const starts = computeLineStarts(full);
  const base = starts[line - 1];
  if (base == null) return 'skipped';
  const offset = base + col - 1;
  const node = sf.getDescendantAtPos(offset);
  if (!node) return 'skipped';
  let pae = node;
  while (pae && pae.getKind() !== SyntaxKind.PropertyAccessExpression) {
    pae = pae.getParent();
  }
  if (!pae) return 'skipped';
  const nameNode = pae.getNameNode();
  const name = nameNode.getText();
  if (name !== 'toEqual') return 'skipped';
  nameNode.replaceWithText('toStrictEqual');
  return 'rewrote';
}

/**
 * Compute the character offset of the start of each line.
 */
function computeLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

const project = new Project({
  useInMemoryFileSystem: false,
  skipAddingFilesFromTsConfig: true,
});
let rewrites = 0;
let skipped = 0;

for (const [filePath, locs] of byFile) {
  const sf = project.addSourceFileAtPath(filePath);

  // Sort locations back-to-front so earlier rewrites don't shift later offsets.
  locs.sort((a, b) => b.line - a.line || b.col - a.col);

  for (const { line, col } of locs) {
    const result = processLocation(sf, line, col);
    if (result === 'rewrote') {
      rewrites++;
    } else if (result === 'skipped') {
      skipped++;
    }
  }
  sf.saveSync();
}

console.log(`rewrites=${rewrites} skipped=${skipped}`);
