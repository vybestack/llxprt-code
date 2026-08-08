# Issue #2744 — Failure-safe, event-driven OCR transport integration tests

## Changes since the issue was filed

- The target tests moved from JavaScript/Vitest to strict TypeScript with `bun:test`.
- OCR was upgraded from 1.7.16 to 1.8.4, and the repository now targets Bun 1.3.14 and Node 24.
- PR #3100 made the abrupt partial-response scenario deterministic and added a local `try/finally` cleanup path for that scenario.
- These changes did not resolve this issue on current `main`: the fixed 100 ms post-abort delay remained, and the other loopback scenarios could still bypass upstream cleanup when startup, traffic, or assertions failed.
- A runtime or OCR upgrade cannot guarantee cleanup after a thrown test failure or prove abort propagation within a fixed delay. Explicit lifecycle ownership and observable network events are still required.

## Accepted behavior

1. Every OCR transport scenario owns its loopback resources through a failure-safe test scope before startup or traffic begins. The scope covers the local upstream server, the embedded monitor process/server, client requests and active responses created directly or internally by a scenario, and the sockets those resources own.
2. The scope releases partially initialized and fully initialized resources on success and on any thrown test/assertion error. Cleanup destroys open client requests and responses, stops the embedded monitor, closes all upstream connections, and closes the upstream server.
3. Cleanup preserves the original test/startup error. If cleanup also fails, the reported failure retains the original error together with the cleanup failure rather than replacing it.
4. Behavior assertions run only after scenario resources have been released, so a failed assertion cannot strand a listener or request.
5. The client-abort scenario aborts only after observing the first streamed response chunk, then waits with a bounded fail-fast condition for the client request destruction and response-stream closure events. It does not use a fixed post-abort sleep.
6. Existing real-loopback coverage remains behaviorally unchanged for streaming and chunked bodies, HTTP 429 accounting, retry counts and retry headers, connection-error retries, concurrent non-retries, malformed/missing retry headers, partial upstream responses, upstream errors, and client aborts.
7. No production behavior, workflow behavior, dependency, public abstraction, or unrelated test is changed.

## Inputs and boundary cases

- Upstream response sequences: 429 then 200; three 429 responses then 200; socket destruction before headers; 200 headers followed by a partial body and abrupt close; open-ended SSE response aborted by the client.
- Retry header values: canonical `0` through `3`, missing, malformed `01`, concurrent and later repeated `0` values.
- Streaming boundaries: request body split across writes; first SSE chunk observable before completion; request destruction and response-stream closure observable before monitor teardown.
- Lifecycle boundaries: failure before monitor startup completes, readiness timeout after child spawn, failure during scenario traffic, a direct response callback that throws before later listeners run, and assertion failure after traffic completes.
- Cleanup boundaries: server not yet listening, server listening with active connections, monitor termination failing once before fallback cleanup, a request callback failing before traffic starts, and directly or internally created client requests/responses still open.

## Behavioral test evidence

1. Add a lifecycle failure-path test that deliberately throws a sentinel scenario/assertion error after opening real loopback traffic. After the failure-safe scope exits, assert that:
   - the exact original error remains the primary failure,
   - the upstream server is not listening,
   - the server-owned socket set is empty after real connection-close events,
   - the tracked client request is destroyed and closed, and
   - the monitor child is reaped and its temporary directory is removed before global fallback cleanup runs.
2. Retain and strengthen monitor startup-failure tests for an invalid target and a readiness timeout after spawn. Add a partial-startup sentinel thrown from the real spawn callback to verify exact original-error identity. In every case, verify the child is reaped and its temporary directory is removed.
3. Add a concurrent failure-path test in which one scope-created proxy request fails while a sibling response remains open. Verify scope cleanup destroys and closes the sibling, and deliberately induce an upstream cleanup failure to prove the scenario failure remains first in the resulting `AggregateError` while the cleanup failure remains represented.
4. Rewrite each transport scenario to return captured behavior from the failure-safe scope and perform assertions after cleanup.
5. In the abort test, consume the complete upstream request body before streaming the first response chunk, use that chunk as the abort trigger, and use bounded request-close and response-close events as proof that the intended client stream state was reached. Assert body completion, request destruction, and telemetry only after all resources are closed.
6. Prove registration ordering with a standalone Bun real-loopback probe whose direct response callback throws: the response must already be owned, destroyed, and closed before manual upstream fallback cleanup. Also prove that a pre-traffic `onRequest` failure preserves its exact sentinel without a synthetic cleanup timeout.
7. Force one real monitor termination failure and verify the scenario failure remains first, the cleanup failure remains present, global fallback ownership is retained, and fallback cleanup later reaps the exact child and removes its directory.
8. Keep issue-specific lifecycle and failure-path cases in `scripts/tests/ocr-transport-lifecycle-2744.test.ts`, with lifecycle ownership in its sibling helper, so the existing concurrency canary remains within source-size limits.
9. Run both focused Bun test files and the relevant script shard, then the repository test, lint, typecheck, format, build, and smoke-test gates.

## Review-finding classification

- PR 2732 discussion 3651993341 — **Blocker-Fix**: the issue explicitly requires all upstream resources to close after failures; current scenarios can leak when startup, traffic, or an assertion throws before `closeServer`.
- PR 2732 discussion 3653265252 — **Blocker-Fix**: the fixed 100 ms abort-propagation delay violates the event-driven acceptance criterion and can be flaky on loaded runners.

## Out of scope

- Changes to the OCR workflow or embedded transport monitor implementation.
- New dependencies or changes to test runners, CI workflows, lint rules, complexity limits, coverage requirements, or agent/project memory.
- General-purpose production lifecycle abstractions or cleanup work outside the OCR transport integration scenarios.
