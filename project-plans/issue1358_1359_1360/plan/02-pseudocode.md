# Phase 02: Pseudocode Development

## Phase ID
`PLAN-20250214-CREDPROXY.P02`

## Prerequisites
- Required: Phase 01a (Analysis Verification) completed
- Verification: `test -f project-plans/issue1358_1359_1360/.completed/P01a.md`

## Requirements Implemented (Expanded)

This phase creates numbered pseudocode for all 9 components. Pseudocode line numbers are referenced by ALL subsequent implementation phases.

### Pseudocode Files to Create/Verify

| File | Component | Line Range |
|---|---|---|
| `analysis/pseudocode/001-framing-protocol.md` | FrameEncoder, FrameDecoder, ProxySocketClient | Lines 1–137 |
| `analysis/pseudocode/002-token-sanitization-merge.md` | sanitizeTokenForProxy, mergeRefreshedToken | TBD |
| `analysis/pseudocode/003-proxy-token-store.md` | ProxyTokenStore (TokenStore impl) | TBD |
| `analysis/pseudocode/004-proxy-provider-key-storage.md` | ProxyProviderKeyStorage | TBD |
| `analysis/pseudocode/005-credential-proxy-server.md` | CredentialProxyServer (socket, routing, dispatch) | TBD |
| `analysis/pseudocode/006-refresh-coordinator.md` | RefreshCoordinator (lock, retry, rate limit) | TBD |
| `analysis/pseudocode/007-proactive-scheduler.md` | ProactiveScheduler (timer management) | TBD |
| `analysis/pseudocode/008-oauth-session-manager.md` | OAuthSessionManager (PKCE sessions, GC) | TBD |
| `analysis/pseudocode/009-proxy-oauth-adapter.md` | ProxyOAuthAdapter (inner-side login/refresh) | TBD |

### Pseudocode Requirements
1. Every line of pseudocode is numbered
2. Uses clear algorithmic steps (not TypeScript)
3. Includes all error handling paths
4. Marks transaction boundaries (lock acquire/release)
5. Notes where validation occurs
6. Contract-first: inputs, outputs, dependencies defined
7. Integration points documented line-by-line
8. Anti-pattern warnings included

## Implementation Tasks

### For Each Pseudocode File, Verify/Create:
1. **Interface Contracts** section — inputs, outputs, dependencies
2. **Integration Points** section — line-by-line callouts
3. **Anti-Pattern Warnings** section
4. **Numbered pseudocode** — every line numbered, algorithmic steps

## Verification Commands

```bash
# Verify all 9 pseudocode files exist
for i in 001 002 003 004 005 006 007 008 009; do
  test -f "analysis/pseudocode/${i}-"*.md && echo "${i}: exists" || echo "${i}: MISSING"
done

# Verify line numbering
for f in analysis/pseudocode/*.md; do
  LINES=$(grep -cE "^\s*[0-9]+:" "$f" 2>/dev/null || echo 0)
  echo "$(basename $f): $LINES numbered lines"
done

# Verify contract sections
for f in analysis/pseudocode/*.md; do
  grep -q "Contract\|Interface" "$f" && echo "$(basename $f): has contract" || echo "$(basename $f): MISSING contract"
  grep -q "Anti-Pattern\|ERROR.*DO NOT" "$f" && echo "$(basename $f): has anti-patterns" || echo "$(basename $f): MISSING anti-patterns"
done
```

## Success Criteria
- All 9 pseudocode files exist with numbered lines
- Each file has Contract, Integration Points, Anti-Pattern sections
- No actual TypeScript in pseudocode (only algorithmic steps)
- Pseudocode covers all requirements from specification

## Failure Recovery
1. Re-run Phase 01 analysis and compare each requirement against pseudocode coverage
2. Patch any pseudocode file missing numbered lines, contract sections, or error paths
3. Re-run verification commands until all nine pseudocode files satisfy checks

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P02.md`
