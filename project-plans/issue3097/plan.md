# Plan: Deterministic Abrupt-Response Transport Canaries

Plan ID: PLAN-20260806-ISSUE3097
Generated: 2026-08-06
Requirements: REQ-PEER-001, REQ-TERM-001, REQ-TELEM-001, REQ-AUDIT-001

## Scope and acceptance boundary

This issue fixes transport tests that use local event-loop scheduling as a substitute for acknowledgement by a separate process or network peer. It does not change production OCR monitor behavior, add retries or delays, increase timeouts, weaken assertions, or introduce a public synchronization framework.

### REQ-PEER-001: Peer-observed failure ordering

**Requirement text:** The abrupt-response canary must trigger the upstream reset only after the downstream client has observed HTTP 200 and the complete partial payload.

- GIVEN the real Bun client, separate Node monitor child, and loopback upstream fixture are running
- WHEN the upstream sends HTTP 200 and the partial payload
- THEN the downstream data callback must observe both before it triggers the one-shot upstream reset

### REQ-TERM-001: Exact abnormal-termination behavior

**Requirement text:** The canary must distinguish the intended post-header response-stream failure from a pre-header request failure or clean completion.

- GIVEN downstream has observed HTTP 200 and the partial payload
- WHEN upstream is reset
- THEN the response must terminate abnormally with exact status and body evidence
- AND a request-level error before response headers must fail the test
- AND a clean response end must fail the test

### REQ-TELEM-001: Exact monitor accounting

**Requirement text:** The monitor must remain alive and account for the partially forwarded HTTP 200 exactly once.

- GIVEN the intended post-header reset occurs
- WHEN the embedded monitor is stopped
- THEN telemetry must report one total request, no upstream setup error, one HTTP 200 response, and clean shutdown
- AND the existing pre-header connection-failure scenario must remain HTTP 502 with one upstream error

### REQ-AUDIT-001: Concrete sibling-fixture audit

**Requirement text:** Repository abrupt-response fixtures must be checked for the same unacknowledged write-then-scheduled-destroy pattern.

- GIVEN test files containing `setImmediate`, response/socket `destroy`, reset errors, partial bodies, or premature termination
- WHEN those fixtures are reviewed
- THEN every concrete case that writes through one process and schedules destruction without peer acknowledgement is included in this issue
- AND unrelated direct socket-close, mocked-error, cancellation, and same-process lifecycle tests remain out of scope

## Preflight and audit evidence

- `scripts/tests/ocr-concurrency-canary-2673.test.ts` currently writes HTTP 200 and `{"partial":`, then calls `response.destroy()` from `setImmediate`.
- The downstream request maps a pre-response request error to synthetic status 0, which is the observed CI failure.
- `.github/workflows/ocr-review.yml` runs the monitor in a separate Node process and destroys the downstream response when the upstream response errors.
- Repository searches found the OCR canary as the only test combining `setImmediate` with response destruction. Other response/socket destruction matches are direct connection lifecycle, cancellation, security, or pre-header failure fixtures and do not use a local scheduling yield as cross-process acknowledgement.
- `packages/vscode-ide-companion/src/ide-server-concurrency.test.ts` contains a relevant established precedent: it replaced `setImmediate` timing yields with an explicit signal that the authoritative peer-side path had been entered.
- No new dependency, workflow, production subsystem, or public API is required.

## Test-first implementation sequence

### Phase 1: RED — require the correct transport behavior

Modify only the existing real-loopback scenario in `scripts/tests/ocr-concurrency-canary-2673.test.ts` so that it:

1. rejects a request error before the response callback;
2. fails if the response emits clean `end`;
3. resolves only from abnormal response termination;
4. requires status 200 and exact partial payload;
5. retains exact telemetry assertions, including clean monitor shutdown.

Run the focused test before changing fixture synchronization. The current unsynchronized fixture must fail by taking the pre-response request-error path or otherwise failing the strengthened contract.

### Phase 2: GREEN — synchronize on downstream observation

In the same behavioral fixture:

1. hold the upstream response open after writing HTTP 200 and the complete partial payload;
2. capture a one-shot action that destroys that specific upstream response;
3. invoke it from the downstream data handler only after the accumulated body equals the complete partial sentinel;
4. keep production monitor code unchanged;
5. preserve resource cleanup for both success and failure paths.

Run the focused test normally and repeatedly under concurrent host load without retrying failed cases.

### Phase 3: Audit confirmation and regression verification

Re-run the repository searches for the concrete anti-pattern and document that no sibling fixtures require modification. Verify the adjacent pre-header 502 scenario and the complete canary file.

## Behavioral evidence

Focused verification:

```bash
bun scripts/run_bun_tests.ts --root scripts-tests scripts/tests/ocr-concurrency-canary-2673.test.ts --testNamePattern "handles an upstream error after headers and partial body"
bun scripts/run_bun_tests.ts --root scripts-tests scripts/tests/ocr-concurrency-canary-2673.test.ts
```

Stress verification must execute fresh focused test processes repeatedly, including bounded concurrent host load, and require every invocation to pass without reruns.

## Full verification

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Before push, run DeepThinker review and detached OCR with `--timeout 20`, including test files. Classify every finding as Blocker-Fix, In-scope-Fix, Reject, or Defer. Do not exceed two review cycles.

## Completion conditions

- Every accepted behavior has direct behavioral evidence.
- The concrete sibling-fixture audit is complete.
- No retry, sleep, timeout increase, suppression, weakened assertion, production monitor change, or speculative abstraction is introduced.
- Focused stress verification and the full local suite pass.
- Review findings are triaged and all Blocker-Fix/In-scope-Fix findings resolved.
- Candidate-head CI is green, review threads are resolved, ancestry is current, and the PR is conflict-free.
