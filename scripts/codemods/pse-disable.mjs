#!/usr/bin/env node
/**
 * Codemod: insert `// eslint-disable-next-line <rule>` above each line
 * flagged by the given rule.
 *
 * Usage: node scripts/codemods/pse-disable.mjs <lint-json> <rule> [justification]
 *
 * Example:
 *   node scripts/codemods/pse-disable.mjs /tmp/lint.json \
 *     vitest/no-conditional-in-test \
 *     'intentional: narrowing/filter/parameterized-test context'
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , lintJson, rule, justArg] = process.argv;
if (!lintJson || !rule) {
  console.error('usage: pse-disable.mjs <lint-json> <rule> [justification]');
  process.exit(2);
}
const justification =
  justArg || 'intentional: narrowing/filter/property-test context';

const report = JSON.parse(readFileSync(lintJson, 'utf8'));
const byFile = new Map();
for (const f of report) {
  const linesToDisable = [];
  for (const m of f.messages || []) {
    if (m.ruleId === rule) {
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
    // Parse the previous line for an actual eslint-disable-next-line directive
    // and check if the target rule is explicitly listed.
    if (idx > 0) {
      const prevLine = srcLines[idx - 1];
      const match = prevLine.match(
        /^\s*\/\/\s*eslint-disable-next-line\s+([^\n]*)/,
      );
      if (match) {
        const disabledRules = match[1]
          .split(/[,\s]+/)
          .map((r) => r.trim())
          .filter(Boolean);
        if (disabledRules.includes(rule)) {
          continue;
        }
      }
    }
    const indent = (target.match(/^\s*/) || [''])[0];
    const directive = `${indent}// eslint-disable-next-line ${rule} -- ${justification}`;
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
