# PLAN-20260808-ISSUE2693 — Make CI workflow relevance traceable

Issue: #2693 — "Audit CI workflow path filters: irrelevant workflows trigger on unrelated PRs"

## Accepted behavior

### REQ-2693-001 — Every workflow has an explicit relevance policy

- **GIVEN** the workflows under `.github/workflows/`
- **WHEN** their triggers and job-level gates are audited
- **THEN** durable CI guidance classifies each workflow as event-path filtered,
  job-level gated, intentionally broad, reusable/caller-controlled, or
  scheduled/manual/non-code
- **AND** every path in a filtered workflow is traceable to an input that the
  workflow can observe
- **AND** no broad `paths-ignore` rule substitutes filename extensions or a
  documentation percentage for actual relevance.

### REQ-2693-002 — Unrelated root scripts do not allocate Windows runners

- **GIVEN** a pull request where the only Windows candidate change is an
  ordinary root `package.json` script that is not used by install, package,
  build, or smoke behavior, such as the `lint:doc-links` and
  `lint:doc-placement` additions from PR #2686
- **WHEN** Windows installed-command relevance is evaluated
- **THEN** a cheap relevance job may run
- **BUT** the expensive `windows-latest` smoke job is skipped
- **AND** the workflow reaches a successful terminal conclusion.

Root `package.json` remains a coarse candidate because the workflow consumes
its workspaces, dependency/install metadata, and lifecycle scripts. GitHub
path filters cannot distinguish fields within one JSON file.

### REQ-2693-003 — Real Windows release/install inputs still run

- **GIVEN** a change to a launcher, native-launcher installer, root or relevant
  workspace dependency/install/package metadata, lifecycle behavior,
  `package-lock.json`, release-pack/prepare/bind/npm/tar helper, setup runtime
  version, packed/runtime package input, workflow, smoke, probe, or benchmark
- **WHEN** relevance is evaluated
- **THEN** the Windows installed-command smoke runs.

The Windows job is treated as a release/install integration lane, not a
launcher-only unit test. Root `package-lock.json` is always relevant because
`npm ci` and release dependency binding consume it.

### REQ-2693-004 — Manifest decisions are semantic and conservative

- **GIVEN** base and head root manifests that both parse
- **WHEN** only formatting, key order, or unrelated named scripts differ
- **THEN** Windows may skip
- **WHEN** workspaces, dependencies, overrides/resolutions, engines,
  package-manager/trusted/install metadata, lifecycle scripts, an invoked
  script, or an unknown potentially install-relevant top-level field differs
- **THEN** Windows runs.

Malformed/missing manifests, incomplete change data, count mismatches,
ambiguous rename/deletion data, unsupported events, or an untrustworthy push
base fail closed to running validation. `workflow_dispatch` always runs.
Mixed changes run whenever any one input is relevant.

### REQ-2693-005 — E2E reuses the tested docs-only policy

- **GIVEN** a PR change set
- **WHEN** E2E determines whether it is documentation-only
- **THEN** it invokes the checked-in `scripts/docs-only-filter.ts` policy with
  structured changed-file entries and the authoritative changed-file count
  instead of maintaining an inline extension allowlist
- **AND** runtime/package Markdown or text, expected-output text fixtures,
  `.github/**`, `scripts/**`, unknown paths, truncated results, and
  code-to-doc renames run E2E
- **AND** genuine docs-only changes skip only heavyweight E2E jobs while the
  detector/check succeeds
- **AND** non-PR events continue to run E2E.

### REQ-2693-006 — Interactive UI paths match the current harness contract

- **GIVEN** a change to a direct tmux harness module, preload, executed scenario,
  or referenced fixture
- **WHEN** GitHub evaluates the Interactive UI workflow path filter
- **THEN** the workflow runs
- **AND** an unrelated script test, fixture, or tmux scenario does not trigger
  it solely through a broad scripts glob.

The existing package/runtime candidates remain conservative because the job
runs root `npm ci`, a workspace-wide build, the real CLI launcher, and the
real tmux UI tests. Redesigning that broad build is not accepted scope.

### REQ-2693-007 — Gating remains observable and maintainable

- Workflow and classifier changes select their own relevance/wiring checks.
- PR and main-push candidate lists remain symmetric unless a real event input
  difference is documented.
- Intentional heavy-job skips produce successful terminal checks rather than
  absent or permanently pending required checks.
- Durable guidance explains coarse candidate filters, semantic gates,
  fail-closed uncertainty, rename/deletion handling, package-local docs, and
  the behavioral test that owns each policy.

## Relevant inputs and boundaries

### Windows installed-command

Relevant categories:

- `.nvmrc`, `.bun-version`, root `package-lock.json`
- root and workspace manifests/metadata used by install, build, bind, and pack
- publishable package/runtime content exercised through the installed CLI
- `packages/cli/bin/**` and native launcher installation
- root pre/postinstall behavior
- release pack, package preparation, dependency binding, npm/tar, and release
  package-selection helpers
- Windows smoke modules, probe, benchmark, workflow, and classifier
- deletion or rename of any relevant input.

Irrelevant negative control:

- a root ordinary script used only by documentation/tooling and not by the
  Windows workflow or its packaging/install call graph.

### E2E

The existing `scripts/docs-only-filter.ts` is authoritative. Package-local
Markdown/text, scripts, workflow/configuration, fixtures, and unknown paths are
code-relevant. Only the policy's explicit documentation locations may skip
heavy E2E jobs.

### Interactive UI

Direct inputs include the harness entry and split helper modules, the Bun test
preload, `interactive-ui.test.ts`, its three executed scenario JSON files, and
the fixtures/settings those scenarios reference. Broad package/runtime paths
remain because the current job installs and builds the workspace and executes
the real CLI.

## Behavioral evidence required

All new or changed tests use TypeScript, Bun, and `bun:test`. No Vitest or Node
test suite changes are accepted.

1. Windows classifier tests cover unrelated named scripts; lifecycle/invoked
   scripts; workspaces/dependency/install metadata; formatting/key order;
   lockfile and direct path categories; mixed changes; rename/deletion;
   malformed/missing manifests; incomplete/mismatched file data; PR, push,
   and manual events.
2. Windows workflow wiring tests read the real YAML and prove the cheap job
   gates only the Windows runner, uncertainty selects run, and intentional
   skip reaches a successful terminal result.
3. E2E wiring tests prove the real workflow invokes the shared classifier with
   structured files and the authoritative count; docs-only skips heavy jobs;
   runtime Markdown/text, fixtures, renames, and truncation run.
4. Interactive UI path-contract tests read the real workflow and prove direct
   harness/scenario/fixture inputs are included while unrelated script
   tests/fixtures/scenarios are excluded.
5. Mutation sanity: removing a required relevant category or reversing a
   fail-closed decision causes a behavioral test to fail.
6. Historical evidence remains consistent: PR #2937 is the docs-only negative
   sample; PRs #2610 and #3086 are genuine Windows positive samples; PR #2686
   provides the unrelated root-script negative case.
7. Candidate-head GitHub Actions must demonstrate terminal checks and preserve
   genuine positive workflow execution. CI evidence complements, but does not
   replace, deterministic classifier and wiring tests.

## Test-first implementation phases

### Phase 0.5 — Preflight and traceability

- Verify the Windows pack/install call graph and every candidate path against
  current source.
- Verify the exact Interactive UI scenarios, fixtures, preload, and harness
  imports.
- Verify the existing docs-only classifier CLI contract and CI invocation.
- Record any disproved assumption before changing workflow behavior.

### Phase 1 — RED: workflow policy tests

- Add Bun behavioral tests for Windows semantic relevance.
- Add Bun tests that read actual Windows, E2E, and Interactive UI workflow YAML
  through existing typed test helpers.
- Run the targeted tests and record natural failures against current behavior.

### Phase 2 — GREEN: Windows relevance

- Add one workflow-specific TypeScript relevance classifier without new
  dependencies or public abstractions.
- Add a cheap Ubuntu relevance job and gate the existing Windows runner.
- Keep a conservative top-level candidate list, correct verified omissions,
  and retain root lockfile relevance.
- Make uncertainty select the Windows smoke; do not swallow classifier errors
  into a skip decision.

### Phase 3 — GREEN: E2E and Interactive UI wiring

- Replace E2E's inline extension classifier with
  `scripts/docs-only-filter.ts`, preserving non-PR and required-check behavior.
- Replace broad Interactive UI script globs with its verified direct harness
  closure and add omitted direct inputs.
- Keep broad package/build/runtime candidates that the current job can observe.

### Phase 4 — REFACTOR and documentation

- Refactor only where tests expose duplication within the new workflow-specific
  logic; do not create a universal workflow-relevance subsystem.
- Add focused durable CI relevance guidance and the complete 21-workflow
  classification.
- Run targeted tests, full verification, smoke test, reviews, and PR CI.

## Explicitly deferred or rejected

### Defer

- Redesigning Windows into a launcher-only harness.
- Replacing Interactive UI's workspace-wide build with a targeted build.
- Consolidating PR-review context classification.
- Semantic lockfile hunk analysis.
- Optimizing scheduled, manual, release, smoke, or review automation without
  evidence of this issue's path-allocation defect.

### Reject

- Removing root manifests without a semantic replacement.
- Removing or partially classifying `package-lock.json`.
- Broad `paths-ignore` rules or classification by extension, title, label,
  author, or percentage of documentation files.
- A public/universal relevance abstraction shared by workflows with different
  observable contracts.
- Dependency, agent-memory, quality-tool, launcher behavior, lint-rule,
  complexity-rule, or unrelated refactor changes.
- Any lint/type suppression directive or weakened quality threshold.

## Verification gate

Before commit/push, all must pass:

```bash
bun test <targeted issue 2693 Bun tests>
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Completion additionally requires no conflicts, correct ancestry from current
`main`, completed DeepThinker and Open Code Review triage, all Blocker-Fix and
In-scope-Fix findings resolved, green PR checks on the candidate head, and no
unresolved actionable review threads.
