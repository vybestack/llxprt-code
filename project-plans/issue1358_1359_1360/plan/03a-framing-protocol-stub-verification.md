# Phase 03a: Framing Protocol Stub — Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P03a`

## Prerequisites
- Required: Phase 03 completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P03" packages/core/src/auth/proxy/`

## Structural Verification
- [ ] `packages/core/src/auth/proxy/framing.ts` exists
- [ ] `packages/core/src/auth/proxy/proxy-socket-client.ts` exists
- [ ] Plan markers `@plan:PLAN-20250214-CREDPROXY.P03` present in both files
- [ ] `npm run typecheck` passes

## Semantic Verification
- [ ] `encodeFrame` exported from `framing.ts`
- [ ] `FrameDecoder` class exported from `framing.ts`
- [ ] `MAX_FRAME_SIZE` constant exported (value: 65536)
- [ ] `ProxySocketClient` class exported from `proxy-socket-client.ts`
- [ ] `ensureConnected()`, `request()`, `close()` methods exist on ProxySocketClient
- [ ] No version duplication (no framingV2.ts, no ProxySocketClientNew.ts)
- [ ] Stubs use `throw new Error('NotYetImplemented')` or return typed empty values

## Behavioral Verification Questions
1. **Do the files compile?** — Run `npm run typecheck`, verify zero errors in these files
2. **Are the exports correct?** — Read the actual export statements and verify they match the pseudocode contract
3. **Is this a real stub or placeholder?** — Methods should have correct signatures even if they throw

## Holistic Functionality Assessment
The verifier MUST write a documented assessment answering:
- What was created? (describe the stub structure)
- Does it match the pseudocode contract? (inputs/outputs)
- What is the type surface area? (exported types and interfaces)
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
Create: `project-plans/issue1358_1359_1360/.completed/P03a.md`
