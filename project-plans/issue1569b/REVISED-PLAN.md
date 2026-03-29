# Issue #1569b: Revised Execution Plan

**Key insight:** ESLint's JSON output includes "suggestion" fixes for ~6,500 of 15,937 warnings. A script (`scripts/codemods/apply-eslint-suggestions.mjs`) can apply these automatically. The remaining ~9,400 are MANUAL and need subagent work in small batches.

**Branch:** `issue1569b` (2 commits done: Phase 4.0 config + Phase 0 auto-fix)

**Current state:** 15,937 warnings (core: 8,851, cli: 6,832, a2a: 208, vsc: 46)

---

## Strategy: Script-First, Subagent-Second

### Tier 1: Safe Script Fixes (~3,900 warnings)

ESLint suggestions that are purely syntactic — no behavioral change possible.

Apply with:
```bash
node scripts/codemods/apply-eslint-suggestions.mjs <path> --rules <rules>
```

**Safe rules:**
| Rule | Count | What it does |
|------|------:|-------------|
| vitest/prefer-strict-equal | 2,440 | .toEqual() → .toStrictEqual() |
| @typescript-eslint/prefer-nullish-coalescing | 1,047 | `\|\|` → `??` |
| sonarjs/prefer-regexp-exec | 121 | .match() → .exec() |
| sonarjs/no-unused-function-argument | 97 | prefix unused params with _ |
| sonarjs/no-undefined-argument | 63 | remove trailing undefined args |
| @typescript-eslint/prefer-optional-chain | 43 | manual null checks → ?. |
| @typescript-eslint/switch-exhaustiveness-check | 41 | add missing switch cases |
| sonarjs/public-static-readonly | 18 | add public static readonly |
| sonarjs/no-redundant-jump | 15 | remove redundant return/continue |
| sonarjs/unused-import | 8 | remove unused import |
| sonarjs/no-primitive-wrappers | 6 | remove wrapper constructors |
| no-console | 4 | replace/remove console |
| sonarjs/no-redundant-optional | 4 | remove redundant ? |
| sonarjs/prefer-single-boolean-return | 4 | simplify boolean returns |
| sonarjs/no-inverted-boolean-check | 1 | fix inverted check |
| sonarjs/no-redundant-boolean | 1 | remove redundant boolean |
| **Total** | **~3,913** | |

### Tier 2: Risky Script Fixes (~2,600 warnings)

ESLint suggestions that change behavior — must test per-directory batch.

| Rule | Count | Risk |
|------|------:|------|
| @typescript-eslint/strict-boolean-expressions | 1,321 | Changes condition logic; mocks may not match types |
| @typescript-eslint/no-unnecessary-condition | 1,065 | Removes ?. that runtime may need despite types |
| sonarjs/different-types-comparison | 108 | Changes comparison operators |
| sonarjs/no-alphabetical-sort | 99 | Changes sort implementation |
| sonarjs/no-misleading-array-reverse | 23 | Changes array mutation pattern |

**Strategy:** Apply per-directory, run tests after each batch. Revert any batch that fails tests.

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

Apply risky suggestions one directory at a time. Test after each. Revert on failure.

**S2.1** `no-unnecessary-condition` — per subdirectory of core, then cli:
```bash
for dir in providers core tools utils hooks services mcp prompt-config recording storage auth debug scheduler ide lsp policy; do
  echo "=== core/$dir ==="
  node scripts/codemods/apply-eslint-suggestions.mjs packages/core/src/$dir --rules @typescript-eslint/no-unnecessary-condition
  npm run typecheck || { git checkout -- packages/core/src/$dir; echo "REVERTED $dir"; continue; }
  cd packages/core && npx vitest run src/$dir || { cd ..; git checkout -- packages/core/src/$dir; echo "REVERTED $dir (tests)"; continue; }
  cd ..
  echo "=== $dir OK ==="
done
```
Same pattern for cli subdirectories.

**S2.2** `strict-boolean-expressions` — same per-directory pattern.

**S2.3** `different-types-comparison`, `no-alphabetical-sort`, `no-misleading-array-reverse` — apply all at once per package (small counts).

**S2.4** Re-run suggestion script multiple passes (overlaps resolve after first pass):
```bash
# Run 3 passes to catch overlaps that resolve
for i in 1 2 3; do
  node scripts/codemods/apply-eslint-suggestions.mjs packages/core/src --rules <all-safe-and-tested-risky-rules>
  node scripts/codemods/apply-eslint-suggestions.mjs packages/cli/src --rules <all-safe-and-tested-risky-rules>
done
npm run format && npm run typecheck && npm run test
```

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

**M5.1-M5.10 [typescriptexpert]** One directory per subagent call:
- M5.1: packages/cli/src/ui/components/ 
- M5.2: packages/cli/src/ui/containers/ + hooks/
- M5.3: packages/cli/src/config/ + auth/
- M5.4: packages/core/src/providers/openai/
- M5.5: packages/core/src/providers/anthropic/ + rest
- M5.6: packages/core/src/tools/
- M5.7: packages/core/src/core/
- M5.8: packages/core/src/services/ + prompt-config/
- M5.9: packages/core/src/utils/ + recording/ + rest
- M5.10: packages/cli/src/ remaining + a2a + vscode

Each call: extract helper functions, use early returns, simplify conditionals. Run tests after each.

**M5.11 [deepthinker]** Review complexity refactoring for correctness.

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

| Phase | Approach | Warnings | Subagent Calls |
|-------|----------|----------|---------------|
| S1 | Script (safe suggestions) | ~3,913 | 0 |
| S2 | Script (risky, per-directory) | ~2,600 | 0 |
| M1 | Codemod script | ~727 | 1 (write script) |
| M2 | Subagent batches | ~359 | 4 |
| M3 | Subagent batches | ~336 | 4 |
| M4 | Subagent batches | ~500 | 9 |
| M5 | Subagent batches | ~1,400 | 10 |
| M6 | Subagent batches | ~600 | 6 |
| F | Coordinator | 0 | 0 |
| **Total** | | **~10,435** | **~34** |

Note: Numbers are estimates. Some warnings share the same line and will be resolved together. Re-running suggestions after each phase picks up more as overlaps resolve.
