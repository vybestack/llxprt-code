#!/usr/bin/env bun
/**
 * Codemod: insert `// eslint-disable-next-line <rule>` above each line
 * flagged by the given rule.
 *
 * Usage: bun scripts/codemods/pse-disable.ts <lint-json> <rule> [justification]
 *
 * Example:
 *   bun scripts/codemods/pse-disable.ts /tmp/lint.json \
 *     vitest/no-conditional-in-test \
 *     'intentional: narrowing/filter/parameterized-test context'
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

const eslintReportSchema = z.array(
  z.object({
    filePath: z.string(),
    messages: z.array(
      z.object({
        // ESLint sets ruleId to null for parsing/fatal errors.
        ruleId: z.string().nullable(),
        line: z.number(),
      }),
    ),
  }),
);

const [, , lintJson, rule, justArg] = process.argv;
if (!lintJson || !rule) {
  console.error(
    'usage: bun scripts/codemods/pse-disable.ts <lint-json> <rule> [justification]',
  );
  process.exit(2);
}
const justification =
  justArg || 'intentional: narrowing/filter/property-test context';

const report = eslintReportSchema.parse(
  JSON.parse(readFileSync(lintJson, 'utf8')),
);
const byFile = new Map<string, number[]>();
for (const f of report) {
  const linesToDisable: number[] = [];
  for (const m of f.messages || []) {
    if (m.ruleId === rule) {
      linesToDisable.push(m.line);
    }
  }
  if (linesToDisable.length > 0) {
    byFile.set(f.filePath, linesToDisable);
  }
}

/**
 * Check whether the target rule is already disabled on the preceding line.
 */
function isAlreadyDisabled(
  srcLines: string[],
  idx: number,
  rule: string,
): boolean {
  if (idx <= 0) return false;
  const prevLine = srcLines[idx - 1];
  const match = prevLine.match(
    /^\s*\/\/\s*eslint-disable-next-line\s+([^\n]*)/,
  );
  if (!match) return false;
  // Strip justification (everything after " -- ")
  const rulesPart = match[1].split(' -- ')[0];
  const disabledRules = rulesPart
    .split(/[,\s]+/)
    .map((r: string) => r.trim())
    .filter(Boolean);
  return disabledRules.includes(rule);
}

/**
 * Insert a disable directive for a single line if appropriate.
 * Returns the directive string to insert, or null if the line should be skipped.
 */
function buildDirectiveForLine(
  srcLines: string[],
  ln: unknown,
  rule: string,
  justification: string,
): string | null {
  // 1-based line number; srcLines is 0-based.
  const lineNum = typeof ln === 'number' ? ln : Number(ln);
  const idx = lineNum - 1;
  if (idx < 0 || idx >= srcLines.length) return null;
  // Skip if already disabled on preceding line.
  if (isAlreadyDisabled(srcLines, idx, rule)) return null;
  const target = srcLines[idx];
  const indent = (target.match(/^\s*/) || [''])[0];
  return `${indent}// eslint-disable-next-line ${rule} -- ${justification}`;
}

let filesTouched = 0;
let disablesInserted = 0;

for (const [file, lines] of byFile) {
  const src = readFileSync(file, 'utf8');
  const srcLines = src.split('\n');
  // Sort descending so insertions don't shift earlier line indices.
  const uniq = [...new Set(lines)].sort((a: number, b: number) => b - a);
  let fileInserts = 0;
  for (const ln of uniq) {
    const directive = buildDirectiveForLine(srcLines, ln, rule, justification);
    if (!directive) continue;
    const idx = ln - 1;
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
