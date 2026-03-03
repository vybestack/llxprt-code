# Review 2 — Updated plan.md for Issue #1652

## Prior Issues Status

### BLOCKING Issues from Review 1

**1. initiateAuth return-type migration incomplete** → **RESOLVED**
Plan now includes branch-by-branch mapping for all 4 providers. I verified against actual source:
- Anthropic: Accurate. `completeAuth()` at L298 does `saveToken('anthropic', token)`. Plan correctly identifies removal.
- Codex: Accurate. `completeAuth()` at L307 and `performDeviceAuth()` at L408 both do unbucketed `saveToken('codex', token)`. Plan correctly identifies both.
- Qwen: Accurate. `initiateAuth()` at L299 does `saveToken('qwen', token)`. `getToken()` at L354 calls `refreshIfNeeded()` which writes at L402. Plan correctly identifies both.
- Gemini: Accurate. `initiateAuth()` at L308 does `saveToken('gemini', token)`. `getToken()` at L363 writes. `migrateFromLegacyTokens()` at L517 writes. Plan correctly identifies all three.

**2. Provider getToken() side effects not addressed** → **RESOLVED**
Plan now explicitly specifies removing `refreshIfNeeded()` calls from `getToken()` for Qwen and removing writes from `getToken()` for Gemini. Contract guarantees section #3 is clear.

**3. TokenStore interface change rollout** → **RESOLVED**
Plan includes compile-surface checklist with specific files. Atomic changeset strategy is appropriate.

**4. Lock timeout too short** → **RESOLVED**
Changed from 10s to 60s wait, 6min stale. Includes poll-for-token-after-timeout. Appropriate for interactive flows.

### IMPORTANT Issues from Review 1

**5. completeAuth contract unclear** → **RESOLVED** — Contract guarantees section covers this.
**6. Change C as defense-in-depth** → **RESOLVED** — Explicitly documented.
**7. Residual contamination in deprecated methods** → **RESOLVED** — Plan specifies deprecation + warning logs.
**8. Gemini legacy migration regression test** → **RESOLVED** — Test listed.
**9. Bug D acceptance criteria** → **PARTIALLY RESOLVED** — Bug D (swallowed errors at turn boundary) is no longer mentioned as a formal "Change D" in the updated plan. This appears intentional — the original review noted it needed exact callsite citation. The other 3 changes (A, B, C) fully address the browser storm and contamination issues. Bug D is lower priority and can be a separate follow-up. Acceptable.

### MINOR Issues from Review 1

**10-12** → All addressed (DRY refactor, naming, cancellation tests).

## NEW Issues Found in Updated Plan

### IMPORTANT

**N1. Codex `refreshIfNeeded()` at L502 also does unbucketed write** — Codex's `refreshIfNeeded()` method at line 502 does `await this.tokenStore.saveToken('codex', newToken)`. The plan mentions removing writes from Codex's `completeAuth()` and `performDeviceAuth()` but doesn't explicitly call out `refreshIfNeeded()`. However, since `Codex.getToken()` (L435-474) does NOT call `refreshIfNeeded()` (it just reads and validates with Zod), this is a latent risk, not an active bug path. The `refreshIfNeeded()` is only called from outside. **Recommendation**: Mark Codex's `refreshIfNeeded()` as deprecated like Qwen's, or at minimum note it as a known unbucketed write path that doesn't affect the fixed flows.

**N2. Codex `initiateAuth()` reuse-of-`authInProgress` promise** — At line 135-139, if another call is in progress, it `await`s the existing promise and returns `void`. With the return type change to `Promise<OAuthToken>`, this reuse path returns `undefined` (since the original promise also returned void). Need to handle: either throw ("auth already in progress") or store-and-return the token from the first call. **This is BLOCKING for the interface change.**

### MINOR

**N3. Plan line numbers don't match actual code** — The plan says Anthropic `completeAuth()` is at lines 287-324 and `initiateAuth()` is at lines 132-305. Actual code has `completeAuth()` starting around L287 and the `saveToken` at L298 — close but the plan's numbers are approximate. Not a problem for implementation, just noting the plan uses approximate line numbers which is fine for a design doc.

**N4. Gemini `refreshIfNeeded()` removes token unbucketed (L401)** — `this.tokenStore.removeToken('gemini')` in the Gemini provider. Plan mentions guarding migration but doesn't explicitly call out this removal. Since the plan says `getToken()` should be read-only and not call `refreshIfNeeded()`, this becomes dead code. Fine, but should be deprecated alongside the method.

## Overall Verdict

**APPROVE WITH MINOR CHANGES**

The plan is comprehensive, well-structured, and addresses all the critical bugs. The two new issues I found:

1. **N2 (Codex authInProgress reuse) is the only real gap** — needs a one-line fix in the plan to specify how the reuse path returns a token or throws.
2. N1 and N4 are latent risks in deprecated code paths — acceptable as follow-up.

The plan is ready for implementation after addressing N2.
