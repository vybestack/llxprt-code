# Phase 01: Domain Analysis

## Phase ID
`PLAN-20250214-CREDPROXY.P01`

## Prerequisites
- Required: Phase 00a (Preflight Verification) completed
- Verification: `test -f project-plans/issue1358_1359_1360/.completed/P00a.md`
- Preflight verification: All blocking issues resolved

## Requirements Implemented (Expanded)

This phase does not implement requirements directly. It creates the domain model that subsequent phases reference.

### Analysis Scope
- Entity relationships for proxy system
- State transitions for connections, sessions, and tokens
- Business rules governing the trust boundary
- Edge cases for each component
- Error scenarios and recovery paths

## Implementation Tasks

### Files to Create
- `analysis/domain-model.md` — Full domain analysis
  - Entity catalog: CredentialProxyServer, ProxyTokenStore, ProxyProviderKeyStorage, ProxyOAuthAdapter, ProxySocketClient, PKCESessionStore, ProactiveScheduler, RefreshCoordinator, TokenMerge, Factory Functions
  - State transition diagrams: proxy connection, OAuth sessions, token lifecycle
  - Business rules: trust boundary, rate limiting, profile scoping, lock ordering
  - Edge cases: PID reuse, macOS symlinks, machine sleep, concurrent refresh, Gemini special case
  - Error scenarios: socket missing, version mismatch, keyring locked, provider errors

### Analysis Must Cover (from specification)
1. Combined delivery model (three issues as one feature)
2. Trust boundary enforcement (refresh_token never crosses socket)
3. Detection mechanism (env var → factory → proxy vs direct)
4. Four OAuth provider flow types (Anthropic PKCE, Gemini PKCE, Qwen device code, Codex dual-flow)
5. Timeout architecture (5 distinct timeout types)
6. Platform considerations (Linux SO_PEERCRED vs macOS LOCAL_PEERPID, Docker Desktop VM boundary)

## Verification Commands

```bash
# Verify domain model exists and covers all entities
test -f analysis/domain-model.md || echo "FAIL: domain-model.md missing"
grep -c "CredentialProxyServer\|ProxyTokenStore\|ProxyProviderKeyStorage\|ProxyOAuthAdapter\|ProxySocketClient\|PKCESessionStore\|ProactiveScheduler\|RefreshCoordinator" analysis/domain-model.md
# Expected: 8+ occurrences (all entities mentioned)

# Verify state transitions
grep -c "State Transition\|DISCONNECTED\|CONNECTING\|CONNECTED\|CREATED\|PENDING\|EXPIRED" analysis/domain-model.md
# Expected: 6+ occurrences

# Verify edge cases documented
grep -c "Edge Case\|PID reuse\|macOS\|sleep\|concurrent\|Gemini" analysis/domain-model.md
# Expected: 5+ occurrences
```

## Success Criteria
- Domain model covers all 9 components from pseudocode
- State transitions defined for connection, session, and token lifecycles
- All business rules from specification documented
- Edge cases enumerated with expected behavior

## Failure Recovery
1. Re-read overview.md, requirements.md, technical-overview.md
2. Regenerate domain model with missing entities

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P01.md`
