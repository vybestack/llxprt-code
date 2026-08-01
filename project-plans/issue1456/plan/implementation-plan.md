# Implementation Plan: Issue #1456 Sandbox Network Hardening

Plan ID: `PLAN-20260801-ISSUE1456`

Requirements: `REQ-1456-001` through `REQ-1456-007`

Specification: [`../specification.md`](../specification.md)

Preflight evidence: [`../analysis/preflight.md`](../analysis/preflight.md)

Required pseudocode: [`../analysis/pseudocode/sandbox-network-hardening.md`](../analysis/pseudocode/sandbox-network-hardening.md)

## Critical Execution Rules

1. Create coordinator todos for every phase and verification phase before P03 begins. Name the intended worker/reviewer in each todo.
2. Execute phases strictly in order. Do not begin the next phase until its verification phase returns PASS.
3. P03 must add all accepted behavioral tests before P04 changes production code. Observe the intended RED failures and record them.
4. Production changes in P04 are limited to code required by those failing tests and pseudocode `PS-1456-01` through `PS-1456-04`.
5. Tests must exercise real existing components. Infrastructure such as child processes, container CLIs, platform reporting, and auth proxy lifecycle may be controlled, but the sandbox function under test may not be mocked.
6. Do not export a resolver/helper solely for tests and do not add source-text assertions.
7. No fallback, swallowed fatal error, lint/type suppression, ignore, threshold change, dependency, workflow, quality-tool, memory, public API, or unrelated refactor is permitted.
8. If a phase fails, remediate that same phase and re-run its verifier. Never skip ahead.
9. No tmux harness is required because there is no visual/TUI behavior.

## Requirements Expanded for Execution

### REQ-1456-001 — Seatbelt profile mapping

When `SEATBELT_PROFILE` is explicitly set and non-empty, preserve it. Otherwise resolve `LLXPRT_SANDBOX_NETWORK ?? SANDBOX_NETWORK`, selecting `permissive-closed` for `off`, `permissive-proxied` for `proxied`, and `permissive-open` for `on` or unset. Verify the actual `.sb` path through `runSeatbeltSandbox`.

### REQ-1456-002 — Seatbelt proxied fail-fast

An automatically mapped proxied Seatbelt run requires a trimmed non-empty `LLXPRT_SANDBOX_PROXY_COMMAND`; invalid values throw `FatalSandboxError` before proxy or sandbox spawn. Existing custom-profile selection and child capability/credential environment scrubbing remain intact.

### REQ-1456-003 — Container proxied fail-fast and existing proxy path

Container network precedence remains primary-before-legacy. Proxied mode without a trimmed non-empty command throws before network setup or process spawn. A valid command continues through existing `setupContainerNetworking` and `startProxyContainer`; `off`, `on`, and unset behavior remain unchanged.

### REQ-1456-004 — Darwin network-off credential rejection

`setupCredentialProxy` rejects Docker/Podman on Darwin with effective network `off` before starting proxy/bridge/tunnel/capability resources or mutating outputs. The fatal message explains that macOS credential bridging requires networking. Linux network-off and Darwin network-enabled behavior remain supported. Launch without `LLXPRT_CREDENTIAL_SOCKET` is not an alternative.

### REQ-1456-005 — Podman macOS SSH conflict timing

A pre-existing non-host `--network`, especially `none`, remains authoritative. `setupSshAgentPodmanMacOS` warns and returns empty before connection lookup, tunnel reservation/spawn, readiness polling, or SSH argument mutation. Existing no-network-flag and host-network behavior remains.

### REQ-1456-006 — Accurate documentation

The sandbox overview and profile reference state all accepted engine-specific semantics. Only the directly contradicted tutorial network-off sentence is adjusted.

### REQ-1456-007 — Behavioral evidence and verification

Tests assert actual paths, errors, arguments, results, and resource side effects. Targeted and complete project checks pass.

## Intended Change Map

### Tests first

- Modify `packages/cli/src/utils/sandbox-seatbelt.test.ts`.
- Create `packages/cli/src/utils/sandbox-containers.test.ts` because no current test reaches the exported run-arg/network seams.
- Modify `packages/cli/src/utils/sandbox-entrypoint.test.ts`.
- Modify `packages/cli/src/utils/sandbox-ssh.test.ts`.

### Production after RED

- Modify `packages/cli/src/utils/sandbox-seatbelt.ts`.
- Modify `packages/cli/src/utils/sandbox-containers.ts`.
- Modify `packages/cli/src/utils/sandbox-podman.ts`.

No change is planned for `sandbox-exec.ts`: verified callers already order argument building before network/process setup and consume the existing proxy command path. No change is planned for `credential-store-factory.ts`: its direct-store fallback is evidence for fail-fast, not a target for redesign.

### Documentation after GREEN

- Modify `docs/sandbox.md`.
- Modify `docs/cli/sandbox-profiles.md`.
- Modify only the contradicted network-validation sentence in `docs/tutorials/sandbox-setup.md`.

## Phase P00: Architect Specification — Completed

Phase ID: `PLAN-20260801-ISSUE1456.P00`

### Deliverable

- `project-plans/issue1456/specification.md`

### Semantic gate

The specification defines accepted behavior, error contracts, compatibility, integration seams, test architecture, documentation, and explicit boundaries for AC1–AC5.

## Phase P00a: Verify Architect Specification — Completed

Phase ID: `PLAN-20260801-ISSUE1456.P00a`

### Verification

- Every accepted criterion maps to formal requirements and observable evidence.
- No issue outside accepted #1456 scope is promoted into implementation.
- No fallback path or direct-credential alternative is allowed.

## Phase P01: Preflight and Integration Analysis — Completed

Phase ID: `PLAN-20260801-ISSUE1456.P01`

### Deliverable

- `project-plans/issue1456/analysis/preflight.md`

### Evidence gate

The artifact records exact current callers, resource order, profile files, test seams, docs contradictions, and the credential factory's no-socket direct-store behavior.

## Phase P01a: Verify Preflight — Completed

Phase ID: `PLAN-20260801-ISSUE1456.P01a`

### Verification command already run

```bash
npm test --workspace @vybestack/llxprt-code -- --run \
  src/utils/sandbox-seatbelt.test.ts \
  src/utils/sandbox-ssh.test.ts \
  src/utils/sandbox-entrypoint.test.ts
```

Verified result: all selected files and tests passed with exit code 0 before implementation.

## Phase P02: Numbered Pseudocode — Completed

Phase ID: `PLAN-20260801-ISSUE1456.P02`

### Deliverable

- `project-plans/issue1456/analysis/pseudocode/sandbox-network-hardening.md`

### Coverage

- `PS-1456-01`: Seatbelt mapping and validation
- `PS-1456-02`: Container validation and current proxy path
- `PS-1456-03`: Credential fail-fast
- `PS-1456-04`: SSH conflict preflight
- `PS-1456-05`: Behavioral TDD sequence
- `PS-1456-06`: Documentation

## Phase P02a: Verify Pseudocode — Completed

Phase ID: `PLAN-20260801-ISSUE1456.P02a`

### Verification

- Algorithms preserve the established call path and error order.
- Implementation P04 below cites every production pseudocode group.
- Tests P03 below cite `PS-1456-05` and enter existing behavior seams.

## Phase P03: Behavioral Integration TDD — RED

Phase ID: `PLAN-20260801-ISSUE1456.P03`

Intended worker: `typescriptexpert`

### Prerequisites

- P00a, P01a, and P02a are PASS.
- Working tree contains no unexamined changes.
- No production file named in P04 has been modified for issue #1456.

### Pseudocode reference

Implement test sequence `PS-1456-05.001` through `PS-1456-05.027` only.

### Test task A: Seatbelt behavior through `runSeatbeltSandbox`

Modify `packages/cli/src/utils/sandbox-seatbelt.test.ts`.

Build a reusable environment lifecycle around:

- `SEATBELT_PROFILE`
- `LLXPRT_SANDBOX_NETWORK`
- `SANDBOX_NETWORK`
- `LLXPRT_SANDBOX_PROXY_COMMAND`
- proxy URL variables used by the fixture

Invoke real `runSeatbeltSandbox`; use only controlled child-process/OS infrastructure. For successful profile cases, capture the actual spawned Seatbelt argument vector and assert:

1. A non-empty explicit built-in override wins over automatic network mapping.
2. Existing explicit custom profile lookup remains under `.llxprt/sandbox-macos-<name>.sb`.
3. `off` selects the real existing `sandbox-macos-permissive-closed.sb` path.
4. `proxied` with a non-whitespace command selects the real existing `sandbox-macos-permissive-proxied.sb` path and takes the existing proxy lifecycle.
5. `on` selects the real existing `sandbox-macos-permissive-open.sb` path.
6. Unset mode selects that same open path.
7. With primary network unset, a legacy `SANDBOX_NETWORK=off` selects closed.
8. If both network vars conflict, the primary variable is authoritative.

For automatically mapped proxied mode, table-test missing, empty, and whitespace-only proxy commands. Repeat an invalid-command case with an explicit built-in `restrictive-proxied` override to prove the advanced override cannot bypass proxied-mode safety. Assert:

- rejection is `FatalSandboxError` with `proxied` and `LLXPRT_SANDBOX_PROXY_COMMAND` in its message;
- neither proxy nor Seatbelt child is spawned;
- no child marker/output file is created;
- run arguments and environment are restored after the case.

Keep the existing child environment test proving capability and credential markers are scrubbed. Do not replace it with a private-resolver test.

### Test task B: Container run-arg and proxy-network behavior

Create `packages/cli/src/utils/sandbox-containers.test.ts` with the current-year license header.

Invoke real `buildContainerRunArgs` and `setupContainerNetworking`; isolate filesystem/container-CLI infrastructure. Use temporary paths and clean them. Test:

1. Effective `proxied` plus missing, empty, and whitespace command throws `FatalSandboxError` from argument construction.
2. A test orchestration that calls network setup only after successful argument construction records no network inspect/create effect for each invalid input.
3. Configured proxied mode returns the original command unchanged, adds proxy env values, attaches the sandbox to `llxprt-code-sandbox`, and performs the existing internal sandbox-network and proxy-network inspect/create operations.
4. `off` retains `--network none`.
5. `on` and unset add no policy network flag.
6. `LLXPRT_SANDBOX_NETWORK=on` with legacy `proxied` does not require the proxy command.
7. `LLXPRT_SANDBOX_NETWORK=proxied` with legacy `off` requires the proxy command, proving primary precedence.

Assertions must center on the real returned args/command/error and resource state. Infrastructure invocation assertions supplement those outcomes; they do not replace them.

### Test task C: Credential proxy platform/network behavior

Extend `packages/cli/src/utils/sandbox-entrypoint.test.ts` at the existing `setupCredentialProxy` seam. Reuse its auth lifecycle infrastructure controls and existing temp-dir helper; use the established `os.platform` spy pattern.

Table-test Darwin `off` for Docker and Podman. Include one primary-network case and one legacy-fallback case. For each:

- expect actionable `FatalSandboxError`;
- verify `args`, `entrypointPrefixes`, and `reservedTunnelPorts` remain unchanged;
- verify no credential socket or capability env-file result exists;
- verify no host proxy/bridge/tunnel resource is created.

Add positive regressions:

- Linux Docker/Podman with `off` succeeds using the direct Unix socket under the mounted temp path and returns cleanup; invoke cleanup.
- Darwin Docker/Podman with `on` or unset follows the existing bridge behavior, yields `LLXPRT_CREDENTIAL_SOCKET`, and returns cleanup where applicable; invoke cleanup.
- Primary-over-legacy precedence is preserved for an enabled primary mode.

Mocks remain infrastructure-only. The real `setupCredentialProxy` must construct or reject the outcome.

### Test task D: Podman macOS SSH conflict

Modify `packages/cli/src/utils/sandbox-ssh.test.ts` conflict behavior at the existing `setupSshAgentPodmanMacOS` suite:

- start with `['--network', 'none']`;
- expect warning describing the retained conflict;
- expect `{}`;
- expect the arguments to remain exactly `['--network', 'none']`;
- expect zero `child_process.spawn` calls;
- expect no SSH environment or entrypoint result;
- verify no connection lookup/readiness command is needed for the early return.

Retain adjacent no-network-flag and host-network success coverage. Keep `sshAgent=off` routing coverage unchanged.

### RED command

```bash
npm test --workspace @vybestack/llxprt-code -- --run \
  src/utils/sandbox-seatbelt.test.ts \
  src/utils/sandbox-containers.test.ts \
  src/utils/sandbox-entrypoint.test.ts \
  src/utils/sandbox-ssh.test.ts
```

### RED success criteria

- New tests compile and reach real exported production functions.
- Failures correspond to current missing issue #1456 behavior: wrong profile, missing fatal errors, current warning fallback, credential resource allocation, or tunnel spawn-before-conflict.
- Existing unrelated cases continue to pass.
- No production or docs changes occur in this phase.

## Phase P03a: Verify Behavioral RED

Phase ID: `PLAN-20260801-ISSUE1456.P03a`

Intended verifier: `deepthinker`

### Verification checklist

- [ ] Read every new test and map it to REQ-1456-001 through REQ-1456-005 and `PS-1456-05`.
- [ ] Confirm each test would fail if the intended production behavior is absent or removed.
- [ ] Confirm no source-text inspection and no self-mocking.
- [ ] Confirm selected Seatbelt paths are observed from the actual run invocation.
- [ ] Confirm invalid inputs include missing, empty, and whitespace variants where required.
- [ ] Confirm no-spawn/no-resource assertions are paired with observable error/output assertions.
- [ ] Confirm environment, process, server, tunnel, temp-file, and cleanup isolation.
- [ ] Record the targeted RED output and explain each expected failure.

If any failure is a test defect, remediate P03 and re-run P03a. P04 is blocked until PASS.

## Phase P04: Minimal Production Implementation — GREEN

Phase ID: `PLAN-20260801-ISSUE1456.P04`

Intended worker: `typescriptexpert`

This is the single bounded production implementation pass. Do not broaden beyond the failing P03 tests.

### Prerequisites

- P03a PASS with recorded behavioral RED.
- Tests remain unmodified except for a demonstrated test defect approved through P03 remediation.

### Task A: Seatbelt profile policy

Modify `packages/cli/src/utils/sandbox-seatbelt.ts` according to `PS-1456-01.001`–`PS-1456-01.040`.

- Resolve non-empty explicit profile first.
- Otherwise map effective network mode to permissive profile.
- Preserve primary-before-legacy nullish precedence.
- Preserve assignment of the selected profile into process env for current diagnostics.
- Before `setupSeatbeltProxy`, reject a selected known built-in proxied profile (`permissive-proxied` or `restrictive-proxied`) when the command is missing/empty/whitespace, whether selection came from mapping or explicit override.
- Keep built-in module-relative and arbitrary custom `.llxprt` profile lookup unchanged.
- Keep child env scrubbing unchanged.
- Do not export the private selection/validation logic.

### Task B: Container proxied validation

Modify `packages/cli/src/utils/sandbox-containers.ts` according to `PS-1456-02.001`–`PS-1456-02.037`.

- In `buildContainerRunArgs`, validate the trimmed proxy command when effective mode is `proxied`.
- Throw `FatalSandboxError` before further preparation when invalid.
- Remove the unimplemented/default-network fallback warning.
- Leave `off` run args unchanged.
- Leave `on`/unset behavior unchanged.
- Leave the existing `setupContainerNetworking` and `startProxyContainer` design in place; do not build another path.
- Preserve the original non-whitespace command string passed to the existing shell execution path.

### Task C: Darwin network-off credential guard

Modify `packages/cli/src/utils/sandbox-containers.ts` according to `PS-1456-03.001`–`PS-1456-03.024`.

- At the start of `setupCredentialProxy`, before mutable setup state or `createAndStartProxy`, resolve effective network mode.
- For Darwin Docker/Podman plus `off`, throw actionable `FatalSandboxError`.
- Do not call `stopProxy` when nothing was started.
- Do not skip proxy setup and continue without a socket.
- Keep Linux and network-enabled Darwin setup/cleanup unchanged.

### Task D: Podman macOS SSH preflight

Modify `packages/cli/src/utils/sandbox-podman.ts` according to `PS-1456-04.001`–`PS-1456-04.024`.

- Make the existing network-conflict decision independent of `ChildProcess`.
- Run it before `startPodmanReverseTunnel`.
- On conflict, warn and return `{}` without connection lookup, port reservation, spawn, poll, kill, or arg mutation.
- On no flag or host mode, preserve current tunnel and result behavior.
- Make no SSH-agent changes outside this ordering/decision adjustment.

### GREEN command

```bash
npm test --workspace @vybestack/llxprt-code -- --run \
  src/utils/sandbox-seatbelt.test.ts \
  src/utils/sandbox-containers.test.ts \
  src/utils/sandbox-entrypoint.test.ts \
  src/utils/sandbox-ssh.test.ts
```

### Phase success criteria

- All P03 behavioral tests pass.
- Existing tests in the selected files pass.
- Errors propagate as `FatalSandboxError`.
- No new public API, fallback, proxy subsystem, or suppression exists.

## Phase P04a: Verify Production Behavior and Pseudocode

Phase ID: `PLAN-20260801-ISSUE1456.P04a`

Intended verifier: `deepthinker`

### Semantic verification

Compare final code step-by-step with `PS-1456-01` through `PS-1456-04`:

- [ ] Policy is checked before affected resource creation.
- [ ] Environment precedence is exact.
- [ ] Trim is used only as a validity test; valid command content is preserved.
- [ ] Automatic Seatbelt mapping chooses actual profile files through the run path.
- [ ] Explicit/custom Seatbelt and child-env behavior is preserved.
- [ ] Existing container proxy networks and proxy container remain the only configured path.
- [ ] Darwin off never succeeds without a credential socket.
- [ ] Linux off still succeeds.
- [ ] Podman network conflict returns before child spawn.
- [ ] Nonconflicting SSH behavior remains.
- [ ] Removing the implementation would make the new tests fail.

### Quality checks

```bash
npm run typecheck --workspace @vybestack/llxprt-code
npm run lint --workspace @vybestack/llxprt-code
```

No phase may proceed until targeted tests, typecheck, and lint pass.

## Phase P05: Security Documentation

Phase ID: `PLAN-20260801-ISSUE1456.P05`

Intended worker: `typescriptexpert`

### Prerequisite

P04a PASS.

### Pseudocode reference

Follow `PS-1456-06.001` through `PS-1456-06.009`.

### Tasks

1. Update `docs/sandbox.md`:
   - state Seatbelt network mapping and explicit non-empty `SEATBELT_PROFILE` override;
   - replace “no network isolation” with precise mapped-profile behavior while retaining Seatbelt's other limitations;
   - list `proxied` as a network value;
   - state required non-whitespace proxy command and existing proxy container/network path;
   - state Darwin Docker/Podman network-off fails before launch because credential bridge networking is mandatory;
   - state Linux network-off uses the direct mounted Unix socket;
   - state Podman macOS conflicting non-host network skips SSH tunnel setup and keeps network isolation.
2. Update `docs/cli/sandbox-profiles.md`:
   - remove the claim that proxied mode is unimplemented/falls back;
   - document engine-specific mapping/validation and precedence;
   - document Darwin credential bridge and Podman SSH constraints.
3. Update `docs/tutorials/sandbox-setup.md` only at the directly contradicted network-off result sentence:
   - distinguish a command denied by network isolation on a supported path from Darwin Docker/Podman fail-fast before container launch.

Do not broaden into a sandbox documentation rewrite.

## Phase P05a: Verify Documentation

Phase ID: `PLAN-20260801-ISSUE1456.P05a`

Intended verifier: `deepthinker`

### Verification checklist

- [ ] Every security statement is supported by a passing behavioral test or the verified existing call path.
- [ ] No statement calls configured proxied mode unimplemented or says it falls back.
- [ ] Engine/platform limitations distinguish Darwin containers, Linux containers, and Seatbelt.
- [ ] The explicit Seatbelt override and primary network precedence are clear.
- [ ] Tutorial change is limited to the contradicted sentence/context.
- [ ] No adjacent hardening recommendation is added.

### Commands

```bash
npm run lint:doc-links
npm run lint:doc-placement
npx prettier --check \
  docs/sandbox.md \
  docs/cli/sandbox-profiles.md \
  docs/tutorials/sandbox-setup.md \
  project-plans/issue1456
```

## Phase P06: Integration and Regression Evidence

Phase ID: `PLAN-20260801-ISSUE1456.P06`

Intended worker: `typescriptexpert`

### Prerequisite

P05a PASS.

### Integration assertions

Run the focused suite as one command so all shared environment/process boundaries are exercised together:

```bash
npm test --workspace @vybestack/llxprt-code -- --run \
  src/utils/sandbox-seatbelt.test.ts \
  src/utils/sandbox-containers.test.ts \
  src/utils/sandbox-entrypoint.test.ts \
  src/utils/sandbox-ssh.test.ts \
  src/utils/sandbox.test.ts \
  src/config/__tests__/sandboxConfig.test.ts
```

Then record evidence for each contract:

| Contract | Required observed evidence |
| --- | --- |
| Profile env → Seatbelt | `runSeatbeltSandbox` spawns with mapped existing `.sb` path; explicit/custom override remains |
| Proxied policy → container network | invalid configuration fails before setup; valid configuration yields internal network args and existing proxy command |
| Network policy → credential isolation | Darwin off rejects before resources; Linux off emits credential socket; enabled Darwin bridge succeeds |
| Network policy → optional SSH | `--network none` remains and no child is spawned; no-flag/host success remains |
| Profile configuration regression | sandbox profile tests still apply primary/legacy env as expected |

No live Docker/Podman invocation is required for this phase: the accepted evidence seam is pre-spawn run args/resource allocation, and external runtimes would make the test host-dependent. Existing real macOS Seatbelt tests remain platform-gated and run where available.

## Phase P06a: Review and Integration Verification

Phase ID: `PLAN-20260801-ISSUE1456.P06a`

Intended verifier: `deepthinker`

### Review questions

1. Can any requested `proxied` path reach spawn without a trimmed non-empty command?
2. Can Darwin Docker/Podman network-off reach direct credential storage or allocate credential resources?
3. Can Podman macOS SSH mutate `--network none`, allocate a tunnel, or reserve a port on conflict?
4. Does every automatic Seatbelt mode select its real expected profile through `runSeatbeltSandbox`?
5. Are explicit/custom Seatbelt and capability/credential env scrubbing preserved?
6. Is the existing proxy-container path reused without a second subsystem?
7. Are on/unset/off and Linux/non-Darwin compatibility protected by behavior tests?
8. Do docs exactly match the verified behavior?

### Review-finding triage table

All findings must use exactly one classification below. Add rows as findings are discovered; do not invent another status.

| Finding | Classification | Required action |
| --- | --- | --- |
| Any path silently downgrades proxied mode or Darwin credential isolation | Blocker-Fix | Remediate in P07 and repeat affected tests/review |
| Accepted mapping, precedence, error timing, no-spawn evidence, or docs are incomplete | In-scope-Fix | Remediate in P07 and repeat affected tests/review |
| Privilege/capability/seccomp/no-new-privileges hardening | Defer | Track under open #2902; do not change this implementation |
| Empty SSH-agent identity diagnostics | Defer | Track under open #1699; do not change this implementation |
| `gh` removal or broker work | Defer | Track under #2903/#1663; do not change this implementation |
| Redesign of #1954 capability transport/socket handling | Reject | Existing scope is satisfied; retain current design |
| New proxy subsystem, Seatbelt credential proxy, Windows work, protocol redesign, public API, dependency, workflow, quality-tool, memory, or unrelated refactor | Reject | Remove from proposed change |

## Phase P07: Finding Remediation Gate

Phase ID: `PLAN-20260801-ISSUE1456.P07`

Intended worker: `typescriptexpert`

### Prerequisite

P06a has classified every finding.

### Tasks

- Fix every `Blocker-Fix` and `In-scope-Fix` finding with the smallest change consistent with specification and pseudocode.
- Do not implement `Defer` or `Reject` rows.
- If production behavior changes, add or correct the failing behavioral test first, observe RED, then change production.
- Re-run the focused integration command from P06.
- If there are no `Blocker-Fix` or `In-scope-Fix` findings, record “no remediation required” and make no code change.

## Phase P07a: Verify Finding Disposition

Phase ID: `PLAN-20260801-ISSUE1456.P07a`

Intended verifier: `deepthinker`

### Verification

- Every finding has one allowed classification.
- Every `Blocker-Fix`/`In-scope-Fix` row is resolved and behaviorally verified.
- No `Defer`/`Reject` row entered the diff.
- Significant remediation triggers another P06a review cycle before PASS.

## Phase P08: Complete Local Verification

Phase ID: `PLAN-20260801-ISSUE1456.P08`

Intended worker: `typescriptexpert`

### Prerequisite

P07a PASS.

Run from repository root, synchronously, and stop on the first failure. Remediate via the responsible earlier phase, then restart this complete sequence.

```bash
# Focused issue #1456 behavior
npm test --workspace @vybestack/llxprt-code -- --run \
  src/utils/sandbox-seatbelt.test.ts \
  src/utils/sandbox-containers.test.ts \
  src/utils/sandbox-entrypoint.test.ts \
  src/utils/sandbox-ssh.test.ts \
  src/utils/sandbox.test.ts \
  src/config/__tests__/sandboxConfig.test.ts

# Full repository gates
npm run test
npm run lint
npm run typecheck
npm run format
npm run build

# Current runtime smoke
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"

# Ensure formatter made no unreviewed semantic change and inspect final scope
git status --short
git diff --check
git diff -- \
  packages/cli/src/utils/sandbox-seatbelt.ts \
  packages/cli/src/utils/sandbox-containers.ts \
  packages/cli/src/utils/sandbox-podman.ts \
  packages/cli/src/utils/sandbox-seatbelt.test.ts \
  packages/cli/src/utils/sandbox-containers.test.ts \
  packages/cli/src/utils/sandbox-entrypoint.test.ts \
  packages/cli/src/utils/sandbox-ssh.test.ts \
  docs/sandbox.md \
  docs/cli/sandbox-profiles.md \
  docs/tutorials/sandbox-setup.md \
  project-plans/issue1456
```

### Smoke expectation

The smoke command exits successfully and emits only the requested haiku content from the selected profile. It is a runtime launch regression check; it does not replace the sandbox behavior tests.

### Failure policy

- Targeted/full test failure: return to P03/P04 or P07 using RED-GREEN.
- Lint/typecheck failure: simplify/fix underlying code; no suppression.
- Format changes: review them, rerun targeted tests, then restart P08.
- Build failure: remediate only the issue-related integration problem demonstrated by the build.
- Smoke failure: investigate and remediate before completion; do not report success with a pending smoke failure.

## Phase P08a: Final Semantic Verification

Phase ID: `PLAN-20260801-ISSUE1456.P08a`

Intended verifier: `deepthinker`

### Final checklist

- [ ] P03 RED was recorded before P04 production changes.
- [ ] AC1–AC5 each have passing behavior evidence.
- [ ] Actual Seatbelt profile paths are observed through `runSeatbeltSandbox`.
- [ ] Invalid proxied modes create no proxy/network/sandbox process.
- [ ] Configured container proxied mode uses the existing isolated network and proxy-container path.
- [ ] Darwin network-off cannot omit the credential socket or allocate a dead bridge.
- [ ] Linux network-off remains supported.
- [ ] Podman macOS SSH conflict occurs before tunnel spawn and never replaces `--network none`.
- [ ] Documentation is accurate and bounded.
- [ ] All findings use allowed classifications and are disposed.
- [ ] Full verification and smoke pass.
- [ ] No workflow, dependency, quality-tool, memory, public API, or unrelated-plan change exists.
- [ ] No tmux evidence is required.

Only after every item passes is `PLAN-20260801-ISSUE1456` ready for commit/PR preparation.
