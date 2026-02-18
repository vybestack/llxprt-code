# Phase 34a: sandbox.ts Integration — Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P34a`

## Prerequisites
- Required: Phase 34 completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P34" packages/cli/src/`

## Structural Verification
- [ ] `@plan:PLAN-20250214-CREDPROXY.P34` markers present in `sandbox.ts`
- [ ] Tests exist and pass
- [ ] TypeScript compiles

## Deferred Implementation Detection (MANDATORY)
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/cli/src/utils/sandbox.ts | grep -v ".test.ts"
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/cli/src/utils/sandbox.ts | grep -v ".test.ts"
```

## Holistic Functionality Assessment
**The verifier MUST write a documented assessment:**
- What was changed in `sandbox.ts`?
- Trace: `start_sandbox()` → `createAndStartProxy(config)` → socket created → container args include `--env LLXPRT_CREDENTIAL_SOCKET={path}` → container spawned
- Trace: container exit → exit handler → `stopProxy()` → socket removed, timers cancelled
- Trace: SIGINT received → signal handler → `stopProxy()` → clean shutdown
- Trace: `createAndStartProxy()` fails → error thrown → container NOT spawned → user sees actionable error
- Verify: socket path uses `fs.realpathSync(os.tmpdir())` on macOS (R3.4)
- Verify: no additional volume mount added for socket (R3.5 — socket lives in already-mounted tmpdir)
- Verify: seatbelt code path does NOT create proxy, does NOT set `LLXPRT_CREDENTIAL_SOCKET` (R26.2)
- Verify: Docker AND Podman code paths both include proxy lifecycle (R27.1)
- Verify: existing sandbox tests still pass (non-regression)
- Verdict: PASS/FAIL

## Non-Regression Check
```bash
npm test -- packages/cli/src/utils/__tests__/
```


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
Create: `project-plans/issue1358_1359_1360/.completed/P34a.md`
