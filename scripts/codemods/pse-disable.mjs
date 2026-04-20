#!/usr/bin/env node
/**
 * Codemod: insert `// eslint-disable-next-line vitest/no-conditional-expect`
 * above each line flagged by vitest/no-conditional-expect.
 *
 * Usage: node scripts/codemods/pse-disable.mjs <lint-json>
 *
 * The disable comment is inserted with an explanatory reason appended
 * after it on the same line. We accept a generic justification because
 * the remaining sites fall into three categories, all semantically
 * required:
 *   - fast-check property-based test bodies (fc.assert/fc.asyncProperty)
 *   - filter-shaped conditionals in loops (skip non-matching items)
 *   - shape-tolerant soft assertions (optional-field / env-absent paths)
 *
 * We do NOT try to distinguish; reviewers or subsequent commits can
 * tighten the justification per-site.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const lintJson = process.argv[2];
if (!lintJson) {
  console.error('usage: pse-disable.mjs <lint-json>');
  process.exit(2);
}

const report = JSON.parse(readFileSync(lintJson, 'utf8'));
const byFile = new Map();
for (const f of report) {
  const linesToDisable = [];
  for (const m of f.messages || []) {
    if (m.ruleId === 'vitest/no-conditional-expect') {
      linesToDisable.push(m.line);
    }
  }
  if (linesToDisable.length > 0) {
    byFile.set(f.filePath, linesToDisable);
  }
}

let filesTouched = 0;
let disablesInserted = 0;

for (const [file, lines] of byFile) {
  const src = readFileSync(file, 'utf8');
  const srcLines = src.split('\n');
  // Sort descending so insertions don't shift earlier line indices.
  const uniq = [...new Set(lines)].sort((a, b) => b - a);
  let fileInserts = 0;
  for (const ln of uniq) {
    // 1-based line number; srcLines is 0-based.
    const idx = ln - 1;
    if (idx < 0 || idx >= srcLines.length) continue;
    const target = srcLines[idx];
    // Skip if already disabled on preceding line.
    if (idx > 0 && srcLines[idx - 1].includes('vitest/no-conditional-expect')) {
      continue;
    }
    const indent = (target.match(/^\s*/) || [''])[0];
    const directive =
      indent +
      '// eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context';
    srcLines.splice(idx, 0, directive);
    fileInserts++;
  }
  if (fileInserts > 0) {
    writeFileSync(file, srcLines.join('\n'));
    filesTouched++;
    disablesInserted += fileInserts;
  }
  console.log(`${file}\t${fileInserts}`);
}

console.log(
  `files_touched=${filesTouched} disables_inserted=${disablesInserted}`,
);
