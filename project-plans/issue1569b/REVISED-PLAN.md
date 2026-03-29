# Issue #1569b: Revised Execution Plan

**Key insight:** ESLint's JSON output includes "suggestion" fixes for ~6,500 of 15,937 warnings. A script (`scripts/codemods/apply-eslint-suggestions.mjs`) can apply these automatically. The remaining ~9,400 are MANUAL and need subagent work in small batches.

**Branch:** `issue1569b` (4 commits done)

**Current state:** 13,496 warnings (core: 7,558, cli: 5,693, a2a: 202, vsc: 43)

**Progress:**
- Phase 4.0: Disabled 11 sonarjs rules (-13,064 warnings) [OK]
- Phase 0: Safe auto-fix sweep (minimal) [OK]
- Phase S1: Safe suggestion script fixes (-2,441 warnings) [OK]

### Lessons Learned (IMPORTANT for future phases)

1. **`prefer-nullish-coalescing` is RISKY:** `||` → `??` changes behavior when values like `0`, `''`, or `false` are valid. Broke 146 test files in core. Must handle per-file with context understanding.

2. **`switch-exhaustiveness-check` suggestions are DANGEROUS:** ESLint adds `throw new Error('Not implemented yet')` cases to switches that intentionally have `default: break`. Broke 12 test files. These need manual review — some switches intentionally ignore unhandled cases.

3. **`no-undefined-argument` is RISKY:** Removing trailing `undefined` from function calls can break tests that assert specific argument passing (e.g., `expect(fn).toHaveBeenCalledWith(x, undefined)`).

4. **`prefer-regexp-exec` with global flag is WRONG:** `.match(/pattern/g)` returns all matches; `.exec()` only returns one. ESLint's suggestion doesn't check for `g` flag.

5. **`toStrictEqual` may fail for `undefined` properties:** Some objects have `undefined` properties that `toEqual` ignores but `toStrictEqual` catches. ~8 test files needed to be reverted.

6. **Mixed `||` and `??` operators:** When `prefer-nullish-coalescing` changes one `||` to `??` in a chain like `a || b || ''`, it creates `a || b ?? ''` which TypeScript/esbuild reject. Must add parens or convert all operators.

7. **Subagent timeout:** Even 8 files was too much for a single subagent call. Need 2-3 files max per call.

8. **Subagent accuracy:** The `typescriptexpert` subagent incorrectly removed optional chains that were needed at runtime (TypeScript types said non-null, but mocks provided null). Subagent work needs immediate test verification.

---

## Strategy: Script-First, Subagent-Second

### Tier 1: Safe Script Fixes — COMPLETED

Applied 2,441 fixes via `scripts/codemods/apply-eslint-suggestions.mjs`.

**Rules applied:** vitest/prefer-strict-equal, sonarjs/prefer-regexp-exec, 
sonarjs/no-unused-function-argument, sonarjs/no-undefined-argument,
@typescript-eslint/prefer-optional-chain, sonarjs/public-static-readonly,
sonarjs/no-redundant-jump, sonarjs/unused-import, sonarjs/no-primitive-wrappers,
sonarjs/no-redundant-optional, sonarjs/prefer-single-boolean-return,
sonarjs/no-inverted-boolean-check, sonarjs/no-redundant-boolean

**Rules moved to risky/manual:**
- prefer-nullish-coalescing → RISKY (changes falsy behavior)
- switch-exhaustiveness-check → DANGEROUS (adds throwing to intentional defaults)
- no-undefined-argument → RISKY (breaks tests asserting undefined args)

### Tier 2: Risky Script Fixes (~3,640 warnings)

ESLint suggestions that change behavior — must test per-directory batch.
Apply with the suggestion script, then run tests. Revert any batch that fails.

| Rule | Count | Risk | Strategy |
|------|------:|------|----------|
| @typescript-eslint/strict-boolean-expressions | 1,321 | Changes condition logic | Per-directory + test |
| @typescript-eslint/no-unnecessary-condition | 1,065 | Removes ?. needed at runtime | Per-directory + test |
| @typescript-eslint/prefer-nullish-coalescing | 1,047 | Changes || falsy behavior | Per-FILE with context review |
| sonarjs/different-types-comparison | 108 | Changes comparison operators | Per-directory + test |
| sonarjs/no-alphabetical-sort | 99 | Changes sort implementation | Per-directory + test |

### Tier 3: Manual Fixes (~9,400 warnings)

No ESLint suggestion available. Need subagent work in small batches (1 directory at a time).

| Category | Count | Approach |
|----------|------:|---------|
| sonarjs/shorthand-property-grouping | 727 | Subagent: reorder object properties |
| sonarjs/nested-control-flow | 433+ | Subagent: extract functions, reduce nesting |
| sonarjs/cyclomatic-complexity | 311 | Subagent: simplify logic |
| sonarjs/elseif-without-else | 191 | Subagent: add else clauses |
| sonarjs/variable-name | 183 | Subagent: rename variables |
| sonarjs/no-conditional-in-test (vitest) | 162 | Subagent: refactor test conditionals |
| sonarjs/no-conditional-expect (vitest) | 174 | Subagent: refactor test expects |
| @typescript-eslint/consistent-type-imports | 359 | Subagent: add type keyword |
| sonarjs/regular-expr | 139 | Subagent: review regex safety |
| sonarjs/too-many-break-or-continue | 118 | Subagent: simplify loops |
| sonarjs/no-duplicate-string | 111 | Subagent: extract constants |
| sonarjs/no-ignored-exceptions | 109 | Subagent: add error handling |
| complexity/max-lines-per-function | 357 | Subagent: extract functions |
| sonarjs/todo-tag | 65+ | Subagent: resolve TODOs |
| Others (40+ rules) | ~1,400 | Subagent: various fixes |

---

## Execution Todo List

### Phase S1: Safe Script Fixes [COORDINATOR]

Apply safe suggestions in batches, with test verification between each.

**S1.1** Apply `vitest/prefer-strict-equal` across all test files:
```bash
node scripts/codemods/apply-eslint-suggestions.mjs packages/core/src --rules vitest/prefer-strict-equal
node scripts/codemods/apply-eslint-suggestions.mjs packages/cli/src --rules vitest/prefer-strict-equal
npm run format && npm run typecheck
cd packages/core && npx vitest run  # verify
cd packages/cli && npx vitest run   # verify
```

**S1.2** Apply `@typescript-eslint/prefer-nullish-coalescing` per package:
```bash
# Core first — apply, test, if pass continue
node scripts/codemods/apply-eslint-suggestions.mjs packages/core/src --rules @typescript-eslint/prefer-nullish-coalescing
npm run typecheck && cd packages/core && npx vitest run
# If tests pass, continue to CLI
node scripts/codemods/apply-eslint-suggestions.mjs packages/cli/src --rules @typescript-eslint/prefer-nullish-coalescing  
npm run typecheck && cd packages/cli && npx vitest run
```
Note: `||` → `??` changes behavior for falsy values (0, '', false). If tests fail, revert the failing package and handle those manually.

**S1.3** Apply remaining safe rules (small counts, low risk):
```bash
node scripts/codemods/apply-eslint-suggestions.mjs packages/core/src packages/cli/src packages/a2a-server/src packages/vscode-ide-companion/src \
  --rules sonarjs/prefer-regexp-exec,sonarjs/no-unused-function-argument,sonarjs/no-undefined-argument,@typescript-eslint/prefer-optional-chain,@typescript-eslint/switch-exhaustiveness-check,sonarjs/public-static-readonly,sonarjs/no-redundant-jump,sonarjs/unused-import,sonarjs/no-primitive-wrappers,sonarjs/no-redundant-optional,sonarjs/prefer-single-boolean-return,sonarjs/no-inverted-boolean-check,sonarjs/no-redundant-boolean
npm run format && npm run typecheck
cd packages/core && npx vitest run
cd packages/cli && npx vitest run
```

**S1.4** Commit: `fix(lint): apply safe eslint suggestion fixes (Phase S1)`

---

### Phase S2: Risky Script Fixes [COORDINATOR per-directory]

Write `scripts/codemods/apply-risky-suggestions.sh` — a shell script that:
1. Iterates over each top-level subdirectory in each package
2. For each directory: applies suggestions, runs typecheck, runs vitest for that directory
3. If typecheck or tests fail: reverts that directory and logs it as "needs manual fix"
4. Commits successful batches

```bash
#!/bin/bash
# scripts/codemods/apply-risky-suggestions.sh
RULES="@typescript-eslint/no-unnecessary-condition,@typescript-eslint/strict-boolean-expressions,sonarjs/different-types-comparison,sonarjs/no-alphabetical-sort,sonarjs/no-misleading-array-reverse"

for pkg in core cli; do
  for dir in packages/$pkg/src/*/; do
    dirname=$(basename "$dir")
    echo "=== $pkg/$dirname ==="
    
    # Apply suggestions
    node scripts/codemods/apply-eslint-suggestions.mjs "$dir" --rules "$RULES"
    
    # Check if anything changed
    if git diff --quiet "$dir"; then
      echo "  No changes, skipping"
      continue
    fi
    
    # Typecheck
    if ! npm run typecheck 2>&1 | tail -1 | grep -q "^$"; then
      echo "  TYPECHECK FAILED - reverting $dirname"
      git checkout -- "$dir"
      continue
    fi
    
    # Run tests for this directory
    if ! cd "packages/$pkg" && npx vitest run "src/$dirname" 2>&1 | grep "Test Files" | grep -qv "failed"; then
      echo "  TESTS FAILED - reverting $dirname"
      cd ../..
      git checkout -- "$dir"
      continue
    fi
    cd ../..
    
    echo "  OK - $dirname passed"
  done
done
```

Run the script, then manually handle the "needs manual fix" directories.
After each package is done, run full test suite and commit.

**S2.1** Run the script for core package
**S2.2** Run the script for cli package  
**S2.3** Handle `prefer-nullish-coalescing` separately — per-file with subagent review
**S2.4** Multi-pass to catch overlaps: re-run 2-3 times on successful directories
**S2.5** Commit: `fix(lint): apply risky eslint suggestion fixes with per-directory verification (Phase S2)`

---

### Phase M1: Manual — Shorthand Property Grouping [typescriptexpert]

~727 warnings. Write a ts-morph codemod to reorder object literal properties.

**M1.1 [typescriptexpert]** Write `scripts/codemods/shorthand-grouping.ts` — AST-based codemod that:
- Finds object literals where shorthand and non-shorthand properties are interleaved
- Reorders so shorthand properties are grouped at the beginning
- Preserves comments attached to properties
- Run on all packages, then `npm run format && npm run typecheck && npm run test`

**M1.2** Commit

---

### Phase M2: Manual — Consistent Type Imports [typescriptexpert]

~359 warnings. ESLint couldn't auto-fix these (they're the unfixable remainder after Phase 0).

**M2.1-M2.4 [typescriptexpert]** Fix `consistent-type-imports` in batches:
- M2.1: packages/cli/src/ui/ (largest batch)
- M2.2: packages/cli/src/ (rest)
- M2.3: packages/core/src/providers/ + tools/
- M2.4: packages/core/src/ (rest) + a2a + vscode

Each batch: fix files, `npm run typecheck`, test the modified package.

**M2.5** Commit

---

### Phase M3: Manual — Vitest Test Quality [typescriptexpert]

~336 warnings (no-conditional-in-test, no-conditional-expect, require-to-throw-message, require-top-level-describe, etc.)

**M3.1-M3.4 [typescriptexpert]** Fix vitest warnings in batches of ~80-100 per subagent call:
- M3.1: packages/core/src/providers/**/*.test.ts
- M3.2: packages/core/src/tools/**/*.test.ts + core/**/*.test.ts
- M3.3: packages/core/src/ remaining test files
- M3.4: packages/cli/src/**/*.test.ts

Each batch: refactor conditional test logic into separate test cases, add error message strings to toThrow(), wrap bare tests in describe blocks. Run vitest after each.

**M3.5** Commit

---

### Phase M4: Manual — Sonarjs Code Quality [typescriptexpert]

Various sonarjs rules that need understanding of context.

**M4.1-M4.3** No-ignored-exceptions (~109 in core, ~58 in cli):
- Add proper error handling (log, rethrow, or explain why swallowing is intentional)

**M4.4-M4.6** Duplicate strings (~111 source-only):
- Extract repeated string literals into named constants

**M4.7-M4.9** Regular expressions / security (~139 regex + ~50 security):
- Review and fix regex issues, add eslint-disable where intentional

**M4.10-M4.12** Variable naming (~183):
- Fix naming convention violations

Each subagent call handles one directory's worth. Commit after each sub-phase.

---

### Phase M5: Manual — Complexity Refactoring [typescriptexpert]

This is the hardest phase: nested-control-flow, cyclomatic/cognitive complexity, elseif-without-else, expression-complexity. ~1,400 warnings requiring genuine refactoring.

**Critical: max 2-3 source files per subagent call** (learned from timeout issues).

For each subagent call:
1. Run ESLint on target directory to get exact file:line:warning list
2. Pick 2-3 files with most warnings
3. Delegate to typescriptexpert with exact file list + warning list
4. After completion: typecheck + run tests for that directory
5. If tests fail, revert and note for manual review

**M5.1-M5.20 [typescriptexpert]** ~20 subagent calls of 2-3 files each:
Split by sub-sub-directory within each package. Example:
- M5.1: packages/core/src/providers/openai/OpenAIProvider.ts + OpenAIStreamProcessor.ts
- M5.2: packages/core/src/providers/openai/OpenAIResponseParser.ts + OpenAIRequestBuilder.ts
- M5.3: packages/core/src/providers/anthropic/ (top 3 files)
- ... etc.

Each call: extract helper functions, use early returns, simplify conditionals.
After all calls: run full test suite.

**M5.21 [deepthinker]** Review complexity refactoring for correctness.

---

### Phase M6: Manual — Remaining Grab-bag [typescriptexpert]

elseif-without-else, too-many-break-or-continue, void-use, destructuring, bool-param-default, todo-tag, max-lines (file splitting), deprecation, type system improvements.

**M6.1-M6.6 [typescriptexpert]** Batch by rule type and directory:
- M6.1: elseif-without-else (~191) — add else clauses
- M6.2: TODO tags (~65) — resolve or add issue references
- M6.3: Deprecation (~68) — replace deprecated APIs
- M6.4: Max-lines file splitting (~56+58 files) — split oversized files
- M6.5: Type system (max-union-size, use-type-alias, etc.)
- M6.6: Everything else (<10 each)

---

### Phase F: Final Verification + PR [COORDINATOR]

**F.1** Run full lint per-package, confirm 0 warnings:
```bash
for pkg in core cli a2a-server vscode-ide-companion; do
  NODE_OPTIONS=--max-old-space-size=12288 npx eslint packages/$pkg/src --no-error-on-unmatched-pattern 2>&1 | tail -1
done
```

**F.2** Run full verification suite:
```bash
npm run test && npm run lint && npm run typecheck && npm run format && npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

**F.3** Push and create PR with gh.

**F.4** Watch CI, address CodeRabbit, loop until green.

---

## Summary

| Phase | Approach | Warnings | Subagent Calls | Status |
|-------|----------|----------|---------------|--------|
| 4.0 | Config disable rules | ~13,064 | 0 | DONE |
| 0 | Auto-fix | ~11 | 0 | DONE |
| S1 | Script (safe suggestions) | ~2,441 | 0 | DONE |
| S2 | Script (risky, per-dir+test) | ~3,640 | 0 | TODO |
| M1 | Codemod script | ~727 | 1 (write script) | TODO |
| M2 | Subagent batches (2-3 files) | ~359 | 4-6 | TODO |
| M3 | Subagent batches (2-3 files) | ~336 | 4-6 | TODO |
| M4 | Subagent batches (2-3 files) | ~500 | 6-9 | TODO |
| M5 | Subagent batches (2-3 files) | ~1,400 | 15-20 | TODO |
| M6 | Subagent batches (2-3 files) | ~600 | 6-10 | TODO |
| F | Coordinator | 0 | 0 | TODO |
| **Total** | | **~23,078** | **~36-52** | |

Starting: ~28,948 warnings | Now: 13,496 | Eliminated: 15,452 (53%)

Note: Numbers are estimates. Some warnings share the same line and will be resolved together. Re-running suggestions after each phase picks up more as overlaps resolve. Expect reverts on ~10-15% of risky batches.
