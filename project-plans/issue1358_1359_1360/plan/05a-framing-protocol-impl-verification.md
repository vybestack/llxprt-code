# Phase 05a: Framing Protocol Implementation — Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P05a`

## Prerequisites
- Required: Phase 05 completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P05" packages/core/src/auth/proxy/`

## Structural Verification
- [ ] `@plan:PLAN-20250214-CREDPROXY.P05` markers in implementation files
- [ ] All tests pass: `npm test -- packages/core/src/auth/proxy/__tests__/framing.test.ts`
- [ ] All tests pass: `npm test -- packages/core/src/auth/proxy/__tests__/proxy-socket-client.test.ts`
- [ ] No test files modified: `git diff packages/core/src/auth/proxy/__tests__/`
- [ ] TypeScript compiles: `npm run typecheck`

## Deferred Implementation Detection (MANDATORY)
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/core/src/auth/proxy/framing.ts packages/core/src/auth/proxy/proxy-socket-client.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/auth/proxy/framing.ts packages/core/src/auth/proxy/proxy-socket-client.ts
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/auth/proxy/framing.ts packages/core/src/auth/proxy/proxy-socket-client.ts
```
All three must return no matches.

## Pseudocode Compliance
- [ ] Line 1: MAX_FRAME_SIZE = 65536 — implemented
- [ ] Lines 3–10: encodeFrame — JSON stringify, size check, header write, concat
- [ ] Lines 11–44: FrameDecoder — buffer accumulation, frame parsing, partial timer
- [ ] Lines 45–57: ProxySocketClient — state, constants, constructor
- [ ] Lines 58–64: ensureConnected — lazy connect + handshake
- [ ] Lines 65–80: connect + handshake — socket, version negotiation
- [ ] Lines 82–91: request — ID generation, timeout, correlation
- [ ] Lines 93–137: event handlers, destroy, idle timer, graceful close

## Holistic Functionality Assessment
**The verifier MUST write a documented assessment:**
- What was implemented?
- Does it satisfy R5.1-R5.4, R6.1-R6.5, R24.1, R24.2, R24.4?
- Trace one complete request path: encode → send → receive → decode → resolve
- What could go wrong? (edge cases, race conditions)
- Verdict: PASS/FAIL


## Anti-Fake / Anti-Fraud Verification (MANDATORY)
- [ ] No test-environment branching in production code (for example: NODE_ENV checks, JEST_WORKER_ID, VITEST, process.env.TEST, isTest guards) unless explicitly required by specification.
- [ ] No fixture-hardcoded behavior in production code for known test values, providers, buckets, or session IDs.
- [ ] No mock theater: tests verify semantic outputs, state transitions, or externally visible side effects; not only call counts.
- [ ] No structure-only assertions as sole proof (toHaveProperty/toBeDefined without value-level behavior assertions).
- [ ] No deferred implementation artifacts in non-stub phases (TODO/FIXME/HACK/placeholder/NotYetImplemented/empty return shortcuts).
- [ ] Security invariants are actively checked where relevant: refresh_token and auth artifacts are never returned across proxy boundaries or logged in full.
- [ ] Failure-path assertions exist (invalid request, unauthorized, timeout, rate limit, session errors) to prevent happy-path-only implementations from passing.

### Anti-Fraud Command Checks
- Run: grep -rn -E "(NODE_ENV|JEST_WORKER_ID|VITEST|process\.env\.TEST|isTest\()" packages --include="*.ts" | grep -v ".test.ts"
- Run: grep -rn -E "(toHaveBeenCalled|toHaveBeenCalledWith)" [phase-test-files]
- Run: grep -rn -E "(toHaveProperty|toBeDefined|toBeUndefined)" [phase-test-files]
- Run: grep -rn -E "(TODO|FIXME|HACK|placeholder|NotYetImplemented|return \[\]|return \{\}|return null|return undefined)" [phase-impl-files] | grep -v ".test.ts"
- Run: grep -rn "refresh_token" packages/cli/src/auth/proxy packages/core/src/auth --include="*.ts" | grep -v ".test.ts"

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P05a.md`
