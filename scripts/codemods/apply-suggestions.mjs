#!/usr/bin/env node
/**
 * Apply ESLint suggestion fixes (not autofix) for a given rule.
 * Usage:
 *   node scripts/codemods/apply-suggestions.mjs <ruleId> <file...>
 *
 * Some rules (e.g. @typescript-eslint/prefer-optional-chain,
 * @typescript-eslint/prefer-nullish-coalescing) only provide suggestions,
 * not auto-fixes. This script loads each file, asks ESLint for messages,
 * applies the first suggestion per message that targets the requested rule
 * (bottom-to-top, skipping overlapping ranges), and re-lints until stable.
 *
 * Overlap-skipping is important because chained binary expressions such as
 *   a || b || c || d
 * produce nested suggestion fixes whose ranges contain each other; naively
 * applying all of them in one pass corrupts the source. Skipping overlaps
 * and relying on the next iteration after re-lint produces correct chains.
 */
import { ESLint } from 'eslint';
import { readFileSync, writeFileSync } from 'node:fs';

const [, , ruleId, ...files] = process.argv;
if (!ruleId || files.length === 0) {
  console.error('usage: apply-suggestions.mjs <ruleId> <file...>');
  process.exit(2);
}

const eslint = new ESLint({
  overrideConfig: {},
});

const ITERATION_CAP = 300;

/**
 * Applies one suggestion-fix iteration for `ruleId` in `file`.
 * Returns true if a suggestion was applied (caller should continue iterating),
 * or false if there are no more suggestions to apply.
 */
async function applyOneSuggestionIteration(eslint, file, ruleId, iteration) {
  const results = await eslint.lintFiles([file]);
  const r = results[0];
  const msgs = (r.messages || []).filter(
    (m) => m.ruleId === ruleId && m.suggestions?.length,
  );
  if (msgs.length === 0) {
    return false;
  }
  if (iteration === ITERATION_CAP) {
    console.warn(
      `[${file}] WARNING: hit ${ITERATION_CAP}-iteration cap with ${msgs.length} ${ruleId} messages still pending; file may be only partially transformed. Re-run the codemod on this file alone to continue.`,
    );
    return false;
  }
  // Apply only the single suggestion with the highest start offset in
  // this pass. Two ESLint suggestions from this rule on chained
  // expressions (a || b || c) frequently overlap via shared tokens, and
  // any attempt to apply more than one per pass — even with overlap
  // skipping on original ranges — has produced corrupted output in
  // practice. Re-linting after each single application yields a fresh
  // set of non-conflicting suggestions.
  msgs.sort(
    (a, b) => b.suggestions[0].fix.range[0] - a.suggestions[0].fix.range[0],
  );
  const m = msgs[0];
  const { range, text: replacement } = m.suggestions[0].fix;
  const [start, end] = range;
  const src = readFileSync(file, 'utf8');
  const next = src.slice(0, start) + replacement + src.slice(end);
  writeFileSync(file, next);
  if (iteration % 10 === 1 || msgs.length <= 1) {
    console.log(`[${file}] iter ${iteration}, applied 1/${msgs.length}`);
  }
  return true;
}

let total = 0;
for (const file of files) {
  let iterations = 0;
  let applied = true;
  while (applied && iterations++ < ITERATION_CAP) {
    applied = await applyOneSuggestionIteration(
      eslint,
      file,
      ruleId,
      iterations,
    );
    if (applied) {
      total += 1;
    }
  }
}
console.log(`total suggestions applied: ${total}`);
