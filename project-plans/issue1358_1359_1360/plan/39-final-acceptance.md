# Phase 39: Final Acceptance Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P39`

## Prerequisites
- Required: Phase 38a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P38" packages/cli/src/auth/proxy/__tests__/`
- Expected: All components implemented, integrated, migrated, deprecated, E2E tested, platform matrix verified

## Purpose

This phase performs the final comprehensive verification that all requirements from issues #1358, #1359, and #1360 are satisfied. It is the last gate before the feature is considered ready for PR.

## Requirements Implemented (Expanded)

This phase validates the complete set of requirements already implemented across P03–P38a, with special emphasis on final acceptance gates.

### R26.1–R26.3: Non-Regression Guarantees
**Full Text**: Non-sandbox mode, seatbelt mode, and `--key` behavior remain unaffected.
**Behavior**:
- GIVEN: Existing non-sandbox usage patterns
- WHEN: Full verification suite and smoke tests run
- THEN: All pre-existing behavior remains intact
**Why This Matters**: Phase B must not break existing workflows.

### R27.1–R27.3: Platform Support and Decision Gate
**Full Text**: Docker/Podman support and platform matrix gate must be satisfied before merge.
**Behavior**:
- GIVEN: Final acceptance verification
- WHEN: Platform evidence from P38/P38a is reviewed
- THEN: Merge is blocked unless matrix is passing or approved fallback is documented
**Why This Matters**: Prevents shipping a feature that fails on target environments.

### R10.1 / R28.2: Security Invariants
**Full Text**: `refresh_token` and auth artifacts never cross trust boundaries or leak in logs.
**Behavior**:
- GIVEN: Final security grep/tests
- WHEN: Proxy code paths are audited
- THEN: No secret leakage is detected
**Why This Matters**: Security is the primary purpose of this feature set.

## Acceptance Criteria Verification

### Issue #1358 — Credential Proxy (Unix Socket IPC)

| # | Acceptance Criterion | Req | Verified? |
|---|---|---|---|
| 1 | Host process creates and listens on Unix socket before container starts | R3.1, R25.1 | [ ] |
| 2 | Inner process can request tokens and API keys through the socket | R8.1, R9.1 | [ ] |
| 3 | `ProxyTokenStore` implements full `TokenStore` interface via socket | R8.1–R8.9 | [ ] |
| 4 | `ProxyProviderKeyStorage` implements provider key interface via socket | R9.1–R9.5 | [ ] |
| 5 | Protocol version handshake on connection; incompatible versions rejected | R6.1–R6.3 | [ ] |
| 6 | Length-prefixed framing handles messages correctly | R5.1 | [ ] |
| 7 | Max message size enforced (64KB) with bounds check before allocation | R5.2 | [ ] |
| 8 | Partial frame timeout (5s) prevents resource exhaustion | R5.3 | [ ] |
| 9 | Per-operation request schema validation on server side | R7.1 | [ ] |
| 10 | Socket path includes cryptographic nonce | R3.1 | [ ] |
| 11 | Socket cleaned up on normal exit, SIGINT, and SIGTERM | R25.2, R25.3 | [ ] |
| 12 | Stale socket files cleaned up on startup | R25.4 | [ ] |
| 13 | Peer credential verification on Linux and macOS | R4.1–R4.3 | [ ] |
| 14 | Profile scoping enforced | R21.1–R21.3 | [ ] |
| 15 | Rate limiting: 60 req/s per connection | R22.1 | [ ] |
| 16 | Per-request timeout: 30s | R24.1 | [ ] |
| 17 | Error handling for socket failures, malformed requests, timeout, rate limiting | R23.1–R23.5 | [ ] |
| 18 | Works with both Docker and Podman sandbox modes | R27.1 | [ ] |
| 19 | Non-sandbox mode is unaffected | R26.1 | [ ] |
| 20 | Hard error on proxy connection loss | R25.5, R29.3 | [ ] |

### Issue #1359 — Host-Side OAuth Refresh

| # | Acceptance Criterion | Req | Verified? |
|---|---|---|---|
| 1 | `get_token` responses never contain refresh_token | R10.1 | [ ] |
| 2 | `refresh_token` op triggers host-side refresh with sanitized response | R11.1 | [ ] |
| 3 | Token merge contract implemented explicitly | R12.1–R12.5 | [ ] |
| 4 | Refresh retry with backoff | R13.1–R13.3 | [ ] |
| 5 | Refresh lock prevents concurrent refreshes | R14.4 | [ ] |
| 6 | Double-check pattern prevents unnecessary refreshes | R11.4 | [ ] |
| 7 | Proactive renewal with jittered scheduling | R16.1–R16.2 | [ ] |
| 8 | Proactive renewal cancelled on sandbox exit | R16.4 | [ ] |
| 9 | Sleep/suspend recovery | R16.3 | [ ] |
| 10 | Rate limiting on refresh: 1 per provider:bucket per 30s | R14.1–R14.3 | [ ] |
| 11 | Concurrent refresh deduplicated | R14.4 | [ ] |
| 12 | Concurrent refresh + logout: logout wins | R15.1 | [ ] |
| 13 | refresh_token never in data crossing socket | R10.1 | [ ] |
| 14 | Auth artifacts never logged | R28.2 | [ ] |
| 15 | Works for all OAuth providers | R11.5 | [ ] |
| 16 | Non-sandbox mode unaffected | R26.1 | [ ] |

### Issue #1360 — Host-Side OAuth Login for Sandbox

| # | Acceptance Criterion | Req | Verified? |
|---|---|---|---|
| 1 | `/auth login` in Docker/Podman sandbox completes via proxy | R17.1, R18.1, R19.1 | [ ] |
| 2 | Auth URL displayed in inner TUI; user pastes code back | R17.4 | [ ] |
| 3 | Code exchange on host side; tokens in host keyring | R17.2 | [ ] |
| 4 | PKCE state + OAuth state verified during exchange | R17.2 | [ ] |
| 5 | Inner receives only sanitized token metadata | R10.1 | [ ] |
| 6 | PKCE verifier/challenge never exposed to inner | R17.3 | [ ] |
| 7 | Session IDs cryptographically random (128 bits) | R20.1 | [ ] |
| 8 | Session IDs single-use | R20.2 | [ ] |
| 9 | Session IDs bound to peer identity | R20.3 | [ ] |
| 10 | Session timeout 10 minutes | R20.4–R20.5 | [ ] |
| 11 | Expired sessions return SESSION_EXPIRED | R20.5 | [ ] |
| 12 | Reused sessions return SESSION_ALREADY_USED | R20.6 | [ ] |
| 13 | Stale session GC runs periodically | R20.7 | [ ] |
| 14 | Multiple concurrent login attempts get independent sessions | R20.9 | [ ] |
| 15 | `oauth_cancel` cleans up session immediately | R20.8 | [ ] |
| 16 | Works for all OAuth providers | R17.1, R18.1, R19.1 | [ ] |
| 17 | Seatbelt mode unaffected | R26.2 | [ ] |
| 18 | Non-sandbox mode unaffected | R26.1 | [ ] |

## Implementation Tasks

- Execute the final acceptance workflow below and collect evidence for sign-off artifacts.

## Verification Commands

### Final Verification Steps

1. **Run full test suite**
   ```bash
   npm run test
   npm run lint
   npm run typecheck
   npm run format
   npm run build
   ```

2. **Smoke test**
   ```bash
   node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"
   ```

3. **Plan marker completeness**
   ```bash
   # Verify all plan phases have markers in code
   for i in $(seq -w 3 39); do
     COUNT=$(grep -r "@plan:PLAN-20250214-CREDPROXY.P${i}" packages/ --include="*.ts" | grep -v node_modules | wc -l)
     echo "P${i}: ${COUNT} markers"
   done
   ```

4. **Requirement marker completeness**
   ```bash
   # Verify key requirements have markers
   for r in R2 R3 R5 R8 R9 R10 R11 R12 R16 R17 R20 R25 R26; do
     COUNT=$(grep -r "@requirement.*${r}" packages/ --include="*.ts" | grep -v node_modules | wc -l)
     echo "${r}: ${COUNT} markers"
   done
   ```

5. **Security invariant check**
   ```bash
   # Verify refresh_token is never in any proxy response construction
   grep -rn "refresh_token" packages/cli/src/auth/proxy/ packages/core/src/auth/proxy/ --include="*.ts" | grep -v ".test.ts" | grep -v "sanitize\|strip\|delete\|omit\|remove\|never"
   # Expected: only in sanitization logic, stripping logic, or test assertions
   ```

6. **Code quality check**
   ```bash
   grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP)" packages/cli/src/auth/proxy/ packages/core/src/auth/proxy/ packages/core/src/auth/token-merge.ts --include="*.ts" | grep -v ".test.ts" | grep -v node_modules
   # Expected: ZERO matches
   ```

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P39
 */
```

## Success Criteria
- ALL acceptance criteria checkboxes above are checked
- Full test suite passes
- Lint passes
- TypeScript compiles
- Build succeeds
- Smoke test succeeds
- Zero TODO/FIXME/HACK in production code
- Zero `refresh_token` leaks in proxy responses
- All plan markers present in code
- Decision gate for platform matrix passed

## Failure Recovery
1. Identify failed acceptance rows in the #1358/#1359/#1360 tables and map each failure back to the originating phase(s)
2. Re-open the corresponding implementation/verification phases (P03–P38a) and remediate gaps before re-running P39
3. Re-run full verification commands and smoke test until all acceptance criteria are checked

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P39.md`
