# Issue #3470: Reclaim abandoned sandbox dependency volumes

Plan ID: `PLAN-20260901-ISSUE3470`

Issue: <https://github.com/vybestack/llxprt-code/issues/3470>

## Scope

Issue #3450 moved each installed-mode sandbox run's private `node_modules`
storage into engine-owned named volumes. Normal cleanup removes those volumes,
but an owner terminated by `SIGKILL`, OOM, LLxprt failure, host restart, or power
loss cannot execute cleanup. This issue adds startup recovery for only those
labeled dependency volumes.

The recovery path applies to Docker and rootless Podman. It does not reclaim
anonymous volumes, user-created named volumes, custom mounts, persistent
checkpoint volumes, or any volume whose ownership cannot be proved stale.

## Required behavior

### AC-1: Process-instance ownership remains exact

Dependency volumes, their initialization container, and the main managed
sandbox use the existing versioned owner metadata:

- hostname;
- PID;
- observed process start time; and
- process-start source.

They also share the existing dependency run-ID label. Recovery does not invent
another ownership or age model.

### AC-2: Dead containers are reaped before volumes

At container-sandbox startup, recovery lists all managed containers, including
stopped containers. A container is removed only when the existing owner test can
prove its process instance dead. Unknown, malformed, estimated-but-live,
foreign-host, permission-denied, and otherwise unverifiable owners remain.

### AC-3: Only provably stale dependency volumes are reclaimed

After container recovery, recovery obtains the run IDs of currently running
managed containers. It then lists only volumes carrying LLxprt's managed label
and examines their labels.

A volume is eligible only when all conditions hold:

1. its name starts with LLxprt's `sandbox-node-modules-` dependency prefix;
2. it has a valid existing owner payload;
3. its owner process instance is provably dead;
4. it has a non-empty existing dependency run ID; and
5. that run ID is absent from every currently running managed container.

The name, managed label, owner label, and run-ID label must all agree before a
volume enters the recovery path. Recovery removes eligible volumes with ordinary
`volume rm`, not forced removal.
The engine therefore rejects a race or any attachment to another container.
`rm --volumes` is never used.

If live-container discovery fails, volume recovery is skipped. This fail-closed
rule preserves active-run safety. Listing, inspection, and removal failures name
the engine operation and resource so the user can act on them.

### AC-4: Concurrent live runs survive recovery

A recovery startup may run while another LLxprt process owns active dependency
volumes. The live owner's volumes and container remain. A killed owner's managed
container is removed first, followed by only that dead run's dependency volumes.

### AC-5: Abrupt-termination behavior is proven against real engines

For each available Docker and rootless Podman engine, a real subprocess creates
a production-labeled dependency-volume run and signals readiness through a
pipe. The test proves the labeled volumes and managed container are active,
terminates the owning helper with `SIGKILL`, and starts recovery while a second
owner remains live. Event-driven bounded waits prove the stale container and
volumes disappear and the live run remains. The tests use no sleeps or polling
retries.

## State-based TDD sequence

1. Extend the stateful fake engine to expose Docker/Podman-compatible label
   formats for managed containers and dependency volumes.
2. Add startup tests that create dead and live process owners as real child
   processes. Assert final engine state, not command-call counts:
   - dead container and its volumes are gone;
   - live container and its volumes remain;
   - malformed, foreign, estimated/unverifiable, unlabeled, custom, and
     checkpoint-like volumes remain;
   - volume discovery failure leaves all volumes in place with actionable
     diagnostics;
   - an attached stale volume remains when engine removal rejects it.
3. Run the focused test and record the expected failure before production edits.
4. Extract the existing owner parser and dead-process predicate so container and
   volume recovery use the same metadata rules.
5. Implement ordered startup recovery and make the focused state tests pass.
6. Add the real abrupt-termination integration scenario for Docker and Podman,
   first proving it fails without the complete production recovery path, then
   make it pass.
7. Update the sandbox documentation with the automatic policy and manual,
   label-scoped inspection/removal commands.

## Verification

- Focused Bun tests for ownership, fake-engine state, cleanup ordering, failures,
  Docker behavior, and Podman behavior.
- Real Docker and Podman abrupt-termination integration tests, with skips only
  when an engine or required local image is unavailable.
- Full repository test, lint, typecheck, format, build, and `stepfun-37` smoke
  cycle.
- Test-audit baseline comparison with no new findings in touched tests.
- Diff inspection proving no `rm --volumes`, no broad volume prune, and no
  anonymous/custom/checkpoint volume selection.

## Implementation record

The implementation extracts owner parsing and dead-process proof into
`sandbox-owner-labels.ts`, then reuses it from the new
`sandbox-orphan-recovery.ts` module. Container startup performs dependency-tree
preflight before any engine call. It then reaps dead-owner managed containers,
collects running managed run IDs, and submits only eligible dependency volumes
to ordinary engine removal.

The state-based test was red when a custom-name volume carried managed, owner,
and run labels: recovery deleted it because labels alone were accepted. Requiring
the `sandbox-node-modules-` name prefix made the test green. A full-suite run
later found that recovery ran before the existing wrong-platform preflight.
Restoring preflight before recovery returned the zero-engine-side-effect test to
green while preserving container-before-volume ordering inside recovery.

Final verification results:

- Focused ownership and recovery tests: 38 passed, 0 failed, 132 assertions.
- Isolated launch lifecycle tests: 4 passed, 0 failed, 17 assertions.
- Complete real Docker and rootless Podman integration file: 14 passed, 0
  failed, 186 assertions. Both `SIGKILL` recovery scenarios ran and retained the
  concurrent live run.
- Complete CLI workspace: 726 files passed; 9,375 passed, 0 failed, 5 skipped,
  and 13 todo tests.
- Repository lint, typecheck, format, and build: passed.
- `stepfun-37` startup smoke: passed and returned a haiku.
- Final test-audit scan: 2,759 files, 36,836 tests, 79,836 assertions, and 2,023
  findings. The findings file is identical to the saved HEAD baseline, so this
  change adds no scanner findings.
- Diff audit found no forced volume removal, broad volume prune, container
  removal with `--volumes`, suppression directive, retry loop, or sleep-based
  synchronization.

The full repository test command has one remaining path-sensitive failure in
`packages/agents/src/core/__tests__/providerAgnosticNaming.test.ts`. Its source
scanner excludes every absolute path containing `/tmp/`, and this required
worktree is under `tmp/worktrees/issue3470`, so it discovers zero files and
fails `allFiles.length > 100`. Issue #3470 does not change that test. All CLI
workspace tests and all changed-area tests pass after the recovery ordering fix.
