# Plan: PowerShell parser tests skip instead of hard-failing when tree-sitter-pwsh is unavailable (Fixes #3309)

Issue: vybestack/llxprt-code#3309
Branch: `issue3309`

## Problem

Five test files in `packages/core/src/utils` throw at module scope when the
PowerShell tree-sitter grammar cannot be loaded:

- `powershell-ast-security.test.ts`
- `shell-parser-pwsh.test.ts`
- `shell-utils.powershell.test.ts`
- `shell-utils.powershell-wrappers.test.ts`
- `shell-utils.pwshUnavailable.test.ts`

Each begins with:

```ts
await initializeParser();
const pwshAvailable = isParserAvailable('powershell');
if (!pwshAvailable) {
  throw new Error('PowerShell grammar failed to load under Bun');
}
```

The throw fires before the `describe.skipIf(!pwshAvailable)` guards that
already exist in three of the five files, so the graceful-skip path is dead
code and a developer with an incomplete `tree-sitter-pwsh` install gets five
opaque file failures. The message also misattributes the cause to Bun: on the
reproducing machine the dependency was not installed at all.

Root cause lead confirmed in-repo: root `package.json` and `bun.lock` both list
`tree-sitter-bash` in `trustedDependencies` but omit `tree-sitter-pwsh`, whose
`scripts.install` is `node-gyp-build`. Bun skips install scripts for untrusted
packages.

Runtime facts that constrain the design:

- The PowerShell grammar loads only under Bun via the
  `tree-sitter-pwsh/tree-sitter-powershell.wasm` file through `web-tree-sitter`
  (`shell-parser.ts` gates on `isBunRuntime()`; under Node the PowerShell path
  deliberately fails closed because the WASM triggers a V8 Zone OOM at
  shutdown under Node 24). These tests run under `bun:test`, so they always
  execute under Bun.
- `packages/core/bun-preload.ts` (the bun:test preload for the whole core
  workspace) force-sets `process.env.CI = 'true'` as a browser-launch safety
  override, so `process.env.CI` is `'true'` on EVERY core bun test run, local
  or CI. Reading `CI` directly cannot distinguish the two. The preload now
  stashes the runner's original value in `CI_BEFORE_TEST_PRELOAD` (empty
  string when unset) before overriding, and the policy helper prefers the
  stash with a fallback to `process.env.CI` for runs without the preload.
- The product feature is Windows-only at runtime, but the tests are
  host-independent by design; PR CI (ubuntu) and the nightly macOS `core`
  shard pass with the grammar loading. No OS gating.
- The unguarded top-level describe at
  `shell-utils.pwshUnavailable.test.ts:83` currently relies on the module
  throw; it must come under the same guard because its lifecycle tests require
  the grammar to be restorable.

## Acceptance criteria

- **AC1 (local skip):** With `tree-sitter-pwsh` unavailable and no `CI` env,
  `bun test` over the five files reports the PowerShell describes as skipped
  (no file failures) and prints one message per file naming the missing
  `tree-sitter-pwsh` dependency and a repair command (`bun install` or
  `npm install` at the repo root).
- **AC2 (CI fails loudly):** With `CI` set (any non-empty value) and the
  grammar unavailable, the files fail at module scope with an actionable
  message naming `tree-sitter-pwsh` and the repair command. The message must
  not blame the Bun runtime.
- **AC3 (no coverage loss):** With the grammar present, the same test set runs
  and passes exactly as today, on every platform (PR ubuntu job, nightly
  Windows/macOS `core` shards). Inner guards (`beforeAll` availability checks,
  `restoreParsers` lifecycle throws) stay unchanged.
- **AC4 (one policy per file):** Each file carries a single availability
  policy sourced from one shared helper; the dead-guard duplication is removed
  (all top-level PowerShell describes use the shared guard, including the
  currently unguarded describe in `shell-utils.pwshUnavailable.test.ts`).
- **AC5 (install root cause):** The root cause of the missing install is
  identified and documented. The issue's conditional ("if it is the
  `trustedDependencies` omission, add it") resolves to FALSE — see
  "Root-cause finding" below — so no trust-list change is made and the
  documented, guard-enforced security decision stands.
- **AC6 (behavioral tests):** New tests prove the policy without mocks:
  - decision matrix of the shared helper (available × CI → run / skip+reason /
    fail+message), calling the real exported function;
  - the real unavailable path in `shell-parser.test.ts`: after a real
    `resetParser()`, PowerShell parse functions fail closed (return their
    documented unavailable results) instead of throwing, and a subsequent
    `initializeParser()` restores availability.

## Root-cause finding (AC5)

The `trustedDependencies` omission is NOT the root cause, and adding
`tree-sitter-pwsh` there was reverted after CI correctly rejected it:

- `scripts/tests/bun-workspaces.test.ts` asserts the trust list equals an
  exact reviewed allowlist ("no over- or under-trust"), and
  `dev-docs/bun.md` ("Why other lifecycle-script packages are NOT trusted")
  records the deliberate decision: only the package's published
  `tree-sitter-powershell.wasm` is loaded (via `web-tree-sitter`); the
  install script (`node-gyp-build`) builds a native Node binding that is
  never imported and is runtime-gated out under Node.
- Bun installs untrusted packages and only skips their lifecycle scripts, and
  the WASM ships in the package `files` — so untrusted status cannot make the
  grammar missing. The issue's own evidence (`npm ls tree-sitter-pwsh` →
  empty, under npm, which ignores `trustedDependencies` entirely) shows the
  reproducing machine had a broken/partial mixed npm/bun install (the same
  class of local breakage as the stale cross-platform `node_modules/.bin/bun`
  binary found during verification).
- CI proved this independently: the `[core 1of1]` ubuntu shard passed with
  the grammar loading both before (main) and after this change.

The graceful-skip policy is therefore the correct remedy: a broken local
install degrades to skips plus a message naming `tree-sitter-pwsh` and the
repair command (`bun install` / `npm install` at the repo root), while real
CI keeps failing loudly.

## Boundary cases

- `CI=''` (empty string) counts as not-CI; any non-empty string counts as CI.
- If `initializeParser()` fails entirely (bash grammar also missing), the
  files still degrade to skip locally rather than file-failing.
- The policy helper is only for these test files; production code paths
  (`shell-parser.ts`, `shell-utils.ts`) are out of scope and unchanged.

## Implementation steps

1. New shared helper `packages/core/src/test-utils/pwsh-test-policy.ts`
   exporting a pure decision function
   `resolvePwshTestPolicy({ available, ci })` returning
   `{ skip, skipReason, failureMessage }` plus the env-aware wrapper
   `resolvePwshTestPolicyFromEnv(available)` that reads
   `process.env.CI_BEFORE_TEST_PRELOAD ?? process.env.CI`, with the two
   message strings (skip reason, CI failure) defined once in the helper, both
   naming `tree-sitter-pwsh` and the repair command.
2. `packages/core/bun-preload.ts` stashes the original CI value in
   `CI_BEFORE_TEST_PRELOAD` (empty string when unset) before its
   `process.env.CI = 'true'` browser-safety override.
3. Update the five test files to:
   - drop the unconditional module-scope throw;
   - call `resolvePwshTestPolicyFromEnv(isParserAvailable('powershell'))`;
   - throw `failureMessage` when present (CI case);
   - write `skipReason` to stderr when skipping;
   - declare `const describePwsh = describe.skipIf(policy.skip);` and use it
     for every top-level PowerShell describe (replacing inline
     `describe.skipIf(!pwshAvailable)` occurrences, including the previously
     unguarded describe in `shell-utils.pwshUnavailable.test.ts`).
4. Tests:
   - new `packages/core/src/test-utils/__tests__/pwsh-test-policy.test.ts`
     covering the decision matrix and the stash/fallback env wrapper (AC6);
   - extend `packages/core/src/utils/shell-parser.test.ts` with the real
     resetParser unavailable-path case (AC6), restoring parsers afterwards.
5. ~~Add `"tree-sitter-pwsh"` to root `package.json` `trustedDependencies`~~
   REVERTED after CI round 1: the scripts-shard guard
   (`bun-workspaces.test.ts`, "trusts exactly the intended native-binary
   allowlist") correctly rejected it — the omission is a documented,
   deliberate decision, and the evidence disproves it as root cause (see
   "Root-cause finding"). Step 5's surviving obligation is the root-cause
   identification itself, recorded above and in the PR.
6. End-to-end verification of AC1/AC2 on a real missing install: temporarily
   move `node_modules/tree-sitter-pwsh` aside, run the five files
   (expect 239 skips + the dependency-naming message, exit 0) and one file
   with `CI=true` (expect module-scope failure with the actionable message),
   then restore the directory unconditionally.
7. Full verification cycle (skill): `npm run test`, `npm run lint`,
   `npm run typecheck`, `npm run format`, `npm run build`, and the
   stepfun-37 smoke test via `bun scripts/start.ts`.

## Out of scope

- The two failing tests in the nightly Windows `core` shard (separate issue).
- Any change to production shell parsing/permission behavior.
- Any OS-based test gating.
- npm-vs-bun lockfile unification work and any `trustedDependencies` change
  (rejected by evidence and by the documented security decision).

## Review record

Round 1 (deepthinker) returned two HIGH findings, both fixed and re-verified:

1. `shell-parser.test.ts` — the new "PowerShell parser unavailable path"
   describe assumed a missing grammar could be re-initialized and hard-failed
   (2 opaque failures) on a real missing install. Fixed by applying the same
   shared policy in that file (module-scope CI throw / stderr skip note) and
   guarding the describe with `describe.skipIf(pwshPolicy.skip)`.
   Re-verified: missing-grammar local run over all six affected files is
   38 pass / 241 skip / 0 fail / exit 0; `CI=true` fails with the actionable
   message.
2. `shell-parser-pwsh.test.ts` — the top-level "Parser.ParseInput conformance
   (Windows-only)" describe used only the platform condition and bypassed the
   shared policy, so Windows with a missing grammar would run and fail
   opaquely. Fixed by combining conditions:
   `describe.skipIf(process.platform !== 'win32' || pwshPolicy.skip)`.
   Windows-with-grammar coverage is unchanged; macOS behavior (5 pre-existing
   skips) is unchanged.

Verification status: full cycle passed twice (test/lint/typecheck/format/build
and the stepfun-37 smoke test); two different `packages/agents` timeout flakes
across the two runs (`policyControl.behavior.test.ts` T4 180s, then
`cli-turn-parity.spec.ts` T10 30s), each proven unrelated by isolation
re-runs (6/6 and 3/3 pass) — load-induced flakiness in that workspace, with
core 393/393 and CLI 714/714 green on both runs.

PR CI round 1: all shards green except `Test (ubuntu-latest) [scripts 1of1]`,
which failed on the exact-allowlist trustedDependencies guard after the
(provisional) trust addition. Remediation: reverted the trust addition (see
"Root-cause finding"), corrected the plan and PR description, re-ran the
verification cycle.

Verification round 3 (post-revert, logs in `tmp/verify3309/`): format,
typecheck, lint, build all pass. Full suite: only two failures, both
`packages/agents` 180s timeouts under concurrency-4 load
(`agent.approvalMode.behavior.test.ts` T1, `workspaceControl.behavior.test.ts`),
both proven passing in isolation (5/5 in 2.7s, 6/6 in 1.7s) — the third
consecutive run with a different random agents-workspace timeout pair; every
PowerShell/policy file green in the full run. stepfun-37 smoke: passed at
2026-08-24 20:40 on this same tree (`[stepfun-37:step-3.7-flash]`, haiku,
exit 0, `/tmp/smoke.log`); two retries after the revert fail with an external
API 400 "you have no active step plan subscription" — the account's step plan
lapsed mid-session. The diff is test-only (`bun-preload.ts` loads solely via
bunfig `[test] preload`), so no code path connects it to the CLI startup
smoke; recorded as an external blocker, not a regression.
