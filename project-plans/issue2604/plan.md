# Plan: Fix Windows nightly process launching under Node 24

Plan ID: PLAN-20260720-ISSUE2604
Generated: 2026-07-20
Total Phases: 6
Requirements: REQ-2604-001 through REQ-2604-006
Issue: https://github.com/vybestack/llxprt-code/issues/2604
Branch: `issue2604`

## Scope and outcome

This is an implementation plan only. The planning pass changes no production code. Implementation must use strict RED-GREEN sequencing and behavioral subprocess tests. It must not replace real process execution with assertions that a mocked `spawn` received particular arguments.

The intended outcome is:

1. `scripts/check-agents-api-surface.mjs` runs TypeScript with the current Node executable and the repository's installed TypeScript JavaScript entry point, without `npx.cmd`.
2. On Windows, both launcher implementations prefer every usable native Bun executable (`bun.exe`, including the direct `bun` dependency and `PATH`) before considering a `.cmd` wrapper.
3. Native launcher execution preserves argument boundaries for multiword prompts and command-shell metacharacters because it does not use a shell.
4. `packages/cli/bin/llxprt.cjs` is generated deterministically from a checked-in canonical source and CI/build checks reject drift.
5. The already-merged nightly notifier fix from PR #2596 remains intact and gains explicit regression coverage; `.github/workflows/nightly.yml` is not reimplemented for this issue.

## Critical reminders

- Complete Phase 0.5 before implementation.
- For each behavioral change, add the test, run it, and record the expected RED failure before changing production code.
- Tests must launch the real checker or launcher process. Existing dependency seams may remain for narrow failure-path tests, but mock-call assertions are not proof for REQ-2604-001 through REQ-2604-004.
- Do not modify `.llxprt/` or any file below it.
- Do not commit or push until the implementation and all verification gates are complete.

## Requirements

### REQ-2604-001: Run the agents API-surface guard without npm command shims

**Full text**: On supported Node.js 24, including Windows, the agents API-surface guard must execute the repository's TypeScript compiler without invoking `npx`, `npx.cmd`, or another command-shell shim.

**Behavior**:

- GIVEN: dependencies are installed and `node_modules/typescript/bin/tsc` is resolvable;
- WHEN: `node scripts/check-agents-api-surface.mjs` runs with `npm`/`npx` unavailable on `PATH`;
- THEN: declaration emission, report generation, and snapshot validation complete successfully.

### REQ-2604-002: Prefer native Bun on Windows

**Full text**: On Windows, the launcher must select a usable native Bun executable from local dependency locations or `PATH` before selecting any `bun.cmd` wrapper. POSIX ordering and checked-in no-compile behavior must remain compatible.

**Behavior**:

- GIVEN: `node_modules/.bin/bun.cmd` exists and either `node_modules/bun/bin/bun.exe` or a `PATH` `bun.exe` exists;
- WHEN: the Node launcher resolves Bun;
- THEN: it executes a native `.exe`, not the `.cmd` shim.

### REQ-2604-003: Preserve Windows argument boundaries

**Full text**: When native Bun is available, the Node-to-Bun launch must preserve each CLI argument exactly, including multiword `--prompt` values and values containing Windows command-shell metacharacters, without `shell: true`.

**Behavior**:

- GIVEN: native Bun is available and the launcher receives `--prompt`, `hello world`, and a value such as `hello & whoami` as discrete arguments;
- WHEN: the checked-in launcher starts a child entry;
- THEN: the child observes the original argument array exactly and exits normally.

### REQ-2604-004: Preserve safe fallback diagnostics

**Full text**: If no native Bun executable is usable, the existing `.cmd` fallback may remain, but unsafe shell forwarding must still fail with exit code 43 and actionable install/PATH guidance. Missing Bun and spawn failures must retain actionable diagnostics.

### REQ-2604-005: Keep source and generated launcher synchronized

**Full text**: The published `packages/cli/bin/llxprt.cjs` must be reproducibly generated from a checked-in canonical launcher source. A deterministic check must fail if the generated file differs from fresh generation.

### REQ-2604-006: Regression-protect nightly notifier repository targeting

**Full text**: The checkout-free `notify_failure` job must continue to set `GH_REPO: '${{ github.repository }}'` and pass `--repo "${GH_REPO}"` to every `gh` label/issue operation.

**Scope constraint**: PR #2596 was merged at `947c7d3c5cd1d3d9131f28f4403df41e5c093060` and the fix is already on this branch. Add regression assertions in `scripts/tests/release-process.test.js`; do not rewrite the workflow behavior.

## Phase 0.5: Preflight verification and recorded RED evidence

### Phase ID

`PLAN-20260720-ISSUE2604.P0.5`

### Repository findings

| Area | Grounded finding |
| --- | --- |
| Branch | `git status --short --branch` reported `## issue2604` before this plan was created. |
| Issue | `gh issue view 2604 --comments` confirms Node 24.18.0 Windows failures in the API guard and launcher, plus notifier remediation already handled by #2596. |
| API guard | `scripts/check-agents-api-surface.mjs` currently calls `execFileSync('npx.cmd', ['tsc', '-p', tempConfigPath])` on Windows. Existing `packages/agents/src/api/__tests__/publicSurface.guard.test.ts` only consumes the generated report; it intentionally does not execute the checker. `scripts/tests/preflight-ci.test.js` and `scripts/tests/release-process.test.js` check orchestration/order, not checker process portability. |
| API guard architecture | `project-plans/issue2285/analysis/api-guard-mechanism.md` establishes the B1a isolated temporary tsconfig and standalone checker contract. Preserve that mechanism, report path, snapshot comparison, timeout, cleanup, and fail-closed semantics. Only compiler process acquisition changes. |
| Runtime launcher call path | `packages/cli/bin/llxprt.cjs` is the root and CLI workspace `bin`; `packages/test-utils/src/test-rig.ts` launches `node <packages/cli/bin/llxprt.cjs>`. `appendUserArgs` adds a string prompt as two array entries (`--prompt`, exact string), and `packages/test-utils/src/process-run.ts` calls `spawn` without a shell. Argument flattening therefore occurs in the launcher, not the test rig. |
| TypeScript launcher call path | `packages/cli/index.ts` imports and invokes `runBunLauncherIfNeeded()` before loading the CLI. It delegates to `packages/cli/src/launcher/bun-path-resolver.ts`; keep this resolver behavior aligned with the generated CJS launcher. |
| Current Windows ordering | Both `packages/cli/src/launcher/bun-path-resolver.ts` and `packages/cli/bin/llxprt.cjs` inspect `.bin/bun.cmd` at an ancestor before proceeding to that ancestor's direct dependency or `PATH`. This lets the shim mask native `node_modules/bun/bin/bun.exe` and setup-bun's `PATH` executable. |
| Existing launcher tests | `bun-path-resolver.test.ts`, `bun-launcher.test.ts`, `bun-launcher-signals.test.ts`, `cli-bin.test.ts`, and `cli-bin.e2e.test.ts` cover resolution, launch/error/signal behavior, and a real Node-to-Bun credential path. However, the CJS unit tests inject `resolveBun`, and the current E2E helper also supplies a concrete Bun path, so they bypass the defective default resolver. Several tests assert mock calls rather than child-observed arguments. |
| Existing Windows test portability | Running the focused resolver suite on Windows produced 18 failures because synthetic POSIX-style expected paths are compared with host-Windows `node:path` output; `defaultPathCommand(process.execPath, ...)` also fails because the implementation enables a shell on Windows. This test debt must be corrected without weakening coverage. |
| Checked-in launcher origin | PR #2305 and commit `22b9f1037` describe `packages/cli/bin/llxprt.cjs` as a hand-maintained, checked-in CommonJS launcher. Git history shows later edits (for example #2474) changed only that file and its tests. Searches of `package.json`, `packages/cli/package.json`, `scripts/build.ts`, `scripts/prepare-package.ts`, and repository scripts found no launcher generator or freshness check. |
| Notifier | `.github/workflows/nightly.yml` already sets `GH_REPO: '${{ github.repository }}'` and passes `--repo "${GH_REPO}"` to label create/list, issue list/comment/create. Current `release-process.test.js` passes but does not assert `GH_REPO` or all repository arguments. |

### Current RED evidence

1. **API guard, exact reproduction**

   ```powershell
   node --version
   npm run lint:agents-api-surface
   ```

   Observed on this branch:

   ```text
   node=v24.18.0
   Agents API-surface guard FAILED: tsc spawn failed with system error code 'EINVAL'
   (errno -4071) syscall 'spawnSync npx.cmd' on 'npx.cmd': spawnSync npx.cmd EINVAL
   ```

2. **Default launcher, real subprocess and default Bun resolution**

   A temporary wrapper outside the repository required `packages/cli/bin/llxprt.cjs`, injected only a temporary child entry, and left `resolveBun` at its production default. The child printed its observed argv.

   ```text
   input:  --prompt "hello world"
   output: ["--prompt","hello","world"]
   exit:   0

   input:  --prompt "hello & whoami"
   output: no child output
   exit:   43
   error:  Cannot safely forward arguments containing Windows command-shell metacharacters through the bundled bun.cmd shim.
   ```

   The machine had all of the following at the time: `node_modules/.bin/bun.cmd`, `node_modules/bun/bin/bun.exe`, and `C:\Users\acoli\.bun\bin\bun.exe`. Thus this is the exact native-masked-by-shim defect.

3. **Resolver ordering characterization**

   Executing the real `resolveBunPath` with a filesystem-shaped checker returned `C:\repo\node_modules\.bin\bun.cmd` without probing the available direct dependency executable or `PATH` result.

4. **Native spawn control**

   A real `spawnSync(process.execPath, [...], { shell: false })` child observed `['hello world', 'a&b']` unchanged, proving native Windows process launch can satisfy REQ-2604-003 without command-shell quoting.

5. **Focused baseline**

   ```powershell
   npm run test --workspace @vybestack/llxprt-code -- src/launcher/bun-path-resolver.test.ts src/launcher/bun-launcher.test.ts src/launcher/cli-bin.test.ts
   ```

   Current result: `cli-bin.test.ts` and `bun-launcher.test.ts` pass; `bun-path-resolver.test.ts` has 18 Windows-host failures described above. These fixture failures must not be confused with the new behavioral RED tests.

6. **Notifier baseline**

   ```powershell
   npm run test:scripts -- scripts/tests/release-process.test.js
   ```

   Current result: 35/35 pass. New repository-target assertions should be GREEN immediately because the behavior is already fixed on main.

### Dependency and contract verification

- `typescript` is a root dev dependency (`5.8.3`) and `require.resolve('typescript/bin/tsc')` is available after `npm ci`.
- Node `>=24` and Bun `>=1.3.14` are declared at the root; the CLI depends on `bun@1.3.14`.
- The no-compile package contract requires the generated launcher to remain CommonJS, executable by Node, included in both package `bin` mappings, and usable before any project build.
- `packages/cli/src/launcher/bun-launcher.ts` preserves `shell: true` only for a selected `bun.cmd` fallback and rejects metacharacters there. That fallback safety is intentional and must remain; normal Windows selection must avoid reaching it when native Bun exists.

### Generation decision and exact commands

There is **no current generation command** for `packages/cli/bin/llxprt.cjs`; this absence is a verified drift risk, not an undocumented command to preserve.

Implementation will establish these exact commands:

```powershell
npm run generate:cli-launcher
npm run check:cli-launcher
```

with package-script expansions:

```text
npm run generate:cli-launcher -> bun scripts/generate-cli-launcher.ts
npm run check:cli-launcher    -> bun scripts/generate-cli-launcher.ts --check
```

The generator will bundle the canonical `packages/cli/src/launcher/cli-bin.cts` for Node/CommonJS into `packages/cli/bin/llxprt.cjs`, retain the Node shebang, write deterministically, and preserve executable mode where the platform supports it. `--check` will generate in memory or a temporary path and compare bytes; it must never silently rewrite the checked-in output.

### Preflight gate

- [x] Issue and comments read through `gh`.
- [x] Relevant historical PRs #2290, #2305, #2315, and merged #2596 inspected through `gh`.
- [x] Existing API guard plan and mechanism inspected.
- [x] Launcher, resolver, generated/check mechanism (currently absent), tests, test-utils launch path, and nightly notifier inspected.
- [x] Safe RED behavior reproduced on Windows Node 24.18.0.
- [x] Exact future generation and check commands selected.

## Phase 01: RED — portable API-surface checker process test

### Phase ID

`PLAN-20260720-ISSUE2604.P01`

### Requirements implemented

REQ-2604-001.

### Test tasks

Create `scripts/tests/check-agents-api-surface.test.ts`.

The test must:

1. Spawn the real checker with `process.execPath` and the absolute path to `scripts/check-agents-api-surface.mjs`.
2. Use the repository root as `cwd`.
3. Supply an environment in which npm/npx command shims are unavailable on `PATH`, while retaining the remaining environment required by Node/TypeScript.
4. Assert exit code 0 and the existing success message (`PASS: agents API-surface report matches expected snapshot.`).
5. On failure, include captured stdout/stderr in the assertion message.
6. Avoid mocking `execFileSync`, TypeScript, or the checker.

### RED command

```powershell
npm run test:scripts -- scripts/tests/check-agents-api-surface.test.ts
```

Expected RED before production changes: the child exits 1 because `npx`/`npx.cmd` cannot be found (on current Windows Node 24 it may report `EINVAL` before the restricted-PATH condition). Record the exact output in implementation notes.

### Success gate

- Test fails for inability to launch `npx`/`npx.cmd`, not for a malformed test fixture.
- Existing B1a declaration and report tests remain untouched.

## Phase 02: GREEN — launch local TypeScript CLI with Node

### Phase ID

`PLAN-20260720-ISSUE2604.P02`

### Prerequisite

Phase 01 RED is recorded.

### Production task

Modify only the compiler acquisition/execution and related diagnostics in `scripts/check-agents-api-surface.mjs`:

1. Resolve TypeScript's JavaScript CLI from the installed repository dependency, anchored to the checker/repository (for example with `createRequire(import.meta.url).resolve('typescript/bin/tsc')`). Do not search `PATH` and do not use `npx`.
2. Execute `process.execPath` with `[resolvedTscCli, '-p', tempConfigPath]` through `execFileSync`.
3. Keep `cwd`, stdio capture, encoding, max buffer, 120-second timeout, temporary tsconfig, cleanup handlers, report path, parser, deny list, and snapshot checks unchanged.
4. Update ENOENT/error diagnostics to distinguish missing Node from an unresolvable/missing local TypeScript CLI. Remove stale advice that requires npm/npx on `PATH`.
5. Preserve the original error cause details for timeout, signal, TypeScript nonzero exit, and system spawn failures.

### GREEN commands

```powershell
npm run test:scripts -- scripts/tests/check-agents-api-surface.test.ts
npm run lint:agents-api-surface
npm run test --workspace @vybestack/llxprt-code-agents -- publicSurface.guard
```

Expected: all pass; the report is generated at `node_modules/.cache/agents-api-surface/report.json` and still matches the checked-in snapshot.

## Phase 03: RED — real launcher behavior, candidate ordering, generation drift, and notifier characterization

### Phase ID

`PLAN-20260720-ISSUE2604.P03`

### Requirements implemented

REQ-2604-002 through REQ-2604-006.

### 03A. Real Windows launcher subprocess tests

Extend `packages/cli/src/launcher/cli-bin.e2e.test.ts` with a helper that launches a real Node wrapper and the real checked-in launcher. It may inject a temporary child entry so the test is deterministic, but it must **not** inject `resolveBun` for these regression cases.

Add Windows-only tests (`it.runIf(process.platform === 'win32')`) that use the installed repository shape (`.bin/bun.cmd` plus `node_modules/bun/bin/bun.exe`):

1. The child reports a native `process.execPath` ending in `bun.exe`, proving default resolution bypassed `bun.cmd`.
2. `['--prompt', 'hello world']` reaches the child exactly as two arguments.
3. `['--prompt', 'hello & whoami']` reaches the child exactly, exits 0, and does not emit the `.cmd` metacharacter diagnostic.
4. The test uses temporary files and cleans them in `finally`; it performs no provider/keychain/network operation.

Add a fallback case using an isolated temporary launcher/package layout with only a `.cmd` candidate (or retain a focused existing seam test if an actual isolated `.cmd` launch is not portable). Verify metacharacters still produce exit 43 and actionable native-Bun/PATH guidance. This fallback case does not replace the real native-path tests.

### 03B. Resolver ordering tests

Update `packages/cli/src/launcher/bun-path-resolver.test.ts` before production changes:

- Replace host-incompatible `/repo/...` equality fixtures with paths assembled through `node:path` from a host-native fixture root.
- Add RED cases proving native-before-wrapper ordering across candidate classes:
  - local `.bin/bun.cmd` plus direct dependency `bun.exe` -> direct dependency executable;
  - local `.bin/bun.cmd` plus `PATH` `bun.exe` -> PATH executable;
  - no native candidate -> remembered `.cmd` fallback;
  - POSIX `.bin`/direct/PATH order remains unchanged.
- Keep these narrow pure-policy tests, but treat the E2E child-observed argv tests as the acceptance proof.
- Update `defaultPathCommand` coverage to require real Windows invocation without `shell: true` (use the native `where.exe` path/command behavior).

### 03C. Source/generated synchronization tests

Create `scripts/tests/generate-cli-launcher.test.ts` and add RED checks that:

1. `npm run generate:cli-launcher` produces a Node-loadable CommonJS launcher with the shebang.
2. `npm run check:cli-launcher` succeeds when source and output match.
3. Checking a deliberately stale temporary output returns nonzero with a command telling the developer to run `npm run generate:cli-launcher`.
4. Two generations from the same source are byte-identical.
5. The generated launcher still exports `runCliBin` for existing tests and can execute `--version` without a prior CLI build.

The generator may expose test-only input/output CLI options to operate on temporary files; tests must invoke the real generator process rather than mock file writes or Bun's build API.

### 03D. Notifier regression characterization

Extend the existing `.github/workflows/nightly.yml` describe block in `scripts/tests/release-process.test.js` to assert:

- `failureNotificationStep().env.GH_REPO` is exactly `'${{ github.repository }}'`;
- label create/list and issue list/comment/create all include `--repo "${GH_REPO}"`;
- the notification job remains checkout-free and has `issues: write` only at job scope.

This test is expected to be GREEN immediately because #2596 is merged. Record it as characterization of an already-correct contract; do not manufacture a production regression to force RED.

### RED commands

```powershell
npm run test --workspace @vybestack/llxprt-code -- src/launcher/cli-bin.e2e.test.ts src/launcher/bun-path-resolver.test.ts
npm run test:scripts -- scripts/tests/generate-cli-launcher.test.ts
npm run test:scripts -- scripts/tests/release-process.test.js
```

Expected before implementation:

- native-path E2E tests fail with split argv and/or exit 43;
- candidate-order tests select `.bin/bun.cmd`;
- generation tests fail because the scripts/mechanism do not yet exist;
- notifier assertions pass on current main-derived code.

## Phase 04: GREEN — native-first shared policy and deterministic generated launcher

### Phase ID

`PLAN-20260720-ISSUE2604.P04`

### Prerequisite

Phase 03 RED evidence is recorded for launcher and generation behavior.

### Files to create

- `packages/cli/src/launcher/cli-bin.cts` — canonical, typed CommonJS launcher source preserving all current entry resolution, Unix spawnability checks, signal forwarding, orphan/self-exit handling, diagnostics, and `runCliBin` export.
- `packages/cli/src/launcher/bun-candidate-policy.ts` — small pure policy for candidate classification/order shared by the TypeScript resolver and bundled canonical launcher; no filesystem or process-spawn side effects.
- `scripts/generate-cli-launcher.ts` — deterministic Bun build/check driver.

### Files to modify

- `packages/cli/src/launcher/bun-path-resolver.ts`
- `packages/cli/src/launcher/bun-launcher.ts` only if comments/types or shared policy integration require it; do not broaden launcher behavior beyond this issue.
- `packages/cli/bin/llxprt.cjs` (generated output only; never hand-edit after the generator exists)
- `package.json`
- relevant tests from Phase 03

### Candidate policy

On Windows, resolve in this order:

1. native `.bin/bun.exe` candidates across supported ancestors;
2. native direct dependency `node_modules/bun/bin/bun.exe` candidates;
3. native executable result(s) from `PATH` (`where.exe bun` without a shell);
4. only if all native candidates fail, the first usable remembered local/PATH `bun.cmd` wrapper.

The implementation may preserve nearer-ancestor preference within each candidate class. It must not return a wrapper merely because it was encountered before a native candidate in a later class. On POSIX, retain the established local `.bin`, direct dependency, then `PATH` behavior and Unix spawnability validation.

The generated CJS launcher and `bun-path-resolver.ts` must consume the same pure ordering/classification policy so later edits cannot drift. Do not duplicate a second ordered list in generated output source.

### Spawn behavior

- Native `.exe`: `shell: false`/unset; forward the exact argument array.
- `.cmd` fallback only: retain `shell: true`, preflight metacharacter rejection, exit code 43, and actionable install/PATH message.
- Continue setting `LLXPRT_BUN_RELAUNCHED=true`, inheriting stdio, forwarding signals, mapping child exits, and preserving current no-compile entry resolution.

### Generator behavior

1. `bun scripts/generate-cli-launcher.ts` (via `npm run generate:cli-launcher`) builds `packages/cli/src/launcher/cli-bin.cts` with target Node and format CommonJS into `packages/cli/bin/llxprt.cjs`.
2. The output starts with `#!/usr/bin/env node`, is deterministic, and remains loadable by Node 24 before any repository build.
3. `bun scripts/generate-cli-launcher.ts --check` (via `npm run check:cli-launcher`) compares fresh bytes with the checked-in output, prints the exact regeneration command on mismatch, and exits nonzero without modifying the output.
4. Add `check:cli-launcher` to an existing mandatory build/CI path (prefer the root `build` preflight) so source/output drift cannot merge unnoticed. Keep `generate:cli-launcher` explicit; do not make a check silently rewrite tracked files.
5. Preserve package `bin` and `files` mappings in root and CLI `package.json`.

### GREEN commands

```powershell
npm run generate:cli-launcher
npm run check:cli-launcher
npm run test:scripts -- scripts/tests/generate-cli-launcher.test.ts
npm run test --workspace @vybestack/llxprt-code -- src/launcher/bun-path-resolver.test.ts src/launcher/bun-launcher.test.ts src/launcher/bun-launcher-signals.test.ts src/launcher/cli-bin.test.ts src/launcher/cli-bin.e2e.test.ts
node packages/cli/bin/llxprt.cjs --version
```

Expected: all pass on Windows Node 24; no DEP0190 warning on the native path; generated output is clean after a second generation.

## Phase 05: Integration and nightly contract verification

### Phase ID

`PLAN-20260720-ISSUE2604.P05`

### Tasks

1. Run the actual agents guard and its consumer test in sequence.
2. Run the real launcher E2E tests on Windows after `npm ci`, where both `.bin/bun.cmd` and direct dependency `bun.exe` are present.
3. Run the integration suite through `packages/test-utils` to prove its already-correct argument arrays survive the full Node launcher path.
4. Keep `.github/workflows/nightly.yml` unchanged unless the regression test reveals that main has regressed. The expected implementation change for REQ-2604-006 is test-only in `scripts/tests/release-process.test.js`.
5. Verify the nightly Windows jobs still set up Bun before guard/tests and that `notify_failure` still has no checkout step.

### Commands

```powershell
npm run lint:agents-api-surface
npm run test --workspace @vybestack/llxprt-code-agents -- publicSurface.guard
npm run test --workspace @vybestack/llxprt-code -- src/launcher/bun-path-resolver.test.ts src/launcher/bun-launcher.test.ts src/launcher/bun-launcher-signals.test.ts src/launcher/cli-bin.test.ts src/launcher/cli-bin.e2e.test.ts
npm run test:scripts -- scripts/tests/check-agents-api-surface.test.ts scripts/tests/generate-cli-launcher.test.ts scripts/tests/release-process.test.js
npm run test:integration:sandbox:none
```

### Semantic gate

- [ ] The API checker succeeds with npm/npx absent from `PATH`.
- [ ] A real child reports native `bun.exe` despite local `.bin/bun.cmd`.
- [ ] The child receives `hello world` as one argument.
- [ ] The child receives `hello & whoami` unchanged without shell rejection.
- [ ] A `.cmd`-only fallback still rejects unsafe forwarding with exit 43.
- [ ] Editing canonical launcher source without regeneration makes `npm run check:cli-launcher` fail.
- [ ] `GH_REPO` and every notifier `--repo` use `${{ github.repository }}`/`${GH_REPO}`.

## Phase 06: Full verification and final review

### Phase ID

`PLAN-20260720-ISSUE2604.P06`

### Windows-specific verification

Run from a Windows checkout with supported Node 24 and Bun setup matching `.github/workflows/nightly.yml`:

```powershell
node --version
bun --version
npm ci
npm run lint:agents-api-surface
npm run check:cli-launcher
npm run test:scripts -- scripts/tests/check-agents-api-surface.test.ts scripts/tests/generate-cli-launcher.test.ts scripts/tests/release-process.test.js
npm run test --workspace @vybestack/llxprt-code -- src/launcher/bun-path-resolver.test.ts src/launcher/bun-launcher.test.ts src/launcher/bun-launcher-signals.test.ts src/launcher/cli-bin.test.ts src/launcher/cli-bin.e2e.test.ts
npm run test:integration:sandbox:none
node packages/cli/bin/llxprt.cjs --version
```

Expected:

- Node resolves to a supported `v24.x` release.
- No `spawnSync npx.cmd EINVAL`.
- Resolver/launcher tests have no host-path fixture failures.
- No prompt/positional prompt collision caused by split launcher arguments.
- No DEP0190 warning on the normal native Bun path.

### Full repository verification

Run all commands from the repository root, fix failures, and rerun the complete sequence after any fix:

```powershell
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Also run the issue-specific guards after formatting/build to ensure generated drift was not introduced:

```powershell
npm run check:cli-launcher
npm run lint:agents-api-surface
npm run test:scripts -- scripts/tests/release-process.test.js
```

### Final diff review

```powershell
git status --short
git diff --check
git diff -- package.json scripts/check-agents-api-surface.mjs scripts/generate-cli-launcher.ts scripts/tests/check-agents-api-surface.test.ts scripts/tests/generate-cli-launcher.test.ts scripts/tests/release-process.test.js packages/cli/src/launcher packages/cli/bin/llxprt.cjs .github/workflows/nightly.yml
```

Confirm:

- `.github/workflows/nightly.yml` has no issue-specific rewrite; if unchanged, the notifier requirement is protected solely by the strengthened test.
- `.llxprt/` has not changed.
- `packages/cli/bin/llxprt.cjs` equals a fresh generation.
- No new dependency, compiler-setting relaxation, unsafe type assertion, skipped test, or unrelated refactor was introduced.
- Test changes prove child-observed behavior and do not merely inspect mock calls.

## Expected implementation file set

### Create

- `packages/cli/src/launcher/cli-bin.cts`
- `packages/cli/src/launcher/bun-candidate-policy.ts`
- `scripts/generate-cli-launcher.ts`
- `scripts/tests/check-agents-api-surface.test.ts`
- `scripts/tests/generate-cli-launcher.test.ts`

### Modify

- `scripts/check-agents-api-surface.mjs`
- `packages/cli/src/launcher/bun-path-resolver.ts`
- `packages/cli/src/launcher/bun-path-resolver.test.ts`
- `packages/cli/src/launcher/cli-bin.e2e.test.ts`
- `packages/cli/bin/llxprt.cjs` (generated only)
- `scripts/tests/release-process.test.js`
- `package.json`

### Modify only if required by a failing behavioral test

- `packages/cli/src/launcher/bun-launcher.ts`
- `packages/cli/src/launcher/bun-launcher.test.ts`
- `packages/cli/src/launcher/cli-bin.test.ts`
- `packages/test-utils/src/test-rig.ts`
- `packages/test-utils/src/process-run.ts`
- `.github/workflows/nightly.yml`

The last three production/workflow files are currently behaving correctly at their boundary and should not be changed speculatively.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Generated CJS changes no-compile startup or signal hardening | Move current behavior into canonical source first; require existing `cli-bin.test.ts`, signal tests, real E2E, `--version`, package-integrity, and deterministic generation checks before changing candidate order. |
| Native-first ordering weakens bundled-runtime preference | Prefer the direct bundled `node_modules/bun/bin/bun.exe` before `PATH`; only wrappers move behind all native candidates. |
| PATH lookup itself uses a shell | Execute native `where.exe` directly on Windows and keep stdout limits/timeouts. |
| Cross-platform resolver tests encode foreign path syntax | Build filesystem expectations with `node:path` and use real Windows E2E for Windows claims. |
| API guard test is slow | Keep one focused real-process test; do not duplicate declaration compilation inside package unit tests. |
| Generator drift check rewrites files in CI | `--check` compares only and exits nonzero; generation is an explicit separate command. |
| Notifier work expands scope | Add assertions only; PR #2596 behavior is already merged and must not be reimplemented. |
