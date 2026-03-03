# A2A Remote Agent Implementation Plan Overview

Plan ID: PLAN-20260302-A2A
Generated: 2026-03-02
Total Phases: 27 (plus verification phases)
Requirements: All 62 requirements from requirements.md

## Purpose

Implement Agent-to-Agent (A2A) protocol support to enable LLxprt Code to invoke remote agents hosted elsewhere. This adds remote agent capabilities alongside existing local agent execution, maintaining multi-provider philosophy.

## Critical Context

**READ THIS FIRST if you're a context-wiped agent:**

1. **Design Document**: `project-plans/gmerge-0.24.5/a2a/design.md` — Full technical architecture
2. **Requirements**: `project-plans/gmerge-0.24.5/a2a/requirements.md` — 62 EARS requirements
3. **Upstream Reference**: gemini-cli 0.24.5 implemented this in ~2,000 LoC across 4 commits
4. **Breaking Change**: This introduces discriminated union types for AgentDefinition (kind: 'local' | 'remote')

## Implementation Sequence

### Phase 0: Preflight (00a)
- Verify all dependencies and types before implementation

### Phase 1: Type System Evolution (03-05)
- **Stub (03)**: Create discriminated union types (LocalAgentDefinition | RemoteAgentDefinition)
- **TDD (04)**: Write tests for type narrowing and validation
- **Impl (05)**: Implement type system with breaking changes to AgentDefinition

### Phase 2: A2A Utilities (06-08)
- **Stub (06)**: Create a2a-utils.ts skeleton
- **TDD (07)**: Test text extraction from Message/Task responses
- **Impl (08)**: Implement extractMessageText, extractTaskText, extractIdsFromResponse

### Phase 3: Auth Provider Abstraction (09-11)
- **Stub (09)**: Create RemoteAgentAuthProvider interface + NoAuthProvider
- **TDD (10)**: Test auth provider contract
- **Impl (11)**: Implement NoAuthProvider and Config integration

### Phase 4: Google ADC Auth Provider (12-14)
- **Stub (12)**: Create GoogleADCAuthProvider skeleton
- **TDD (13)**: Test ADC token retrieval (mocked google-auth-library)
- **Impl (14)**: Implement GoogleADCAuthProvider with google-auth-library

### Phase 5: A2A Client Manager (15-17)
- **Stub (15)**: Create A2AClientManager class skeleton
- **TDD (16)**: Test client lifecycle, agent card caching, message sending
- **Impl (17)**: Implement full A2AClientManager with Vertex AI dialect adapter

### Phase 6: Async AgentRegistry (18-20)
- **Stub (18)**: Make registerAgent async (breaking change)
- **TDD (19)**: Test parallel registration with Promise.allSettled
- **Impl (20)**: Implement async registration + registerRemoteAgent method

### Phase 7: RemoteAgentInvocation (21-23)
- **Stub (21)**: Create RemoteAgentInvocation class skeleton
- **TDD (22)**: Test session state, abort handling, input-required states
- **Impl (23)**: Implement full RemoteAgentInvocation with SDK blocking mode

### Phase 8: Execution Dispatch (24-26)
- **Stub (24)**: Add AgentRegistry.createInvocation() factory method
- **TDD (25)**: Test dispatch logic for local vs remote agents
- **Impl (26)**: Implement factory with type-safe discriminated union narrowing

### Phase 9: TOML Integration (27-29)
- **Stub (27)**: Extend TOML schemas for remote agents
- **TDD (28)**: Test TOML parsing with kind inference
- **Impl (29)**: Implement remote agent TOML loading with Zod validation

### Phase 10: Integration & Migration (30-32)
- **Integration (30)**: Update all AgentRegistry callers to await async registerAgent
- **Migration (31)**: Update tests, fix type narrowing throughout codebase
- **E2E Testing (32)**: End-to-end tests with mock A2A server

### Phase 11: Final Verification (33)
- **Verification (33)**: Run all tests, verify all 62 requirements satisfied

## Critical Requirements

1. **NO NotYetImplemented** - Stubs return empty values of correct type
2. **Behavioral Tests Only** - Test actual data flows, not mocks
3. **Follow Design Doc** - Every component matches design.md architecture
4. **Breaking Changes Allowed** - This changes core types (AgentDefinition)
5. **Integration Required** - Must modify existing agent execution paths
6. **Multi-Provider Philosophy** - Auth providers pluggable, not hardcoded

## Files to Create

NEW files (all in `packages/core/src/agents/`):
- `a2a-client-manager.ts` — Client lifecycle manager (~400 LoC)
- `a2a-utils.ts` — Text extraction utilities (~100 LoC)
- `remote-invocation.ts` — RemoteAgentInvocation class (~250 LoC)
- `auth-providers.ts` — Auth provider interface + implementations (~400 LoC)

## Files to Modify

EXISTING files to UPDATE:
- `packages/core/src/agents/types.ts` — Add discriminated union types
- `packages/core/src/agents/registry.ts` — Make async, add remote agent support
- `packages/core/src/agents/executor.ts` — Type narrowing for LocalAgentDefinition
- `packages/core/src/agents/invocation.ts` — Type narrowing for LocalAgentDefinition
- `packages/core/src/config/config.ts` — Add auth provider getter/setter
- TOML loader (TBD based on existing TOML loading code)

## Migration Impact

**Breaking Changes:**
1. `AgentDefinition` becomes discriminated union — requires type narrowing throughout
2. `AgentRegistry.registerAgent()` becomes async — all callers must await
3. `AgentExecutor.create()` signature changes to accept only `LocalAgentDefinition`
4. `SubagentInvocation` constructor changes to accept only `LocalAgentDefinition`

**Affected Call Sites:**
- `AgentRegistry.loadBuiltInAgents()` — must become async
- `AgentRegistry.initialize()` — already async, no change
- Any tests calling `registerAgent` — must add `await`
- Any code directly instantiating `SubagentInvocation` — must switch to factory or add type guards

## Success Criteria

- [ ] All 62 EARS requirements satisfied (traceable in tests)
- [ ] Type system enforces local vs remote distinction at compile time
- [ ] Remote agents can be loaded from TOML files
- [ ] Agent card fetching works with auth providers
- [ ] Session state persists contextId/taskId correctly
- [ ] Abort signals cancel remote tasks
- [ ] input-required state returns error to LLM
- [ ] Vertex AI dialect adapter normalizes proto-JSON responses
- [ ] All tests pass with 80%+ mutation coverage
- [ ] No mock theater (behavioral tests only)
- [ ] Integration tests verify end-to-end flow
- [ ] Documentation updated with remote agent examples

## Non-Goals (Out of Scope)

Per design.md §8 Non-Goals:
- [ERROR] Agent directory scanning (no auto-discovery from filesystem)
- [ERROR] Agent versioning/updates
- [ERROR] Multi-turn input-required handling (MVP returns error)
- [ERROR] Streaming remote agent thoughts (responses are blocking)
- [ERROR] Custom A2A client configuration (uses SDK defaults)
- [ERROR] Advanced auth providers (only NoAuth + GoogleADC in MVP)
- [ERROR] Async task submission with explicit polling (MVP uses SDK blocking mode)

## Execution Notes for Coordinator

1. **Sequential Execution**: Execute phases 00a, 03, 03a, 04, 04a, 05, 05a, ... (NO SKIPPING)
2. **Type Safety**: Breaking changes to AgentDefinition require careful type narrowing
3. **Testing Philosophy**: RULES.md mandates behavioral tests, no mock theater
4. **Integration First**: Design.md emphasizes integration — features must connect to existing system
5. **Auth Provider Pattern**: Follows LLxprt's multi-provider philosophy (injectable, not hardcoded)

## Traceability Matrix

Every MUST requirement from requirements.md is implemented in a specific phase:

| Requirement | Phase | Files |
|-------------|-------|-------|
| A2A-DISC-001 (agent cards) | P15-17 | a2a-client-manager.ts |
| A2A-DISC-002 (error handling) | P18-20 | registry.ts |
| A2A-DISC-003 (caching) | P15-17 | a2a-client-manager.ts |
| A2A-REG-001 (discriminated union) | P03-05 | types.ts |
| A2A-REG-002 (async registry) | P18-20 | registry.ts |
| A2A-REG-006 (TOML loading) | P27-29 | toml-loader.ts |
| A2A-EXEC-001 (client manager delegation) | P21-23 | remote-invocation.ts |
| A2A-EXEC-002 (session state) | P21-23 | remote-invocation.ts |
| A2A-EXEC-003 (terminal state clearing) | P06-08 | a2a-utils.ts |
| A2A-EXEC-004 (text extraction) | P06-08 | a2a-utils.ts |
| A2A-EXEC-009 (input-required handling) | P21-23 | remote-invocation.ts |
| A2A-EXEC-010 (SDK blocking mode) | P21-23 | remote-invocation.ts |
| A2A-EXEC-011 (dispatch point) | P24-26 | registry.ts |
| A2A-EXEC-012 (Vertex AI adapter) | P15-17 | a2a-client-manager.ts |
| A2A-AUTH-001 (pluggable auth) | P09-11 | auth-providers.ts |
| A2A-AUTH-003 (Google ADC) | P12-14 | auth-providers.ts |
| A2A-CFG-001 (Config integration) | P09-11 | config.ts |
| A2A-CFG-003 (TOML Zod validation) | P27-29 | toml-loader.ts |

(Full mapping in requirements.md)

## Recovery Instructions

If you lose context mid-execution:

1. Read this file (00-overview.md) first
2. Read `design.md` for architecture
3. Read `requirements.md` for EARS specs
4. Check execution-tracker.md for last completed phase
5. Read the START HERE section in the phase file you're about to execute
6. Verify prerequisite phase artifacts exist before proceeding

## Dependencies

**NPM packages required (verify existence):**
- `@google/genai` (already exists)
- `@google/genai-a2a-sdk` (NEW - must add to package.json)
- `google-auth-library` (NEW - must add to package.json)
- `zod` (already exists)

**Internal dependencies:**
- Config class (DI pattern)
- ToolRegistry (tool management)
- MessageBus (confirmation system)
- BaseToolInvocation (tool invocation pattern)
- DebugLogger (logging infrastructure)
