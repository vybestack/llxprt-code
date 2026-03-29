#!/usr/bin/env node
/**
 * Apply ESLint "suggestion" fixes for specified rules.
 *
 * Usage:
 *   node scripts/codemods/apply-eslint-suggestions.mjs <glob> [--rules rule1,rule2,...] [--dry-run]
 *
 * Examples:
 *   # Apply all suggestion-fixable warnings in core/src/providers
 *   node scripts/codemods/apply-eslint-suggestions.mjs packages/core/src/providers/
 *
 *   # Apply only specific rules
 *   node scripts/codemods/apply-eslint-suggestions.mjs packages/core/src/ \
 *     --rules @typescript-eslint/no-unnecessary-condition,@typescript-eslint/prefer-nullish-coalescing
 *
 *   # Dry run — show what would be changed
 *   node scripts/codemods/apply-eslint-suggestions.mjs packages/core/src/ --dry-run
 *
 * How it works:
 *   1. Runs ESLint with JSON output on the target path
 *   2. Collects all warnings that have "suggestions" (not auto-fixable, but ESLint knows how to fix)
 *   3. Applies the first suggestion for each warning, processing files one at a time
 *   4. Applies fixes in reverse-offset order to avoid shifting positions
 *
 * Safe rules (suggestions are always correct):
 *   - @typescript-eslint/no-unnecessary-condition (remove unnecessary ?. or conditions)
 *   - @typescript-eslint/prefer-nullish-coalescing (|| → ??)
 *   - @typescript-eslint/prefer-optional-chain (manual checks → ?.)
 *   - @typescript-eslint/strict-boolean-expressions (add explicit checks)
 *   - @typescript-eslint/switch-exhaustiveness-check (add missing cases)
 *   - vitest/prefer-strict-equal (toEqual → toStrictEqual)
 *   - sonarjs/no-unused-function-argument (prefix with _)
 *   - sonarjs/different-types-comparison (fix type coercion)
 *   - sonarjs/no-alphabetical-sort (fix sort)
 *   - sonarjs/prefer-regexp-exec (match → exec)
 *   - sonarjs/no-undefined-argument (remove trailing undefined)
 *   - sonarjs/public-static-readonly (add modifiers)
 *   - sonarjs/no-misleading-array-reverse (fix array reverse)
 *   - sonarjs/no-primitive-wrappers (remove wrapper)
 *   - sonarjs/no-redundant-jump (remove redundant return/continue)
 *   - sonarjs/no-redundant-optional (remove redundant optional)
 *   - sonarjs/prefer-single-boolean-return (simplify return)
 *   - sonarjs/unused-import (remove unused import)
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const rulesIdx = args.indexOf('--rules');
const allowedRules =
  rulesIdx >= 0 ? new Set(args[rulesIdx + 1].split(',')) : null;
const skipArgs = new Set(['--dry-run', '--rules']);
if (rulesIdx >= 0) skipArgs.add(args[rulesIdx + 1]);
const target = args.find((a) => !skipArgs.has(a));

if (!target) {
  console.error(
    'Usage: node apply-eslint-suggestions.mjs <path> [--rules r1,r2] [--dry-run]',
  );
  process.exit(1);
}

// Run ESLint with JSON output
console.log(`Running ESLint on ${target}...`);
let jsonStr;
try {
  jsonStr = execSync(
    `NODE_OPTIONS=--max-old-space-size=12288 npx eslint ${target} --no-error-on-unmatched-pattern -f json`,
    { encoding: 'utf8', maxBuffer: 500 * 1024 * 1024, timeout: 600_000 },
  );
} catch (e) {
  // ESLint exits non-zero when there are issues, but still outputs JSON
  jsonStr = e.stdout;
}

const results = JSON.parse(jsonStr);

// Collect suggestions by file
const fileFixMap = new Map(); // filePath → [{range, text, rule, line}]
let totalSuggestions = 0;

for (const fileResult of results) {
  const fixes = [];
  for (const msg of fileResult.messages) {
    if (msg.severity !== 1) continue; // only warnings
    if (!msg.suggestions?.length) continue;
    if (allowedRules && !allowedRules.has(msg.ruleId)) continue;

    const suggestion = msg.suggestions[0]; // take the first suggestion
    fixes.push({
      range: suggestion.fix.range,
      text: suggestion.fix.text,
      rule: msg.ruleId,
      line: msg.line,
      desc: suggestion.desc,
    });
    totalSuggestions++;
  }

  if (fixes.length > 0) {
    fileFixMap.set(fileResult.filePath, fixes);
  }
}

console.log(
  `Found ${totalSuggestions} suggestion-fixable warnings across ${fileFixMap.size} files`,
);

if (dryRun) {
  for (const [filePath, fixes] of fileFixMap) {
    console.log(`\n${filePath}: ${fixes.length} fixes`);
    for (const fix of fixes.slice(0, 5)) {
      console.log(`  L${fix.line} [${fix.rule}] ${fix.desc}`);
    }
    if (fixes.length > 5) console.log(`  ... and ${fixes.length - 5} more`);
  }
  process.exit(0);
}

// Apply fixes file by file
let filesModified = 0;
let fixesApplied = 0;

for (const [filePath, fixes] of fileFixMap) {
  const content = readFileSync(filePath, 'utf8');

  // Sort fixes by range start descending so we apply from end to start
  // This prevents position shifts from affecting subsequent fixes
  fixes.sort((a, b) => b.range[0] - a.range[0]);

  // Check for overlapping ranges and skip overlaps
  const nonOverlapping = [];
  let minStart = Infinity;
  for (const fix of fixes) {
    if (fix.range[1] <= minStart) {
      nonOverlapping.push(fix);
      minStart = fix.range[0];
    }
    // else: overlaps with a later fix, skip
  }

  let result = content;
  for (const fix of nonOverlapping) {
    result =
      result.substring(0, fix.range[0]) +
      fix.text +
      result.substring(fix.range[1]);
  }

  if (result !== content) {
    writeFileSync(filePath, result, 'utf8');
    filesModified++;
    fixesApplied += nonOverlapping.length;
    if (nonOverlapping.length !== fixes.length) {
      console.log(
        `${filePath}: ${nonOverlapping.length}/${fixes.length} fixes (${fixes.length - nonOverlapping.length} overlaps skipped)`,
      );
    }
  }
}

console.log(
  `\nDone: ${fixesApplied} fixes applied across ${filesModified} files`,
);
if (totalSuggestions - fixesApplied > 0) {
  console.log(
    `${totalSuggestions - fixesApplied} suggestions skipped (overlaps)`,
  );
  console.log(
    'Re-run to pick up remaining fixes after position shifts resolve.',
  );
}
