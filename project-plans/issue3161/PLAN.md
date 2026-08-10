# Issue #3161 — Typecheck test files by default

## Problem

The root `npm run typecheck` delegates to each workspace's TypeScript project,
but most package `tsconfig.json` files blanket-exclude tests. A test can
therefore contain a hard type error while local verification and CI remain
green.

The exclusion debt has two forms:

- own-package blanket patterns such as `**/*.test.ts`, `**/*.spec.ts`,
  `**/*.test-d.ts`, and `**/__tests__/**`;
- cross-package blanket patterns in packages whose TypeScript project includes
  another workspace's source tree.

`packages/cli/tsconfig.json` already demonstrates the intended migration:
known debt is listed by file, so new tests are checked automatically.

## Preflight findings

- After `npm run build`, the current `npm run typecheck` and
  `npm run lint:eslint-guard` pass.
- `packages/settings` and `packages/test-utils` already typecheck their tests
  without test exclusions.
- `packages/a2a-server` already typechecks its own tests, but blanket-excludes
  tests imported from `mcp`.
- `packages/lsp` is a special case. Its tests live under `test/`, while its
  current config includes only `src/**/*.ts` and excludes `test`. A temporary
  config that included the tests exposed 71 diagnostics. Those diagnostics
  must be fixed; the issue's earlier zero-error measurement did not include the
  test directory.
- `packages/lsp` uses its typecheck config for emission. Its build must retain
  production-only emission while its typecheck includes tests, so build and
  typecheck inputs need separate configs.
- Typecheck configs may contain JSONC comments. The repository already declares
  `comment-json`; no dependency is needed.
- Build-only configs legitimately exclude tests from emitted artifacts and are
  outside this issue.

## Accepted behavior

### AC1 — Typecheck configs contain no blanket test exclusions

Every `packages/*/tsconfig.json` used by workspace typecheck is free of blanket
test exclusions. This includes own-package and cross-package patterns for:

- `.test.ts` and `.test.tsx`;
- `.spec.ts` and `.spec.tsx`;
- `.test-d.ts`;
- `__tests__` and test directories;
- brace patterns and directory wildcards that cover tests.

Any remaining test exclusion is a literal, enumerated file path. Non-test
exclusions such as `dist` and `node_modules` are unchanged.

### AC2 — The graduated packages typecheck all tests

`lsp`, `a2a-server`, `policy`, `storage`, `ide-integration`, `auth`, and `tools`
have no test opt-outs. Their test files and test helpers are inside the
workspace typecheck program, and their package typecheck commands pass.

For `lsp`, `test/**/*.ts` is included in typecheck. Production build output
continues to exclude tests through a build-only config rather than by weakening
typecheck.

### AC3 — New tests fail typecheck on type errors

A newly created test file covered by a package's source/test include patterns is
typechecked without editing an opt-out list. A permanent Bun behavioral test
creates a temporary deliberately-invalid test file in a graduated package,
runs that workspace's real typecheck command, observes failure, removes the
file, and confirms the command passes again.

### AC4 — CI prevents both blanket exclusions and opt-out growth

The existing `npm run lint:eslint-guard` gate gains two fail-fast checks:

1. a full-tree scan rejects a blanket test exclusion in any package typecheck
   config;
2. a ratchet rejects any explicit test opt-out absent from the committed
   issue-3161 baseline and rejects growth of that baseline after its initial
   bootstrap.

The baseline is keyed by package config, uses normalized POSIX paths, and is
compared with the guard's configured Git base. Removing or renaming an excluded
file may make a baseline entry stale; stale debt is reported for removal but
never blocks reducing the list.

Because the existing ESLint guard already runs in CI with base/head revisions,
no new workflow or independent quality command is required.

### AC5 — Remaining debt is finite and traceable

Tests that cannot yet be enabled in `telemetry`, `mcp`, `core`, `agents`,
`providers`, or `cli` are excluded only by literal file path. Each affected
config points to issue #3161, and the guard baseline records the same entries
with issue #3161 metadata, making the debt countable and reviewable.

Explicit lists are derived from compiler diagnostics after removing blanket
patterns; clean tests are not copied into the debt list. Typecheck is rerun
iteratively after exclusions are narrowed so newly exposed diagnostics cannot
be missed.

### AC6 — Type safety and test behavior are not weakened

The implementation introduces no type assertions, `any`, TypeScript suppression
directives, lint suppressions, lint/complexity weakening, deleted tests, skipped
tests, or weakened assertions. Fixture and mock errors are fixed with precise
types or typed builders. Every new or changed test uses `bun:test`.

## Boundary decisions

| Input or condition | Required result |
| --- | --- |
| New `.test.ts`, `.test.tsx`, `.spec.ts`, `.spec.tsx`, or `.test-d.ts` | Included by default unless its literal path was already grandfathered. |
| New file under `__tests__` or the LSP `test/` tree | Included by default. |
| Cross-package test pulled into another project's program | Typechecked or listed as a literal opt-out in that consuming config. |
| JSONC comments in a tsconfig | Parsed correctly; comments do not hide exclusions. |
| Windows path separators | Normalized to POSIX before comparison. |
| Deleted or renamed grandfathered test | Stale baseline entry is reported and can be removed; debt reduction does not fail CI. |
| Attempt to add a literal opt-out and update the baseline in the same later PR | Fails because baseline growth is compared to the Git base. |
| Package with no remaining debt | Contains no test exclusions and has no baseline entries. |
| `tsconfig.build.json` or equivalent emit-only config | Out of scope; tests may remain excluded from production emission. |

## Test-first implementation plan

### Phase 1 — Guard behavior, RED first

Add Bun tests under `scripts/tests/` before guard implementation. The tests
must prove:

- each forbidden own-package and cross-package blanket form is rejected;
- literal file paths are accepted;
- JSONC comments are parsed;
- a current entry absent from the baseline is rejected;
- baseline growth relative to the Git-base baseline is rejected;
- stale entries are non-blocking;
- path normalization is deterministic;
- the committed repository has no forbidden patterns when conversion is done;
- the graduated package configs have no test opt-outs;
- an invalid newly-created policy test fails the real workspace typecheck and
  cleanup restores a passing typecheck.

Implement the minimum scanner/ratchet module under `scripts/eslint-guard/`, wire
it into `scripts/check-eslint-guard.ts`, and add a committed baseline under
`scripts/eslint-guard/`.

### Phase 2 — Graduate zero/small-debt packages

Work package-by-package and keep each package typecheck and test suite green:

1. `a2a-server` — retain all own tests and replace cross-package blanket debt
   only after the `mcp` explicit list is known.
2. `lsp` — include `test/**/*.ts`, split production build inputs from
   typecheck inputs, and fix all diagnostics without assertions or
   suppressions.
3. `policy`.
4. `storage`.
5. `ide-integration`.
6. `auth`.
7. `tools`, including helpers and `.test-d.ts` files under `__tests__`.

For each package: remove test patterns, run its real typecheck to establish RED,
fix the reported test/fixture types, run its Bun tests, and confirm no literal
test exclusions remain.

### Phase 3 — Enumerate remaining debt

For `telemetry`, `mcp`, `core`, `agents`, `providers`, and the applicable
cross-package portions of `cli`:

1. temporarily remove blanket test patterns while retaining non-test excludes;
2. run the real package typecheck and collect distinct erroring test paths;
3. replace only those diagnostics-producing tests with normalized literal
   exclusions;
4. rerun typecheck and repeat until green;
5. add issue #3161 tracking text and update the initial baseline;
6. replace `a2a-server` cross-package globs with the corresponding literal `mcp`
   debt paths.

The existing explicit CLI debt remains unless compiler evidence permits an
entry to be removed. CLI launcher wildcards are converted to literal paths.

### Phase 4 — Verification and review

Run focused guard tests and each changed package's tests/typecheck, followed by:

```sh
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
npm run lint:eslint-guard
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Run DeepThinker and Open Code Review, then classify every finding:

- **Blocker-Fix** — accepted behavior, safety, architecture, verification, or CI
  cannot pass without it;
- **In-scope-Fix** — directly improves correctness or maintainability of the
  accepted implementation;
- **Reject** — factually wrong, already satisfied, or would weaken a requirement;
- **Defer** — valid but requires behavior, architecture, dependency, workflow,
  or cleanup outside issue #3161.

Resolve every Blocker-Fix and In-scope-Fix finding before the candidate head is
pushed. Do not exceed two local or two PR Open Code Review runs.

## Explicitly out of scope

- Burning down the deferred high-error packages beyond the literal opt-out
  conversion required here.
- Reorganizing cross-package `include`, `paths`, or package boundaries.
- Changing production runtime behavior or public APIs.
- Changing dependencies.
- Changing workflow topology; the existing ESLint policy guard remains the CI
  entry point.
- Changing build-only test exclusions except for the necessary LSP split that
  preserves current production emission.
- Adjacent lint, formatting, migration, or test cleanup not required to satisfy
  the accepted criteria or make required verification green.
