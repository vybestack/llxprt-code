# PLAN-20251028-STATELESS6 Requirements (P04)

> @plan PLAN-20251028-STATELESS6.P04

## Overview

This document defines the hierarchical requirements for STATELESS6, which eliminates the remaining 27 Config touchpoints in GeminiChat and SubAgentScope (identified in P03 analysis). Each requirement includes implementation phase mapping and cross-references to P03 findings.

---

## REQ-STAT6-001: Stateless Runtime View Injection

**Goal**: Replace Config-based dependency injection with immutable AgentRuntimeContext.

**P03 Findings Reference**:
- 27 total Config touchpoints across GeminiChat (20) and SubAgentScope (7)
- 1 critical mutation at SubAgentScope line 609 (`setModel()`)
- 5 adapter interfaces required (Provider, Settings, Ephemeral, Telemetry, Tool)

### REQ-STAT6-001.1: AgentRuntimeContext Construction

**Description**: Factory functions must construct immutable runtime contexts without mutating shared Config.

**Implementation Phases**: P06 (scaffold), P07 (SubAgentScope integration)

**Acceptance Criteria**:
- `createAgentRuntimeContext(state, settings)` returns frozen object (`Object.isFrozen === true`)
- `createRuntimeContextFromConfig(config, runtimeState)` provides foreground adapter
- `createSubagentRuntimeContext(foregroundConfig, subagentProfile)` derives isolated context
- Constructor functions do NOT invoke Config mutator methods (`setModel`, `setProvider`, etc.)

**P03 Cross-Reference**:
- SubAgentScope line 609 mutation eliminated by pre-building context
- Architecture.md Section "Supporting Observations" #4 (constructor signature change)

### REQ-STAT6-001.2: GeminiChat Config Elimination

**Description**: GeminiChat must eliminate all 20 Config access points by using runtime context adapters.

**Implementation Phases**: P08 (unit implementation), P09 (integration verification)

**Acceptance Criteria**:
- GeminiChat constructor accepts `AgentRuntimeContext` instead of `Config`
- All 20 Config touchpoints replaced:
  - 4 provider manager calls → `runtimeContext.providerAdapter`
  - 4 settings service calls → `runtimeContext.settingsAdapter`
  - 5 ephemeral setting calls → `runtimeContext.getEphemeralSetting()`
  - 6 telemetry calls → `runtimeContext.telemetry.log*()`
  - 1 tool registry call → `runtimeContext.toolAdapter`
- No `this.config` field remains in GeminiChat class

**P03 Cross-Reference**:
- Integration-map.md Component Dependency Mapping (lines 8-16)
- Architecture.md GeminiChat Config Dependencies (lines 88-189)

### REQ-STAT6-001.3: Immutability Enforcement

**Description**: Runtime contexts must be deeply immutable and verifiable.

**Implementation Phases**: P06 (factory implementation), P10 (mutation testing)

**Acceptance Criteria**:
- `Object.isFrozen(runtimeContext) === true`
- All adapter interfaces throw on mutation attempts (e.g., `setActiveProvider()`)
- Ephemeral settings return frozen values
- Mutation testing kills mutants that remove `Object.freeze()` calls

**P03 Cross-Reference**:
- Architecture.md Supporting Observations #2 (immutability verification)
- Requirements REQ-STAT6-003.1 (isolation guarantee depends on immutability)

---

## REQ-STAT6-002: Runtime Data Completeness

**Goal**: Ensure runtime contexts expose all data currently sourced from Config.

**P03 Findings Reference**:
- AgentRuntimeState (STATELESS5) provides provider/model/auth data
- 5 ephemeral settings identified (compression-threshold, context-limit, etc.)
- 6 telemetry call sites require metadata enrichment

### REQ-STAT6-002.1: Core Runtime State Data

**Description**: Runtime context must expose immutable provider/model/auth metadata from AgentRuntimeState.

**Implementation Phases**: P06 (already satisfied by STATELESS5, verified in P09)

**Acceptance Criteria**:
- `runtimeContext.state` exposes: `provider`, `model`, `authType`, `baseUrl`, `authPayload`, `modelParams`
- All fields are immutable (frozen via STATELESS5 `Object.freeze()`)
- GeminiChat accesses state fields instead of Config getters

**P03 Cross-Reference**:
- Architecture.md "STATELESS5 Outcomes" (lines 6-15)
- Integration-map.md REQ-STAT6-002.1 row (line 340)

### REQ-STAT6-002.2: Ephemeral Settings Access

**Description**: Runtime context must provide read-only access to compression/context configuration.

**Implementation Phases**: P06 (interface definition), P08 (GeminiChat integration)

**Acceptance Criteria**:
- `runtimeContext.getEphemeralSetting(key)` supports:
  - `compression-threshold` (default: 0.6)
  - `compression-preserve-threshold` (default: 0.3)
  - `context-limit` (default: 60000)
  - `compression-min-age` (default: 4)
  - `maxOutputTokens` / `max-output-tokens` (default: 65536)
  - `tool-format-override` (optional)
- Fallback defaults match current Config behavior (GeminiChat lines 1392-1702)
- Settings snapshot taken at context creation (no dynamic Config queries)

**P03 Cross-Reference**:
- Architecture.md GeminiChat Config Dependencies Section 4 (lines 121-150)
- Integration-map.md Ephemeral Settings Interface (lines 100-137)

### REQ-STAT6-002.3: Telemetry Integration

**Description**: Runtime context must provide telemetry logging with enriched metadata.

**Implementation Phases**: P06 (interface), P08 (GeminiChat refactor), P09 (integration tests)

**Acceptance Criteria**:
- `runtimeContext.telemetry.logApiRequest(metadata, payload)` accepts:
  - `metadata: { sessionId, runtimeId, provider, model, authType, timestamp }`
  - `payload: string` (serialized request)
- Metadata automatically includes runtime state fields (no manual extraction in GeminiChat)
- Telemetry helper functions (`loggers.ts`) refactored to accept metadata instead of Config
- Foreground and subagent telemetry logs contain distinct `runtimeId` values

**P03 Cross-Reference**:
- Architecture.md Telemetry Integration (lines 151-171)
- Integration-map.md Telemetry Target Interface (lines 142-197)

---

## REQ-STAT6-003: Isolation & Concurrency

**Goal**: Guarantee runtime isolation between foreground and subagent contexts.

**P03 Findings Reference**:
- Line 609 mutation risk: `setModel()` overwrites foreground model
- Concurrency scenario: foreground query + subagent execution must not interfere
- Telemetry correlation: distinct runtime IDs required for trace analysis

### REQ-STAT6-003.1: Foreground Config Immutability

**Description**: Subagent execution must NOT mutate foreground Config state.

**Implementation Phases**: P07 (SubAgentScope refactor), P09 (integration verification)

**Acceptance Criteria**:
- `SubAgentScope.create()` does NOT invoke `config.setModel()`, `config.setProvider()`, or any mutator
- Spy-based tests verify zero Config mutation calls during subagent lifecycle
- Foreground `config.getModel()` remains unchanged after subagent execution completes
- Integration test: `it('should not mutate foreground config when creating subagent @plan PLAN-20251028-STATELESS6.P07 @requirement REQ-STAT6-003.1')`

**P03 Cross-Reference**:
- Architecture.md SubAgentScope Config Dependencies (lines 200-206)
- Integration-map.md Subagent Constructor Signature Change (lines 239-299)

### REQ-STAT6-003.2: History Service Isolation

**Description**: Each runtime context must provide an isolated HistoryService instance.

**Implementation Phases**: P07 (SubAgentScope), P09 (integration tests)

**Acceptance Criteria**:
- `runtimeContext.history` returns unique HistoryService per context
- Foreground and subagent history objects are different references
- History service mutations (adding messages) do not affect other contexts
- Test: `it('should allocate isolated history services @plan PLAN-20251028-STATELESS6.P07 @requirement REQ-STAT6-003.2')`

**P03 Cross-Reference**:
- Architecture.md Supporting Observations #5 (history service coupling)
- Test-strategy.md P07 SubAgentScope Behaviour (lines 24-31)

### REQ-STAT6-003.3: Telemetry Runtime Correlation

**Description**: Telemetry logs must distinguish foreground vs subagent events via runtime IDs.

**Implementation Phases**: P08 (telemetry refactor), P09 (integration verification)

**Acceptance Criteria**:
- `runtimeContext.runtimeId` is unique per context (UUID or session-derived)
- All telemetry events (request/response/error) include `runtimeId` in metadata
- Integration test validates distinct runtime IDs in concurrent execution
- Test: `it('should tag telemetry with runtime ids @plan PLAN-20251028-STATELESS6.P09 @requirement REQ-STAT6-003.3')`

**P03 Cross-Reference**:
- Test-strategy.md Integration Telemetry Sample (lines 61-70)
- Architecture.md Telemetry/Tool Logging Dependencies (lines 248-278)

---

## Requirements Traceability Matrix

> @plan PLAN-20251028-STATELESS6.P04

| Requirement | P03 Finding | Implementation Phase | Verification Phase | Test Cases |
|-------------|-------------|---------------------|-------------------|-----------|
| REQ-STAT6-001.1 | Line 609 mutation, 27 touchpoints | P06, P07 | P07a, P09a | Unit: factory immutability, Spy: no setModel calls |
| REQ-STAT6-001.2 | 20 Config calls in GeminiChat | P08 | P08a, P09a | Unit: adapter usage, Integration: no Config field |
| REQ-STAT6-001.3 | Immutability gaps | P06, P10 | P10a | Mutation: freeze removal, Property: Object.isFrozen |
| REQ-STAT6-002.1 | STATELESS5 state fields | P06 (inherited) | P09a | Integration: state field access |
| REQ-STAT6-002.2 | 5 ephemeral calls | P06, P08 | P08a, P09a | Unit: threshold getters, Property: round-trip |
| REQ-STAT6-002.3 | 6 telemetry calls | P06, P08 | P09a | Unit: metadata enrichment, Integration: log capture |
| REQ-STAT6-003.1 | SubAgentScope setModel | P07 | P07a, P09a | Spy: Config mutators, Integration: foreground model unchanged |
| REQ-STAT6-003.2 | Shared history risk | P07 | P07a, P09a | Unit: history reference inequality |
| REQ-STAT6-003.3 | Telemetry ambiguity | P08, P09 | P09a | Integration: distinct runtimeId values |

---

## Phase Mapping Summary

> @plan PLAN-20251028-STATELESS6.P04

- **P06 (Scaffold)**: REQ-STAT6-001.1, REQ-STAT6-001.3, REQ-STAT6-002.1, REQ-STAT6-002.2, REQ-STAT6-002.3
- **P07 (SubAgentScope)**: REQ-STAT6-001.1, REQ-STAT6-003.1, REQ-STAT6-003.2
- **P08 (GeminiChat)**: REQ-STAT6-001.2, REQ-STAT6-002.2, REQ-STAT6-002.3, REQ-STAT6-003.3
- **P09 (Integration)**: All requirements (end-to-end verification)
- **P10 (Mutation)**: REQ-STAT6-001.3 (immutability enforcement)

> Validate coverage and traceability in Phase P04a.
