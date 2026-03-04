# A2A Remote Agent Implementation Plan

**Plan ID**: PLAN-20260302-A2A  
**Generated**: March 2, 2026  
**Total Phases**: 33 (including verification)  
**Requirements**: 62 EARS requirements from requirements.md

## Quick Start

### For Coordinator Agents

1. **Read START-HERE.md** — Context recovery instructions
2. **Read 00-overview.md** — Plan structure and success criteria
3. **Check execution-tracker.md** — Current phase status
4. **Execute phases sequentially** — P00a, P03, P03a, P04, P04a, ... (NO SKIPPING)
5. **Update tracker after each phase** — Mark complete and verify

### For Implementation Subagents

1. **Read the phase file you're assigned** (e.g., `15-a2a-client-manager-stub.md`)
2. **Check prerequisites section** — Verify previous phase complete
3. **Follow subagent prompt instructions** — Explicit implementation steps
4. **Run verification commands** — Ensure correctness
5. **Add plan markers to code** — @plan and @requirement tags

### For Verification Subagents

1. **Read the verification phase file** (e.g., `15a-a2a-client-manager-verification.md`)
2. **Run structural checks** — grep for markers, run tests
3. **Answer semantic questions** — Does it actually work?
4. **Document results** — Pass/fail with specifics
5. **If fail, send back to implementation** — Don't proceed to next phase

## File Structure

```
plan/
├── README.md                           ← You are here
├── START-HERE.md                       ← Read first if context-wiped
├── 00-overview.md                      ← Plan structure
├── 00a-preflight-verification.md       ← Verify assumptions before starting
├── execution-tracker.md                ← Track phase completion
├── PHASE-TEMPLATE.md                   ← Pattern for generating remaining phases
│
├── 03-type-system-stub.md              ← Phase 03: Discriminated union types (stub)
├── 03a-type-system-verification.md     ← (Generate using template)
├── 04-type-system-tdd.md               ← Phase 04: Type system tests
├── 04a-type-system-tdd-verification.md ← (Generate using template)
├── 05-type-system-impl.md              ← (Generate using template)
├── 05a-type-system-impl-verification.md← (Generate using template)
│
├── 06-a2a-utils-stub.md                ← (Generate using template)
├── 07-a2a-utils-tdd.md                 ← (Generate using template)
├── 08-a2a-utils-impl.md                ← (Generate using template)
│
├── 09-auth-provider-stub.md            ← (Generate using template)
├── 10-auth-provider-tdd.md             ← (Generate using template)
├── 11-auth-provider-impl.md            ← (Generate using template)
│
├── 12-google-adc-auth-stub.md          ← (Generate using template)
├── 13-google-adc-auth-tdd.md           ← (Generate using template)
├── 14-google-adc-auth-impl.md          ← (Generate using template)
│
├── 15-a2a-client-manager-stub.md       ← Phase 15: Client manager (stub)
├── 16-a2a-client-manager-tdd.md        ← (Generate using template)
├── 17-a2a-client-manager-impl.md       ← (Generate using template)
│
├── 18-async-registry-stub.md           ← (Generate using template)
├── 19-async-registry-tdd.md            ← (Generate using template)
├── 20-async-registry-impl.md           ← (Generate using template)
│
├── 21-remote-invocation-stub.md        ← Phase 21: Remote invocation (stub)
├── 22-remote-invocation-tdd.md         ← (Generate using template)
├── 23-remote-invocation-impl.md        ← (Generate using template)
│
├── 24-dispatch-stub.md                 ← (Generate using template)
├── 25-dispatch-tdd.md                  ← (Generate using template)
├── 26-dispatch-impl.md                 ← (Generate using template)
│
├── 27-toml-integration-stub.md         ← (Generate using template)
├── 28-toml-integration-tdd.md          ← (Generate using template)
├── 29-toml-integration-impl.md         ← (Generate using template)
│
├── 30-integration.md                   ← (Generate using template)
├── 31-migration.md                     ← (Generate using template)
├── 32-e2e-testing.md                   ← (Generate using template)
└── 33-final-verification.md            ← (Generate using template)
```

## Key Documents

### Must Read Before Starting

1. **START-HERE.md** — Context recovery for wiped agents
2. **00-overview.md** — Plan overview and success criteria
3. **execution-tracker.md** — Phase status tracking
4. **../design.md** — Full technical architecture (parent directory)
5. **../requirements.md** — 62 EARS requirements (parent directory)
6. **../../dev-docs/RULES.md** — Project rules (testing, TDD)
7. **../../dev-docs/COORDINATING.md** — Subagent coordination

### Reference Documents

- **PHASE-TEMPLATE.md** — Pattern for generating remaining phase files
- **00a-preflight-verification.md** — Assumption verification checklist

## Phase Summary

### Group 1: Foundation (P00a-P08)
- P00a: Preflight verification
- P03-05: Discriminated union types (breaking change)
- P06-08: A2A utilities (text extraction)

### Group 2: Authentication (P09-P14)
- P09-11: Auth provider abstraction + NoAuthProvider
- P12-14: GoogleADCAuthProvider (requires google-auth-library)

### Group 3: Core Infrastructure (P15-P23)
- P15-17: A2AClientManager (requires @google/genai-a2a-sdk)
- P18-20: Async AgentRegistry (breaking change)
- P21-23: RemoteAgentInvocation

### Group 4: Integration (P24-P32)
- P24-26: Execution dispatch (breaking change)
- P27-29: TOML integration
- P30: Integration (fix breaking changes)
- P31: Migration (type narrowing)
- P32: E2E testing

### Group 5: Completion (P33)
- P33: Final verification (all 62 requirements)

## Breaking Changes

**CRITICAL**: This plan introduces breaking changes fixed in later phases:

### Breaking Change #1: Discriminated Union Types (P03-05)
- **Impact**: Code accessing promptConfig/modelConfig on AgentDefinition breaks
- **Fixed In**: P30-31 (Integration & Migration)
- **Action**: Don't fix prematurely; wait for integration phases

### Breaking Change #2: Async registerAgent (P18-20)
- **Impact**: Callers of registerAgent must await
- **Fixed In**: P20, P30 (Registry implementation, integration)
- **Action**: Update callers in P20 and P30

### Breaking Change #3: Execution Dispatch (P24-26)
- **Impact**: Direct SubagentInvocation instantiation breaks
- **Fixed In**: P26, P30 (Factory method, integration)
- **Action**: Switch to AgentRegistry.createInvocation() factory

## Dependencies

### Existing Packages (Verified in P00a)
- `@google/genai`
- `zod`
- `vitest`

### New Packages (Added During Implementation)
- `@google/genai-a2a-sdk` (Phase 15)
- `google-auth-library` (Phase 12)

## Requirements Coverage

All 62 EARS requirements from requirements.md are implemented:

- **A2A-DISC-***: Discovery and agent cards (P15-17)
- **A2A-REG-***: Registration and type system (P03-05, P18-20, P27-29)
- **A2A-EXEC-***: Execution and invocation (P06-08, P21-26)
- **A2A-AUTH-***: Authentication (P09-14)
- **A2A-CFG-***: Configuration (P09-11, P27-29)
- **A2A-APPR-***: Confirmation/approval (P21-23)

See 00-overview.md for detailed traceability matrix.

## Success Criteria

Plan is complete when:

- [ ] All 33 phases executed (00a through 33)
- [ ] execution-tracker.md shows all phases PASS
- [ ] All 62 EARS requirements satisfied (tests pass)
- [ ] Type system enforces local vs remote at compile time
- [ ] Remote agents load from TOML files
- [ ] Agent cards fetched with authentication
- [ ] Session state persists contextId/taskId correctly
- [ ] Abort signals cancel remote tasks
- [ ] input-required state handled gracefully
- [ ] Vertex AI dialect adapter normalizes responses
- [ ] Integration tests pass end-to-end
- [ ] No breaking changes unfixed
- [ ] 80%+ mutation test coverage
- [ ] No TODOs or NotYetImplemented in code
- [ ] Documentation updated

## Coordinator Instructions

### Phase Execution Pattern

```
FOR each phase P{N} in [00a, 03, 04, 05, ..., 33]:
  1. Read plan/P{N}-*.md
  2. Verify prerequisites (previous phase complete)
  3. Launch subagent with prompt from phase file
  4. Wait for subagent completion
  5. Launch verification subagent for P{N}a
  6. If PASS: Update execution-tracker.md, proceed to P{N+1}
  7. If FAIL: Remediate, re-verify, repeat until PASS
  8. NEVER skip to P{N+2} without completing P{N+1}
```

### Subagent Selection

- **Implementation (stub, impl)**: typescriptexpert, cherrypicker
- **TDD**: typescriptexpert
- **Verification**: typescriptreviewer, deepthinker

### Todo Management

Create todos for ALL phases upfront:

```typescript
TodoWrite({
  todos: [
    { id: 'P00a', content: 'Preflight verification (deepthinker)', status: 'pending' },
    { id: 'P03', content: 'Type system stub (typescriptexpert)', status: 'pending' },
    { id: 'P03a', content: 'Type system verification (typescriptreviewer)', status: 'pending' },
    { id: 'P04', content: 'Type system TDD (typescriptexpert)', status: 'pending' },
    // ... all 33 phases
  ]
});
```

Update status after each phase completes.

## Common Pitfalls

1. **Skipping Phases** — Execute ALL phases in order (no skipping)
2. **Batching Phases** — One phase per subagent (no combining)
3. **Fixing Breaking Changes Early** — Wait for integration phases (P30-31)
4. **Mock Theater** — Test behavior, not mock interactions
5. **Time Estimates** — Never include time estimates in output

## Emergency Recovery

If plan execution fails or context is lost:

1. Read **START-HERE.md** for orientation
2. Check **execution-tracker.md** for last completed phase
3. Read **00-overview.md** for plan structure
4. Review **design.md** and **requirements.md** for architecture
5. Resume at next phase (don't restart from beginning)

## Questions?

- **Architecture questions**: Read design.md
- **Requirement questions**: Read requirements.md
- **Testing questions**: Read RULES.md
- **Coordination questions**: Read COORDINATING.md
- **Context recovery**: Read START-HERE.md
- **Phase pattern**: Read PHASE-TEMPLATE.md

## Plan Maintenance

**Adding Phases**: Use PHASE-TEMPLATE.md pattern to generate missing phase files.

**Modifying Phases**: Update phase file + execution-tracker.md + 00-overview.md.

**Verification Failures**: Document in execution-tracker.md, remediate, re-verify.

---

**Ready to start? Read START-HERE.md, then execute P00a (Preflight Verification).**
