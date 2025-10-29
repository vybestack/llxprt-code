# PLAN-20251029-RUNTIMELOADER

## Objective
Extract a reusable `AgentRuntimeLoader` (or similar) that builds all resources a non-interactive agent needs: `AgentRuntimeContext`, isolated `HistoryService`, provider/telemetry adapters, `ContentGenerator`, and tool registry view. Primary agent bootstrap and subagent spawn will both call this loader to obtain properly isolated runtimes.

## Preconditions
- AgentId plumbing (PLAN-20251029-AGENTID) ready or at least scaffolded.
- SubAgentScope tests available to extend.

## Plan (Test-First)

### P01 – Test Inventory
- Identify existing tests covering runtime creation (`SubAgentScope`, `createAgentRuntimeContext`, CLI runtime adapter).
- Define new tests verifying loader behaviour for:
  - Foreground (primary) runtime.
  - Subagent runtime (isolated history / settings).

### P02 – Red Tests: Loader Contract
- Add failing tests establishing loader API:
  - `loadAgentRuntime(profileSnapshot, options)` returns context + auxiliary services.
  - History service instances are unique per call.
  - Settings reflect profile inputs without mutating global config.

### P03 – Red Tests: Integration Hooks
- Update SubAgentScope tests to use loader; initially expect failure until implementation provided.
- Add CLI-level test ensuring primary agent bootstrap still works when switched to loader.

### P04 – Implementation (Green)
- Implement loader module that:
  - Accepts profile/subagent config data.
  - Constructs `AgentRuntimeState`, `SettingsService`, `ProviderRuntimeContext`, `ContentGenerator`, `HistoryService`, `AgentRuntimeContext`.
  - Returns bundle in a frozen structure.
- Refactor SubAgentScope and (optionally) CLI bootstrap to use loader.

### P05 – Verification
- Run targeted unit suites (`npm test -- SubAgentScope`, runtime loader tests) then full test suite/lint/typecheck.
- Manual check: start CLI and ensure chat still functions.

### P06 – Documentation
- Update developer docs describing runtime creation.
- Note new loader in project plans for future subagent work.

## Success Criteria
- Tests demonstrate loader returns isolated runtime components from profile data.
- SubAgentScope uses loader without relying on foreground config except for environment context (until later refactor).
- Primary agent initialisation unaffected.
