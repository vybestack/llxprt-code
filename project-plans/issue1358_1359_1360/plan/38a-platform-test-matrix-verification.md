# Phase 38a: Platform Test Matrix — Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P38a`

## Prerequisites
- Required: Phase 38 completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P38" packages/cli/src/auth/proxy/__tests__/`

## Structural Verification
- [ ] `packages/cli/src/auth/proxy/__tests__/platform-matrix.test.ts` exists
- [ ] `packages/cli/src/auth/proxy/__tests__/platform-uds-probe.test.ts` exists
- [ ] `@plan:PLAN-20250214-CREDPROXY.P38` markers present
- [ ] All platform tests pass on current platform
- [ ] TypeScript compiles

## Semantic Verification — Platform Coverage
- [ ] **Socket permissions tested**: `0o600` for socket file, `0o700` for directory
- [ ] **Realpath tested**: macOS symlink resolution verified
- [ ] **Peer credential tested**: platform-appropriate verification (SO_PEERCRED / LOCAL_PEERPID / fallback)
- [ ] **Socket path length tested**: fits within platform limits
- [ ] **Stale socket cleanup tested**: pre-existing socket removed
- [ ] **UDS probe tested**: round-trip through tmpdir works

## Holistic Functionality Assessment
**The verifier MUST write a documented assessment:**
- What platforms were tested?
- Which platform tests pass on the current development machine?
- Are platform-conditional tests correctly skipped on unsupported platforms?
- Is the manual test protocol documented and clear enough for a developer to follow?
- Decision gate status:
  - Linux Docker: [PASS/UNTESTED]
  - Linux Podman: [PASS/UNTESTED]
  - macOS Docker Desktop: [PASS/UNTESTED/FALLBACK NEEDED]
  - macOS Podman: [PASS/UNTESTED/FALLBACK NEEDED]
- If any platform fails UDS: is a fallback transport documented?
- Are there any platform-specific edge cases not covered?
- Verdict: PASS/FAIL/CONDITIONAL (specify conditions)


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
Create: `project-plans/issue1358_1359_1360/.completed/P38a.md`
