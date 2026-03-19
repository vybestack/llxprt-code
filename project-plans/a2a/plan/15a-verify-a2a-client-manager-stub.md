# Phase 15a: Verify A2A Client Manager Stub

## Phase ID

`PLAN-20260302-A2A.P15a`

## Prerequisites

- Required: Phase 15 (A2A Client Manager Stub) completed
- Verification: a2a-client-manager.ts file created
- Expected: A2AClientManager class with stub methods

## Purpose

Verify that Phase 15 stub implementation is correct and ready for TDD in Phase 16.

## Verification Commands

### Automated Checks (Structural)

```bash
# Check file created
ls packages/core/src/agents/a2a-client-manager.ts
# Expected: File exists

# Check dependency installed
npm ls @a2a-js/sdk
# Expected: @a2a-js/sdk@<version> installed

# Check plan markers exist
grep -c "@plan PLAN-20260302-A2A.P15" packages/core/src/agents/a2a-client-manager.ts
# Expected: 7+ occurrences (class + 6 methods + helper functions)

# Check requirements covered
grep -E "@requirement A2A-DISC-001|@requirement A2A-DISC-002|@requirement A2A-DISC-003|@requirement A2A-EXEC-012" packages/core/src/agents/a2a-client-manager.ts
# Expected: 4+ occurrences

# Check class export
grep "^export class A2AClientManager" packages/core/src/agents/a2a-client-manager.ts
# Expected: 1 occurrence

# Check methods exist
grep -E "async loadAgent|async sendMessage|async getTask|async cancelTask|getAgentCard|getClient" packages/core/src/agents/a2a-client-manager.ts
# Expected: 6 matches (all methods present)

# Check helper functions exist
grep -E "function createAdapterFetch|function mapTaskState" packages/core/src/agents/a2a-client-manager.ts
# Expected: 2 matches

# Check imports from SDK
grep "import.*@a2a-js/sdk" packages/core/src/agents/a2a-client-manager.ts
# Expected: 1 occurrence

# TypeScript compiles
npm run typecheck
# Expected: No errors in a2a-client-manager.ts

# No forbidden patterns
grep -E "(NotYetImplemented|TODO|throw new Error)" packages/core/src/agents/a2a-client-manager.ts | grep -v "requirement"
# Expected: No matches (stubs return dummy data, not errors)

# Check stub returns correct types
grep -A 1 "async loadAgent" packages/core/src/agents/a2a-client-manager.ts | grep "return {"
# Expected: Stub returns object (AgentCard)

grep -A 1 "async sendMessage" packages/core/src/agents/a2a-client-manager.ts | grep "return {"
# Expected: Stub returns object (Message)
```

### Semantic Verification Checklist

**Does the stub have correct structure?**
- [ ] I read the a2a-client-manager.ts file (not just checked file exists)
- [ ] A2AClientManager class exists with correct name
- [ ] Constructor accepts optional RemoteAgentAuthProvider
- [ ] Class has private fields: clients (Map), agentCards (Map), authProvider
- [ ] All 6 methods exist with correct signatures
- [ ] Helper functions createAdapterFetch and mapTaskState exist
- [ ] All methods have JSDoc with @plan and @requirement markers

**Do stubs return correct types?**
- [ ] loadAgent returns AgentCard (stub with name, url, skills, capabilities)
- [ ] sendMessage returns Message (stub with kind: 'message', role, messageId, parts)
- [ ] getTask returns Task (stub with kind: 'task', id, contextId, status)
- [ ] cancelTask returns Task (stub with state: 'canceled')
- [ ] getAgentCard returns AgentCard | undefined
- [ ] getClient returns Client | undefined

**Is stub implementation clean?**
- [ ] No TODO comments in method bodies
- [ ] No error throwing (stubs return dummy data)
- [ ] Stub returns are minimal but valid
- [ ] createAdapterFetch returns native fetch (stub)
- [ ] mapTaskState returns pass-through (stub)

**Dependencies verified?**
- [ ] @a2a-js/sdk installed in package.json
- [ ] Imports from @a2a-js/sdk work
- [ ] auth-providers.ts types imported correctly

## Success Criteria

- All verification commands return expected results
- a2a-client-manager.ts created with complete stub structure
- All methods and helpers have @plan and @requirement markers
- File compiles with no TypeScript errors
- @a2a-js/sdk dependency installed
- Stubs return correct types (not errors)
- Ready for P16 (TDD tests)

## Failure Recovery

If verification fails:

1. **Missing file**: Go back to Phase 15 and create it
2. **Compilation errors**: Fix TypeScript issues
3. **Missing methods**: Add missing methods with stub implementations
4. **Wrong return types**: Fix stub return values to match signatures
5. **Missing markers**: Add @plan and @requirement JSDoc comments

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.verified/P15a-report.md`

Contents:
```markdown
Phase: P15a
Verified: [YYYY-MM-DD HH:MM timestamp]
Verification Result: PASS/FAIL

File Created:
  - packages/core/src/agents/a2a-client-manager.ts (~100 lines)

Components Verified:
  - A2AClientManager class with constructor and 6 methods
  - createAdapterFetch() helper function
  - mapTaskState() helper function

Markers: 7+ @plan markers, 4+ @requirement markers

Dependencies:
  - @a2a-js/sdk: [version]

TypeScript: Compiles successfully

Verification Output:
[paste grep/npm commands output]

Issues Found: [list any issues that need fixing]

Next Phase: P16 (A2A Client Manager TDD)
```
