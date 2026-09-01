# Plan: Issue #3449 sandbox orphan reaping

Plan ID: PLAN-20260831-ISSUE3449
Generated: 2026-08-31
Requirements: REQ-3449-001 through REQ-3449-007

## Purpose

A Docker or Podman sandbox is started as a child of the host CLI. Normal cleanup is wired to host process and sandbox child events. SIGKILL, OOM termination, host crash, and power loss bypass those handlers, so the container keeps running. This plan chooses the issue's permitted recovery route: a later sandbox startup sweeps orphaned containers for its selected engine.

The sweep is conservative. It removes a container only when LLxprt ownership metadata is valid and the owning host process is proven dead. Missing, malformed, foreign-host, inaccessible, or otherwise unverifiable ownership leaves the container alone.

## Preflight findings

### Repository and test environment

- The working branch is `issue3449` and was clean before this plan was created.
- `packages/cli/package.json` runs tests with Bun through `bun run-bun-tests.ts`.
- `packages/cli/run-bun-tests.ts:69-77` discovers co-located `*.test.ts`, `*.spec.ts`, and `*.bun.ts` files.
- `dev-docs/RULES.md:3-15` requires test-first development, behavior tests, strict TypeScript, immutable data, and complete behavior coverage.
- `dev-docs/RULES.md:85-109` permits infrastructure substitution but rejects implementation-detail and mock-interaction assertions.
- No dependency is needed. Node child-process, OS, and JSON facilities already used by the CLI are sufficient.
- Read-only probes on the development host confirmed that Docker 29.1.3 and Podman 5.7.1 both accept `ps --filter` and the Go-template `.Label` lookup needed to list marked containers.

### Existing call path

1. `packages/cli/src/cli.tsx:422-423` calls `maybeHopIntoSandbox` after provider activation.
2. `packages/cli/src/cliSandbox.ts:153-211` rejects nested hops, resolves the sandbox config, calls `start_sandbox`, and exits after the sandbox finishes.
3. `packages/cli/src/utils/sandbox.ts:91-142` dispatches Docker and Podman configs to the container sandbox path and performs normal cleanup.
4. `packages/cli/src/utils/sandbox-exec.ts:148-240` prepares the container. The selected engine is available here before image, networking, credential proxy, and container side effects.
5. `packages/cli/src/utils/sandbox-exec.ts:280-313` spawns the selected engine and waits for its child process.
6. `packages/cli/src/utils/sandbox-containers.ts:765-830` wires cleanup to `exit`, `SIGINT`, `SIGTERM`, and sandbox `close`. None can run after host SIGKILL or host process loss.

### Current ownership signal

- `packages/cli/src/utils/sandbox-containers.ts:449-477` builds a name from image version and `process.pid`, then adds a suffix on collision.
- The optional numeric suffix makes reverse parsing of the PID from the name ambiguous.
- Name matching alone could also select a user-created container. It is not sufficient proof of ownership.
- `packages/cli/src/utils/sandbox-containers.ts:144-220` is the existing main-container argument builder, so engine labels fit the existing design without a new package, service, dependency, or public API.
- The repository already uses the safe process identity rule elsewhere: PID existence plus an OS-observed process start time, with unverifiable state retained rather than treated as dead. The issue implementation will keep its small, private equivalent inside the sandbox container utility rather than expose another package's internals.

### Architecture decision

Keep the change inside the existing container lifecycle:

- Add private ownership metadata, parsing, process probing, and sweep helpers to `sandbox-containers.ts`.
- Mark only the main Docker or Podman sandbox in its existing run arguments.
- Call the best-effort sweep from `prepareContainerSandbox` before image, network, credential, or new-container setup.
- Sweep only the engine selected for this startup. A Docker startup handles Docker containers, and a Podman startup handles Podman containers.
- Do not add a daemon, watchdog, heartbeat, public abstraction, shared process-liveness module, package export, dependency, setting, or command.

The existing architecture supports this narrow change. No approval for expansion is needed.

## Accepted behavior

### REQ-3449-001: Mark newly created main containers

**Requirement text:** Every newly started LLxprt main sandbox container for Docker or Podman carries an LLxprt-managed marker and versioned owner metadata supplied in the existing `run` arguments.

The owner metadata contains:

- metadata version
- host name
- positive integer host CLI PID
- host CLI process start time in milliseconds
- start-time source, either `observed` or `estimated`

The process start time is read from the OS where supported. If it cannot be read, `Date.now() - process.uptime() * 1000` is stored as `estimated`. The existing container name remains unchanged and is not used as sole ownership proof.

### REQ-3449-002: Sweep at the selected engine's sandbox startup boundary

**Requirement text:** Before a new Docker or Podman sandbox performs image, networking, credential-proxy, or container startup work, it lists running containers from that same selected engine that carry the LLxprt-managed marker.

A normal non-sandbox CLI startup performs no sweep. A process already inside `SANDBOX` performs no sweep because it never enters `runContainerSandbox`. A Docker startup does not invoke Podman, and a Podman startup does not invoke Docker.

### REQ-3449-003: Remove only proven orphans

**Requirement text:** A marked container is eligible for `ENGINE rm -f CONTAINER_ID` only when all of the following hold:

1. Its owner metadata parses and validates.
2. Its recorded host name equals the current host name.
3. Its owner is proven dead by one of these rules:
   - `process.kill(pid, 0)` reports `ESRCH`; or
   - the PID exists, the stored start-time source is `observed`, the current OS start time is observed, and the two start times differ by more than 2,000 ms.

The second rule corroborates PID identity and detects PID reuse. The sweep does not require a process command-name heuristic because start time identifies the process instance rather than the executable family.

### REQ-3449-004: Preserve live and unverifiable owners

**Requirement text:** The sweep leaves the container running in every state that is not proven dead, including:

- the PID exists and its observed start time matches within 2,000 ms
- the PID exists but stored metadata uses an `estimated` start time
- the PID exists but its current start time cannot be observed
- the liveness probe fails with `EPERM` or any error other than `ESRCH`
- the ownership row or JSON is empty, malformed, unsupported, or from an unknown metadata version
- the recorded host name differs from the current host

This is the live-session negative case. Uncertainty produces a retained container, not a removal attempt.

### REQ-3449-005: Make the sweep best effort and bounded

**Requirement text:** Listing, parsing, process probing, and removal are recovery work. Their failures do not reject or abort sandbox preparation.

- Bound each OS process start-time probe to 250 ms.
- Bound the engine listing operation and each engine removal operation to 5,000 ms.
- If listing fails or times out, skip the sweep and continue startup.
- If one row is malformed or one process probe is unverifiable, retain that row and continue with other rows.
- If removal of one proven orphan fails or times out, continue with other rows and continue startup.
- Concurrent startup sweeps may race to remove the same orphan. A later `rm -f` failure remains non-fatal.

### REQ-3449-006: Support both engine paths

**Requirement text:** The same marker, owner decision, retention rule, and best-effort removal behavior apply when `SandboxConfig.command` is `docker` and when it is `podman`.

Behavior is selected by the existing `SandboxConfig.command`; there is no duplicated Docker-only or Podman-only policy.

### REQ-3449-007: Deliver behavioral evidence

**Requirement text:** Bun tests and manual engine evidence demonstrate the decision and its startup integration.

Automated evidence must prove:

1. A live owner with matching process identity is retained.
2. A dead owner is selected for removal.
3. A live process that reused the recorded PID, represented by a mismatched observed start time, makes the old container eligible for removal without terminating that live process.
4. An estimated or otherwise unverifiable owner is retained.
5. Malformed or foreign-host metadata is retained.
6. Engine list and removal failures do not escape the sweep.
7. Docker and Podman run arguments receive the same ownership labels, and each selected-engine sweep uses the same decision path.

Manual evidence must prove, for Docker and Podman separately:

1. Start sandbox A and record its host PID and container ID.
2. Kill sandbox A's host CLI with `kill -9`.
3. Confirm the old container remains before recovery startup.
4. Start sandbox B with the same engine.
5. Confirm sandbox A's container is gone and sandbox B starts successfully.
6. Start two live sandbox sessions with the same engine and confirm the second startup does not remove the first session's container.

## Inputs and boundary cases

| Input or state | Accepted result |
|---|---|
| No marked running containers | No removal and startup continues. |
| Marked container with dead PID | Remove best effort. |
| Marked container whose PID is now an unrelated live process with a different observed start time | Remove the marked container best effort; do not signal the live process. |
| Marked container with matching live PID and start time | Retain. |
| PID exists but owner start time was estimated | Retain. |
| OS process query is unsupported, malformed, denied, or timed out | Retain the affected container. |
| Engine output is empty | No removal and startup continues. |
| Engine output has a malformed row or owner payload | Retain that row and continue. |
| Managed marker exists but owner payload is missing | Retain. |
| Owner host differs from current host | Retain. |
| Engine list fails or times out | Skip the sweep and continue startup. |
| One `rm -f` fails or times out | Continue other removals and startup. |
| Two recovery startups remove the same orphan | At most one succeeds; both startups continue. |
| Container name resembles LLxprt but lacks the managed marker | Ignore it. |
| Marked container is stopped rather than running | Ignore it because the accepted defect is a running orphan. |

### Race handling

The policy favors retention when state changes during a probe:

- If an owner exits after being classified live, retain the container until a later sweep.
- If an owner exits between PID existence and start-time lookup, a missing lookup result is unverifiable and retained until a later sweep.
- If a PID is reused before the start-time lookup, the mismatch proves that the recorded owner no longer exists and permits removal.

## Out of scope

- Immediate self-termination, an in-container watchdog, heartbeat, daemon, or host service
- Reaping from ordinary non-sandbox CLI startups
- Sweeping every installed engine instead of the selected engine
- Reaping pre-change containers that lack the managed marker
- Parsing ownership only from `sandbox-*-<pid>` names
- Reaping user-created containers, the shared proxy sidecar, or macOS Seatbelt processes
- Cross-host recovery for remote Docker or Podman contexts
- Capability environment directory cleanup from issue #3440
- Changes to credential proxy behavior, mounts, network setup, container naming, normal signal cleanup, settings, CLI flags, documentation, workflows, dependencies, package exports, or agent memory
- Refactoring the similar private process-owner logic in auth or storage into a shared module

If implementation appears to require any item above, stop and request scope approval rather than extending this plan.

## Proposed implementation surface

### `packages/cli/src/utils/sandbox-containers.ts`

Add only private or package-internal pieces needed by the existing lifecycle:

- label constants for the managed marker and serialized owner metadata
- a small versioned owner metadata type and validator
- an OS process start-time reader using argument-array child-process execution, fixed locale and timezone, and a 250 ms timeout
- a liveness classifier with `dead`, `live`, and `unverifiable` outcomes
- a best-effort selected-engine sweep that lists marked running containers, classifies each owner, and runs `rm -f` only for `dead`
- ownership label arguments added when `assignContainerName` already adds `--name` and `--hostname`

Use `execFile` or `execFileSync` with argument arrays for all new engine and `ps` operations. Do not compose shell commands from engine output or container IDs.

### `packages/cli/src/utils/sandbox-exec.ts`

Call and await the sweep at the start of `prepareContainerSandbox`, after sandbox environment validation and before `prepareContainerImageAndArgs`. The sweep owns its recovery-error handling, so existing fatal behavior for image, configuration, proxy, and spawn failures is unchanged.

### Tests

- Create `packages/cli/src/utils/sandbox-orphan-reaping.bun.test.ts` for the decision, malformed external input, best-effort behavior, and both-engine matrix.
- Extend `packages/cli/src/utils/sandbox-container-name.bun.test.ts` only for the observable run-argument labels if that remains the smallest non-duplicative location.
- Do not modify unrelated sandbox tests or create Node/Vitest suites.

No other production or test file is planned.

## Numbered pseudocode

### Owner metadata and labels

```text
10: FUNCTION buildCurrentSandboxOwner
11:   SET observedStart to bounded OS start-time lookup for process.pid
12:   IF observedStart exists
13:     RETURN version, hostname, pid, observedStart, source observed
14:   RETURN version, hostname, pid, Date.now minus process.uptime, source estimated
15:
16: FUNCTION addSandboxOwnershipLabels(args)
17:   SET owner to buildCurrentSandboxOwner
18:   APPEND managed marker label to args
19:   APPEND serialized owner label to args
```

### Liveness decision

```text
30: FUNCTION probeSandboxOwner(owner)
31:   IF owner is invalid OR owner.hostname differs from current hostname
32:     RETURN unverifiable
33:   TRY process.kill(owner.pid, 0)
34:   CATCH ESRCH
35:     RETURN dead
36:   CATCH any other error
37:     RETURN unverifiable
38:   IF owner.startTimeSource is not observed
39:     RETURN unverifiable
40:   SET currentStart to bounded OS start-time lookup for owner.pid
41:   IF currentStart is missing
42:     RETURN unverifiable
43:   IF absolute difference between owner.startTimeMs and currentStart exceeds 2000
44:     RETURN dead
45:   RETURN live
```

### Startup sweep

```text
60: ASYNC FUNCTION reapOrphanedSandboxContainers(config)
61:   TRY list running container ID and owner-label rows from config.command filtered by managed marker
62:   CATCH OR TIMEOUT
63:     RECORD debug diagnostic and RETURN
64:   FOR EACH row
65:     PARSE container ID and owner metadata
66:     IF parsing or validation fails
67:       RETAIN row and CONTINUE
68:     SET liveness to probeSandboxOwner(owner)
69:     IF liveness is not dead
70:       RETAIN row and CONTINUE
71:     TRY config.command rm -f container ID with timeout
72:     CATCH OR TIMEOUT
73:       RECORD debug diagnostic and CONTINUE
74:     RECORD successful reap diagnostic
75:   RETURN without throwing
76:
77: ASYNC FUNCTION prepareContainerSandbox(...)
78:   VALIDATE existing sandbox environment
79:   AWAIT reapOrphanedSandboxContainers(config)
80:   CONTINUE existing image, network, credential, argument, and spawn preparation
```

## TDD execution sequence

Every production change follows a test that fails for the missing behavior. Do not write all production code and add tests afterward.

### Phase 0.5: Reconfirm preflight

1. Confirm branch and preserve any user changes with `git status --short --branch`.
2. Re-read the call sites and line ranges named above because line numbers may move.
3. Confirm `docker ps --help` and `podman ps --help` still expose filter and format options where those tools are installed. Tests must not require installed or running engines.
4. Confirm the new test file is discovered by the Bun CLI test runner.
5. If a new dependency, package export, shared subsystem, or workflow change appears necessary, stop.

### Phase 1: RED, live and dead owner decisions

1. Add the new Bun test file.
2. Use real child processes and the real OS liveness probe where the host supports start-time observation.
3. Write the live-session negative test first: a running child with matching recorded PID, host, and observed start time is retained.
4. Run the single file and record that it fails because the decision behavior does not exist.
5. Add tests for a child after confirmed exit and for a live child paired with an older observed start time. Assert the reused-PID stand-in process remains alive after classification.
6. Add estimated, malformed, and foreign-host retention cases.

### Phase 2: GREEN, minimal ownership decision

1. Add the private metadata parser, bounded OS start-time reader, and liveness classifier in `sandbox-containers.ts`.
2. Implement only enough to pass Phase 1.
3. Run the single test file after each behavior is made green.
4. Refactor only if needed to keep parsing and classification readable.

### Phase 3: RED, container marking for both engines

1. Add a Docker and Podman table test that calls the real argument-building path and reads the emitted labels.
2. Assert the managed marker exists and the owner payload validates to the current host PID with an allowed start-time source.
3. Assert the existing `--name` and `--hostname` behavior remains unchanged.
4. Run the focused tests and record failure because labels are absent.

### Phase 4: GREEN, ownership labels

1. Add labels at the existing name/hostname argument boundary.
2. Do not alter the name format or label the proxy sidecar.
3. Run the orphan and container-name focused files.

### Phase 5: RED, best-effort selected-engine sweep

1. Test the real sweep with only the child-process engine boundary substituted. Do not mock the liveness classifier or assert mock call counts.
2. Model engine state as marked container rows. Assert resulting retained/removed state, not that a stub was called.
3. Cover Docker and Podman with the same cases:
   - dead owner removed
   - live owner retained
   - malformed owner retained while another dead owner is processed
   - list failure returns normally
   - one removal failure does not prevent another removal or completion
4. Add the startup-boundary test that proves preparation continues after the sweep reports an engine failure. Keep existing image/proxy behavior outside the test's subject.
5. Run the file and record failures because no sweep or startup integration exists.

### Phase 6: GREEN, sweep and wiring

1. Implement filtered selected-engine listing, row parsing, dead-only removal, timeouts, and per-row continuation.
2. Wire the sweep into `prepareContainerSandbox` before image and proxy side effects.
3. Preserve fatal behavior outside recovery work.
4. Run focused tests after each behavior becomes green.

### Phase 7: Refactor and behavioral verification

1. Remove duplication introduced during green only if the result remains private to the existing module.
2. Check that every catch is limited to engine/process-list external input or the explicitly best-effort removal path.
3. Confirm no production fallback treats unverifiable state as dead.
4. Run the manual Docker and Podman evidence matrix from REQ-3449-007.

## Verification commands and required evidence

### Focused automated checks

```bash
bun test packages/cli/src/utils/sandbox-orphan-reaping.bun.test.ts
bun test packages/cli/src/utils/sandbox-container-name.bun.test.ts
bun test packages/cli/src/utils/sandbox-containers.test.ts
bun test packages/cli/src/utils/sandbox.test.ts
bun scripts/test-audit/scan.ts tmp/issue3449-test-audit
```

Expected evidence:

- The new test file first fails against the pre-change implementation for missing accepted behavior.
- The same file passes after each green step.
- Neighboring container and sandbox behavior remains green.
- The test-audit output adds no mock-mirror, always-true, self-confirming, or no-assert finding for touched tests.

### Full repository cycle

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
git diff --check
```

Record exact command status and the smoke-test output. Formatting must not broaden the diff beyond the planned files.

### Manual Docker evidence

Record commands and container IDs for:

- one host CLI killed with SIGKILL, then removed by a later Docker sandbox startup
- one live Docker sandbox retained when another Docker sandbox starts
- the recovery startup completing even when an induced stale removal fails, if this can be induced without changing host configuration

### Manual Podman evidence

Record the same three observations using Podman. A missing local engine may justify a recorded skip for manual evidence, but it does not justify omitting the automated Docker and Podman behavior matrix.

## Closing review triage and evidence

The post-rebase candidate integrates the current `origin/main` sandbox capability-directory changes from `e4d0999b7` with issue #3449. Conflict resolution retained current-main's per-session mount and cleanup refactoring while preserving the orphan sweep, ownership labels, proxy behavior, and normal container lifecycle. The integrated `sandbox-containers.ts` then failed the mandatory source-size gate at 832 counted lines, while `origin/main` passed.

The lint-required adjustment extracts only the ownership-label writer from `sandbox-containers.ts` into the private co-located `sandbox-owner-labels.ts` module. The moved code is limited to the managed and owner label constants, current-owner metadata type, bounded current-process start observation, current-owner construction, and label-argument append helper. The orphan reader and liveness policy remain private to `sandbox-exec.ts`; there is no shared liveness subsystem, package export, dependency, suppression, metadata change, or proxy labeling change.

The final candidate changes six paths: `packages/cli/src/utils/sandbox-container-name.bun.test.ts`, `packages/cli/src/utils/sandbox-containers.ts`, `packages/cli/src/utils/sandbox-exec.ts`, `packages/cli/src/utils/sandbox-orphan-reaping.bun.test.ts`, `packages/cli/src/utils/sandbox-owner-labels.ts`, and this plan. The implementation marks main containers, sweeps the selected engine before startup side effects, validates owner metadata, compares host process identity, and retains every state that is not proven dead. Docker and Podman use the same private policy. Engine and process probes remain bounded.

### Review findings

| Source | Finding | Classification | Resolution |
|---|---|---|---|
| Deep review | Test engine and process fixtures needed to execute on Windows as well as POSIX hosts. | Blocker-Fix | Fixed by compiling portable Bun executables. Focused tests exercise the compiled Docker, Podman, and process fixtures. |
| Deep review | Fixture compilation could leave source files or root `.bun-build` intermediates when setup or execution failed. | Blocker-Fix | Fixed with failure-path cleanup, suite teardown, and before-and-after artifact checks. |
| First local OCR | `ps lstart` output was generated in UTC but parsed as host-local time, which could misclassify a live owner after a timezone or daylight-saving transition. | Blocker-Fix | Fixed by parsing the observed value explicitly as UTC in the writer and reader. A non-UTC child test proves matching recorded owners remain live. |
| First local OCR | The tests did not prove that the ownership writer and reaping reader agreed under a non-UTC host timezone. | In-scope-Fix | Added a behavioral path that emits real ownership labels, reads them during startup recovery, and retains the matching owner under `America/New_York`. |
| First local OCR | Add `-a` so stopped containers are included. | Reject | The accepted defect and input table cover running orphan containers. Stopped containers remain outside this issue. |
| First local OCR | Run all removals concurrently or add one total sweep deadline. | Reject | The accepted design bounds listing and each removal independently and continues after each failure. It does not promise a constant total sweep duration. |
| First local OCR | Extract the duplicated labels, metadata types, and process-start logic to shared code. | Reject | The accepted architecture forbids a shared liveness abstraction or package export. Writer and reader remain small, private, behaviorally covered, and explicitly UTC-compatible. |
| First local OCR | Log every owner whose process-start observation is unavailable. | Reject | Unverifiable owners are deliberately retained. Per-row diagnostics are not an accepted requirement and could add repeated startup warnings on hosts without the observation facility. |
| Second local OCR | Extract the duplicated labels, metadata types, and `lstart` parsing to a shared or private-export module. | Reject | This repeats the rejected abstraction change. The plan keeps the issue-specific writer and reader private and covers their compatibility through behavior. |
| Second local OCR | Replace `ENGINE_ENV_KEYS.slice(3)` with an explicit flag-key array. | Defer | This is an optional low-risk test-maintenance cleanup outside the defined follow-up concerns. It remains a known follow-up and is not implemented here. No separate issue was created. |
| Second local OCR | CRLF `ps --format` rows could leave a carriage return attached to owner JSON and prevent orphan removal on Windows. | In-scope-Fix | Added CRLF behavioral evidence, removed a dead marked container from that output, and stripped only the row-ending carriage return before parsing. Malformed-row retention and metadata validation are unchanged. |

All Blocker-Fix and In-scope-Fix findings are resolved. The Reject and Defer findings did not change production or test architecture.

### TDD and local verification evidence

- CRLF RED: `tmp/issue3449-final-candidate-red/crlf-red.log` ran the named regression against retained `origin/main`; the marked dead container remained and the test failed with `0 pass, 1 fail`.
- CRLF GREEN: `tmp/issue3449-final-candidate-green/crlf-green.log` passed with `1 pass, 0 fail` after row-ending normalization.
- Focused candidate tests: `tmp/issue3449-final-candidate-focused/` records `15/15` orphan-reaping tests, `11/11` container-name tests, `82/82` container utility tests, and `94/94` sandbox tests. The latter three counts include ignored retained test copies discovered by Bun. No focused test failed.
- Full cycle: `tmp/issue3449-final-candidate-cycle/statuses.txt` records exit status 0 for `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, the `stepfun-37` smoke, and `git diff --check`.
- Smoke output: `tmp/issue3449-final-candidate-cycle/smoke.log` contains only the selected profile header and a three-line haiku.
- Test audit: `tmp/issue3449-final-candidate-audit/` records successful retained `origin/main` and candidate scans. Both have 2,023 findings and `findings.diff` is empty. The candidate adds one scanned file, 17 tests, and 22 assertions without a new scanner finding.
- Artifact checks: `tmp/issue3449-final-candidate-focused/artifact-status.txt` and `tmp/issue3449-final-candidate-cycle/artifact-statuses.txt` record no new root `.bun-build` intermediates and no leaked `tmp/issue3449-orphan-reaping-*` fixture directories. The formatter did not change the five-path status.

### Docker and Podman manual evidence

`tmp/issue3449-manual-20260831T1625-branch8/` contains the Docker and Podman evidence. For each engine, the `*-A` records show the main container and owner before host SIGKILL and show that the container remained immediately afterward. The `*-B` records show the later startup removed orphan A. The `*-C` records show that another startup retained live sandbox B. Final inventory files show Docker at 13 containers before and after, Podman at 1 container before and after, no managed containers left, no owner processes left, and no change to pre-existing container ID and name sets.

## Risks and controls

| Risk | Control and evidence |
|---|---|
| PID reuse causes a live session container to be removed | Require matching host plus process-instance start time. Any unavailable or estimated identity is retained. Test matching live and mismatched reused-PID cases. |
| A user container has an LLxprt-like name | Ignore names as ownership proof and list only containers with the managed marker and valid owner payload. |
| Remote engine context exposes a container created from another host | Hostname mismatch is unverifiable and retained. Cross-host recovery is out of scope. |
| Engine output differs or is malformed | Treat output as external input, validate each row, retain malformed rows, and continue. Test malformed rows. |
| Docker or Podman hangs or rejects a command | Bound process and engine operations. Catch only the recovery boundary and continue startup. Test list, timeout, and removal failure paths. |
| Concurrent startups race on one orphan | Use idempotent best-effort `rm -f`; a losing removal is non-fatal. |
| Owner exits during liveness probing | Missing or uncertain observations retain the container for a later sweep. This may delay cleanup but does not kill a live session. |
| Pre-change orphan remains | It lacks the managed marker and is intentionally retained. Name-only migration would weaken ownership proof and is out of scope. |
| Similar process-owner code already exists in another package | Keep the issue-specific helper private and small. Do not add package exports or a shared subsystem in this issue. |
| Tests become mock-interaction checks | Use real child processes for identity decisions and assert fake engine state or returned behavior, never invocation counts. |

## Completion gate

Implementation is complete only when:

- all seven requirements have behavioral evidence
- Docker and Podman use the same decision and best-effort policy
- the live-session negative test passes
- PID reuse is handled through process start-time corroboration
- malformed or unverifiable input cannot cause removal
- sweep failures cannot abort sandbox startup
- no out-of-scope file or behavior changed
- focused checks, full verification, and available manual engine evidence are recorded

## Final-head PR finding remediation

The final-head review findings were evaluated against the accepted requirements and architecture before production code changed.

| Finding | Classification | Resolution and rationale |
|---|---|---|
| 1. CodeRabbit `PRRT_kwDOPB5qbc6d9IH2`, one total sweep deadline | Reject | REQ-3449-005 bounds the listing and each removal independently and permits sequential best effort. A total deadline or concurrent removal would change accepted behavior. |
| 2. OCR `PRRT_kwDOPB5qbc6d9Q-X`, hoisted child-process mock | In-scope-Fix | The container-name test now captures the real module with the repository `automock(realNodeChildProcessModule)` pattern, stubs `execSync`, preserves real `execFileSync`, and proves that the non-stubbed export executes Bun. The real argument builder remains under test. |
| 3. OCR `PRRT_kwDOPB5qbc6d9Q_a`, shared owner helpers | Reject | The writer and strict external reader have different responsibilities. The accepted plan excludes a shared liveness abstraction and public export. |
| 4. OCR `PRRT_kwDOPB5qbc6d9RBD`, recheck ESRCH after unavailable start lookup | Reject | The accepted race policy retains an owner that exits between existence and start-time lookup as unverifiable until a later startup. |
| 5. OCR `PRRT_kwDOPB5qbc6d9RCc`, placeholder hostname while writing labels | Reject | Ownership labels require actual host metadata. A placeholder would create invalid or permanently foreign metadata and change label-writing behavior. |
| 6. OCR `PRRT_kwDOPB5qbc6d9RD8`, hostname failure during reaping | In-scope-Fix | A behavior test proves lookup failure retains the container and sandbox preparation continues. The private recovery decision now returns not-proven-dead when `os.hostname()` throws. Label writing is unchanged. |
| 7. Last-four-arguments assertion | Reject | The assertion intentionally protects current `--name` and `--hostname` placement. Refactoring it is unrelated to orphan recovery. |
| 8. Force `observed` in the host-dependent label test | Reject | Cross-platform observation may be unavailable, so the host-dependent case correctly accepts `observed` or `estimated`. Controlled process fixtures cover observed behavior. |
| 9. Re-prove `--label` pairing in the fallback case | Reject | The preceding behavior case verifies ownership values are paired with `--label`. The fallback case isolates estimated metadata. |
| 10. Bound estimated `startTimeMs` | In-scope-Fix | The real argument-building call is bracketed by process-start estimates with a stable 30-second allowance. The parsed fallback value must fall within those bounds. |
| 11. Derive the timezone child filename from `import.meta` | Reject | The child command failure is asserted, so a rename cannot silently remove coverage. The cleanup is unrelated to issue behavior. |
| 12. CodeRabbit docstring coverage warning | Reject | Bulk docstrings conflict with project comment style and source-size limits and add no behavior evidence. |

### Final-head TDD evidence

- Finding 2 RED: `tmp/issue3449-final-head/red/container-name-red.log` failed because automocking all child-process exports made `execFileSync` return `undefined`; the setup-integrity behavior test attempted to execute `Bun --version` and failed. GREEN: `tmp/issue3449-final-head/green/container-name-green.log` passed after the real captured `execFileSync` was restored in the automock factory. The suite passed 12 tests across the candidate and retained fixture copy.
- Finding 6 RED: `tmp/issue3449-final-head/red/hostname-red.log` received `hostname lookup failed` instead of reaching the existing missing-image preparation boundary. The container state remained unchanged. GREEN: `tmp/issue3449-final-head/green/hostname-green.log` passed after the private recovery decision treated hostname failure as not proven dead, with `1 pass` and `0 fail`.
- Finding 10 RED: `tmp/issue3449-final-head/red/estimated-bound-red.log` mutation-checked the new behavior assertion with an invalid fallback value of `1`; the lower-bound assertion failed. GREEN: `tmp/issue3449-final-head/green/container-name-green.log` passed after restoring the accepted `Date.now() - process.uptime() * 1000` calculation.

## Second-cycle PR finding remediation

The second-cycle findings were classified against the accepted recovery engines, ownership protocol, and private writer/reader split. This is the final review-remediation cycle. No additional OCR run is permitted.

| Finding | Classification | Resolution and rationale |
|---|---|---|
| CodeRabbit `PRRT_kwDOPB5qbc6d-Yj_`, recovery runs for `sandbox-exec` | In-scope-Fix | Recovery is limited to Docker and Podman. A `sandbox-exec` config now reaches ordinary container preparation without container `ps --filter` recovery arguments. Docker and Podman behavior is unchanged. |
| OCR `PRRT_kwDOPB5qbc6d-dSS`, writer uses non-standard `Date.parse` input | Blocker-Fix | The private label writer parses only the C-locale `ps -o lstart=` shape and constructs the epoch with `Date.UTC`. Calendar fields and weekday must match without normalization; unavailable or malformed observations use estimated metadata. |
| OCR `PRRT_kwDOPB5qbc6d-dTw`, reader uses non-standard `Date.parse` input | Blocker-Fix | This is the same underlying defect as `PRRT_kwDOPB5qbc6d-dSS`. The separate private recovery reader uses deterministic parsing and treats malformed observations as unavailable, retaining the container. |
| Two duplicated OCR summary findings objecting to reverse-DNS product and business label literals | Reject | The label keys are stable external identifiers required by the accepted ownership protocol. Changing them would break compatibility with containers already marked by this implementation. |
| Two duplicated OCR summary findings requesting shared exported label constants | Reject | The accepted scope excludes shared writer/reader exports. The label writer and strict external reader have different responsibilities and remain private and separate. |
| OCR partial-review and coverage warning | Reject | This is a tool-run diagnostic rather than a code finding. Complete local and PR reviews already covered the changed files, and the two-PR-OCR cap has been reached. |
| Repeated CodeRabbit docstring concern | Reject | The recorded disposition remains unchanged. Bulk docstrings add no behavior evidence and conflict with project comment style and source-size constraints. |
| Repeated CodeRabbit total sweep deadline concern | Reject | The recorded disposition remains unchanged. REQ-3449-005 bounds listing and each removal independently and permits sequential best effort. |
| Repeated CodeRabbit remote or shared-engine walkthrough concern | Reject | The recorded disposition remains unchanged. Recovery is intentionally limited to the selected local engine; remote cross-host recovery and sweeping another engine are outside accepted scope. |

### Second-cycle TDD evidence

- Engine guard RED: `tmp/issue3449-second-review/red/engine-guard.log` showed `sandbox-exec:ps --filter` before image preparation and failed with `0 pass, 1 fail`. GREEN: `tmp/issue3449-second-review/green/engine-guard.log` passed with `1 pass, 0 fail`; preparation reached the existing missing-image boundary without recovery arguments.
- Writer parser RED: `tmp/issue3449-second-review/red/writer-parser.log` showed impossible day, mismatched weekday, and out-of-range hour values being normalized into observed epochs, with `0 pass, 3 fail`. GREEN: `tmp/issue3449-second-review/green/writer-parser.log` passed all three fallback cases.
- Reader parser RED: `tmp/issue3449-second-review/red/reader-parser.log` showed all three malformed observations removing live-owner containers, with `0 pass, 3 fail`. GREEN: `tmp/issue3449-second-review/green/reader-parser.log` passed all three conservative-retention cases.
- Accepted format and timezone GREEN: `tmp/issue3449-second-review/green/timezone-epochs.log` passed the exact C-locale observation under `America/New_York`, proved the writer epoch equals `Date.UTC(2026, 6, 15, 12, 34, 56)`, and proved the private reader retains that matching owner.

### Final-head verification and manual evidence

- Full repository test: `npm run test` exited 0 after running 2,495 of 2,495 files. The log contains 24,625 pass records, 174 skips, and 0 failures. Bun also emitted seven non-failing `directory mismatch` internal diagnostics. Evidence: `tmp/issue3449-final-head-20260901-branch8-gpt56sol/npm-run-test.log` and `npm-run-test.status`.
- StepFun smoke: the `stepfun-37` smoke exited 0. Evidence: `tmp/issue3449-final-head-20260901-branch8-gpt56sol/smoke.log` and `smoke.status`. Exact output:

  ```text
  [stepfun-37:step-3.7-flash]
  Silicon dreams hum,
  Code flows like water through wires,
  Quiet mind at work.
  ```

- Docker 29.1.3 controlled A/B/C: A used host PID `90458` and container `3ba9012e5d4173adbe67f399ec315d0416e2194ef35ac1324e0043ca2c6898c1`. The container remained after the host received SIGKILL. B used PID `91466` and container `57230635d14935faea3d0ceb148180995c30fc007f72029e7c0f3204fa526147`; its startup reaped A. C used PID `93218` and container `c0688e7fec3b976d15b11ba4eec4894260727830c6530495b8624618ea0f3952`; its startup retained live B. Controlled cleanup removed B and C, left no managed container or owner process, and preserved the 14-container pre-existing ID/name inventory. Evidence: `tmp/issue3449-final-head-20260901-branch8-gpt56sol/manual/docker-A/`, `docker-B/`, `docker-C/`, `docker-cleanup-summary.txt`, and `docker-id-name-diff.txt`.
- Podman 5.7.1 final-head manual repeat: two safe A attempts stopped before creating an A container with `Credential proxy bridge tunnel failed to start for Podman macOS. Ensure Podman machine is running: podman machine start. Check SSH connectivity: podman machine ssh.` The second attempt confirmed exit 0 from both `podman info` and `podman machine ssh true` before the same credential-proxy reverse SSH tunnel failure. Neither attempt proceeded to B or C. Controlled processes were stopped, no managed container remained, and the one-container pre-existing inventory was unchanged. First-attempt evidence: `tmp/issue3449-final-head-20260901-branch8-gpt56sol/manual/podman-A/` with the surrounding `podman-*-before`, `podman-*-final`, and diff files. Second-attempt evidence: `tmp/issue3449-podman-final-head-20260901-branch8-gpt56sol-attempt2/`, especially `final-summary.txt`, `diagnostics/statuses.txt`, and `A/terminal.log`.
- The earlier successful Podman 5.7.1 A/B/C evidence remains at `tmp/issue3449-manual-20260831T1625-branch8/` as recorded above. The final-head automated Docker/Podman matrix, deterministic writer and reader parser behavior, focused and full tests, lint, typecheck, build, and CI cover the candidate. The external bridge defect tracked in follow-up issue [#3467](https://github.com/vybestack/llxprt-code/issues/3467) blocks only repetition of the final-head manual Podman A/B/C run. It is an external manual-environment blocker, not a failing accepted code behavior and not a scope expansion for #3449.

Commit, push, and final CI remain, so this evidence does not claim final completion.
