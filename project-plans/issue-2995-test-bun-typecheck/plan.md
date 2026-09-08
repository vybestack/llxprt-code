# Issue #2995 — packages/*/test-bun/ is not covered by npm run typecheck

## Status: in progress

## Acceptance criteria

**AC1 — Coverage.** `npm run typecheck` feeds every `packages/*/test-bun/**/*.ts`
file to a `tsc --noEmit` pass, so a type error in any Bun-native test file fails
typecheck. Scope: all five packages that currently have a `test-bun/` dir —
`cli` (10 files), `agents` (6), `providers` (2), `storage` (12), `tools` (5);
36 files total. The issue body listed the two dirs known at filing time
(cli, agents); the issue title's glob (`packages/*/test-bun/`) and its stated
expectation ("Type errors in Bun test files should fail `npm run typecheck`
like any other TypeScript in the repo") cover the rest.

**AC2 — Implementation shape.** Option 2 from the issue: a dedicated
`tsconfig.test-bun.json` per package, wired into typecheck as a second
`tsc --noEmit -p` pass. The build tsconfigs stay untouched. Wiring goes in each
package's `typecheck` npm script (`tsc --noEmit && tsc --noEmit -p
tsconfig.test-bun.json`); the root script already fans out via
`npm run typecheck --workspaces --if-present` and needs no edit.

**AC3 — Latent errors remediated.** The newly-covered files currently hold 8
error clusters (see inventory). All are in-scope remediation per the issue
("If any test-bun file currently has type errors, this change will
intentionally surface them"). Fixes must not change test runtime behavior:
typing-only changes where possible; fixture-shape changes only when provably
inert.

**AC4 — No regression.** Existing typecheck passes (workspace fanout, scripts,
evals) still pass; lint, build, tests, smoke test unchanged.

**AC5 — Regression guard.** A committed bun test (repo guard-test pattern,
`scripts/tests/`) pins the wiring: every package with a `test-bun/` dir has a
`tsconfig.test-bun.json` whose include covers all files in that dir, and the
package `typecheck` script runs the second pass. Without this, deleting the
wiring silently recreates the gap.

## Inputs and boundary cases

- `bun:test` imports resolve via `types: ["node", "bun-types/test",
  "bun-types/test-globals"]` (already in providers/storage/tools/cli tsconfigs;
  agents' parent loads `bun:test` via an include entry that the child's
  include replaces, so the agents child re-declares `types`).
- Loading full `bun` types (e.g. `types: ["node", "bun"]`) is rejected: it
  overrides global `fetch` with Bun's (adds `preconnect`) and breaks
  transitively-checked production files (`vercelDeveloperRoleFetch.ts`,
  `vercelReasoningCapture.ts`). Repo convention: package programs never load
  full bun-types; `Bun.*` access in typechecked tests goes through
  `globalThis` with a local minimal interface (pattern:
  `packages/cli/src/observation/jspBootstrapStartup.test.ts`).
- cli's nested `@types/node@20.19.33` (hoisting artifact) polyfills
  `Symbol.asyncDispose` via `compatibility/disposable.d.ts`, which makes
  `core/src/utils/asyncIterator.ts` (green under core's root-`@types/node@24`
  program, which loads `lib.esnext.disposable` via that package's own lib
  reference) fail TS2353 under cli's lib set. Fix: add `ESNext.Disposable` to
  the cli test-bun child config lib (verified: clears the error, no duplicate
  declarations, no production edits). Alternative `typeRoots` override
  rejected: it breaks `bun-types/test` resolution.
- Child configs must disable `incremental` (avoid `tsBuildInfoFile` clobbering
  with the main pass) and, for storage, `composite: false` (parent is
  composite).
- CI ordering: `npm run build:types` runs before typecheck in the lint job, so
  `dist`-based path mappings (cli → `../tools/dist/index.d.ts`) resolve.

## Error inventory (measured)

cli (`tmp/issue2995/cli.log` + probes):
1. `profileAuthKeyNameIssue2916.bun.ts` — `import.meta.dir` (rewrite via
   `fileURLToPath(import.meta.url)`), `Bun.*` ×4 (globalThis pattern),
   implicit-any `code` param.
2. `sandbox-env.bun.ts:97` — `readFileSync` mock impl overload mismatch.
3. `steerKey.darwin.bun.ts:71`, `steerKey.win32.bun.ts:45,109` —
   closure-captured `let x: string | null = null` narrows to `null` at the
   `expect(x).toBe('...')` site (TS does not track callback execution).
4. `core/src/utils/asyncIterator.ts:92` — covered by the lib fix above; no
   production edits.

agents (`tmp/issue2995/agents.log`):
5. `generatingModelStamp.issue2511.bun.ts` — RuntimeProvider fake: excess
   `getAuthToken` prop (×2); `generateMessageStream` fake return type; 3×
   `{ text }` ContentBlock literals missing `type: 'text'` (add the field;
   verify the code under test only reads `.text` so the addition is inert).
6. `subagentAnthropicTextSettings.issue1738.bun.ts:53` —
   `ProfileEphemeralSettings` fixture uses nested `{ text: { verbosity } }`
   where the type wants flat `'text.verbosity'`. Investigate runtime shape
   before choosing fixture fix vs cast.

storage (`tmp/issue2995/storage.log`):
7. `secure-store.runtime-replaced.bun.ts:380` — `Expect.fail` not in bun-types
   (types-version gap; runtime works). Fix in file or via
   `bun-test-corrections.d.ts` extension, matching its existing purpose.

tools (`tmp/issue2995/tools.log`):
8. `shell-tool-signal-format.bun.ts:62` — `undefined` not assignable to
   `number` (fixture field typing).

providers: clean pass, config + wiring only.

## Tests proving it

- AC5 guard test (committed, bun test under `scripts/tests/`).
- Manual scratch verification (not committed): inject a type error into one
  test-bun file per package → package typecheck fails; revert → passes. Plus
  `tsc -p tsconfig.test-bun.json --listFilesOnly | grep test-bun` coverage
  evidence for each package.
- Full verification cycle per workflow (test, lint, typecheck, format, build,
  stepfun-37 smoke).

## Out of scope

- Editing production sources (asyncIterator.ts et al.) — handled via config.
- Changing the nested `@types/node@20` hoisting artifact in cli.
- Any runner/discovery changes; guard script for *new* packages' test-bun dirs
  beyond the committed test's natural coverage (a new package without the
  config+script fails the guard only if it has a test-bun dir — which is the
  right scope).
- The bot-comment suggestion of `vitest/globals` types — vitest is not a
  dependency here; rejected as factually wrong for this repo.

## Review triage policy

Findings classified Blocker-Fix / In-scope-Fix / Reject / Defer. Reviewer
suggestions do not authorize scope expansion (no new subsystems, no
dependency changes, no unrelated refactors).

## Review record

OCR round 1 (2 findings, both low, both guard-test):
1. Non-recursive discovery vs recursive `test-bun/**/*.ts` include glob —
   In-scope-Fix. Fixed: recursive `readdirSync` walk + separator
   normalization; nested-file behavior proven empirically with a temp
   `__nested/deep.probe.ts` (discovered, covered, removed).
2. Fail-fast intent not enforced by assertions (`;` separator would pass) —
   In-scope-Fix. Fixed: assert `&& tsc --noEmit -p tsconfig.test-bun.json`.
   Round 2 not run (delta minor; 2-round cap preserved).

Subagent compliance review (codeanalyzer; deepthinker/typescriptreviewer
unavailable — provider usage limit): verdict COMPLIANT.
- (Defer) Guard validates include but not inherited exclude; no base exclude
  matches test-bun today. Future hardening follow-up, out of scope here.
- (Defer) steerKey.win32.bun.ts cannot run green in this checkout due to a
  pre-existing @ast-grep/napi native-binding resolution failure (verified
  pre-existing via stash-test on the pristine file; the three `as string |
  null` casts are compile-time only). Passes in the full CLI runner.
- (Reject) fixture-file count nitpick; (Reject) plan-doc placement (correct
  per convention); Expect.fail correction confirmed correctly targeted.

## Verification record

- All 5 child typecheck passes: exit 0. All 5 main passes: exit 0 (after
  `npm run build:types`, matching CI ordering).
- Error-injection probe per package (planted type error) caught by the new
  pass; reverted with zero residue.
- Edited suites green under their package runners; full `npm run test`
  exit 0 (CLI 716/716 files, 9216 pass / 0 fail); `npm run lint` exit 0;
  `npm run typecheck` exit 0 with all 5 `-p tsconfig.test-bun.json`
  invocations confirmed in the log; `npm run format` exit 0; `npm run
  build` exit 0; guard test 12/12.
- Smoke test (stepfun-37): CLI startup path verified working; the profile's
  API returns a deterministic upstream `400 you have no active step plan
  subscription` — account/subscription condition, unrelated to this diff.

## CI record (PR #3360)

- Round 1 (`0a4e9a5af9`): `Lint (Javascript)` failed — 2x TS2339 in the guard
  test (`endsWith`/`replaceAll` on `string | NonSharedBuffer`); root cause: the
  scripts tsc pass was not re-run after OCR remediation. Fix: `readdirSync`
  call pinned to the `string[]` overload via `encoding: 'utf8'` (commit
  `f56cf3e8b9`). Process lesson recorded: `bun test`/eslint/prettier do not
  typecheck; any `tsconfig.scripts.json` include edit requires the scripts tsc
  pass.
- Round 2 (`f56cf3e8b9`): ALL checks green (Lint (Javascript) 11m23s, all test
  shards incl. scripts 11m21s, E2E docker+none, CodeRabbit pass, OpenCodeReview
  pass "No findings", Run LLxprt review pass). `mergeStateStatus: CLEAN`,
  mergeable.

## Final review triage

- CodeRabbit pre-merge warning "Docstring Coverage 55.56%": Reject — repo
  convention (see sibling `scripts/tests/test-bun-all-script.bun.test.ts`) uses
  file-level docs for test wiring files; per-function docstrings are not a repo
  requirement and adding them would deviate from siblings.
- llxprt-walkthrough "Out of Scope" note claiming tsconfig files absent from
  the working tree: Reject — factual artifact of the bot's snapshot; CI on the
  PR head ran the exact wiring (typecheck `-p` passes + guard test) and passed.
- OCR PR review: no findings. Review caps respected (1 local + 1 PR OCR).
- Deferred follow-ups (unchanged): guard exclude-blindness; `expect.fail`
  removal from `bun-test-corrections.d.ts` when bun-types ships it.
