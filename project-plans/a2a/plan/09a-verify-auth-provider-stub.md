# Phase 09a: Auth Provider Abstraction - Stub Verification

## Phase ID

`PLAN-20260302-A2A.P09a`

## Prerequisites

- Required: Phase 09 completed
- Files expected:
  - `packages/core/src/agents/auth-providers.ts` (created)
  - `packages/core/src/config/config.ts` (modified)

## Verification Procedure

Run ALL checks from Phase 09 "Verification Commands" section:

### 1. Structural Checks

```bash
# File existence
ls packages/core/src/agents/auth-providers.ts

# Plan markers in auth-providers.ts
grep -c "@plan PLAN-20260302-A2A.P09" packages/core/src/agents/auth-providers.ts
# MUST return: 2

# Requirements in auth-providers.ts
grep "@requirement A2A-AUTH-001\|@requirement A2A-AUTH-002" packages/core/src/agents/auth-providers.ts | wc -l
# MUST return: 2

# Plan markers in config.ts
grep -c "@plan PLAN-20260302-A2A.P09" packages/core/src/config/config.ts
# MUST return: 3

# Requirements in config.ts
grep "@requirement A2A-CFG-001" packages/core/src/config/config.ts | wc -l
# MUST return: 3

# Exports
grep "^export.*RemoteAgentAuthProvider\|^export.*NoAuthProvider" packages/core/src/agents/auth-providers.ts
# MUST show: Both interface and class exported
```

### 2. Compilation Checks

```bash
# auth-providers.ts (SDK import error expected)
npx tsc --noEmit packages/core/src/agents/auth-providers.ts 2>&1 | grep "Cannot find module '@google/genai-a2a-sdk'"
# EXPECT: Module not found error (acceptable until P15)

# config.ts compiles
npx tsc --noEmit packages/core/src/config/config.ts
# MUST: Exit 0 (success)
```

### 3. Deferred Implementation Detection

```bash
# No TODO in implementation
grep -E "(TODO|FIXME|HACK|STUB)" packages/core/src/agents/auth-providers.ts | grep -v "NOTE:"
# MUST return: Empty (no matches)

# No TODO in new Config methods
grep "@plan PLAN-20260302-A2A.P09" packages/core/src/config/config.ts -A 5 | grep -E "(TODO|FIXME|HACK|STUB)"
# MUST return: Empty
```

### 4. Semantic Verification

**Manual checks (answer ALL before marking complete):**

#### auth-providers.ts
- [ ] File contains RemoteAgentAuthProvider interface
- [ ] Interface has getAuthHandler(agentCardUrl: string): Promise<AuthenticationHandler | undefined> method signature
- [ ] Interface has JSDoc with @plan and @requirement A2A-AUTH-001
- [ ] File contains NoAuthProvider class
- [ ] NoAuthProvider implements RemoteAgentAuthProvider
- [ ] NoAuthProvider.getAuthHandler returns undefined
- [ ] NoAuthProvider has JSDoc with @plan and @requirement A2A-AUTH-002
- [ ] File has NOTE comment about SDK availability in P15
- [ ] Both interface and class are exported

#### config.ts
- [ ] Private field remoteAgentAuthProvider exists (around line 93)
- [ ] Import statement for RemoteAgentAuthProvider added at top
- [ ] setRemoteAgentAuthProvider(provider) method exists (around line 611)
- [ ] getRemoteAgentAuthProvider() method exists (around line 611)
- [ ] Both methods have JSDoc with @plan and @requirement A2A-CFG-001
- [ ] setRemoteAgentAuthProvider stores the provider in the private field
- [ ] getRemoteAgentAuthProvider returns the stored provider

## Success Criteria

- [x] All structural checks pass
- [x] All compilation checks pass (ignoring expected SDK error)
- [x] All deferred implementation checks pass
- [x] All semantic verification checklist items checked
- [x] No blocking issues found

## Blocking Issues

**If ANY check fails, document here and STOP:**

[List any issues]

## Verification Report

Create: `project-plans/gmerge-0.24.5/a2a/plan/.verified/P09a-report.md`

Contents:
```markdown
Phase: P09a
Verified: [YYYY-MM-DD HH:MM timestamp]
Phase 09 Status: PASS / FAIL

### Structural Checks
[Paste output of all grep commands]

### Compilation Checks
[Paste tsc output]

### Deferred Implementation Checks
[Paste grep output - should be empty]

### Semantic Verification
All checklist items: VERIFIED / FAILED

### Issues Found
[None / List issues]

### Recommendation
PROCEED to Phase 10 / FIX Phase 09
```

## Next Steps

- If ALL checks pass → Proceed to Phase 10 (Auth Provider TDD)
- If ANY check fails → Return to Phase 09, fix issues, re-run verification
