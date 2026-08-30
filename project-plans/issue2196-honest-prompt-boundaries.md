# Issue #2196: Make core prompt utility boundaries honest instead of widening to unknown

Follow-up to audit issue #2159. Branch: `issue2196`.

## Root cause

`PromptLoader.loadAllFiles` declares `baseDir: string` and `fileList: string[]`
but then checks `(baseDir as unknown) == null` and `(fileList as unknown) == null`.
The declared types over-promise non-null while runtime code still defends against
nullish boundary values; the widening casts exist only to make lint accept the
defensive checks.

## Research findings

- `loadAllFiles` has no production callers; only `prompt-loader.test.ts` invokes
  it, currently passing `null as unknown as string` / `null as unknown as string[]`.
- Sibling methods in the same class already use the honest-nullable convention:
  `loadFile(filePath: string | null | undefined, ...)` and
  `compressContent(content: string | null | undefined)`, each guarded with
  explicit `=== null || === undefined` checks.
- The tests already assert the documented contract: nullish/empty inputs return
  an empty `Map`.
- `packages/core/src/utils/partUtils.ts` is already an honest boundary: inputs
  are `unknown`, narrowing is done via type predicates (`isNonNullObject`,
  `isEmptyPartValue`); there are no widening casts. No change needed.
- `packages/core/src/utils/tool-utils.ts`:
  - `isShellInvocationAllowlisted` uses
    `const params = invocation.params as unknown;` to narrow the intentionally
    opaque `AnyToolInvocation.params: object` boundary
    (`AnyToolInvocation = ToolInvocation<object, ToolResult>` in
    `packages/tools/src/tools/tools.ts`) with `typeof`/`in` checks. This is
    legitimate boundary narrowing of an opaque type — keep it.
  - `matchesToolPattern` narrows with
    `(invocation.params as { command: string }).command` after an `in` guard,
    then defensively calls `String(...)`. The cast over-promises
    `command: string` while runtime conversion defends against non-strings.
    Honest form: `command?: unknown`.

## Decision (Design choice: honest-nullable vs. remove checks)

Make `loadAllFiles` honestly nullable, matching the sibling `loadFile` /
`compressContent` convention. Rationale: nullish inputs are possible (public
method, no non-null caller guarantee; tests pass null today), the empty-`Map`
behavior is already documented and asserted, and removing the checks would
delete proven behavior. This keeps the existing contract; it adds no new
defensive layer.

## Acceptance criteria

1. `loadAllFiles` signature becomes
   `baseDir: string | null | undefined, fileList: string[] | null | undefined`
   with explicit `=== null` / `=== undefined` guards replacing both
   `(x as unknown) == null` widening casts. Behavior unchanged: nullish or
   empty inputs return an empty `Map`.
2. `prompt-loader.test.ts` proves the nullish boundary without casts:
   - existing null cases pass `null` directly (no `as unknown as`),
   - `undefined` coverage added for both `baseDir` and `fileList`,
   - vestigial casts dropped from the `loadFile` null/undefined test and the
     `compressContent(null)` test (both signatures already accept nullish).
   - positive-path tests unchanged.
3. `tool-utils.ts`: keep the `as unknown` narrowing of the opaque
   `AnyToolInvocation.params` boundary with a brief why-comment; replace the
   over-promising `{ command: string }` cast in `matchesToolPattern` with
   `{ command?: unknown }` (runtime `String()` conversion unchanged).
4. `partUtils.ts`: no change (already honest); recorded here and in the PR.
5. Tests added in `shell-utils.test.ts` for the previously untested
   malformed-`params` branch of `isShellInvocationAllowlisted`: missing
   `command`, non-string `command`, empty/whitespace `command` → `false`.
6. No lint suppressions, no lint/type rule loosening, no new .js files, no
   vitest/node test runners (TS + bun test only).

## Out of scope (classified)

- `watchFiles`' non-nullable `callback` param with `typeof callback !== 'function'`
  check (same file, not named by the issue) — Defer.
- Other `as unknown` sites in prompt-config (e.g. `prompt-service.ts` L199,
  `toolOutputLimiter.ts` L310) — Defer; broader audit belongs to #2159 follow-ups.
- Changing `AnyToolInvocation` or `ToolInvocation` type definitions — Reject
  (public tools-package API, far beyond this issue).

## Tests that prove it

- `packages/core/src/prompt-config/prompt-loader.test.ts`
  - `loadAllFiles(null, ['file.md'])` → empty map
  - `loadAllFiles(undefined, ['file.md'])` → empty map
  - `loadAllFiles(tempDir, [])` → empty map
  - `loadAllFiles(tempDir, null)` / `loadAllFiles(tempDir, undefined)` → empty map
- `packages/core/src/utils/shell-utils.test.ts`
  - `isShellInvocationAllowlisted({ params: {} }, ['run_shell_command(git)'])` → false
  - non-string `command` → false
  - whitespace-only `command` → false

## Verification

Full cycle per workflow: `npm run test`, `npm run lint`, `npm run typecheck`,
`npm run format`, `npm run build`, then the stepfun-37 smoke test via
`bun scripts/start.ts`. OCR review before push (max 2 rounds). deepthinker
review (max 2 rounds).

## Results (2026-08-23)

- Implementation: typescriptexpert produced the 4-file diff (57+/23-);
  round-1 review remediation split the six-condition guard into two
  early-return guards (sonarjs/expression-complexity), final diff 58+/27-.
- deepthinker round 1: REQUEST_CHANGES (HIGH: expression complexity) → fixed.
  Round 2: APPROVE, zero findings. 2/2 rounds used.
- Targeted tests: `bun test src/prompt-config/prompt-loader.test.ts
  src/utils/shell-utils.test.ts` → 112 pass / 1 Windows skip / 0 fail.
- typecheck EXIT=0; lint EXIT=0; format EXIT=0 (no file changes); build EXIT=0;
  stepfun-37 smoke test generated a haiku and exited cleanly.
- OCR local round 1: complete, 4/4 changed files covered (tests included via
  global include rules), 0 findings. 1 of 2 local rounds used.
- Full suite (`npm run test`): 14 failing files, none in changed files.
  Evidence of pre-existing/environmental origin (checked against a clean
  origin/main worktree):
  - `packages/core/test/utils/ripgrepPathResolver.test.ts`: identical 4
    failures on origin/main.
  - `packages/agents` specs: ≥1 identical failure standalone on origin/main.
  - Remaining failures (core settings-remediation performance `<10ms`
    wall-clock, auth lock-owner, cli dialog/performance, tools grep 15s
    timing, agents 300s timeout): pass standalone on both trees; all are
    load-sensitive timing/process tests that failed only under full-suite
    load, with no code-path overlap with this diff (the diff's only
    runtime-visible change is a behavior-preserving guard split plus a
    type-only cast).
- Main worktree removed after evidence capture.

## PR remediation (CodeRabbit, 2026-08-23)

- PR #3280 CI fully green (37 pass / 0 fail / 3 by-design skips), CodeRabbit
  check SUCCESS, CI OpenCodeReview: 0 findings (PR OCR round 1 of 2).
- One actionable CodeRabbit thread (tool-utils.ts `matchesToolPattern`):
  `String(...)` coerced a malformed non-string `params.command` (e.g. `42`)
  into matching `ShellTool(42)` via the exported `doesToolInvocationMatch`,
  bypassing `isShellInvocationAllowlisted`'s non-string rejection. Classified
  In-scope-Fix (line touched by this PR; same boundary-honesty root cause;
  sibling path already rejects non-strings; fail-closed).
- Fix: `matchesToolPattern` now reads `params.command` as `unknown` and
  returns `false` for non-strings instead of coercing; regression test added
  in `tool-utils.test.ts` (`{ params: { command: 42 } }` vs `ShellTool(42)`
  → `false`).
- Round-2 verification: targeted tests 121 pass / 1 Windows skip / 0 fail
  (prompt-loader, shell-utils, tool-utils test files); typecheck EXIT=0
  (re-run sequentially after build — a concurrent build/typecheck run
  produces transient `Cannot find module '@vybestack/llxprt-code-ide-integration'`
  errors from dist being rebuilt); format EXIT=0 no changes; build EXIT=0;
  stepfun-37 smoke PASS; full lint + full suite re-run on the remediated
  head. No new OCR local round needed for this small guard change; the CI
  OpenCodeReview on the new head covers it (PR OCR round 2 of 2).
- Round-2 full suite: 31 failing tests, none in changed files (targeted
  runs of all three touched test files: 121 pass / 1 Windows skip / 0 fail).
  Failure triage: 4 ripgrepPathResolver (byte-identical on origin/main,
  proven round 1); agents 180s/30s-timeout specs plus GrepTool 60s and
  provider-liveness 150ms timing tests (load-sensitive — this run shared
  the machine with concurrent lint/typecheck/build). Proof of flakiness at
  the merge-base 38d9fb9f7 (fixed commit, no PR changes present):
  config-injection.spec.ts + core-history.spec.ts combined standalone →
  1 fail (config-injection T1, 30s timeout) then 0 fail on immediate
  re-run, and a third repetition failed T1 again; on the remediated branch
  the same T1/T6 fail the same way. Full-suite round-1 worktree evidence
  (identical ripgrep failures, standalone-passing timing tests on both
  trees) plus this round's merge-base flake proof cover all 31.
- Main worktree removed after evidence capture.
