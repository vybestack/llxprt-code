# Execution Tracker: Credential Proxy Remediation

**Plan ID**: PLAN-20250217-CREDPROXY-REMEDIATION  
**Created**: 2025-02-17  
**Status**: Ready for execution

---

## CRITICAL: Phase Execution Order

Execute phases in EXACT numerical order. Do NOT skip phases.

### Active Plan Files (Use These)

The plan directory contains two sets of files:
1. **NEW STRICT PLANS** (use these): `01-delete-fake-handlers`, `02-oauth-initiate-tdd`, etc.
2. **Old plans** (superseded): `01-constructor-options`, `02-sandbox-wiring`, `03-handle-oauth-initiate`, etc.

**USE THE NEW PLANS** that follow this naming pattern:
- `NN-<feature>.md` for implementation phases
- `NNa-<feature>-verification.md` for verification phases

---

## Execution Order

| Phase | File | Description | Status | Verified |
|-------|------|-------------|--------|----------|
| 01 | `01-delete-fake-handlers.md` | Replace fakes with NOT_IMPLEMENTED | Pending | |
| 01a | `01a-delete-fake-handlers-verification.md` | Verify fakes deleted | Pending | N/A |
| 02 | `02-oauth-initiate-tdd.md` | Write tests for handleOAuthInitiate | Pending | |
| 02a | `02a-oauth-initiate-tdd-verification.md` | Verify tests (stub-fail check) | Pending | N/A |
| 03 | `03-oauth-initiate-impl.md` | Implement handleOAuthInitiate | Pending | |
| 03a | `03a-oauth-initiate-impl-verification.md` | Verify implementation (deepthinker) | Pending | N/A |
| 04 | `04-oauth-exchange-tdd.md` | Write tests for handleOAuthExchange | Pending | |
| 04a | `04a-oauth-exchange-tdd-verification.md` | Verify tests (stub-fail check) | Pending | N/A |
| 04b | `04b-oauth-poll-tdd.md` | Write tests for handleOAuthPoll | Pending | |
| 04c | `04c-oauth-poll-tdd-verification.md` | Verify poll tests (stub-fail check) | Pending | N/A |
| 04d | `04d-oauth-poll-impl.md` | Implement handleOAuthPoll | Pending | |
| 04e | `04e-oauth-poll-impl-verification.md` | Verify poll implementation (deepthinker) | Pending | N/A |
| 05 | `05-oauth-exchange-impl.md` | Implement handleOAuthExchange | Pending | |
| 05a | `05a-oauth-exchange-impl-verification.md` | Verify implementation (deepthinker) | Pending | N/A |
| 06 | `06-refresh-token-tdd.md` | Write tests for handleRefreshToken | Pending | |
| 06a | `06a-refresh-token-tdd-verification.md` | Verify tests (stub-fail check) | Pending | N/A |
| 07 | `07-refresh-token-impl.md` | Implement handleRefreshToken | Pending | |
| 07a | `07a-refresh-token-impl-verification.md` | Verify implementation (deepthinker) | Pending | N/A |
| 08 | `08-integration-wiring.md` | Wire real providers into lifecycle | Pending | |
| 08a | `08a-integration-wiring-verification.md` | Verify wiring (deepthinker) | Pending | N/A |
| 09 | `09-final-acceptance.md` | Final audit and acceptance | Pending | N/A |

---

## Per-Phase Checklist

### Before Starting Any Phase

- [ ] Previous phase completed
- [ ] Previous verification phase passed
- [ ] Clean git state (`git status` shows no uncommitted changes)

### During Implementation Phase

- [ ] Read the plan file completely
- [ ] Follow implementation instructions exactly
- [ ] Run verification commands from plan
- [ ] Do NOT modify tests (TDD phases only)

### During Verification Phase

- [ ] Run automated verification script
- [ ] Complete manual checklist
- [ ] Run deepthinker analysis (mandatory)
- [ ] Record evidence in verification output
- [ ] Only proceed if ALL checks pass

---

## Superseded Files (DO NOT USE)

These files from the old plan structure are superseded by the new strict plans:

| Old File | Superseded By |
|----------|---------------|
| `01-constructor-options.md` | `08-integration-wiring.md` |
| `02-sandbox-wiring.md` | `08-integration-wiring.md` |
| `03-handle-oauth-initiate.md` | `03-oauth-initiate-impl.md` |
| `04-handle-oauth-exchange.md` | `05-oauth-exchange-impl.md` |
| `05-handle-refresh-token.md` | `07-refresh-token-impl.md` |
| `06-peer-credential-verification.md` | Future phase (out of scope) |
| `07-rate-limiting.md` | Included in `07-refresh-token-impl.md` |
| `08-stale-socket-cleanup.md` | Future phase (out of scope) |
| `09-request-schema-validation.md` | Future phase (out of scope) |

---

## Documentation Files

| File | Purpose |
|------|---------|
| `overview.md` | Problem statement, strict requirements |
| `test-strategy.md` | Anti-fake behavioral test patterns |
| `verification-prompts.md` | Deepthinker prompts for each phase |
| `execution-tracker.md` | This file - execution status |

---

## Build Verification (Run After Each Phase)

```bash
# Minimum verification
npm run typecheck
npm test -- packages/cli/src/auth/proxy/

# Full verification (before commit)
npm run test && npm run lint && npm run typecheck && npm run format && npm run build
```

---

## Progress Log

### Phase 01: Delete Fake Handlers
- Started: 
- Completed: 
- Verification:
- Notes:

### Phase 02: OAuth Initiate TDD
- Started: 
- Completed: 
- Verification:
- Notes:

### Phase 03: OAuth Initiate Implementation
- Started: 
- Completed: 
- Verification:
- Notes:

### Phase 04: OAuth Exchange TDD
- Started: 
- Completed: 
- Verification:
- Notes:

### Phase 04b: OAuth Poll TDD
- Started: 
- Completed: 
- Verification:
- Notes:

### Phase 04d: OAuth Poll Implementation
- Started: 
- Completed: 
- Verification:
- Notes:

### Phase 05: OAuth Exchange Implementation
- Started: 
- Completed: 
- Verification:
- Notes:

### Phase 06: Refresh Token TDD
- Started: 
- Completed: 
- Verification:
- Notes:

### Phase 07: Refresh Token Implementation
- Started: 
- Completed: 
- Verification:
- Notes:

### Phase 08: Integration Wiring
- Started: 
- Completed: 
- Verification:
- Notes:

### Phase 09: Final Acceptance
- Started: 
- Completed: 
- Verification:
- Notes:

---

## Completion Criteria

All of these must be true to mark the remediation complete:

- [ ] All phases completed (01 through 09, including 04b-04e)
- [ ] All verification phases passed
- [ ] No fake patterns in production code
- [ ] All tests verify backing store state
- [ ] Zero mock theater
- [ ] Full test suite passes
- [ ] Build passes
- [ ] Smoke test passes
- [ ] Deepthinker final audit passes
