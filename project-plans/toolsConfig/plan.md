# PLAN-20250210-TOOLSCONFIG

## Objective
Add per-profile tool enable/disable configuration persisted in profile ephemerals, expose `/tools list|enable|disable` (plus interactive picker) that respects friendly names, and ensure providers/models only receive schemas for tools enabled in the active agent (primary or subagent). Implementation must follow a test-first workflow.

## Scope
- Extend profile model/manager and runtime settings so profiles round-trip `tools.allowed` / `tools.disabled` ephemerals.
- Update tool registry / scheduler surfaces to honour agent-specific tool availability and block execution of disabled tools.
- Enhance `/tools` CLI command with list/enable/disable subcommands and an interactive picker similar to `/auth`.
- Ensure subagent bootstrapping inherits tool restrictions from its configured profile.

## Out of Scope
- UI changes beyond tool menus/history indicators.
- Concurrent multi-subagent routing (handled separately).
- Persisting tool overrides outside of profiles (e.g., session-only toggles).

## Preconditions
1. Workspace clean and synced (done prior to plan creation).
2. Provider runtime isolation (STATELESS plans) already merged.
3. `/profile save|load` operational.

## Plan Phases (Test-First)

### P01 – Requirements & Test Inventory
- Document exact assertions for unit/integration tests:
  - ProfileManager loads/saves tool lists.
  - Runtime adapter publishes tool ephemerals.
  - Tool execution rejects disabled tools.
  - `/tools` CLI command behaves as expected (list/enable/disable + picker).
- Identify existing suites to extend (e.g., `profileManager.test.ts`, `tool-registry`, CLI command tests).

### P02 – Red Tests: Profile + Runtime plumbing
- Add failing unit tests covering:
  - `ProfileManager` round-tripping `tools.allowed` / `tools.disabled`.
  - Runtime adapter exposing settings to Config & SubAgentScope.
  - Subagent creation propagating tool ephemerals.

### P03 – Red Tests: CLI & Tool Enforcement
- Add failing tests for:
  - `toolsCommand` new subcommands & friendly-name resolution.
  - `CoreToolScheduler` / `executeToolCall` rejecting disabled tools.
  - Gemini tool schema filtering (mocked provider expectations).

### P04 – Implementation Pass (Green)
- Implement profile schema changes, settings propagation, registry filtering, CLI command behaviour, and enforcement logic until P02/P03 tests pass.
- Update documentation/help text as needed.

### P05 – Regression & Integration Tests
- Add/extend integration tests (`cli` or `core`) ensuring:
  - `/profile load` + `/tools list` reflect stored config.
  - Subagent task uses restricted tool set when invoking provider.

### P06 – Verification & Cleanup
- Run `npm run lint`, `npm run typecheck`, `npm test --workspaces`, targeted CLI integration tests.
- Document new profile schema keys in `docs/`.
- Prepare summary for change log.

## Risks & Mitigations
- **Tool alias collisions** – build normalization map in tests before implementation.
- **Provider schema mismatch** – cover with acceptance tests to prevent disabled tools leaking.
- **Cross-plan interference** – confine changes to profile-driven settings, avoid global side effects.

## Success Criteria
- All new tests green; existing suites unaffected.
- `/tools` command reflects enablement state and updates profile files.
- Disabled tools never reach providers or execute even if LLM requests them.
