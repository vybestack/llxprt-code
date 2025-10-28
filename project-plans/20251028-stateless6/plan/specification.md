# STATELESS6 Specification (P02)

> @plan PLAN-20251028-STATELESS6.P02

## 1. Background

### STATELESS5 Outcomes

PLAN-20251027-STATELESS5 (completed 2025-10-28) established runtime state as source of truth for foreground agent execution:

- **AgentRuntimeState introduced**: Immutable container for provider/model/auth/baseUrl/params, validated via Object.freeze
- **89 Config coupling touchpoints eliminated**: Direct Config reads removed from GeminiClient/GeminiChat foreground paths
- **CLI runtime adapter**: `agentRuntimeAdapter.ts` bridges Config to AgentRuntimeState for foreground flows
- **Production ready**: 4592 tests passing, 19 regression guards, all quality gates green

### Observed Issues Motivating STATELESS6

Despite STATELESS5 success, **SubAgentScope and GeminiChat retain Config dependencies** preventing true isolation:

1. **Shared State Mutation**: `this.runtimeContext.setModel(this.modelConfig.model)` in SubAgentScope (line ~609) mutates shared Config object, overriding foreground agent's model selection. This violates isolation invariant.

2. **Ephemeral Settings Coupling**: GeminiChat accesses `config.getEphemeralSetting*()` for compression thresholds (lines 1392, 1396, 1575, 1700), context limits, preserve thresholds. These reads prevent runtime-scoped configuration.

3. **Telemetry Logger Dependency**: `logApiRequest/Response/Error(this.config, ...)` (lines 514, 538, 672) requires Config instance for metadata extraction, coupling telemetry to shared state.

4. **Provider Manager Access**: `config.getProviderManager?.()` (lines 561, 1177, 1775, 2480) used for diagnostics and tool registry lookups, preventing provider isolation.

**Root cause**: GeminiChat and SubAgentScope operate on `Config` (mutable, globally shared) rather than runtime-scoped immutable context. **STATELESS6 goal**: Introduce AgentRuntimeContext wrapper eliminating these touchpoints.

## 2. Glossary

See **analysis/architecture.md#Glossary** for detailed definitions. Summary:

- **AgentRuntimeContext**: Immutable wrapper extending AgentRuntimeState with ephemeral settings, telemetry target, and provider adapters
- **Ephemerals**: Runtime-scoped compression/context settings (compressionThreshold, contextLimit, preserveThreshold, etc.)
- **TelemetryTarget**: Logging interface enriched with runtime metadata, decoupled from Config
- **Runtime View Adapter**: Temporary helper (`createRuntimeViewFromConfig`) for foreground Config-to-context bridge (until STATELESS7)

## 3. Architectural Decisions

> @plan PLAN-20251028-STATELESS6.P02

### AD-STAT6-01: Runtime View Wrapper Pattern

**Decision**: Introduce `AgentRuntimeContext` as wrapper around `AgentRuntimeState` providing additional read-only adapters, rather than extending AgentRuntimeState directly.

**Rationale**:
- AgentRuntimeState (from STATELESS5) is core immutable container; extending it would pollute runtime state with adapter concerns
- Wrapper pattern allows composing multiple adapters (ephemeral settings, telemetry, provider diagnostics) without modifying base state
- Enables separate testing of adapter logic vs. core runtime state behavior
- Maintains compatibility: foreground adapter creates wrapper from existing state; subagents construct fresh wrappers per profile

**Alternatives rejected**:
- Extending AgentRuntimeState: Violates single responsibility; mixes data container with adapter logic
- Passing separate adapter arguments: Increases GeminiChat/SubAgentScope constructor complexity; no immutability guarantee across arguments

### AD-STAT6-02: Immutability Enforcement

**Decision**: Apply `Object.freeze(runtimeContext)` to AgentRuntimeContext instances and verify via regression test (`Object.isFrozen(ctx) === true`).

**Rationale**:
- Prevents accidental mutation by consumers (e.g., `runtimeContext.model = ...` fails silently or throws in strict mode)
- Aligns with STATELESS5 immutability guarantees for AgentRuntimeState
- Enables safe sharing across concurrent operations (foreground + subagent) without defensive copying
- Runtime verification catches regressions where new properties added without freeze

**Alternatives rejected**:
- Readonly TypeScript modifiers only: Compile-time only; no runtime guarantee against JavaScript mutation
- Defensive getters: Performance overhead; doesn't prevent mutation of returned objects

### AD-STAT6-03: Telemetry Abstraction via Metadata

**Decision**: TelemetryTarget interface accepts metadata object `{ runtimeId, provider, model, timestamp }` instead of Config instance. Implementation delegates to existing `logApiRequest/Response/Error` helpers but extracts metadata from runtime context.

**Rationale**:
- Decouples telemetry logging from Config dependency
- Enables runtime-scoped telemetry enrichment (subagent logs tagged with subagent runtimeId)
- Preserves existing telemetry infrastructure; no rewrite of logging sinks
- Facilitates future telemetry improvements (correlation IDs, trace context) without Config changes

**Alternatives rejected**:
- Passing Config to telemetry methods: Perpetuates Config coupling; violates STATELESS6 isolation goal
- Complete telemetry rewrite: Out of scope; unnecessary for achieving isolation

### AD-STAT6-04: Config Adapter for Foreground Transitional Path

**Decision**: Provide `createRuntimeViewFromConfig(config, runtimeState)` helper constructing AgentRuntimeContext from existing Config. Used ONLY by foreground agent flows until STATELESS7 eliminates Config entirely. Subagent flows construct context directly from profile.

**Rationale**:
- Minimizes foreground agent disruption; CLI runtime adapter remains compatible
- Isolates STATELESS6 scope to subagent + GeminiChat refactor; defers full Config elimination to follow-on plan
- Clear migration path: foreground uses adapter, subagents use direct construction
- Adapter can be deleted cleanly once STATELESS7 completes

**Alternatives rejected**:
- Rewriting foreground CLI runtime now: Out of scope; increases risk and timeline
- Using adapter for subagents: Defeats purpose; subagents must not depend on shared Config

### AD-STAT6-05: Ephemeral Settings as Read-Only View

**Decision**: AgentRuntimeContext exposes ephemeral settings (compressionThreshold, contextLimit, etc.) via read-only getters sourced from profile/settings snapshot at context creation time. No runtime mutation allowed.

**Rationale**:
- Prevents mid-execution setting changes affecting agent behavior unpredictably
- Aligns with immutability guarantee; ephemeral settings frozen at context construction
- Simplifies reasoning: agent behavior determined by context at chat start, not dynamic Config state
- Enables testing with explicit ephemeral values; no hidden Config dependencies

**Alternatives rejected**:
- Live Config queries: Couples to shared state; violates isolation
- Mutable ephemeral setters: Breaks immutability; requires synchronization for concurrent access

## 4. Integration Points

> @plan PLAN-20251028-STATELESS6.P02

### Consumers

**SubAgentScope.create** (`packages/core/src/core/subagent.ts`)
- **Current**: Constructs with `runtimeContext: Config`, calls `this.runtimeContext.setModel(...)` mutating shared Config
- **After STATELESS6**: Constructs `AgentRuntimeContext` from subagent profile (provider/model/auth/ephemerals), passes to GeminiChat
- **Integration**: SubAgentScope constructor signature changes from `(config: Config, ...)` to `(runtimeContext: AgentRuntimeContext, ...)`

**GeminiChat** (`packages/core/src/core/geminiChat.ts`)
- **Current**: Accepts `config: Config`, reads provider/model/auth via `config.getProviderManager?.()`, ephemeral settings via `config.getEphemeralSetting*()`
- **After STATELESS6**: Accepts `runtimeContext: AgentRuntimeContext`, accesses all data via context getters
- **Integration**: Constructor signature `GeminiChat(config, historyService, ...)` changes to `GeminiChat(runtimeContext, historyService, ...)`; Config becomes type-only import

**Foreground Agent Helper** (`packages/cli/src/runtime/agentRuntimeAdapter.ts`)
- **Current**: Creates AgentRuntimeState from Config, passes to GeminiClient
- **After STATELESS6**: Additionally constructs AgentRuntimeContext via `createRuntimeViewFromConfig(config, runtimeState)`, passes to GeminiClient
- **Integration**: Temporary adapter method added; removed in STATELESS7 when Config eliminated from foreground path

### Replacements

**Remove Config Ephemeral Reads** (`geminiChat.ts` lines 1392, 1396, 1575, 1700)
- Replace: `this.config.getEphemeralSetting('compressionThreshold')` → `this.runtimeContext.getEphemeralSetting('compressionThreshold')`
- Replace: `this.config.getEphemeralSettingNumber(...)` → `this.runtimeContext.getEphemeralSetting(...)`
- Replace: `this.config.getEphemeralSettingBoolean(...)` → `this.runtimeContext.getEphemeralSetting(...)`

**Remove Config Provider Manager Access** (`geminiChat.ts` lines 561, 1177, 1775, 2480)
- Replace: `this.config.getProviderManager?.()` → `this.runtimeContext.getProviderDiagnostics()` (adapter method exposing tool registry, diagnostics without Config)

**Remove Config Telemetry Coupling** (`geminiChat.ts` lines 514, 538, 672)
- Replace: `logApiRequest(this.config, ...)` → `this.runtimeContext.telemetryTarget.logApiRequest({ runtimeId, provider, model, ... }, ...)`
- Replace: `logApiResponse(this.config, ...)` → `this.runtimeContext.telemetryTarget.logApiResponse(...)`
- Replace: `logApiError(this.config, ...)` → `this.runtimeContext.telemetryTarget.logApiError(...)`

**Delete Shared State Mutation** (`subagent.ts` line ~609)
- Remove: `this.runtimeContext.setModel(this.modelConfig.model);` – no longer needed; model selection immutable in AgentRuntimeContext

### Access Paths

**User Perspective**: No user-visible changes. CLI commands (`/provider`, `/model`, slash commands, `--profile-load` flag) continue to work identically. Runtime view wiring is internal refactor.

**Developer Perspective**:
- Foreground agent: CLI runtime adapter constructs AgentRuntimeContext via `createRuntimeViewFromConfig`; GeminiClient/GeminiChat receive context instead of Config
- Subagent flows: SubAgentScope constructs AgentRuntimeContext directly from profile; no Config dependency

### Migration Strategy

**Phase 1 (STATELESS6 - this plan)**:
1. Implement AgentRuntimeContext wrapper with ephemeral settings, telemetry target, provider adapters
2. Refactor SubAgentScope to construct and pass AgentRuntimeContext (no Config mutation)
3. Refactor GeminiChat to accept AgentRuntimeContext, eliminate Config reads
4. Implement `createRuntimeViewFromConfig` adapter for foreground path
5. Update CLI runtime adapter to use foreground adapter
6. Verify: Subagent + foreground isolation tests pass, no Config mutation

**Phase 2 (STATELESS7 - future plan)**:
1. Eliminate Config from foreground CLI runtime flows
2. Remove `createRuntimeViewFromConfig` adapter
3. Fully decouple all runtime operations from Config singleton

## 5. Scope Exclusions

> @plan PLAN-20251028-STATELESS6.P02

**Out of Scope for STATELESS6**:

1. **Foreground Config Elimination**: Foreground agent continues using Config via adapter (`createRuntimeViewFromConfig`). Full Config removal deferred to STATELESS7.

2. **HistoryService Refactor**: HistoryService remains injectable per GeminiChat instance. No changes to history persistence, compression, or retrieval logic. Isolation concerns addressed by per-agent HistoryService instances (already established in STATELESS5).

3. **Provider Implementations**: No changes to provider SDK clients (GeminiProvider, OpenAIProvider, etc.). Providers already stateless (STATELESS4 completion). This plan focuses on consumer (GeminiChat/SubAgentScope) refactor.

4. **Settings Service Changes**: Settings service (`getSettingsService()`) access patterns unchanged. AgentRuntimeContext sources ephemeral settings from snapshot at construction; runtime changes to settings do NOT affect active agents.

5. **UI/Diagnostics Display Logic**: Diagnostics UI (`/diagnostics`, status bar) continues sourcing data from existing mechanisms. Runtime view exposes diagnostic snapshot via adapter methods; no UI component refactors required.

6. **Content Generator Config**: ContentGenerator construction (used by SubAgentScope) currently receives Config-like object. Temporary adapter maintains compatibility; full decoupling deferred to STATELESS7.

7. **Tool Execution Context**: Tool invocation within SubAgentScope/GeminiChat receives runtime context for telemetry but does not change tool API signatures. Tool SDK refactors out of scope.

## 6. Acceptance Criteria

> @plan PLAN-20251028-STATELESS6.P02

### AC-STAT6-01: Runtime View Construction (REQ-STAT6-001)

**Criteria**:
- [ ] AgentRuntimeContext instances created via constructor accepting `{ runtimeState, ephemeralSettings, telemetryTarget, providerAdapters }`
- [ ] `Object.isFrozen(runtimeContext) === true` for all constructed instances
- [ ] SubAgentScope constructs AgentRuntimeContext from subagent profile without Config dependency
- [ ] Foreground adapter `createRuntimeViewFromConfig` produces valid AgentRuntimeContext from Config + AgentRuntimeState

**Verification**:
- Unit test: Construct AgentRuntimeContext, verify immutability (Object.isFrozen)
- Unit test: SubAgentScope.create builds context with explicit provider/model/auth/ephemerals from profile
- Unit test: Foreground adapter produces context matching Config snapshot
- Regression test: Attempt mutation throws TypeError or fails silently (strict mode check)

### AC-STAT6-02: Config Elimination in GeminiChat (REQ-STAT6-001, REQ-STAT6-002)

**Criteria**:
- [ ] GeminiChat constructor signature: `constructor(runtimeContext: AgentRuntimeContext, historyService: HistoryService, ...)`
- [ ] No `this.config.getEphemeralSetting*()` calls in geminiChat.ts (replaced with `this.runtimeContext.getEphemeralSetting()`)
- [ ] No `this.config.getProviderManager?.()` calls in geminiChat.ts (replaced with `this.runtimeContext.getProviderDiagnostics()`)
- [ ] No `logApi*(this.config, ...)` calls in geminiChat.ts (replaced with `this.runtimeContext.telemetryTarget.logApi*(...)`)
- [ ] Config import in geminiChat.ts is type-only: `import type { Config } from ...`

**Verification**:
- Static analysis: `grep -n "this\.config\." packages/core/src/core/geminiChat.ts` returns no runtime reads (only type annotations)
- Unit test: GeminiChat constructed with AgentRuntimeContext, sends message successfully
- Unit test: Ephemeral settings (compressionThreshold, contextLimit) sourced from runtime context, not Config
- Unit test: Telemetry calls enriched with runtime metadata (runtimeId, provider, model)

### AC-STAT6-03: SubAgentScope Mutation Elimination (REQ-STAT6-001, REQ-STAT6-003)

**Criteria**:
- [ ] `this.runtimeContext.setModel(...)` removed from subagent.ts (line ~609)
- [ ] SubAgentScope constructor: `constructor(runtimeContext: AgentRuntimeContext, ...)`
- [ ] SubAgentScope passes immutable runtime context to GeminiChat; no Config reference
- [ ] Subagent execution leaves foreground Config (`getModel()`) unchanged

**Verification**:
- Static analysis: `grep -n "\.setModel" packages/core/src/core/subagent.ts` returns no matches
- Unit test: SubAgentScope created with model="subagent-model", verify runtimeContext.model === "subagent-model"
- Integration test: Foreground agent model="foreground-model", launch subagent with model="subagent-model", verify foreground Config.getModel() === "foreground-model" after subagent execution

### AC-STAT6-04: Runtime Data Completeness (REQ-STAT6-002)

**Criteria**:
- [ ] AgentRuntimeContext exposes: provider, model, auth, baseUrl, params (from AgentRuntimeState)
- [ ] AgentRuntimeContext exposes: compressionEnabled, compressionThreshold, compressionMinAge, contextLimit, preserveThreshold, toolFormatOverride (ephemeral settings)
- [ ] AgentRuntimeContext.telemetryTarget provides: logApiRequest, logApiResponse, logApiError methods
- [ ] AgentRuntimeContext.getProviderDiagnostics() returns tool registry metadata without Config

**Verification**:
- Unit test: Construct AgentRuntimeContext with explicit ephemerals, verify getEphemeralSetting() returns correct values
- Unit test: TelemetryTarget.logApiRequest called with metadata containing runtimeId/provider/model
- Unit test: getProviderDiagnostics() returns diagnostic snapshot (e.g., available tools, provider version)

### AC-STAT6-05: Isolation & Concurrency (REQ-STAT6-003)

**Criteria**:
- [ ] Foreground agent runtime context and subagent runtime context have distinct runtimeId values
- [ ] Concurrent foreground + subagent execution produces telemetry records with distinct runtimeId tags
- [ ] HistoryService instances isolated per agent (foreground vs. subagent have separate history stores)
- [ ] Subagent execution does NOT mutate foreground Config (verified via Config.getModel(), Config.getProvider() snapshots before/after)

**Verification**:
- Integration test: Start foreground chat (model="foreground"), emit message, start subagent (model="subagent"), emit message, verify telemetry logs contain two distinct runtimeId values
- Integration test: Foreground Config snapshot before subagent execution === Config snapshot after subagent execution (provider/model/auth unchanged)
- Unit test: Foreground HistoryService.getMessages() excludes subagent messages; SubAgentScope history excludes foreground messages

## 7. Evaluation Checklist

> @plan PLAN-20251028-STATELESS6.P02

This checklist maps requirements (REQ-STAT6-001, REQ-STAT6-002, REQ-STAT6-003) to verification outcomes. Use during Phase P02a verification.

| Requirement | Verification Item | Pass Criteria | Status |
|-------------|-------------------|---------------|--------|
| **REQ-STAT6-001.1** | SubAgentScope constructs AgentRuntimeContext without Config mutation | `grep -n "\.setModel" subagent.ts` returns no matches | ⬜ Pending |
| **REQ-STAT6-001.2** | GeminiChat accepts AgentRuntimeContext, eliminates Config access | Static analysis: no `this.config.get*()` runtime calls | ⬜ Pending |
| **REQ-STAT6-001.3** | AgentRuntimeContext immutability enforced | `Object.isFrozen(runtimeContext) === true` | ⬜ Pending |
| **REQ-STAT6-002.1** | Runtime view exposes provider/model/auth/params | Unit test: runtimeContext getters return expected values | ⬜ Pending |
| **REQ-STAT6-002.2** | Runtime view exposes read-only ephemerals | Unit test: getEphemeralSetting() returns compressionThreshold, contextLimit, etc. | ⬜ Pending |
| **REQ-STAT6-002.3** | Runtime view supplies telemetry hooks | Unit test: telemetryTarget.logApiRequest called with runtimeId metadata | ⬜ Pending |
| **REQ-STAT6-003.1** | Subagent execution leaves foreground Config unchanged | Integration test: Config.getModel() before === after subagent | ⬜ Pending |
| **REQ-STAT6-003.2** | Isolated HistoryService per agent | Unit test: foreground history != subagent history | ⬜ Pending |
| **REQ-STAT6-003.3** | Concurrent execution emits distinct telemetry runtimeIds | Integration test: telemetry logs contain foreground runtimeId ≠ subagent runtimeId | ⬜ Pending |

**Evaluation Instructions**:
1. Execute verification tests (unit, integration, static analysis)
2. Update "Status" column: ✅ Pass, ❌ Fail, ⬜ Pending
3. Document failures in phase verification artifacts (P02a, P05a, etc.)
4. Block progression to implementation phases if any item fails

## 8. Stakeholder Sign-off

> @plan PLAN-20251028-STATELESS6.P02

**Specification Approval**:
- **Author**: Claude (PLAN-20251028-STATELESS6.P02 execution)
- **Date**: 2025-10-28
- **Status**: ✅ **APPROVED** (self-sign-off)

**Scope Confirmation**:
- Background context (STATELESS5 outcomes) documented: ✅
- Glossary entries complete: ✅
- Architectural decisions rationale provided: ✅
- Integration points mapped: ✅
- Scope exclusions explicit: ✅
- Acceptance criteria traceable to requirements: ✅
- Evaluation checklist ready for P02a verification: ✅

**Notes**:
- Specification aligns with requirements (REQ-STAT6-001, REQ-STAT6-002, REQ-STAT6-003) defined in requirements.md
- Cross-references to architecture.md glossary maintained
- Follow-on plan (STATELESS7) scope boundary clarified
- No open questions; ready for Phase P03 (deep analysis)
