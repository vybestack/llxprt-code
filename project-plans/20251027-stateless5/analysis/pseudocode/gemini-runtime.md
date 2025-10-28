# Gemini Runtime Pseudocode

@requirement:REQ-STAT5-003
@requirement:REQ-STAT5-004
@requirement:REQ-STAT5-005

1. GeminiClient initialization
   1.1 Constructor accepts `config`, `AgentRuntimeState`, `HistoryService`.
   1.2 Store runtime state reference; do not read provider/model from config.
   1.3 Require caller to supply a `HistoryService` created during CLI bootstrap; throw descriptive error if missing.
   1.4 Store provided history service reference; never instantiate a new HistoryService internally.
   1.5 Call `subscribeToAgentRuntimeState(runtimeId, handler)` to update telemetry metadata (per REQ-STAT5-003.2).
2. Start chat sequence
   2.1 When `startChat()` called, read model/provider/baseUrl from runtime state.
   2.2 Validate runtime state has required fields; else throw descriptive error.
   2.3 Build `GeminiChatContext` containing runtime state snapshot + history service.
   2.4 Instantiate `GeminiChat` with context object (no Config reference).
3. Send message flow
   3.1 Normalize user input and tool data.
   3.2 Pass runtime context to GeminiChat `send` method (includes model, auth, baseUrl, metadata).
   3.3 After response, if runtime state changed (e.g., provider switch), request updated snapshot; telemetry hook already subscribed via Step 1.5.
4. GeminiChat behavior
   4.1 Store runtime context and history service provided.
   4.2 For each provider call, construct payload using runtime context (model/auth/baseUrl/tool settings).
   4.3 Update history service with results; do not mutate runtime state.
   4.4 Surface telemetry using runtime metadata (runtimeId, provider key).
5. CLI integration
   5.1 CLI runtime adapter updates runtime state (Phase 08) which triggers GeminiClient subscriber.
   5.2 Diagnostics commands read runtime state snapshot via adapter.
6. Error handling
   6.1 Missing runtime state → throw `MissingRuntimeStateError` with hints to activate context.
   6.2 Inconsistent provider/model (e.g., provider change mid-send) → request new runtime state snapshot before continuing.
7. Subagent hook (non-goal placeholder)
   7.1 Document that Task tool will supply its own runtime state + history service in future plan.

> Ensure steps reference runtime state pseudocode lines for validation during implementation (Phase 10).
