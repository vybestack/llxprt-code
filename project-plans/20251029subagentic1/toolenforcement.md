# PLAN-20251029-TOOLENFORCEMENT

## Objective
Enforce per-agent tool allow/deny lists that are already stored in profile ephemerals so each runtime bundle (primary or subagent) only advertises and executes tools permitted for its agent. Ensure Gemini provider schemas, local tool execution, and CLI surfaces stay in sync with these filters without introducing global registries.

## Preconditions
- AgentId plumbing complete (PLAN-20251029-AGENTID).
- Subagent runtime loader available (PLAN-20251029-RUNTIMELOADER).
- `/tools` command persists `tools.allowed` and `tools.disabled` in active profiles (already implemented).

## Plan (Test-First)

### P01 – Test Inventory
- Identify coverage in:
  - `SubAgentScope` tests touching tool lists.
  - `GeminiChat` / provider factory tests that verify tool schemas.
  - CLI `/tools` command tests to confirm persisted lists.
- Document helper utilities for building `ToolRegistry` snapshots in tests.

### P02 – Red Tests: Runtime Bundles
- Add unit tests for `loadAgentRuntime` verifying:
  - When `tools.allowed` is set, resulting tool view only exposes those tools.
  - When `tools.disabled` lists items, they are removed from execution paths and provider schemas.
  - Defaults (empty lists) preserve current behaviour.

### P03 – Red Tests: Provider Schema Filtering
- Create regression tests for `GeminiChat` (or provider adapters) asserting:
  - `FunctionDeclaration[]` sent to providers respects agent-specific tool filters.
  - Disallowed tools are not sent, even if the registry contains them.

### P04 – Implementation (Green)
- Enhance `loadAgentRuntime` to read `tools.allowed` / `tools.disabled` from the supplied profile ephemerals and build a filtered ToolRegistry view.
- Update provider schema generation (e.g., in `GeminiChat` or adapter layer) to use the filtered view.
- Adjust local tool execution pipeline (scheduler/executor) to reject disallowed tools with clear errors.

### P05 – Verification
- Run targeted suites covering loader, scheduler, Gemini chat (`npm run test --workspaces -- AgentRuntimeLoader coreToolScheduler GeminiChat`).
- Run full `npm run test`, `npm run lint`, `npm run typecheck`.
- Manual sanity: use `/tools disable` on a tool, confirm the CLI no longer lists it as executable and provider calls omit it.

### P06 – Documentation
- Update developer docs describing tool filtering in runtime bundles.
- Mention enforcement flow in release notes / migration docs if behaviour changes.

## Success Criteria
- Per-agent runtime bundle only exposes allowed tools and hides disabled ones.
- Provider function declarations align with the filtered tool set.
- CLI `/tools` command and runtime enforcement remain consistent (no drift between stored lists and runtime behaviour).
