# Design Questions & Decisions

@plan:PLAN-20251027-STATELESS5.P01

1. **AgentRuntimeState Interface Contract**
   - Fields, validation rules, immutability strategy, event emission semantics.
   - **Resolution:** Immutable snapshot with synchronous change events carrying `{ runtimeId, changes, snapshot, timestamp }` per runtime-state pseudocode §3-5.
2. **ProviderRuntimeContext Integration**
   - How runtime state stored/retrieved alongside settings/config.
   - Lifecycle synchronization (activation/deactivation).
3. **Config Migration Strategy**
   - Sequence for removing provider/model/auth from `Config`.
   - Compatibility shims for legacy callers (if any).
4. **Slash Command & Flag Migration Scope**
   - Commands impacted, tests to update, UX changes (if any).
5. **HistoryService Ownership**
   - Foreground agent vs subagent lifecycle, injection strategy, reuse rules.
   - **Resolution:** CLI bootstrap supplies a single `HistoryService` per foreground runtime; GeminiClient must receive it as a constructor dependency and must never instantiate replacements (gemini-runtime pseudocode §1.3-1.5). Future subagents remain scoped to their own instances (documented non-goal).
6. **Telemetry/Event Hooks**
   - Runtime state change notifications, subscribers, performance considerations.
   - **Resolution:** GeminiClient subscribes synchronously to runtime state events to refresh telemetry context, while CLI diagnostics can opt-in to async dispatch via subscription options (runtime-state pseudocode §4, gemini-runtime §1.5).
7. **Error Handling & Messaging**
   - New error types, UX messaging updates for missing runtime context.

> Each item must be answered in Phase P01, with links to supporting analysis or pseudocode sections.
