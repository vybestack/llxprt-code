# Issue 2285 Overview: Depollute Agents Public Barrel and Finish CLI Session Boundary Refactor

## Issue

GitHub issue: https://github.com/vybestack/llxprt-code/issues/2285

Title: Depollute agents public barrel and finish CLI session boundary refactor

This work finishes the architectural boundary cleanup started by issue 2204 and PR 2265. The previous work moved CLI runtime behavior toward public factories and made the existing boundary check pass, but deliberately preserved a non-breaking agents package root export shape. This issue removes that deliberate debt rather than adding another compatibility layer around it.

## Problem Statement

The CLI is supposed to be one client of a shared Agent/runtime API. It should not know about, import, or assemble low-level agents runtime internals. Today that boundary is only partially enforced because the agents package root still exposes internals.

The key current debts are:

1. `packages/agents/src/index.ts` re-exports `./internals.js` from the root package barrel.
2. `scripts/check-cli-import-boundary.mjs` compensates with `PUBLIC_AGENT_SYMBOLS`, a manually maintained root-symbol allowlist that distinguishes curated public API from internals leaking through the root.
3. Production CLI boundary enforcement depends on symbol-level checker knowledge instead of package shape, export-map shape, and API-surface contract checks.
4. `AgentRuntimeFactoryBindings` is structurally duplicated between agents and providers, creating silent drift risk at a runtime factory seam.
5. `packages/cli/src/cliSessionDispatch.tsx` is explicitly documented as a temporary quarantine for multiple mixed responsibilities extracted from the old monolithic CLI entrypoint.

## Desired Final State

The final state must be binary and mechanically guarded:

- `@vybestack/llxprt-code-agents` root exports only the curated public Agent API.
- The agents root barrel no longer re-exports `./internals.js`.
- Low-level agents internals, if retained, are reachable only through an explicit internals subpath such as `@vybestack/llxprt-code-agents/internals.js`.
- Production CLI cannot import agents internals through root symbols, deep source paths, or an internals subpath.
- Non-CLI production consumers, including A2A server code, must not rely on root-leaked internals; if they legitimately need low-level internals, they must use the explicit internals subpath.
- `PUBLIC_AGENT_SYMBOLS` is removed from `scripts/check-cli-import-boundary.mjs`.
- Boundary enforcement relies on package subpaths, export maps, and public API-surface checks rather than a manually maintained root-symbol allowlist.
- The public agents API surface is declared and regression-tested using a deliberate API-surface mechanism that covers both value and type exports.
- `AgentRuntimeFactoryBindings` has one source of truth unless dependency-direction analysis proves that a duplicate contract is necessary; any retained duplication must have a documented no-cycle justification and a mechanical compile-time drift guard.
- `cliSessionDispatch.tsx` no longer exists as a large temporary quarantine, or it is reduced/renamed into a small stable module with narrow ownership and no temporary-debt comment.
- Full verification, smoke testing, detached OCR, PR CI, and CodeRabbit remediation complete before the work is considered done.

## Non-Deferral Gates

The implementation must not be accepted if any of these gates fail.

### Agents Root Barrel Gate

`packages/agents/src/index.ts` must not contain:

```ts
export * from './internals.js';
```

The root public API must be mechanically checked so internal names such as `AgentClient`, `CoreToolScheduler`, and the concrete `AgenticLoop` class/value cannot reappear through the root unnoticed. The check must preserve intentional curated loop API such as `createAgenticLoop`, `AgenticLoopRunner`, `AgenticLoopEvent`, and `AgenticLoopMessage` if inventory confirms they remain public. The check must cover emitted declaration/type surface as well as runtime value exports so type-only internal leakage cannot bypass the guard. A runtime `Object.keys()` style check alone is insufficient. Acceptable type-surface mechanisms include parsing freshly emitted `dist/index.d.ts` after `npm run build`, using the TypeScript compiler API to compare exported type names directly from source, or using an API-report-style declaration snapshot. If the guard reads `dist`, build ordering must make stale or absent declarations impossible.

Existing root-local compatibility exports must be audited after removing `./internals.js`, including `createTaskToolRegistration` and the explicit disambiguation type exports for `AgenticLoopMessage`, `ApprovalHandler`, and `CompressionResult`. `createTaskToolRegistration` is a root-local compatibility function that delegates to `createTaskRegistration`; it is not the same export name as `createTaskRegistration` from `runtimeFactories.ts`, and A2A currently imports it from the root. The detailed plan must explicitly decide whether `createTaskToolRegistration` remains a curated root export or is migrated away, and must not rely on the old `PUBLIC_AGENT_SYMBOLS` checker to validate it. Any disambiguation export that is only needed because internals and API barrels were previously merged must be removed or justified after depollution.

Existing agents surface tests must be updated, not left competing with a new guard. In particular, `packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts` currently characterizes the old non-breaking internals leak. Assertions that bind root internals to internals-subpath identities, such as `root.AgentClient === internals.AgentClient`, must be surgically removed and replaced with explicit root deny assertions rather than mechanically inverted. `packages/agents/src/api/__tests__/nonBreaking.exports.test.ts` must receive the same treatment so it remains compatible with the explicit internals subpath without asserting root pollution.

Generated `dist` trees must not be used as authoritative source inventory. Preflight must determine the repository policy for generated build artifacts and record the evidence. If `dist` files are untracked build artifacts, ignore them during source inventory and regenerate them with `npm run build`; if preflight finds committed build artifacts, update them only according to the repository's normal build-artifact policy. Any API guard that reads emitted declarations must run against freshly generated output, not stale `dist` content.

### Manual Symbol Allowlist Gate

`PUBLIC_AGENT_SYMBOLS` and its root-symbol checking logic must be removed from `scripts/check-cli-import-boundary.mjs`.

The replacement checker rules should be based on import specifiers and package/subpath contracts:

- bare `@vybestack/llxprt-code-agents` imports are allowed because the root is curated;
- `@vybestack/llxprt-code-agents/internals.js` is forbidden in production CLI;
- deep runtime package imports remain forbidden except for existing narrowly justified composition seams;
- stale allowlist entries remain self-pruning;
- the existing getConfig escape-hatch scan must continue to work;
- non-literal `vi.mock` detection, thin-entry checks, and scoped public subpath logic must continue to work;
- new CLI modules created by this issue must remain inside the boundary scan and must not require new deep-import allowlist entries without explicit justification.

The existing synthetic boundary tests that use `CLI_BOUNDARY_ROOT` must be updated as part of the replacement. New tests elsewhere are not enough if the fixture tests still encode the old symbol-allowlist behavior.

### Production Consumer Internals Gate

Production CLI source under `packages/cli/src` must not import agents internals via:

- root leaked symbols;
- `@vybestack/llxprt-code-agents/internals.js`;
- deep agents source paths.

**Final guard (architect finding 11):** the full verification gate (P13/P13a)
includes an explicit fail-closed grep proving production `packages/cli/src`
has zero imports of `@vybestack/llxprt-code-agents/internals.js`. Tests may
still use the internals subpath (they test lower-level seams), but production
source must not.

Other production package consumers must be inventoried separately from CLI. In particular, A2A server code that imports internals-only symbols such as `AgentClient` and `CoreToolScheduler` must be migrated away from root-leaked internals. Known hard compile-breakers include:

- `packages/a2a-server/src/config/config.ts`, which imports `AgentClient`, `CoreToolScheduler`, and `createTaskToolRegistration` from the agents root and constructs the concrete internals directly;
- `packages/a2a-server/src/agent/task.ts`, which imports `AgentClient` from the agents root;
- `packages/a2a-server/src/agent/task-runtime-helpers.ts`, which imports `AgentClient` as a type from the agents root;
- `packages/a2a-server/src/utils/testing_utils.ts`, which imports `CoreToolScheduler` as a type from the agents root.

A2A migration must attempt public factory migration first. Each retained A2A internals-subpath use must have a decision record explaining why the public API or public factory path is insufficient, plus behavior tests proving the A2A code still works after root depollution.

Tests and test utilities can use internals when they are testing lower-level seams, but they must not import internals-only names from the root after depollution because full typecheck and Vitest will fail. Known CLI test compile-breakers include:

- `packages/cli/src/integration-tests/test-utils.ts`;
- `packages/cli/src/integration-tests/todo-continuation.integration.test.ts`;
- `packages/cli/src/ui/hooks/useTodoContinuation.spec.ts`;
- `packages/cli/src/ui/hooks/useToolScheduler.test.ts` and `useToolScheduler.part*.test.ts`;
- `packages/cli/src/ui/hooks/geminiStream/__tests__/useAgenticLoop.test.tsx`;
- `packages/cli/src/ui/App.behavior.test.tsx`, `App.context.test.tsx`, `App_test.tsx`, `App.components.test.tsx`, and `App.dialogs.test.tsx`.

The inventory must classify consumers by category:

- production CLI;
- production A2A server;
- other production packages;
- intra-agents self-imports and package-internal source imports;
- tests;
- scripts/tooling.

Tests should include negative cases proving production CLI cannot import representative internals including `AgentClient`, `CoreToolScheduler`, and the concrete `AgenticLoop` class/value from the root or internals subpath. API-surface tests should separately prove those names are not root exports while preserving intentional curated loop API if retained. Positive tests should prove curated root API imports still work. Preflight must verify legitimate `@vybestack/llxprt-code-agents/internals.js` consumers resolve under typecheck and Vitest without widening production CLI access.

### Public API Contract Gate

There must be an agents public API-surface guard. A focused export snapshot or API report is acceptable if it is deliberate, checked by tests or scripts, and not embedded as another hidden copy of the CLI root-symbol allowlist.

The API-surface guard must answer a different question from the CLI boundary checker:

- API guard: what does the agents root intentionally expose?
- CLI boundary checker: which package specifiers are production CLI allowed to import?

The API-surface guard must fail closed on unknown root-surface changes and must independently assert absence of known internals from the root. At minimum, the deny assertions must include `AgentClient`, `CoreToolScheduler`, the concrete `AgenticLoop` class/value, and any other internals selected during inventory. A snapshot update must be an intentional reviewable change, not an automatic re-blessing step. Normal CI verification must compare only; regeneration must be a separate explicit developer action with a reviewable diff.

Export maps guard which package subpaths can be imported. The API-surface guard must guard the named root symbol shape. Both are required because neither one proves the other.

The existing `./app-service.js` subpath is orthogonal to the agents root internals leak and should not be changed unless preflight analysis identifies a direct requirement.

### Runtime Factory Contract Gate

The duplicated `AgentRuntimeFactoryBindings` definitions must be replaced by one source of truth if dependency direction allows it. The plan must analyze ownership and dependency direction before choosing the target package for the shared contract. Known relevant files include:

- `packages/agents/src/api/runtimeFactories.ts`;
- `packages/providers/src/runtime/runtimeContextFactory.ts`.

Known dependency direction is agents toward providers, not providers toward agents. A single source in agents would create the wrong dependency direction for providers. The detailed plan must still evaluate whether a neutral/core-owned contract is appropriate before accepting retained duplication.

If one source of truth would create an inappropriate dependency cycle or misplaced ownership, retained duplication is acceptable only with:

- a documented no-cycle/no-neutral-owner decision record;
- comments at both declarations referencing the drift guard;
- a compile-time contract test that fails on drift;
- explicit assignability checks in both directions where TypeScript can enforce them.

The compile-time drift guard must live where it participates in typechecking. A `.test.ts` file that is excluded from `tsc --noEmit` is not sufficient. Prefer an existing project type-test pattern such as `.types.ts`, or another file included by the relevant package typecheck, and place it so it does not introduce the dependency cycle it is meant to avoid. The detailed plan must name the exact package/tsconfig command that includes the guard and include a verifier step proving `npm run typecheck` would fail if either side of the factory binding shape drifts.

**Architect review finding 1 (decision record lifecycle):** the decision record (`runtime-factory-contract-decision.md`) is CREATED in P01 (preflight) — NOT P09 — because P08/P08a read it before P09 runs. It contains a machine-greppable `decision:` line (`decision: single-source` or `decision: retained-duplication`) and, for retained-duplication, an optional `drift-guard-path:` line naming the guard file. P09 FINALIZES the record with the applied outcome; it does NOT create it.

### CLI Session Ownership Gate

`cliSessionDispatch.tsx` must stop being a large temporary quarantine. The refactor must preserve behavior and cleanup ordering while moving responsibilities into stable ownership boundaries. Candidate seams are:

- interactive Ink render/bootstrap;
- non-interactive dispatch and runner;
- piped prompt/session driving;
- output listener setup/flush;
- SIGINT and non-interactive error handling;
- process lifecycle and unhandled rejection handling;
- terminal protocol and mouse cleanup.

A cosmetic comment deletion is not sufficient. The module structure must reflect stable ownership.

Characterization tests must be written and observed against the current `cliSessionDispatch.tsx` behavior in a separate numbered phase before splitting, then preserved or retargeted in a later refactor phase after the split. These tests must include explicit observable assertions for dispatch branch selection, SIGINT handler installation/disposal, output flush ordering, process lifecycle/error handling, piped prompt driving, terminal/mouse cleanup, and non-interactive error output. Because this area is side-effectful, tests may isolate infrastructure boundaries such as process, TTY, Ink render, and filesystem diagnostics, but must not mock the session-dispatch module or assert only that mocks were called. Permissible boundary isolation means replacing external effects so the real dispatch code can be executed safely; forbidden mock theater means asserting only that those replacements were called without checking the resulting output, cleanup state, handler effect, selected execution branch, or flushed payloads. Tests involving `process.exit` should use safe boundary seams or subprocess-style characterization rather than terminating the test runner.

The refactor must preserve every currently exported name that `packages/cli/src/cli.tsx` or `packages/cli/index.ts` depends on, either directly or through stable replacement modules. `packages/cli/src/cli.tsx` currently imports and re-exports these six names from `./cliSessionDispatch.js`:

- `dispatchInteractiveOrNonInteractive`;
- `formatNonInteractiveError`;
- `initializeOutputListenersAndFlush`;
- `installNonInteractiveSigintHandler`;
- `setupUnhandledRejectionHandler`;
- `startInteractiveUI`.

It also re-exports `validateDnsResolutionOrder` from the `cliBootstrap` module (`packages/cli/src/cliBootstrap.tsx` source), which is not part of the `cliSessionDispatch` split and must not be accidentally moved into session modules.

The refactor must remove stale `cliSessionDispatch` references and temporary/quarantine language from `cli.tsx`, migrated modules, and tests. **Scope note (architect finding 9): the executable quarantine-language scan covers production source (`packages/cli/src/cliSessionDispatch.tsx`, `packages/cli/src/session/`, `packages/cli/src/cli.tsx`) and characterization test files only. Plan and analysis docs are NOT scanned for quarantine language because they intentionally use "quarantine" to describe the problem being fixed.**

### Verification Gate

Before PR completion, all required checks must pass:

```bash
npm run test
npm run lint
npm run lint:eslint-guard
npm run lint:cli-boundary
npm run lint:agents-api-surface
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
```

`npm run lint:cli-boundary` must invoke `node scripts/check-cli-import-boundary.mjs`; the detailed plan should also call out that direct checker name so the issue's acceptance criterion is visibly satisfied. `npm run lint:agents-api-surface` must invoke `node scripts/check-agents-api-surface.mjs` (the API-surface guard — architect finding 2 + revision 4 findings 1, 8: it is a CI-required lint script wired into `.github/workflows/ci.yml`; revision 6 finding 7: the CI job placement is mechanism-conditional — B1/B1a/B1b source-path temp tsconfig runs in the pre-build `lint_javascript` job, while B2 fresh-shared-dist runs only in the post-build `test` job because it requires `dist/` to exist; the guard test also runs in `npm run test` reading the report the lint script emits).

Open Code Review must run detached with a 20-minute floor, and every finding must be evaluated before pushing or finalizing. High and Medium findings must be fixed. Low findings must either be fixed or explicitly justified as non-actionable, factual mistakes, or outside the issue scope:

```bash
nohup ocr review --audience agent --timeout 20 main...HEAD > /tmp/ocr_review.log 2>&1 & echo PID=$!
```

After PR creation (architect finding 7: this is a POST-PR step — the PR number
does not exist until `gh pr create` returns it), CI must be watched with
the REAL PR number (**architect review finding 7: P13a must actually RUN**
`gh pr checks`, not just confirm evidence — read the real PR number via
`gh pr view --json number --jq '.number'`, then loop):

```bash
# Read the REAL PR number (NOT the literal token NUM). This runs ONLY after
# the PR exists. Loop up to 5 times with --watch --interval 300.
PR_NUMBER="$(gh pr view --json number --jq '.number')"
gh pr checks "$PR_NUMBER" --watch --interval 300
```

Workflow failures and CodeRabbit comments must be investigated and remediated until all checks are green and all actionable comments are addressed.

**Architect review finding 4 (build evidence):** the final verification gate
(P13/P13a) captures `git status --ignored --short` after `npm run build` to
prove generated artifacts are correctly gitignored and no unexpected unignored
build output appeared. The normalized git status comparison handles ignored
files, but the completion evidence explicitly includes the ignored-file
listing so unexpected unignored build output is not hidden by assumptions.

**Architect review finding 9 (escape-hatch gate):** the final verification
gate (P13/P13a) asserts `LLXPRT_API_SURFACE_SKIP` is UNSET before running
the API-surface guard verification. This prevents the local escape hatch from
undercutting the final fail-closed behavior.

## Implementation Strategy

The work should proceed as numbered, test-first vertical phases that make deferred debt impossible to hide. The slices below are architectural workstreams only; they are not executable phases and must be decomposed into the detailed numbered plan before implementation.

### Slice 1: Inventory and API Surface Contract

Inventory all current imports of `@vybestack/llxprt-code-agents`, the explicit internals subpath, and deep agents source paths. Classify production CLI, A2A server, other production packages, intra-agents self-imports, tests, and scripts separately. Identify which imports are curated public API and which rely on root-leaked internals.

Use a red/green characterization workflow: first demonstrate locally that internal names are currently visible from the root, then convert that characterization into a passing final API-surface guard that proves those names are absent after depollution. Failing characterization tests must be transient local evidence, or committed only as passing current-state characterization tests that are converted within the same phase before verification. No completed phase may leave CI red.

Choose and implement a focused public API-surface guard for agents. Prefer a repo-local export snapshot or API-report style check if no standard API Extractor workflow already exists in this repository. The guard must be generated from the agents root surface and must cover type declarations as well as runtime value exports by parsing freshly emitted declarations, using the TypeScript compiler API, or an equivalent API-report mechanism. The detailed plan must explicitly include type-only deny cases for internal names, not just runtime value checks.

### Slice 2: Depollute Agents Root and Package Exports

Remove `export * from './internals.js'` from `packages/agents/src/index.ts`. Keep the explicit `./internals.js` subpath only if internal, A2A, test, or power-user consumers still require it. Update imports so internal package code uses relative paths or explicit internal subpaths as appropriate, while production CLI uses only the curated root API.

Named import migrations must explicitly cover A2A production compile-breakers and test compile-breakers discovered in Slice 1, including `packages/a2a-server/src/config/config.ts`, `packages/a2a-server/src/agent/task.ts`, `packages/a2a-server/src/agent/task-runtime-helpers.ts`, `packages/a2a-server/src/utils/testing_utils.ts`, and CLI tests importing `AgentClient` or `CoreToolScheduler` from the root. A2A production changes must try public factories first and must record a per-use exception if any internals subpath remains.

Document any retained internals subpath in appropriate source/package documentation or README material, not through unsupported JSON comments in `package.json`.

### Slice 3: Replace Boundary Symbol Allowlist

Remove `PUBLIC_AGENT_SYMBOLS`. Simplify CLI boundary enforcement so the checker cares about package specifiers and declared public subpaths. Preserve unrelated boundary behavior such as stale allowlist pruning, deep runtime package checks, non-literal `vi.mock` detection, thin-entry checks, and getConfig escape-hatch scanning.

Update existing synthetic `CLI_BOUNDARY_ROOT` fixture tests in `scripts/tests/cli-import-boundary.test.js` and add any new tests needed for agents internals from root and internals subpath. Keep API-surface tests and CLI boundary tests separate because they prove different properties.

### Slice 4: Unify Runtime Factory Contract

Resolve duplicated `AgentRuntimeFactoryBindings`. Prefer one exported contract at a neutral package seam if dependency direction and ownership allow it. Retained duplication is only acceptable after explicit dependency-direction and neutral/core ownership analysis documents why a single source of truth was rejected. If dependency direction makes a single source inappropriate, add a compile-time contract guard proving exact assignability both ways, documenting why duplication remains intentional, and naming the typecheck command that includes the guard.

### Slice 5: Refactor CLI Session Dispatch Ownership

Add behavior-preserving characterization tests around dispatch ordering, non-interactive error output, signal handler installation/disposal, output listener flushing, process lifecycle handling, and terminal/mouse cleanup in a dedicated numbered phase. Run those tests against current behavior before splitting. In a later numbered phase, split `cliSessionDispatch.tsx` along stable responsibility seams and retarget tests only as needed to keep the same behavior assertions. Preserve `packages/cli/src/cli.tsx` as a thin entrypoint and preserve all required public exports through explicit replacement modules or narrow compatibility re-exports only where justified.

### Slice 6: Full Boundary Hardening and Verification

Run boundary scripts, API-surface scripts, package tests, lint guardrail checks including `npm run lint:eslint-guard` and `npm run lint:cli-boundary`, full verification suite, smoke test, OCR, PR checks, and CodeRabbit remediation.

## Plan Requirements

The detailed plan in `project-plans/issue2285` must follow the project planning rules. This overview is not executable by itself. A detailed plan must be created before implementation as numbered phase files and an execution tracker under `project-plans/issue2285`, then executed using `dev-docs/COORDINATING.md`.

The detailed plan must include:

- test-first implementation using `dev-docs/RULES.md`;
- preflight verification before implementation, including generated artifact policy, export-map/type-resolution checks, and internals-subpath resolution under typecheck/Vitest;
- numbered phases executed sequentially;
- one synchronous worker subagent per phase and one synchronous verifier subagent per phase;
- no skipped phase numbers;
- no phase batching;
- semantic verification, not marker-only verification;
- no deferred implementation comments such as TODO, FIXME, HACK, STUB, TEMPORARY, placeholder, or for-now language in completed implementation code (**architect review finding 6**: deferred-language scans use pre-phase baselines or git-diff added-lines so pre-existing debt from prior issues does not cause false failures; only NEWLY INTRODUCED deferred language fails);
- no lint/complexity rule loosening and no suppression directives;
- all implementation phases must be reachable through existing package/API/CLI code paths, not isolated features;
- phase-specific verification commands including `npm run lint:eslint-guard`, `npm run lint:cli-boundary`, and affected package tests wherever relevant.
- an execution tracker that lists every Non-Deferral Gate as a blocking checklist item with verifier evidence;
- **per-phase structured diff evidence (architect finding 8)**: every phase completion marker (`.completed/PNN.md`) MUST record structured evidence — see the Standard Completion Marker Template below.
- **marker policy (architect review finding 5)**: `@plan:PLAN-20260629-ISSUE2285`/`@requirement:REQ-` markers are restricted to test files (`.test.ts`, `.spec.ts`) and plan artifacts (`.md`) only — NOT production source or executable scripts. **Pre-existing markers from other issues** (e.g. `@plan PLAN-20260610-ISSUE1592` in `packages/a2a-server/src/config/config.ts`, widespread `@plan:PLAN-` in `packages/tools/**` and `packages/settings/**`) **are NOT to be removed** unless the line they annotate is changed for issue #2285 scope. The policy prohibits only NEW issue2285 markers in production source.

## Standard Completion Marker Template (architect finding 8)

Every phase completion marker (`project-plans/issue2285/.completed/PNN.md` and
`.completed/PNNa.md`) MUST contain the following structured evidence sections.
This ensures per-phase attribution is reliable (P13/P13a do not re-derive
attribution from a single broad `git diff HEAD`).

```markdown
# PNN Completion Marker

## Phase
PLAN-20260629-ISSUE2285.PNN

## Files Changed (git diff --name-only of phase-owned files)
<!-- list each file this phase created or modified -->
- <file path 1>
- <file path 2>

## Diff Stats (git diff --stat of phase-owned files)
<!-- paste the output of: git diff --stat -- <phase-owned files> -->
<paste diff --stat output here>

## Command Outputs (key verification commands)
<!-- paste exit status and relevant output for each required command -->
- <command>: PASS/FAIL + key output excerpt
- <command>: PASS/FAIL + key output excerpt

## Tracker Evidence
<!-- which execution-tracker.md gate items this phase satisfies, and the
     verifier evidence recorded for each -->
- Gate N, item "...": evidence recorded
- Gate N, item "...": evidence recorded

## Verifier Sign-off
- Verified by: <verifier name>
- Verification phase: PNNa
```

Analysis-only phases (P10) and verification phases (PNNa) record the same
structure adapted to their scope (analysis phases record the analysis artifact
created; verification phases record the commands run and gates evidenced).

## Completion Definition

This issue is finished only when the architecture itself enforces the intended boundary. Passing the current checker is not enough. The package root, export map, API contract, boundary checker, runtime factory contract, CLI module ownership, tests, and PR workflow must all agree on the same final state.
