# Plan: Enable deferred Jest test-quality rules (Issue #3129)

Plan ID: PLAN-20260822-ISSUE3129

Generated: 2026-08-22

Updated: 2026-08-24

Issue: #3129

Status: Implementation and local verification complete; PR verification in progress

## Current state

The repository already depends on `eslint-plugin-jest`, imports it in
`eslint.config.js`, and configures the package-source test block with
`settings.jest.globalPackage = 'bun:test'`. The automated issue-plan comment that
says the plugin is absent describes an older checkout.

The existing block targets
`packages/*/src/**/*.{test,spec,bun}.{ts,tsx}`. This plan does not expand that
scope to integration-test roots, evals, scripts, or other files.

## Accepted behavior

### REQ-3129-1: Enable all five rules as errors

For every file covered by the existing package-source test block, the effective
ESLint configuration reports severity `error` for:

- `jest/no-conditional-in-test`
- `jest/no-standalone-expect`
- `jest/prefer-strict-equal`
- `jest/require-top-level-describe`
- `jest/valid-expect`

The existing `bun:test` package setting, file glob, and
`additionalTestBlockFunctions` options remain effective. The recognized test
functions remain `it`, `itProp`, `itProp.prop`, `it.prop`, `testProp`, and
`test.prop`.

### REQ-3129-2: Correct every violation without weakening tests

Every violation is corrected in the affected test. Corrections must preserve the
asserted behavior:

- Conditional test logic becomes explicit cases or typed behavior helpers.
  Assertions must still execute through registered tests.
- Standalone expectations execute inside real test blocks.
- Structural comparisons use `toStrictEqual` where required.
- Bare test blocks and hooks are grouped under meaningful top-level suites.
- Async matcher chains are awaited or returned so failed assertions fail tests.

No test, assertion, or meaningful case may be deleted to satisfy a rule. An
assertion may not be replaced with a less discriminating condition.

### REQ-3129-3: Preserve policy constraints

The change introduces no inline ESLint directive, ignore, carve-out, severity
downgrade, threshold increase, TypeScript suppression, Vitest import, or test
framework. It does not change lint scope, lint workflows, production behavior,
public APIs, or dependencies.

### REQ-3129-4: Leave the repository green

The candidate must pass lint with zero warnings, the test suite, type checking,
formatting, build, and the required `stepfun-37` smoke test.

## Boundary handling

Platform behavior remains explicit. Conditional platform registration may use a
suite-level gate while preserving the original set of cases. Property and table
callbacks keep their typed inputs and run counts.

A helper is acceptable when it represents a named behavior, preserves closure and
async semantics, and is invoked by a real test. Conditional computation may live
in the helper, but meaningful assertions should remain visible to the registered
test when practical. Generic wrappers created only to avoid AST traversal are not
accepted.

A standalone expectation used by setup or generated scripts must be connected to
a registered test without changing process, socket, cleanup, or failure behavior.
Async assertions may not be detached with `void`, swallowed, or converted to
non-asserting calls.

## RED evidence

The initial candidate inventory covered 977 matched files and reported 5,171
violations:

| Rule | Violations | Files |
| --- | ---: | ---: |
| `jest/no-conditional-in-test` | 3,497 | 832 |
| `jest/no-standalone-expect` | 751 | 81 |
| `jest/prefer-strict-equal` | 466 | 119 |
| `jest/require-top-level-describe` | 304 | 80 |
| `jest/valid-expect` | 153 | 43 |
| **Total** | **5,171** | **977 matched files** |

The installed `no-conditional-in-test` rule reports every `if`, `switch`, ternary,
and logical expression traversed inside a test callback. This accounts for its
large count and requires semantic test refactoring rather than a threshold change.

## Implementation result

The five rules are enabled at `error` in the existing package-source test block.
The `bun:test` setting, matched glob, and standalone-expect options are unchanged.

Corrections span package tests in `a2a-server`, `agents`, `auth`, `cli`, `core`,
`ide-integration`, `mcp`, `policy`, `providers`, `settings`, `storage`,
`telemetry`, `test-utils`, `tools`, and `vscode-ide-companion`. Changes include:

- Removing extra invalid arguments passed to `expect`.
- Replacing structural `toEqual` calls with `toStrictEqual`.
- Moving standalone assertions into registered tests.
- Grouping bare tests and hooks under suites.
- Splitting behaviorally distinct cases.
- Extracting typed, named setup and observation helpers while retaining test
  registration, assertion execution, cleanup, platform gates, and async flow.

Final exact-rule ESLint shards on 2026-08-24 covered 2,393 matched package test
files and reported zero findings for all five rules. The count includes two new
test-only helper files. Normal-config ESLint also passed over every package source
tree in bounded shards.

Scoped agents also ran normal ESLint, Prettier, and isolated Bun tests while
correcting each package slice. The complete 713-file CLI workspace passed in three
bounded partitions: 9,165 tests passed, five skipped by existing gates, and 13
existing todos. All 162 changed core test files ran in isolated processes; one
missing `await` was found in the LSP shutdown observation, corrected, and rerun
successfully.

The CLI UI hooks slice initially introduced 55 `NO_ASSERT` scanner findings after
assertions moved into helpers. That regression was corrected by returning typed
observations from helpers and keeping meaningful assertions in registered test
callbacks. Its final comparison is unchanged from `HEAD` for `MOCK_MIRROR`,
`ALWAYS_TRUE`, `SELF_CONFIRMING`, and `NO_ASSERT`.

## Verification result

Before integration with current `main`, repository-wide typecheck, build,
formatting, the ESLint policy guard, the `stepfun-37` smoke test, and
`git diff --check` passed. Exact-rule and normal-config ESLint passed across
complete bounded package shards. The false-green scanner reported zero parse
errors and no increase from `HEAD` in any finding category.

After rebasing onto `origin/main` at `721b38655`, 12 textual conflicts were
resolved by retaining both the newer shell, janitor, PowerShell, and telemetry
fixes and the issue's compliant test structure. Current `main` also introduced
64 findings across 11 tests under the newly enabled rules. Those findings were
corrected without removing tests or assertions. A later main update at
`ece3d796e` required three additional provider-test conflict resolutions. The
resolution preserves its stateful Responses context behavior and all issue rule
compliance; 218 focused tests across its ten overlapping files pass. Exact-rule
ESLint passes across every package-source test shard, and normal-config ESLint
passes across every configured package source tree with zero warnings.
Repository-wide build, typecheck, formatting, the ESLint policy guard, and
`git diff --check` also pass. Focused post-rebase tests passed for every
additional remediation file.

The complete root test run traversed every workspace. It reported three failures
in the agents workspace: one load-sensitive timeout that passed immediately in
isolation and two real async-ordering regressions in observation helpers. The
helpers now await their provider or scheduler prerequisites before advancing
fake timers while returning observations for visible assertions in registered
tests. Both corrected files pass in isolation, and the complete agents workspace
rerun passed 380 of 380 files plus all six native Bun files. An independent
review also found assertions hidden in ZIP and telemetry helpers; those helpers
now return observations or throw while the registered tests make the assertions.
Focused verification for the review fixes passed 59 tests.

The required smoke command reaches the configured provider, but the provider now
returns HTTP 400 because the account has no active Step plan subscription. The
monolithic lint command exceeds the shell execution ceiling on this machine;
complete bounded package lint provides the final local lint evidence. Both
compliance review rounds completed and their in-scope findings were corrected.
Open Code Review was run within the workflow's two-round cap. The final detached
run reviewed 151 files and produced no code comments; five files failed because
the provider returned HTTP 429. Higher concurrency caused widespread HTTP 429
responses, while lower concurrency could not complete this 983-file diff within
the available run. These provider and tool limitations are disclosed in the PR.

## Required verification

1. Use `eslint --print-config` on a representative matched test. Confirm severity
   `2` for all five rules and confirm the preserved standalone-expect options.
2. Pipe a synthetic `bun:test` sample through ESLint with a matched stdin
   filename. Confirm that all five rule IDs are reported.
3. Run `npm run lint` with zero warnings.
4. Run `npm run lint:eslint-guard`.
5. Audit the diff for suppressions, rule weakening, ignored files, skipped tests,
   deleted assertions, production changes, and unsupported test frameworks.
6. Compare `bun scripts/test-audit/scan.ts` output for `HEAD` and the candidate.
   The candidate may introduce no `MOCK_MIRROR`, `ALWAYS_TRUE`,
   `SELF_CONFIRMING`, or `NO_ASSERT` finding.
7. Run `npm run test`.
8. Run `npm run typecheck`.
9. Run `npm run format`, inspect its diff, and rerun checks invalidated by
   formatting.
10. Run `npm run build`.
11. Run
    `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
12. Complete compliance and Open Code Review rounds. Classify each finding and
    resolve every in-scope defect.
13. Commit, push, create the PR, and watch CI and PR feedback. Confirm that the
    candidate is based on the intended `main` ancestry and has no conflicts.

## Review classification

Each compliance, Open Code Review, CodeRabbit, and CI finding is classified as:

- **Blocker-Fix:** Prevents an accepted requirement, behavioral evidence, safety
  property, or required gate from passing.
- **In-scope-Fix:** Identifies a defect in changed code or tests within
  REQ-3129-1 through REQ-3129-4.
- **Reject:** Is factually incorrect, already satisfied, or conflicts with an
  accepted requirement.
- **Defer:** Is valid but outside the accepted inputs or excluded scope.

Reviewer suggestions do not expand scope. Adding a subsystem, public abstraction,
workflow, dependency, or unrelated behavior requires approval.

## Completion gate

Completion requires evidence for every requirement, a passing local verification
cycle, completed reviews with every in-scope finding resolved, passing CI on the
same candidate head, and a conflict-free PR based on the intended `main` head.
Stop when the PR is ready to merge. Do not merge without explicit user approval.
