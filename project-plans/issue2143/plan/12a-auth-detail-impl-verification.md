<!-- @plan:PLAN-20260622-COREAPIGAP.P12a @requirement:REQ-005 -->
# Phase 12a: Auth Detail — Pseudocode-Compliance Verification

## Phase ID

`PLAN-20260622-COREAPIGAP.P12a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 12 completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P12.md`

## Purpose

Independent gate. Confirm the P12 implementation matches `analysis/pseudocode/auth-detail.md`
line-by-line, preserves the existing `AgentAuthControl` surface (non-breaking), is delegate-only
(no cached manager/results), NEVER returns raw token secrets (R-NO-RAW-SECRETS), uses `peekStoredToken`
(no refresh) for expiry, and that the P11 tests are genuinely behavioral (real `OAuthManager` over an
in-memory `TokenStore`, no mock theater, ≥30% property, no reverse tests).

## Verification Commands

```bash
set -o pipefail
set -e
A=packages/agents/src/api/agent.ts
C=packages/agents/src/api/control/authControl.ts
I=packages/agents/src/api/agentImpl.ts
F=packages/agents/src/api/__tests__/authDetail.behavior.test.ts

# 1. Target test + whole dir GREEN.
npx vitest run "$F" 2>&1 | tail -30
npx vitest run packages/agents/src/api/__tests__/ > /tmp/p12a_all.log 2>&1 || { echo "FAIL: regressions"; tail -60 /tmp/p12a_all.log; exit 1; }

# 2. Project typecheck + lint clean.
npm run typecheck 2>&1 | tail -15
npm run lint 2>&1 | tail -15

# 3. Non-breaking: existing AgentAuthControl members still declared.
for m in "login" "logout" "status" "enableOAuth" "disableOAuth" "listBuckets" "switchBucket" "mcpLogin" "setBaseUrl"; do
  grep -qE "$m" "$A" || { echo "FAIL: existing AgentAuthControl member $m missing"; exit 1; }
done
grep -qE "readonly keys: AgentAuthKeysControl" "$A" || { echo "FAIL: existing keys member missing"; exit 1; }

# 4. R-NO-RAW-SECRETS: control must not reference secret token fields; must use peekStoredToken not getToken.
if grep -nE "access_token|refresh_token" "$C"; then echo "FAIL: control references a raw secret field"; exit 1; fi
grep -qE "peekStoredToken" "$C" || { echo "FAIL: not using peekStoredToken"; exit 1; }
if grep -nE "\.getToken\(" "$C"; then echo "FAIL: used refreshing getToken"; exit 1; fi

# 5. Delegation + wiring; no cache.
grep -qE "getOAuthManager: \(\) => this\.deps\.oauthManager" "$I" || { echo "FAIL: buildAuthControl wiring missing"; exit 1; }
grep -qE "this\.deps\.getOAuthManager\(\)" "$C" || { echo "FAIL: not resolving manager per call"; exit 1; }
if grep -nE "private .*(oauthManager|cachedManager|authCache)\b" "$C"; then echo "FAIL: cached manager state"; exit 1; fi

# 6. Expiry gated behind authenticated (the pseudocode contract).
grep -qE "if \(authenticated\)" "$C" || { echo "FAIL: expiry not gated behind authenticated"; exit 1; }

# 7. Re-audit P11 tests are behavioral + hermetic-real.
grep -qE "new OAuthManager\(" "$F" || { echo "FAIL: not a real OAuthManager"; exit 1; }
if grep -nE "toHaveBeenCalled|mockResolvedValue|mockReturnValue|vi\.fn\(|vi\.spyOn" "$F"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "not\.toThrow\(\)" "$F"; then echo "FAIL: reverse test"; exit 1; fi
if grep -nE "as unknown as AuthControlDeps" "$F"; then echo "FAIL: RED-note cast lingering"; exit 1; fi
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
CLASSIC_PROP_BLOCKS=$(awk '/(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 } /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } } END { print n+0 }' "$F")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
PCT=$(( PROP * 100 / TOTAL ))
echo "property CASES: $PROP / $TOTAL = ${PCT}%"
[ "$PROP" -ge 2 ] && [ "$PCT" -ge 30 ] || { echo "FAIL: property gate"; exit 1; }
# No-leak assertion is present in the test.
grep -qE "access_token|refresh_token" "$F" || { echo "FAIL: no-leak assertion missing"; exit 1; }

# 8. Deferred scan on changed lines.
for X in "$A" "$C" "$I"; do
  git diff HEAD -- "$X" | grep -E "^\+" | grep -vE "^\+\+\+" \
    | grep -nE "(TODO|FIXME|HACK|STUB|placeholder|for now|in a real)" \
    && { echo "FAIL: deferred marker in $X"; exit 1; } || true
done
echo "PASS: gates green."
```

### Line-by-Line Compliance Table (fill in, fold into marker)

| Pseudocode lines | Method | Implemented at (file:line) | Matches? |
| --- | --- | --- | --- |
| 1-17 | detailedStatus (oauthEnabled + authenticated; expiry from peekStoredToken ONLY when authenticated; no secrets) | authControl.ts:___ | |
| 30-33 | getHigherPriorityAuth (read-through string\|null) | authControl.ts:___ | |
| 40-49 | listBucketStatuses (project bucket/authenticated/expiry/isSessionBucket) | authControl.ts:___ | |
| wiring | buildAuthControl threads `getOAuthManager: () => this.deps.oauthManager` | agentImpl.ts:___ | |

## Holistic Functionality Assessment (MANDATORY — into marker)

- **What was implemented**: three masked detail methods on `AgentAuthControl`/`AuthControl`, plus the
  `getOAuthManager` closure dep wired in `buildAuthControl()`.
- **Satisfies REQ-005?**: detailedStatus / getHigherPriorityAuth / listBucketStatuses present; existing
  members intact (non-breaking)?
- **Data flow**: live `this.deps.getOAuthManager()` every call; `peekStoredToken` (no refresh); expiry
  gated behind `authenticated`; bucket projection to four named fields.
- **Security (R-NO-RAW-SECRETS)**: no `access_token`/`refresh_token` reachable on any returned object;
  test enumerates keys to prove it. Verdict on leak risk with evidence.
- **Risks**: any cached manager; any path that could surface a secret; any change to existing members;
  any use of refreshing `getToken`.
- **Verdict**: PASS/FAIL with file:line evidence.

## Success Criteria

- All gates pass; compliance table complete; non-breaking + no-raw-secrets confirmed; holistic verdict
  PASS.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P12a.md` including the completed compliance table + holistic
assessment.
