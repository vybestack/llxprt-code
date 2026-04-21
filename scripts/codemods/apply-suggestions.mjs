#!/usr/bin/env node
/**
 * Apply ESLint suggestion fixes (not autofix) for a given rule.
 * Usage:
 *   node scripts/codemods/apply-suggestions.mjs <ruleId> <file...>
 *
 * Some rules (e.g. @typescript-eslint/prefer-optional-chain) only provide
 * suggestions, not auto-fixes. This script loads each file, asks ESLint for
 * messages, and applies the first suggestion per message that targets the
 * requested rule. Iterates per file until no messages remain.
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

let total = 0;
for (const file of files) {
  let iterations = 0;
  while (iterations++ < 20) {
    const results = await eslint.lintFiles([file]);
    const r = results[0];
    const msgs = (r.messages || []).filter(
      (m) => m.ruleId === ruleId && m.suggestions?.length,
    );
    if (msgs.length === 0) break;
    // Apply from bottom to top to keep offsets stable
    msgs.sort((a, b) => b.line - a.line || b.column - a.column);
    let text = readFileSync(file, 'utf8');
    for (const m of msgs) {
      const suggestion = m.suggestions[0];
      const { range, text: replacement } = suggestion.fix;
      text = text.slice(0, range[0]) + replacement + text.slice(range[1]);
    }
    writeFileSync(file, text);
    total += msgs.length;
    console.log(
      `[${file}] applied ${msgs.length} suggestions (iter ${iterations})`,
    );
  }
}
console.log(`total suggestions applied: ${total}`);
