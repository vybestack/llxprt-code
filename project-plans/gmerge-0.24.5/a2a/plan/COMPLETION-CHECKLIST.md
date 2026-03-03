# A2A Implementation Completion Checklist

**Plan ID**: PLAN-20260302-A2A  
**Use this checklist to verify the plan is fully complete.**

## Phase Execution

### Phase Completion Status

- [ ] P00a: Preflight Verification — All assumptions verified
- [ ] P03: Type System Stub — Discriminated union types created
- [ ] P03a: Type System Stub Verification — Types compile
- [ ] P04: Type System TDD — Type narrowing tests written
- [ ] P04a: Type System TDD Verification — Tests pass
- [ ] P05: Type System Implementation — (No implementation needed, types are complete)
- [ ] P05a: Type System Implementation Verification — Types work correctly
- [ ] P06: A2A Utils Stub — a2a-utils.ts created
- [ ] P06a: A2A Utils Stub Verification — Stubs compile
- [ ] P07: A2A Utils TDD — Text extraction tests written
- [ ] P07a: A2A Utils TDD Verification — Tests fail naturally
- [ ] P08: A2A Utils Implementation — extractMessageText, extractTaskText, extractIdsFromResponse implemented
- [ ] P08a: A2A Utils Implementation Verification — All utils tests pass
- [ ] P09: Auth Provider Stub — RemoteAgentAuthProvider interface + NoAuthProvider created
- [ ] P09a: Auth Provider Stub Verification — Interface compiles
- [ ] P10: Auth Provider TDD — Auth provider tests written
- [ ] P10a: Auth Provider TDD Verification — Tests fail naturally
- [ ] P11: Auth Provider Implementation — NoAuthProvider implemented, Config integration done
- [ ] P11a: Auth Provider Implementation Verification — Auth provider tests pass
- [ ] P12: Google ADC Auth Stub — GoogleADCAuthProvider stub created, google-auth-library added
- [ ] P12a: Google ADC Auth Stub Verification — Stub compiles
- [ ] P13: Google ADC Auth TDD — ADC auth tests written (mocked google-auth-library)
- [ ] P13a: Google ADC Auth TDD Verification — Tests fail naturally
- [ ] P14: Google ADC Auth Implementation — ADC token retrieval implemented
- [ ] P14a: Google ADC Auth Implementation Verification — ADC auth tests pass
- [ ] P15: A2A Client Manager Stub — A2AClientManager class created, @google/genai-a2a-sdk added
- [ ] P15a: A2A Client Manager Stub Verification — Stub compiles
- [ ] P16: A2A Client Manager TDD — Client manager tests written
- [ ] P16a: A2A Client Manager TDD Verification — Tests fail naturally
- [ ] P17: A2A Client Manager Implementation — loadAgent, sendMessage, Vertex AI adapter implemented
- [ ] P17a: A2A Client Manager Implementation Verification — Client manager tests pass
- [ ] P18: Async AgentRegistry Stub — registerAgent made async, registerRemoteAgent added
- [ ] P18a: Async AgentRegistry Stub Verification — Stubs compile
- [ ] P19: Async AgentRegistry TDD — Async registration tests written
- [ ] P19a: Async AgentRegistry TDD Verification — Tests fail naturally
- [ ] P20: Async AgentRegistry Implementation — registerRemoteAgent, parallel registration implemented
- [ ] P20a: Async AgentRegistry Implementation Verification — Registry tests pass
- [ ] P21: RemoteAgentInvocation Stub — RemoteAgentInvocation class created
- [ ] P21a: RemoteAgentInvocation Stub Verification — Stub compiles
- [ ] P22: RemoteAgentInvocation TDD — Remote invocation tests written
- [ ] P22a: RemoteAgentInvocation TDD Verification — Tests fail naturally
- [ ] P23: RemoteAgentInvocation Implementation — execute, session state, abort handling implemented
- [ ] P23a: RemoteAgentInvocation Implementation Verification — Remote invocation tests pass
- [ ] P24: Execution Dispatch Stub — createInvocation factory method added
- [ ] P24a: Execution Dispatch Stub Verification — Factory stub compiles
- [ ] P25: Execution Dispatch TDD — Dispatch tests written
- [ ] P25a: Execution Dispatch TDD Verification — Tests fail naturally
- [ ] P26: Execution Dispatch Implementation — Factory dispatches to local vs remote invocations
- [ ] P26a: Execution Dispatch Implementation Verification — Dispatch tests pass
- [ ] P27: TOML Integration Stub — remoteAgentSchema added to TOML loader
- [ ] P27a: TOML Integration Stub Verification — Schema compiles
- [ ] P28: TOML Integration TDD — TOML parsing tests written
- [ ] P28a: TOML Integration TDD Verification — Tests fail naturally
- [ ] P29: TOML Integration Implementation — Remote agent TOML loading implemented
- [ ] P29a: TOML Integration Implementation Verification — TOML tests pass
- [ ] P30: Integration — All registerAgent callers updated to await, SubagentInvocation calls migrated to factory
- [ ] P30a: Integration Verification — All integration points work
- [ ] P31: Migration — Type narrowing added to executor.ts, invocation.ts
- [ ] P31a: Migration Verification — All breaking changes fixed
- [ ] P32: E2E Testing — End-to-end integration tests written and pass
- [ ] P32a: E2E Testing Verification — E2E tests cover all user flows
- [ ] P33: Final Verification — All requirements satisfied, plan complete

## Requirements Coverage (62 EARS Requirements)

### Agent Discovery (4 requirements)

- [ ] A2A-DISC-001: Agent card fetching via A2A SDK
- [ ] A2A-DISC-002: Error handling for failed agent card fetches
- [ ] A2A-DISC-003: Agent card caching for session
- [ ] A2A-DISC-004: Description extraction from agent card skills

### Agent Registration (6 requirements)

- [ ] A2A-REG-001: Discriminated union types (LocalAgentDefinition | RemoteAgentDefinition)
- [ ] A2A-REG-002: Async AgentRegistry.registerAgent()
- [ ] A2A-REG-003: Parallel registration with Promise.allSettled
- [ ] A2A-REG-004: Validation of remote agent definitions
- [ ] A2A-REG-005: Override existing agent definitions
- [ ] A2A-REG-006: TOML loading for remote agents

### Agent Execution (12 requirements)

- [ ] A2A-EXEC-001: Delegate to A2AClientManager
- [ ] A2A-EXEC-002: Persist contextId/taskId for conversation continuity
- [ ] A2A-EXEC-003: Clear taskId on terminal states (completed/failed/canceled)
- [ ] A2A-EXEC-004: Extract text from Message/Task responses
- [ ] A2A-EXEC-005: Abort signal cancels remote tasks
- [ ] A2A-EXEC-006: Validate non-empty query parameter
- [ ] A2A-EXEC-007: Lazy-load remote agent clients
- [ ] A2A-EXEC-008: Extract text from DataPart and FilePart
- [ ] A2A-EXEC-009: input-required state returns error to LLM
- [ ] A2A-EXEC-010: SDK blocking mode for task completion (MVP)
- [ ] A2A-EXEC-011: Execution dispatch via AgentRegistry.createInvocation()
- [ ] A2A-EXEC-012: Vertex AI dialect adapter (createAdapterFetch)

### Authentication (6 requirements)

- [ ] A2A-AUTH-001: Pluggable RemoteAgentAuthProvider interface
- [ ] A2A-AUTH-002: NoAuthProvider for unauthenticated agents
- [ ] A2A-AUTH-003: GoogleADCAuthProvider for Google Cloud agents
- [ ] A2A-AUTH-004: BearerTokenAuthProvider (SHOULD - post-MVP)
- [ ] A2A-AUTH-005: MultiProviderAuthProvider (SHOULD - post-MVP)
- [ ] A2A-AUTH-006: Error handling for authentication failures

### Configuration (5 requirements)

- [ ] A2A-CFG-001: Config.setRemoteAgentAuthProvider() / getRemoteAgentAuthProvider()
- [ ] A2A-CFG-002: NoAuthProvider as default if no provider configured
- [ ] A2A-CFG-003: TOML parsing with Zod schema validation
- [ ] A2A-CFG-004: Infer kind='remote' from agent_card_url presence
- [ ] A2A-CFG-005: Validate agent_card_url is valid URL format

### Confirmation/Approval (3 requirements)

- [ ] A2A-APPR-001: User confirmation before remote agent execution (if policy requires)
- [ ] A2A-APPR-002: Confirmation details include agent name, URL, query preview
- [ ] A2A-APPR-003: Configurable confirmation type (info/warning) based on data exfiltration risk

### Error Handling (Covered in other sections)

All error handling requirements integrated into execution and discovery requirements.

### Observability (Covered in other sections)

Logging integrated via DebugLogger in all components.

### Security (Covered in other sections)

Authentication and confirmation requirements cover security concerns.

## Code Quality Checks

### Structural Quality

- [ ] No `TODO` comments in production code
- [ ] No `NotYetImplemented` errors
- [ ] No `console.log` or debug code
- [ ] All code has `@plan` markers
- [ ] All code has `@requirement` markers
- [ ] TypeScript strict mode passes (no errors)
- [ ] All imports resolve correctly
- [ ] No duplicate files (ServiceV2, Copy, etc.)

### Test Quality

- [ ] All tests are behavioral (test input → output)
- [ ] NO mock theater (tests don't just verify mocks were called)
- [ ] NO reverse testing (tests don't expect NotYetImplemented)
- [ ] 30%+ property-based tests (using fast-check or similar)
- [ ] 80%+ mutation test coverage
- [ ] All tests have `@plan` and `@requirement` markers
- [ ] Tests cover all edge cases and error paths

### Integration Quality

- [ ] All breaking changes fixed (types, async, factory)
- [ ] All AgentRegistry.registerAgent callers await
- [ ] All SubagentInvocation instantiations use factory or type guards
- [ ] AgentExecutor.create only accepts LocalAgentDefinition
- [ ] SubagentInvocation constructor only accepts LocalAgentDefinition
- [ ] Type narrowing works correctly throughout codebase

## Functional Verification

### Agent Card Discovery

- [ ] Agent cards fetched from remote URLs
- [ ] Agent cards cached in A2AClientManager
- [ ] Agent card fetch failures logged and skipped
- [ ] Descriptions extracted from skills if not provided

### Agent Registration

- [ ] Local agents register with all execution config
- [ ] Remote agents register with only name and agentCardUrl
- [ ] Both kinds stored in AgentRegistry map
- [ ] Registration errors don't block other agents
- [ ] TOML files load remote agents correctly

### Agent Execution

- [ ] Local agents execute via AgentExecutor (existing behavior)
- [ ] Remote agents execute via RemoteAgentInvocation → A2AClientManager → A2A SDK
- [ ] Session state (contextId/taskId) persists across invocations
- [ ] Terminal states (completed/failed/canceled) clear taskId
- [ ] Abort signals cancel remote tasks (best-effort)
- [ ] input-required state returns error to LLM
- [ ] Text extracted correctly from Message/Task responses
- [ ] Vertex AI proto-JSON responses normalized

### Authentication

- [ ] NoAuthProvider returns undefined (no auth)
- [ ] GoogleADCAuthProvider retrieves ADC tokens
- [ ] Auth provider passed to A2AClientManager
- [ ] Authentication used for all agent card fetches and messages
- [ ] Config stores and retrieves auth provider

### Dispatch

- [ ] createInvocation factory routes to SubagentInvocation for local agents
- [ ] createInvocation factory routes to RemoteAgentInvocation for remote agents
- [ ] Type narrowing works correctly (no runtime errors)
- [ ] Factory throws if agent not found

## Documentation

- [ ] design.md reflects implementation accurately
- [ ] requirements.md requirements all satisfied
- [ ] README.md updated with remote agent examples
- [ ] TOML schema documented (remote agent format)
- [ ] Code comments explain WHY, not WHAT
- [ ] Auth provider interface documented
- [ ] Session state management documented

## Performance

- [ ] Agent card caching prevents redundant fetches
- [ ] Client reuse (one SDK client per agent name)
- [ ] Parallel registration (Promise.allSettled)
- [ ] Lazy loading of remote agent clients
- [ ] No unnecessary network requests

## Security

- [ ] Authentication required for Google Cloud agents (ADC)
- [ ] No hardcoded credentials
- [ ] User confirmation for remote agent execution (if policy requires)
- [ ] Confirmation shows agent URL (user knows where data is sent)
- [ ] Abort signals propagate to remote tasks

## Breaking Change Migration

- [ ] AgentDefinition discriminated union used throughout
- [ ] Type narrowing added where needed (kind checks)
- [ ] AgentExecutor.create signature changed to LocalAgentDefinition
- [ ] SubagentInvocation constructor signature changed to LocalAgentDefinition
- [ ] AgentRegistry.registerAgent is async (all callers await)
- [ ] AgentRegistry.createInvocation factory used for dispatch
- [ ] All compilation errors resolved

## E2E Flows

- [ ] Register remote agent from TOML file
- [ ] Fetch agent card with authentication
- [ ] Invoke remote agent via createInvocation factory
- [ ] Session state persists contextId/taskId
- [ ] Multi-turn conversation works (contextId continuity)
- [ ] Terminal state clears taskId for next invocation
- [ ] Abort signal cancels remote task
- [ ] input-required state handled gracefully
- [ ] Error responses propagate correctly

## Final Verification Commands

```bash
# All tests pass
npm test

# TypeScript compiles
npm run typecheck

# No forbidden patterns
grep -r "TODO\|NotYetImplemented\|console\.log" packages/core/src/agents/
# Expected: no matches (or only in comments)

# All plan markers present
grep -r "@plan:PLAN-20260302-A2A" packages/core/src/agents/ | wc -l
# Expected: 100+ occurrences

# All requirements covered
grep -r "@requirement:A2A-" packages/core/src/agents/ | wc -l
# Expected: 62+ occurrences

# Mutation tests
npm run test:mutation
# Expected: 80%+ coverage

# E2E tests
npm test -- packages/core/src/agents/__tests__/a2a-integration.test.ts
# Expected: All pass
```

## Sign-Off

- [ ] All phases complete (00a through 33)
- [ ] All requirements satisfied (62/62)
- [ ] All tests pass
- [ ] No breaking changes unfixed
- [ ] Code quality checks pass
- [ ] Documentation updated
- [ ] E2E flows verified
- [ ] Performance acceptable
- [ ] Security requirements met

## Plan Completion

**Date Completed**: _____________  
**Completed By**: _____________  
**Final Notes**: _____________

---

**When ALL checkboxes are checked, the A2A implementation is COMPLETE.**
