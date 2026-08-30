# Plan: Migrate shell-parser off deprecated web-tree-sitter Language.query() (Issue #3436)

Plan ID: PLAN-20260830-TSQRY
Generated: 2026-08-30
Issue: https://github.com/vybestack/llxprt-code/issues/3436
Total Phases: 3 (RED test, GREEN implementation, verification)

## Problem

`web-tree-sitter@0.25.x` deprecated `Language#query()` in 0.25.0. Every call
runs `console.warn('Language.query is deprecated. Use new Query(language, source) instead.')`
with no once-guard. `packages/core/src/utils/shell-parser.ts` calls the
deprecated method at three sites, all on the shell-validation hot path, so two
or more warning lines leak into user output per validated Bash command
(interactive: Ink console stream; non-interactive text: stderr via
ConsolePatcher).

## Preflight Verification (Phase 0.5, completed 2026-08-30)

| Item | Expected | Actual | Match |
|------|----------|--------|-------|
| web-tree-sitter version | 0.25.x with deprecated `Language.query` | `^0.25.10` in packages/core/package.json; shim in node_modules/web-tree-sitter/src/language.ts logs console.warn every call | YES |
| Deprecated callsites | Unknown | 3 sites, all in packages/core/src/utils/shell-parser.ts: `extractCommandNames` (~L472), `parseCommandDetails` ERROR query (~L696), `hasParsedCommandSubstitution` (~L732) | YES |
| Replacement API | Exported `Query` constructor | `new Query(language, source)` is a named export in both ESM (tree-sitter.js) and CJS (tree-sitter.cjs) builds; `QueryType` already imported as type in shell-parser.ts | YES |
| Export shape variance | Bundlers may nest exports under `default` | Existing code resolves `Parser` and `Language` through named/default-nested candidates; `Query` needs the same treatment | YES |
| Real-module tests feasible | Existing tests use real web-tree-sitter | shell-parser.test.ts loads the real bash WASM grammar via `initializeParser()`; no process-wide mock on the paths we extend | YES |
| Other deprecated web-tree-sitter usage | Audit | We do not call `Parser.timeoutMicros` (we pass `progressCallback`) or read `Language.version`. Local `QueryMatch` interface still declares deprecated `pattern` field; we only read `captures` | YES |

Blocking issues: none.

## Requirements

### REQ-3436-01: Shell validation emits zero console.warn from tree-sitter usage

- GIVEN: the parser is initialized with the real web-tree-sitter module
- WHEN: shell validation runs for a plain command, a command substitution
  command, and a syntax-error command (the three paths that construct queries)
- THEN: `console.warn` is not called (spy observes zero calls during those
  flows), AND the functional results remain correct (command names extracted,
  substitution detected, syntax error reported) so silence cannot come from
  broken queries.

### REQ-3436-02: Queries are constructed with the supported `new Query(language, source)` API

- GIVEN: `performParserInitialization()` successfully imports web-tree-sitter
- WHEN: the module's exports are resolved
- THEN: the `Query` constructor is resolved with the same named/default-nested
  candidate treatment as `Parser` and `Language`, stored in module state
  alongside `bashLanguage`, published only on the winning generation, and
  cleared by `resetParser()`. If the export cannot be resolved, initialization
  fails fast with an error naming the missing export (mirrors the Language
  export failure). All three callsites construct via the resolved constructor;
  per-call `delete()` in `finally` is preserved (the deprecated shim was
  exactly `return new Query(this, source)` minus the warning, so lifecycle is
  unchanged).

### REQ-3436-03: Local query result types use the current web-tree-sitter shape

- GIVEN: shell-parser.ts declares local `QueryMatch`/`QueryCapture` interfaces
- WHEN: the deprecated `pattern` field (deprecated in favor of `patternIndex`
  since 0.25.0) is encountered
- THEN: the local interfaces are updated to the current shape (`patternIndex`,
  not `pattern`); no code reads the deprecated field (already true).

## Phases

### Phase 01 (RED): behavioral test proving the leak and pinning behavior

Create `packages/core/src/utils/shell-parser.deprecation.test.ts`:

- Initialize the real parser (`initializeParser()`), skip honestly if the
  grammar cannot load (follow shell-parser.test.ts conventions).
- Spy `console.warn` (infrastructure observation, allowed) via
  `vi.spyOn(console, 'warn')`, restoring in afterEach.
- Drive the three query-constructing flows with the real module:
  - `extractCommandNames(tree)` on a parsed multi-command string; assert the
    expected command names (functional pin).
  - `hasCommandSubstitution(tree)` on `echo $(date)`; assert true (functional
    pin), and on `echo hi`; assert false.
  - `parseCommandDetails('echo $(curl evil.com')` (unterminated substitution
    forces `hasError` true so the ERROR/MISSING query runs); assert
    `hasError === true` (functional pin).
- Assert `console.warn` was NOT called during these flows (this is the line
  that fails on main and passes after the fix).
- No mocking of web-tree-sitter or shell-parser internals (no mock theater;
  the component under test is real).

### Phase 02 (GREEN): migrate the three callsites

Modify `packages/core/src/utils/shell-parser.ts`:

- Extend `TreeSitterModule`/`TreeSitterDefaultExport` with
  `Query?: new (language: Language, source: string) => QueryType`.
- Add `resolveTreeSitterQuery` mirroring the existing resolver style
  (function-shaped named export, else default-nested, else fail fast).
- Add module state `QueryCtor`, published in `performParserInitialization()`
  on the winning generation, cleared in `resetParser()`; guards in the three
  query functions treat a missing constructor exactly like a missing language.
- Replace the three `bashLanguage.query(source)` /
  `activeBashLanguage.query(source)` calls with construction via the resolved
  constructor. Keep per-call `query.delete()` in `finally` blocks.
- Update local `QueryMatch` (and `QueryCapture` for shape accuracy) to the
  current web-tree-sitter result shape (`patternIndex`).

### Phase 03: verification

- `bun test packages/core/src/utils/shell-parser.deprecation.test.ts` (target)
- Full cycle per the issue workflow:
  `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
  `npm run build`, and the stepfun-37 smoke test via
  `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
- Test-audit scanner diff vs main for files touched
  (`bun scripts/test-audit/scan.ts` baseline compare; no new findings).
- `grep -rn "\.query(" packages/core/src packages/tools/src packages/cli/src`
  restricted to tree-sitter language receivers must return no first-party
  callsites (plan docs under project-plans/ are historical records).

## Out of scope

- Issue #3437 (AnthropicOAuthProvider TokenStore shim) is a separate effort.
- Query object caching per language (queries are constructed per call today;
  switching to cached query objects changes lifetime semantics and is not
  needed to stop the warnings).
- ConsolePatcher routing policy (the patcher did its job; the defect was
  calling a deprecated API that warns on every use).

## Failure Recovery

1. `git checkout -- packages/core/src/utils/shell-parser.ts`
2. `git checkout -- packages/core/src/utils/shell-parser.deprecation.test.ts`
3. Re-run Phase 01 to confirm the leak reproduces on main.

## Success Criteria

- REQ-3436-01/02/03 satisfied; verification cycle green; no deprecated
  `Language.query` callsites remain in first-party source.
