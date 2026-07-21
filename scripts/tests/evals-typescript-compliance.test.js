/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';

const ROOT = resolve(import.meta.dirname, '../..');

/**
 * Dynamically import eslint.config.js as an ESM module and find the config
 * block that applies to evals. This inspects the ACTUAL config object (not the
 * source text), so the assertions are robust against formatting changes and
 * validate the real rule values ESLint will apply.
 *
 * Matches the EXACT expected glob (the evals tree with ts and tsx extensions)
 * rather than a loose substring (`includes('evals')`) so a future block such
 * as `files: ['...evals-helper...']` cannot satisfy the predicate and cause
 * the remaining assertions to validate the wrong rules.
 */
async function loadEvalsEslintBlock() {
  const url = new URL('../../eslint.config.js', import.meta.url);
  const config = (await import(url.href)).default;
  expect(Array.isArray(config), 'eslint.config.js must export an array').toBe(
    true,
  );
  const EXACT_EVALS_GLOB = ['evals' + '/**' + '/*.{ts,tsx}'];
  const block = config.find(
    (entry) =>
      Array.isArray(entry.files) &&
      entry.files.some(
        (pattern) =>
          typeof pattern === 'string' && EXACT_EVALS_GLOB.includes(pattern),
      ),
  );
  expect(block, 'must define an eslint block targeting evals').toBeDefined();
  return block;
}

/**
 * Resolve every `ignores` array from the actual ESLint flat-config blocks.
 * Returns every declared ignore glob so callers can assert none matches
 * evals/**.
 */
async function loadEslintIgnores() {
  const url = new URL('../../eslint.config.js', import.meta.url);
  const config = (await import(url.href)).default;
  expect(Array.isArray(config), 'eslint.config.js must export an array').toBe(
    true,
  );
  /** @type {string[]} */
  const ignores = [];
  for (const entry of config) {
    collectStringIgnores(entry, ignores);
  }
  return ignores;
}

/**
 * Push every string entry from an entry's `ignores` array into `out`. Kept as
 * a separate function so the caller stays under the nested-control-flow limit.
 * @param {unknown} entry
 * @param {string[]} out
 */
function collectStringIgnores(entry, out) {
  if (!(entry && typeof entry === 'object' && Array.isArray(entry.ignores))) {
    return;
  }
  for (const pattern of entry.ignores) {
    if (typeof pattern === 'string') {
      out.push(pattern);
    }
  }
}

/**
 * Check that a rule is set to 'error' (or an array whose first element is
 * 'error'). Handles both the shorthand `['error']` and the config-with-options
 * `['error', {...}]` forms.
 */
function isRuleError(ruleValue) {
  if (ruleValue === 'error') {
    return true;
  }
  return Array.isArray(ruleValue) && ruleValue[0] === 'error';
}

/**
 * Issue #2605 (eval TS static compliance): The eval TypeScript files
 * (evals/*.ts) are real source that the nightly workflow executes via the
 * runtime loader. They were previously excluded from both lint and typecheck,
 * so type regressions and `any` usage went undetected. They must have a strict
 * tsconfig and be covered by the root typecheck invocation, and they must be
 * linted by ESLint (with `@typescript-eslint/no-explicit-any` enforced).
 *
 * These tests validate the CONFIGURATION that opts evals into the root
 * typecheck/lint (the tsconfig shape and the eslint block). They deliberately
 * do NOT re-run tsc/eslint against the source: the root `npm run typecheck`
 * and `npm run lint` invocations already cover evals/*.ts, and duplicating
 * that here would be brittle and slow. The configuration assertions prove the
 * opt-in wiring exists; the root suites prove the source actually passes.
 */
describe('evals: TypeScript static compliance configuration', () => {
  it('ships a strict evals/tsconfig.json', () => {
    const tsconfigPath = join(ROOT, 'evals', 'tsconfig.json');
    expect(existsSync(tsconfigPath), `${tsconfigPath} must exist`).toBe(true);
    const raw = readFileSync(tsconfigPath, 'utf8');
    // Use jsonc-parser (not JSON.parse) because tsconfig.json is a JSONC file:
    // TypeScript itself permits comments and trailing commas in tsconfig.json,
    // and jsonc-parser mirrors that tolerance so the test won't break if a
    // comment is ever added.
    const parsed = parseJsonc(raw);
    // Must extend the strict root config so it inherits strict:true,
    // noImplicitAny, strictNullChecks, etc.
    expect(parsed.extends).toBe('../tsconfig.json');
    // Must be noEmit: evals are run by the runtime loader, never compiled.
    expect(parsed.compilerOptions?.noEmit).toBe(true);
    // Must include the eval source. The include globs match the ESLint
    // evals lint block's `evals/**/*.{ts,tsx}` pattern so type-aware lint
    // rules and the TypeScript program agree on the same file set. TypeScript
    // does not support brace expansion `{ts,tsx}` in tsconfig include, so both
    // extensions are listed explicitly. Including tsx future-proofs the type
    // program even though the eval suite currently uses only .ts files.
    expect(parsed.include).toContain('**/*.ts');
    expect(parsed.include).toContain('**/*.tsx');
  });

  it('evals/tsconfig.json is invoked by the root typecheck script as a real tsc project command', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const typecheck = pkg.scripts?.typecheck;
    expect(
      typeof typecheck,
      'package.json must define a typecheck script',
    ).toBe('string');
    // Assert the script invokes `tsc --project evals/tsconfig.json` (or an
    // equivalent long form) as an ACTUAL command, not merely that the substring
    // appears (which a comment or `echo evals/tsconfig.json` would satisfy).
    // Tokenize on shell separators and prove a tsc invocation carries the
    // evals project as its --project argument. The script may contain multiple
    // tsc invocations (e.g. tsconfig.scripts.json AND evals/tsconfig.json), so
    // scan for any occurrence where tsc is immediately followed by the project
    // flag pointing at the evals tsconfig.
    const tokens = String(typecheck).split(/(?:\s|&&|\|\||;)+/);
    let found = false;
    for (let i = 0; i < tokens.length - 2; i++) {
      if (
        tokens[i] === 'tsc' &&
        (tokens[i + 1] === '--project' || tokens[i + 1] === '-p') &&
        tokens[i + 2] === 'evals/tsconfig.json'
      ) {
        found = true;
        break;
      }
    }
    expect(
      found,
      'typecheck script must invoke tsc --project evals/tsconfig.json as a real command',
    ).toBe(true);
  });

  it('enables type-aware correctness ESLint rules for evals', async () => {
    const block = await loadEvalsEslintBlock();
    const rules = block.rules ?? {};
    // The evals block must enable the type-aware async/promise rules so that
    // floating promises, misused promises, non-awaitable awaits, and missing
    // return-await are caught at lint time.
    expect(isRuleError(rules['@typescript-eslint/no-floating-promises'])).toBe(
      true,
    );
    expect(isRuleError(rules['@typescript-eslint/no-misused-promises'])).toBe(
      true,
    );
    expect(isRuleError(rules['@typescript-eslint/await-thenable'])).toBe(true);
    expect(
      isRuleError(rules['@typescript-eslint/strict-boolean-expressions']),
    ).toBe(true);
    // return-await uses the 'in-try-catch' option.
    const returnAwait = rules['@typescript-eslint/return-await'];
    expect(Array.isArray(returnAwait) && returnAwait[0] === 'error').toBe(true);
  });

  it('eslint.config.js does not globally ignore evals/**', async () => {
    // Inspect the ACTUAL resolved config object's ignores entries rather than
    // scanning raw source text. A global ignore could exclude evals files while
    // evading a source-text regex (e.g. via a RegExp literal or variable
    // reference), so the resolved ignores array is the authoritative check.
    const ignores = await loadEslintIgnores();
    const evalsIgnorePatterns = ignores.filter(
      (pattern) =>
        // Match globs that would blanket-ignore the evals tree: `evals/**`,
        // `evals/**/*.{ts,tsx}`, etc.
        /^evals\/\*\*/.test(pattern) ||
        pattern === 'evals/**' ||
        /^evals\/\*\*\/\*\.\{ts,tsx\}/.test(pattern),
    );
    expect(
      evalsIgnorePatterns,
      `no resolved ignore glob must match evals/**, but found: ${JSON.stringify(evalsIgnorePatterns)}`,
    ).toEqual([]);
  });

  it('targets the evals tsconfig project in the eslint evals block', async () => {
    const block = await loadEvalsEslintBlock();
    const project = block.languageOptions?.parserOptions?.project;
    // The evals lint block must point its parser project at evals/tsconfig.json
    // so the type-aware rules can resolve the type program. Accept both a
    // string and an array containing the string.
    const projects = Array.isArray(project) ? project : [project];
    expect(projects).toContain('evals/tsconfig.json');
  });
});
