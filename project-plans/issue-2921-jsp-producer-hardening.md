# Issue 2921 delivery plan — JSP producer hardening and honest evidence

## Scope decision

Deliver one issue-linked pull request closing issue 2921. The issue collects
review findings raised against the observation producer after PR 2897 had been
adjudicated. Scope is exactly those findings: nothing in
`packages/cli/src/observation` beyond them, and no adjacent cleanup.

## Baseline audit

Every finding was re-verified against `main` at `bb700c00e` before planning.
The producer source fixes for findings 1-6 landed inside PR 2897 itself
(`git log -S` on `heartbeatLifecycle`, `requestRecovery`, and
`applyOpenTransition` all resolve to `8b8abeb3a`). What remains is the evidence
that those behaviors actually hold, plus the three findings that were never
addressed.

| Finding | Subject | State on `main` | Work |
| --- | --- | --- | --- |
| 1 | Heartbeat rejection must degrade telemetry only | Implemented; covered by `degrades telemetry only when a heartbeat rejects` | None |
| 2 | Heartbeat bound to its lifecycle | Implemented; covered by `a stale in-flight heartbeat cannot stop a restarted producer` | None |
| 3 | Shutdown cleanup survives a failing drain | Implemented; test proves `stop()` ran but not that the final publish still happened | Strengthen evidence (see below) |
| 4 | Constructor validates capacity and heartbeat interval | Implemented; covered by both construction tests | None |
| 5 | Queue overflow invokes the recovery callback | Implemented; existing test cannot fail if the callback is deleted | Replace with real evidence |
| 6 | Post-terminal immutability | Implemented; covered by `ignores transitions that arrive after the session ended` | None |
| 7 | Heartbeat cadence test proves nothing | Not addressed | Rewrite |
| 8 | Registration/publication test name overstates | Not addressed | Split into honest tests |
| 9 | Bootstrap failure policy | Not addressed | Decide, record, make legible |

### Finding 3 in detail

The finding is written as "if `flush()` rejects the error propagates and
`stop()` never runs". With the shipped queue that premise is unreachable:
`JspBoundedQueue.send` catches every sink rejection and converts it to a
non-delivery, and the producer's registration task carries its own `catch`, so
neither `JspProducer.flush` nor `JspBoundedQueue.flush` can reject. The
`try/finally` in `shutdown` is therefore a guarantee about a path the current
queue cannot take, and no test can honestly exercise it without a fabricated
seam.

What is reachable, and what the finding is really protecting, is the other
half: a drain in which every publish fails must not skip the final terminal
snapshot or leave the producer started. That is what A4 proves.

Proving it needs care. A failed send asks the producer for a recovery
snapshot, so a naive "the last published document is a snapshot" assertion is
satisfied by the queue's own recovery snapshot even when the direct terminal
publish is deleted (verified by mutation). The recovery request is one-shot
until a send succeeds, so A4 burns it before shutdown; after that, every
snapshot the queue can still offer is enqueued ahead of the `session.ended`
event, and a trailing snapshot can only be the direct terminal publish.

### Finding 5 in detail

`overflow recovery > publishes a fresh snapshot after the queue overflows`
bursts three events through a capacity-one queue. The third event reaches
`applyAndPublish`, sees `needsSnapshotRecovery()`, and enqueues the snapshot
itself. The assertion therefore passes through the polling path and is
satisfied even if `JspBoundedQueue` never calls `onRecoveryNeeded`, which is
the code path the finding is about. Real evidence requires an overflow with no
subsequent event, so the only route to a published snapshot is the callback.

## Bootstrap failure policy (finding 9)

**Decision: explicit misconfiguration keeps failing fast, and now fails
legibly.**

Rationale:

- `LLXPRT_JSP_BOOTSTRAP_FILE` is never set by a human interactive session; it
  is set by the launching supervisor. Its presence is an explicit statement
  that this process is meant to be observed.
- Silently degrading turns "my agent never appears in the observer" into an
  invisible failure with no local signal, which is the harder failure to
  diagnose of the two.
- A rejected bootstrap includes the non-loopback endpoint case. Refusing loudly
  is the correct answer to a credential aimed off-host; continuing quietly
  teaches the operator nothing.
- Issue 2779's non-blocking guarantee is scoped to the post-startup path:
  "After valid startup, transport outage or queue pressure degrades telemetry
  without failing/blocking the foreground TUI." Startup-time configuration
  validation is the P1 row, which already reads "Explicit invalid config fails
  fast without leaking values". The recorded design note is therefore upheld,
  not contradicted, and no existing test or note needs to be reversed.

What changes: today the three `loadBootstrapFromEnv` failures throw a bare
`Error`, so the CLI entry point classifies them as an unexpected critical error
and prints a stack trace under "An unexpected critical error occurred". A
deliberate fail-fast policy has to produce a deliberate diagnostic, so these
become `FatalConfigError` (exit code 52), which the entry point renders as a
single actionable line. Messages name the environment variable and the failure
category, and carry neither the file contents nor the publisher credential.

## Acceptance criteria

| ID | Boundary | Inputs / edge cases | Success | Failure / side effects | Evidence |
| --- | --- | --- | --- | --- | --- |
| A1 | Heartbeat cadence | Shipped default interval, observer lease window, fake timers | At least three heartbeats are actually delivered within `OBSERVER_LEASE_MS`, and the delivered count is asserted | A producer that never arms its interval fails the test | `jspProducer.test.ts` |
| A2 | Terminal registration | Registration returns 409 | No throw from the foreground calls, and publish is proven uncalled | A test name that implies publish failure coverage without exercising it | `jspProducer.test.ts` |
| A3 | Publication failure | Registration accepted, publish rejects | No throw, publish is proven called, producer stays usable | Rejection escaping into the foreground | `jspProducer.test.ts` |
| A4 | Shutdown cleanup | Every publish fails during the final drain | Final terminal snapshot publish is still attempted and producer ends stopped and inert | Skipped final publish or a producer left started | `jspProducer.test.ts` |
| A5 | Overflow recovery | Overflow with no further observations | A fresh snapshot is published through the queue's recovery callback | Deleting `onRecoveryNeeded` must fail this test | `jspProducer.test.ts` |
| A6 | Bootstrap failure | Unreadable file, malformed JSON, rejected schema | Startup fails with `FatalConfigError` and a message naming the env var | Message leaks the credential or the raw file body; unexpected-critical stack trace | `jspWiring.test.ts` |

## Constraints

- Heartbeat tests use fake timers and restore real timers in a `finally`. Real
  timers plus sleep-based waits leave a live `setInterval` and pending promises
  behind and hang the file.
- The cadence assertion uses the shipped default interval, not a small test
  override, because the shipped value is the thing under test.
- Changed tests stay on Bun. `src/observation/jspProducer.test.ts` and
  `jspWiring.test.ts` are already Bun-native entries in
  `scripts/bun-test-manifest.ts` and are excluded from the Vitest selection;
  the `vitest` import resolves through the preloaded Bun compatibility shim.
- No new lint suppressions, no complexity or size threshold changes, no
  test-suite exclusions.

## Out of scope

- Suppressing the duplicate `source_sequence` a no-op transition publishes.
  That behavior predates this issue, is shared with the superseded-tool case,
  and has an existing accepted test.
- Any change to the queue's drain strategy, the publisher, or the tap.
- Converting the remaining real-timer producer tests to fake timers. They pass
  and stop their producers; only the heartbeat cadence test is in scope.
