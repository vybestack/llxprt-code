# PLAN-20251028-STATELESS6 Requirements (P04)

> @plan PLAN-20251028-STATELESS6.P04

- **REQ-STAT6-001 – Stateless runtime view injection**
  - **REQ-STAT6-001.1** – `SubAgentScope.create` must construct and pass a `GeminiRuntimeView` without mutating shared `Config`.
  - **REQ-STAT6-001.2** – `GeminiChat` constructor must accept `GeminiRuntimeView` and eliminate direct `Config` access.
  - **REQ-STAT6-001.3** – `GeminiRuntimeView` instances must be immutable (`Object.isFrozen === true`).
- **REQ-STAT6-002 – Runtime data completeness**
  - **REQ-STAT6-002.1** – Runtime view must expose provider/model/auth/modelParams/header data sourced from `AgentRuntimeState`.
  - **REQ-STAT6-002.2** – Runtime view must expose read-only ephemerals (compression thresholds, context limit, preserve threshold, tool format override).
  - **REQ-STAT6-002.3** – Runtime view must supply telemetry logging hooks enriched with runtime metadata.
- **REQ-STAT6-003 – Isolation & concurrency**
  - **REQ-STAT6-003.1** – Subagent execution must leave foreground Config (e.g., `getModel()`) unchanged.
  - **REQ-STAT6-003.2** – Runtime views must provide isolated HistoryService instances per agent.
  - **REQ-STAT6-003.3** – Concurrent foreground + subagent chats must emit telemetry records containing distinct runtime IDs.

> Validate coverage and traceability in Phase P04a.
