# Issue #1569b: Resolve All ESLint Warnings Before Package Extraction

## Execution Playbook

**To start:** Tell the coordinator "execute the issue1569b plan" and it will run
start-to-finish using the todo list below. No further input needed unless a decision
point is hit.

**Branch:** `issue1569b` (already created from main)

**Subagent pattern:** `typescriptexpert` implements, `deepthinker` verifies after each
phase. Coordinator runs shell commands (auto-fix, lint, commit) directly.

**Lint command (avoids OOM):** Must lint per-package:
```bash
NODE_OPTIONS=--max-old-space-size=12288 npx eslint packages/core/src --no-error-on-unmatched-pattern 2>&1 | tail -1
NODE_OPTIONS=--max-old-space-size=12288 npx eslint packages/cli/src --no-error-on-unmatched-pattern 2>&1 | tail -1
NODE_OPTIONS=--max-old-space-size=12288 npx eslint packages/a2a-server/src --no-error-on-unmatched-pattern 2>&1 | tail -1
NODE_OPTIONS=--max-old-space-size=12288 npx eslint packages/vscode-ide-companion/src --no-error-on-unmatched-pattern 2>&1 | tail -1
```

**Full verification suite (run between phases):**
```bash
npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

**Commit pattern:** One commit per phase. Single PR at the end with all commits.

---

## Linear Todo List

Each item is one todo. Execute strictly in order. Items marked `[COORDINATOR]` are
shell commands run directly. Items marked `[typescriptexpert]` or `[deepthinker]` are
subagent delegations.

---

### Phase 0: Auto-fix Sweep

**T01 [COORDINATOR]** Run auto-fix for 100%-fixable rules across all packages:
```bash
NODE_OPTIONS=--max-old-space-size=12288 npx eslint packages/core/src packages/cli/src packages/a2a-server/src packages/vscode-ide-companion/src --fix --rule '{"vitest/prefer-strict-equal":"warn","@typescript-eslint/prefer-nullish-coalescing":"warn"}' --no-error-on-unmatched-pattern
```
Then run auto-fix for partially-fixable rules one at a time:
```bash
NODE_OPTIONS=--max-old-space-size=12288 npx eslint packages/core/src packages/cli/src packages/a2a-server/src packages/vscode-ide-companion/src --fix --rule '{"@typescript-eslint/consistent-type-imports":"warn"}' --no-error-on-unmatched-pattern
NODE_OPTIONS=--max-old-space-size=12288 npx eslint packages/core/src packages/cli/src packages/a2a-server/src packages/vscode-ide-companion/src --fix --rule '{"@typescript-eslint/strict-boolean-expressions":"warn"}' --no-error-on-unmatched-pattern
NODE_OPTIONS=--max-old-space-size=12288 npx eslint packages/core/src packages/cli/src packages/a2a-server/src packages/vscode-ide-companion/src --fix --rule '{"@typescript-eslint/no-unnecessary-condition":"warn"}' --no-error-on-unmatched-pattern
```
Run `npm run format` after. Run `npm run test` to catch breakage. Count remaining warnings.
Commit: `fix(lint): auto-fix eslint warnings (Phase 0)`

---

### Phase 1: Manual TypeScript Strictness

After Phase 0 auto-fix, ~2,200 warnings remain for these rules:
- `@typescript-eslint/strict-boolean-expressions`
- `@typescript-eslint/no-unnecessary-condition`
- `@typescript-eslint/no-misused-promises`
- `@typescript-eslint/switch-exhaustiveness-check`
- `@typescript-eslint/consistent-type-imports` (unfixable remainder)
- `@typescript-eslint/prefer-nullish-coalescing` (unfixable remainder)
- `@typescript-eslint/prefer-optional-chain`

Split into subagent tasks by sub-package. Before each task, run per-package lint
to get the EXACT current file list and warning count for that scope.

**T02 [typescriptexpert]** Fix all remaining `@typescript-eslint/*` warnings in
`packages/cli/src/ui/` (~600 warnings). Rules: strict-boolean-expressions,
no-unnecessary-condition, no-misused-promises, switch-exhaustiveness-check,
prefer-optional-chain. For each file: read it, understand the context, fix the
warning correctly (add null checks, add `?? undefined`, add `void`, add missing
switch cases, etc.). Run `npm run test` and `npm run typecheck` when done.

**T03 [typescriptexpert]** Same as T02 for `packages/core/src/providers/` (~400 warnings).

**T04 [typescriptexpert]** Same for `packages/core/src/tools/` (~250 warnings).

**T05 [typescriptexpert]** Same for `packages/core/src/core/` (~220 warnings).

**T06 [typescriptexpert]** Same for `packages/cli/src/config/` + `packages/cli/src/auth/`
(~205 warnings combined).

**T07 [typescriptexpert]** Same for `packages/core/src/utils/` + `packages/core/src/hooks/`
+ `packages/core/src/services/` (~190 warnings combined).

**T08 [typescriptexpert]** Same for ALL remaining directories in packages/core/src/ not
covered above (~250 warnings — mcp/, prompt-config/, recording/, storage/, auth/,
debug/, scheduler/, ide/, lsp/, policy/).

**T09 [typescriptexpert]** Same for ALL remaining directories in packages/cli/src/ not
covered above + packages/a2a-server/ + packages/vscode-ide-companion/ (~85 warnings).

**T10 [COORDINATOR]** Run full verification suite. Count remaining TS warnings (should be 0).
Commit: `fix(lint): resolve typescript strictness warnings (Phase 1)`

**T11 [deepthinker]** Review Phase 0+1 changes. Read `git diff HEAD~2 --stat` to see scope.
Spot-check: are null checks correct? Are `void` annotations on fire-and-forget promises
correct? Are switch exhaustiveness fixes using `satisfies never` pattern? Are type imports
correct? Flag anything that changes runtime behavior incorrectly.

---

### Phase 2: Complexity, Style, Import, ESLint-comments

Rules: `complexity`, `max-lines-per-function`, `max-lines`, `no-else-return`,
`no-lonely-if`, `no-unneeded-ternary`, `import/*`, `eslint-comments/*`, `no-console`.

**T12 [typescriptexpert]** Fix all complexity/style/import warnings in
`packages/cli/src/ui/` (~387 warnings). For complexity/max-lines-per-function:
extract helper functions, use early returns, simplify conditionals. For style rules:
apply the fix (remove else-after-return, merge lonely-if, simplify ternary). For
import rules: fix import ordering/duplicates. For no-console: replace with
debugLogger or remove. Run `npm run test` when done.

**T13 [typescriptexpert]** Same for `packages/core/src/tools/` + `packages/core/src/providers/`
(~228 warnings combined).

**T14 [typescriptexpert]** Same for `packages/cli/src/auth/` + `packages/cli/src/config/`
+ `packages/cli/src/utils/` (~150 warnings combined).

**T15 [typescriptexpert]** Same for ALL remaining directories (~435 warnings).

**T16 [COORDINATOR]** Run full verification suite. Count remaining warnings.
Commit: `fix(lint): resolve complexity/style/import warnings (Phase 2)`

---

### Phase 3: Vitest Test Quality

Rules: `vitest/no-conditional-in-test`, `vitest/no-conditional-expect`,
`vitest/require-to-throw-message`, `vitest/require-top-level-describe`,
`vitest/max-nested-describe`, `vitest/expect-expect`.

**T17 [typescriptexpert]** Fix all vitest warnings in `packages/cli/src/**/*.test.{ts,tsx}`
(~400 warnings). For no-conditional-in-test/no-conditional-expect: refactor
conditional logic into separate test cases or use test.each. For
require-to-throw-message: add expected error message strings. For
require-top-level-describe: wrap bare tests in describe blocks. For
max-nested-describe: flatten nested describes. Run `npm run test` when done.

**T18 [typescriptexpert]** Same for `packages/core/src/**/*.test.{ts,tsx}` (~400 warnings).

**T19 [COORDINATOR]** Run full verification suite.
Commit: `fix(lint): resolve vitest test quality warnings (Phase 3)`

**T20 [deepthinker]** Review Phase 2+3 changes. Spot-check: are extracted functions
well-named and logically cohesive? Did complexity refactoring preserve behavior?
Are test refactorings actually testing the same things? Flag anything suspicious.

---

### Phase 4.0: Sonarjs Config Tuning

**T21 [typescriptexpert]** Modify `eslint.config.js` to disable 9 sonarjs rules and
add test-file override. Specific changes to the general TS/TSX config block
(targeting `packages/*/src/**/*.{ts,tsx}`), add to rules section:

```javascript
// Disabled sonarjs rules — see project-plans/issue1569b/README.md for rationale
'sonarjs/declarations-in-global-scope': 'off',  // ESM false positives (2,937)
'sonarjs/no-unused-vars': 'off',                // Redundant with @typescript-eslint (242)
'sonarjs/max-lines-per-function': 'off',        // Redundant with base rule at 80 (690)
'sonarjs/process-argv': 'off',                  // CLI tool (366)
'sonarjs/standard-input': 'off',                // CLI tool (239)
'sonarjs/publicly-writable-directories': 'off', // Test /tmp usage (240)
'sonarjs/pseudo-random': 'off',                 // Non-crypto context (87)
'sonarjs/no-reference-error': 'off',            // TypeScript ambient false positives (280)
'sonarjs/no-undefined-assignment': 'off',       // TypeScript undefined convention (938)
```

In the vitest test config block (targeting `packages/*/src/**/*.test.{ts,tsx}`), add:
```javascript
'sonarjs/no-duplicate-string': 'off',  // Tests repeat strings legitimately (1,894)
```

Also verify the existing `sonarjs/max-lines-per-function` override if any — the base
ESLint `max-lines-per-function` should remain at `['warn', { max: 80, ... }]`.

Run full verification suite after. Count warnings — should drop by ~6,019.
Commit: `fix(lint): disable false-positive/redundant sonarjs rules (Phase 4.0)`

---

### Phase 4.1: Arrow Function Convention Codemod

**T22 [typescriptexpert]** Write and run an AST-based codemod (jscodeshift or
ts-morph script) to fix `sonarjs/arrow-function-convention` (5,234 warnings).
The fix: remove unnecessary parens from single-parameter arrow functions where
the parameter is a simple identifier (no type annotation, no destructuring, no
default value, no rest param). Save the script to `scripts/codemods/arrow-parens.ts`.

IMPORTANT edge cases that MUST keep parens:
- `(x: string) => ...` — typed parameter
- `({a, b}) => ...` — destructured parameter
- `([a, b]) => ...` — array destructured parameter
- `(x = 5) => ...` — default value
- `(...args) => ...` — rest parameter
- `() => ...` — zero parameters

Run across all packages. Run `npm run format` after. Run `npm run test`.
Count remaining `arrow-function-convention` warnings — should be near 0.
If >50 remain, fix manually in the same task.
Commit: `fix(lint): remove unnecessary arrow function parens (Phase 4.1)`

---

### Phase 4.3: Shorthand Property Grouping

**T23 [typescriptexpert]** Fix `sonarjs/shorthand-property-grouping` warnings in
`packages/core/src/` (~400 warnings). In object literals, reorder properties so
shorthand properties (`{ foo, bar }`) are grouped together, not interleaved with
non-shorthand (`{ foo, baz: 1, bar }`). Run `npm run test` when done.

**T24 [typescriptexpert]** Same for `packages/cli/src/` + `packages/a2a-server/src/`
+ `packages/vscode-ide-companion/src/` (~327 warnings).

---

### Phase 4.4: Suggestion-fixable Code Quality

**T25 [typescriptexpert]** Fix sonarjs suggestion-fixable warnings in `packages/core/src/`
(~350 warnings). Rules: `prefer-regexp-exec` (use .exec() instead of .match()),
`different-types-comparison` (fix type coercion in comparisons),
`no-alphabetical-sort` (replace .sort() with locale-aware or numeric sort),
`no-unused-function-argument` (prefix with _ or remove),
`prefer-immediate-return` (return expression directly instead of temp variable),
`no-undefined-argument` (remove trailing undefined args). Run `npm run test`.

**T26 [typescriptexpert]** Same for `packages/cli/src/` + remaining packages (~309 warnings).

---

### Phase 4.5: Duplicate String Constants (source only)

**T27 [typescriptexpert]** Fix `sonarjs/no-duplicate-string` in source files only
(NOT test files — those are disabled in 4.0). ~142 warnings. Extract repeated
string literals into named constants. Run `npm run test`.

**T28 [COORDINATOR]** Run full verification suite.
Commit: `fix(lint): resolve sonarjs mechanical warnings (Phases 4.1-4.5)`

**T29 [deepthinker]** Review Phases 4.0-4.5 changes. Verify: config disables are
correct rules with correct keys. Codemod didn't break typed/destructured params.
Shorthand grouping didn't change semantics. String constant extraction is sensible.

---

### Phase 4.6: Security Hotspot Review + Regex

**T30 [typescriptexpert]** Fix sonarjs security/regex warnings in `packages/core/src/`
(~300 warnings). Rules: `regular-expr` (review regex for correctness),
`slow-regex` (optimize catastrophic backtracking), `concise-regex` (simplify),
`no-os-command-from-path` / `os-command` (use absolute paths or validate),
`file-permissions` (use restrictive permissions), `sockets` / `encryption` /
`hashing` (add eslint-disable with justification comment if intentional).
Run `npm run test`.

**T31 [typescriptexpert]** Same for `packages/cli/src/` + remaining (~216 warnings).

---

### Phase 4.7: Error Handling

**T32 [typescriptexpert]** Fix `sonarjs/no-ignored-exceptions` across all packages
(167 warnings). For each empty catch block: add proper error handling (log, rethrow,
or add a comment explaining why swallowing is intentional with eslint-disable).
Never silently swallow errors without justification. Run `npm run test`.

---

### Phase 4.8: Grab-bag + TODO Cleanup

**T33 [typescriptexpert]** Fix remaining small sonarjs rules across all packages
(~350 warnings). Rules: `void-use`, `destructuring-assignment-syntax`,
`bool-param-default`, `no-duplicated-branches`, `no-identical-functions`,
`no-inconsistent-returns`, `no-dead-store`, `constructor-for-side-effects`,
`assertions-in-tests`, `generator-without-yield`, and ~15 other rules with <10 each.
Run `npm run test`.

**T34 [typescriptexpert]** Fix `sonarjs/todo-tag` (281 warnings). For each TODO comment:
- If it's LLM placeholder cruft ("TODO: implement this", "TODO: add error handling") —
  actually implement it or remove the TODO if it's already done
- If it's a legitimate future task — create or reference a GitHub issue number in the
  comment (e.g., `// TODO(#1234): migrate to new API`)
- If it's obsolete — remove it
Goal: zero `todo-tag` warnings. Run `npm run test`.

**T35 [COORDINATOR]** Run full verification suite.
Commit: `fix(lint): resolve sonarjs security/error/cleanup warnings (Phases 4.6-4.8)`

---

### Phase 4.9: Complexity Refactoring (hardest phase)

Rules: `nested-control-flow`, `cyclomatic-complexity`, `cognitive-complexity`,
`elseif-without-else`, `too-many-break-or-continue-in-loop`,
`expression-complexity`, `no-nested-conditional`, plus smaller structural rules.

These require genuine refactoring: extract functions, simplify conditionals,
reduce nesting, use early returns / guard clauses.

**T36 [typescriptexpert]** Fix sonarjs complexity warnings in `packages/cli/src/ui/`
(~500 warnings). Focus: extract React components, extract helper functions from
large render methods, simplify conditional rendering, use early returns.
Run `npm run test`.

**T37 [typescriptexpert]** Fix complexity in `packages/core/src/providers/` (~450).
Focus: extract API call helpers, simplify retry/error handling logic, use
strategy patterns where appropriate. Run `npm run test`.

**T38 [typescriptexpert]** Fix complexity in `packages/core/src/tools/` (~250).
Focus: break up large tool implementation functions, extract validation helpers.
Run `npm run test`.

**T39 [typescriptexpert]** Fix complexity in `packages/core/src/core/` (~200).
Focus: simplify algorithms, use early returns, extract sub-functions.
Run `npm run test`.

**T40 [typescriptexpert]** Fix complexity in `packages/core/src/prompt-config/`
+ `packages/core/src/services/` (~200). Focus: extract pipeline stages.
Run `npm run test`.

**T41 [typescriptexpert]** Fix complexity in `packages/core/src/utils/`
+ `packages/core/src/recording/` (~180). Focus: flatten control flow.
Run `npm run test`.

**T42 [typescriptexpert]** Fix complexity in `packages/cli/src/config/`
+ `packages/cli/src/utils/` + `packages/cli/src/auth/` (~200).
Focus: reduce if/else chains, use maps/lookups. Run `npm run test`.

**T43 [typescriptexpert]** Fix complexity in ALL remaining directories (~382):
`packages/cli/src/runtime/`, `packages/cli/src/commands/`,
`packages/cli/src/services/`, `packages/core/src/mcp/`,
`packages/core/src/hooks/`, `packages/core/src/storage/`,
`packages/core/src/scheduler/`, `packages/a2a-server/`,
`packages/vscode-ide-companion/`. Run `npm run test`.

**T44 [COORDINATOR]** Run full verification suite.
Commit: `fix(lint): refactor complex functions for sonarjs compliance (Phase 4.9)`

**T45 [deepthinker]** Review Phase 4.9 complexity refactoring. This is the highest-risk
phase. Check: are extracted functions well-named, logically cohesive, and not just
moving complexity around? Are early returns correct? Did any behavioral changes slip
in? Are there any new bugs from control flow changes? Spot-check the 10 largest diffs.

---

### Phase 4.10: Deprecation Fixes

**T46 [typescriptexpert]** Fix sonarjs deprecation warnings across all packages
(148 warnings). Replace deprecated API calls with modern equivalents.
Run `npm run test`.

---

### Phase 4.11: Type System Improvements

**T47 [typescriptexpert]** Fix sonarjs type system warnings across all packages
(~250 warnings). Rules: `max-union-size` (break up large union types into
intermediate types), `variable-name` (fix naming convention violations),
`no-unused-collection` (remove or use unused collections),
`no-implicit-dependencies`, `use-type-alias`. Run `npm run test`.

---

### Phase 4.12: File Splitting

**T48 [typescriptexpert]** Fix `sonarjs/max-lines` warnings (58 warnings).
Split oversized files into smaller modules. Maintain the same public API via
re-exports from the original file path to avoid breaking imports.
Run `npm run test` and `npm run typecheck`.

**T49 [COORDINATOR]** Run full verification suite.
Commit: `fix(lint): resolve remaining sonarjs warnings (Phases 4.10-4.12)`

**T50 [deepthinker]** Final review of Phases 4.10-4.12. Check: are deprecated API
replacements correct? Are file splits clean with proper re-exports? Are type
changes backwards-compatible?

---

### Phase 5: Final Verification + PR

**T51 [COORDINATOR]** Run per-package lint and confirm 0 warnings, 0 errors:
```bash
NODE_OPTIONS=--max-old-space-size=12288 npx eslint packages/core/src --no-error-on-unmatched-pattern 2>&1 | tail -1
NODE_OPTIONS=--max-old-space-size=12288 npx eslint packages/cli/src --no-error-on-unmatched-pattern 2>&1 | tail -1
NODE_OPTIONS=--max-old-space-size=12288 npx eslint packages/a2a-server/src --no-error-on-unmatched-pattern 2>&1 | tail -1
NODE_OPTIONS=--max-old-space-size=12288 npx eslint packages/vscode-ide-companion/src --no-error-on-unmatched-pattern 2>&1 | tail -1
```
Run full verification suite one last time.

**T52 [COORDINATOR]** Push branch and create PR:
```bash
git push -u origin issue1569b
```
Create PR with `gh pr create` — title: "Resolve all ESLint warnings before package
extraction (Fixes #1569)" — body includes:
- Summary of what was done (30,012 warnings resolved)
- Phase breakdown with commit references
- List of disabled rules with rationale
- Note: todo-tag warnings driven to zero (not disabled)
- "closes #1569" in body

**T53 [COORDINATOR]** Watch CI: `gh pr checks NUM --watch --interval 300`.
Loop up to 5 times. If failures: investigate, fix, push, watch again.
Review all CodeRabbit comments per project rules (evaluate each against source,
address or dismiss with explanation, resolve addressed ones).

---

## Reference: Warning Inventory

### By subsystem

| Subsystem | Warnings | Files |
|---|---:|---:|
| packages/core | 16,188 | 905 |
| packages/cli | 13,375 | 955 |
| packages/a2a-server | 345 | 22 |
| packages/vscode-ide-companion | 104 | 9 |

### By semantic category

| Category | Count | % |
|---|---:|---:|
| sonarjs-quality | 18,947 | 63.1% |
| typescript-strictness | 6,515 | 21.7% |
| test-quality | 3,288 | 11.0% |
| complexity-size | 1,067 | 3.6% |
| control-flow-style | 88 | 0.3% |
| other (eslint-comments) | 59 | 0.2% |
| import-hygiene | 44 | 0.1% |
| console-logging | 4 | 0.0% |

### Key Decisions (all resolved)

1. **Null vs undefined:** Disable `sonarjs/no-undefined-assignment`. TypeScript
   `undefined` convention. Absorbed into Phase 4.0.
2. **Arrow function codemod:** Try codemod first (Phase 4.1 T22).
3. **todo-tag:** Keep enabled — claudefraud detection. Fix all 281 in Phase 4.8 T34.
4. **Disabled sonarjs rules (9):** declarations-in-global-scope, no-unused-vars,
   max-lines-per-function, process-argv, standard-input, publicly-writable-directories,
   pseudo-random, no-reference-error, no-undefined-assignment.
5. **Disabled in tests only (1):** no-duplicate-string.
