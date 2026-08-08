# Issue #2970 — Remove all Vitest escape hatches

Terminal sub-issue of #2578. When this lands, Vitest is gone from the repository.

## Precondition (met)

#2969 / PR #3122 merged as `18108c62c`. Only 10 files still reference the `vitest`
specifier, and 9 of them are the Vitest config files this issue deletes.

## Grounding evidence

Vitest is already **completely non-functional** on `main`:

```
$ npx vitest run --config vitest.config.ts src/llm-types/modelEnvelope.test.ts
  import { describe, expect, it } from 'bun:test';
  Caused by: Error: Failed to load url bun:test (resolved id: bun:test)
  Test Files  1 failed (1) | Tests  no tests
```

Every test now imports `bun:test`, which Vite cannot resolve. Therefore:

- All 6 `test:vitest` scripts are dead.
- All 4 Stryker configs (`testRunner: "vitest"`, `configFile: "vitest.config.ts"`) are dead.
- `@vitest/coverage-v8` has no producer: no workspace `test` script invokes Vitest.

Removing these loses **no working capability**. This is the evidence that satisfies the
issue's "capability must have a Bun-native equivalent before removal" gate: there is no
capability left to preserve.

## Accepted behavior

### B1 — No Vitest escape-hatch scripts

Delete `test:vitest` from: `auth`, `lsp`, `mcp`, `providers`, `storage`, `tools`.

### B2 — No Vitest config files

Delete: `packages/{auth,core,lsp,mcp,providers,storage,tools}/vitest.config.ts`,
`packages/storage/vitest.config.{native-keyring,fallback-behavior}.ts`, and the root
`vitest.coverage.ts`.

### B3 — No Vitest dependencies

Remove from all manifests and `bun.lock` / `package-lock.json`:
`vitest`, `@vitest/coverage-v8`, `@vitest/eslint-plugin`, `@fast-check/vitest`,
`@stryker-mutator/vitest-runner`.

`@fast-check/vitest` has **zero importers** — its two remaining mentions are comments
explaining that it was replaced by plain `fast-check`.

### B4 — ESLint enforcement preserved, not dropped

Replace `@vitest/eslint-plugin` with `eslint-plugin-jest` configured for Bun:

```js
settings: { jest: { globalPackage: 'bun:test' } }
```

14 of 17 active rules port 1:1 (same rule names, same options):
`expect-expect` (keep `assertFunctionNames`), `no-standalone-expect` (keep
`additionalTestBlockFunctions`), `no-identical-title`, `valid-expect`, `valid-title`,
`valid-describe-callback`, `no-conditional-expect`, `no-conditional-in-test`,
`require-to-throw-message`, `prefer-strict-equal`, `max-nested-describe`,
`require-top-level-describe`, `no-commented-out-tests` (off), `no-disabled-tests` (off).

`vitest/no-import-node-test` becomes a `no-restricted-imports` entry banning `node:test`
in test files — same invariant, different mechanism.

Two rules have no `bun:test` equivalent and are dropped as inapplicable, not as loosening:
`prefer-called-exactly-once-with` and
`require-local-test-context-for-concurrent-snapshots` (both encode Vitest-runner concepts).

Also update the three `vitest/*` overrides in the `packages/tools` block to `jest/*`.

Net enforcement must not decrease. `npm run lint` must stay at 0 warnings.

### B5 — Dead Vitest-testing-Vitest tests deleted

- `packages/test-utils/src/quota-guard-vitest-integration.test.ts`
- `scripts/tests/vitest-coverage.test.ts`

(The other two named in the issue were already deleted by earlier slices.)

### B6 — CI runs the Bun-native SecureStore split

`ci.yml` `secure_store_backend` and `nightly.yml` currently call
`npm run test:vitest --workspace ...-storage -- --config vitest.config.*.ts`.

Replace with the Bun-native scripts that **already exist** in
`packages/storage/package.json`:

- `test:secure-store:keyring` → `secure-store.native-keyring.test.ts`
- `test:secure-store:fallback` → `secure-store.fallback-behavior.test.ts` +
  `provider-key-storage.fallback.test.ts`

Both already emit `junit.secure-store.xml`, which the existing test-reporter step
consumes unchanged. Replace the `test-config` matrix axis with a `test-script` axis.

### B7 — Vestigial coverage and Vitest-tuning plumbing removed

- `VITEST_MAX_FORKS` / `VITEST_MIN_FORKS` / `VITEST_TEST_TIMEOUT` / `VITEST_POOL_TIMEOUT`
  steps and env in `ci.yml` and `nightly.yml` — Bun reads none of them.
- `LLXPRT_COVERAGE` env, the `Upload coverage reports` step, and the
  `post_coverage_comment` job with its two `continue-on-error` downloads.
- `.github/actions/post-coverage-comment` if it becomes unreferenced.
- Stale Vitest comments in `ci.yml` (lines ~841, ~899, ~985, ~1024–1049, ~1076).

### B8 — Stryker mutation testing removed

Delete `packages/{core,mcp,providers}/stryker*.conf.json`, the
`@stryker-mutator/*` devDependencies, the `test:mutation` scripts, and
`dev-docs/stryker.md`.

It is unreachable (Vitest cannot load `bun:test`), wired into zero workflows, and
`dev-docs/stryker.md` already documents `packages/cli/vitest.config.mutation.ts`, deleted
by an earlier slice. Re-establishing mutation testing on Bun is a separate concern; file
a follow-up issue rather than expanding this PR.

### B9 — Collateral references corrected

Not listed in the issue but discovered by inventory; all break without a fix:

1. `packages/providers/src/package-boundary.test.ts` asserts `vitest.config.ts` **exists**.
   Invert to assert its absence, preserving the boundary intent.
2. `scripts/affected-lint-targets.ts` and `scripts/affected-test-shards.ts` list
   `vitest.coverage.ts` as a scripts-shard trigger file.
3. `scripts/tests/affected-test-shards.test.ts:692` asserts that trigger.
4. `packages/vscode-ide-companion/tsconfig.json` excludes a `vitest.config.ts`.
5. Stale comments in `scripts/check-settings-boundary.ts`,
   `scripts/genai-enclave/config.ts`, `packages/cli/run-bun-tests.ts`,
   `packages/storage/test-setup-bun-session-reset.ts`,
   `packages/tools/src/__tests__/todo-contract.test-d.ts`.
6. `scripts/tests/genai-enclave-adversarial.test.ts` uses `'vitest.config.ts'` as a
   classifier fixture — retarget to a still-plausible config filename.

### B10 — CI guard against regression

New `scripts/check-no-vitest.ts`, wired as `npm run lint:no-vitest` in the existing lint
guard job in `ci.yml` alongside `lint:eslint-guard`.

Fails when any of these appear outside the guard's own source and its test fixtures:

- an import/require of the `vitest` specifier or a `vitest/*` subpath;
- a `vitest`, `@vitest/*`, `@fast-check/vitest`, or `@stryker-mutator/vitest-runner`
  dependency entry in any manifest;
- a `vitest.config.*` / `vitest.*.config.*` file anywhere in the tree;
- a package script that invokes the `vitest` binary.

Follows the conventions of `scripts/check-legacy-paths.ts`: reports every offending
`file:line:match` (detection, not counting), supports a root override env var so tests can
scan a temp fixture tree, and exits non-zero on any hit.

### B11 — Documentation has one canonical command

`dev-docs/bun.md`, `dev-docs/test-runner-inventory.md`, `dev-docs/RULES.md`,
`dev-docs/PLAN.md`, `dev-docs/schema-guide.md`, `dev-docs/REGRESSION_TESTS.md`,
`dev-docs/npm.md`, `docs/hooks/writing-hooks.md`, `CONTRIBUTING.md`, `AGENTS.md`:
no Vitest instructions; one canonical Bun-native test command.

## Tests (behavioral, written first)

`scripts/tests/no-vitest-guard.test.ts`, following the fixture-tree style of
`scripts/tests/legacy-paths-guard.test.ts`:

| # | Given | Then |
|---|---|---|
| 1 | clean fixture tree | exit 0, no findings |
| 2 | file with `import { it } from 'vitest'` | exit non-zero, reports that file:line |
| 3 | file with `import ... from 'vitest/config'` | exit non-zero |
| 4 | manifest with `"vitest"` in devDependencies | exit non-zero |
| 5 | manifest with `"@vitest/coverage-v8"` | exit non-zero |
| 6 | manifest with `"@fast-check/vitest"` | exit non-zero |
| 7 | manifest with `"@stryker-mutator/vitest-runner"` | exit non-zero |
| 8 | a `vitest.config.ts` file | exit non-zero |
| 9 | a `vitest.config.native-keyring.ts` file | exit non-zero |
| 10 | script `"test:vitest": "vitest run"` | exit non-zero |
| 11 | the word "vitest" in prose/comment only | exit 0 — no false positive |
| 12 | two distinct violations | both reported, not just the first |

Real process invocation against a real temp tree. No mocking of the guard.

The repository itself passing `npm run lint:no-vitest` is the end-to-end proof of B1–B3.

## Boundaries

Out of scope: rewriting test imports (done by #2969); changing assertions or coverage
thresholds; restoring coverage or mutation testing on Bun (follow-up issues).

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`,
and `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
