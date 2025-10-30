# PLAN-20251029-SUBAGENTORCHESTRATION

## Objective
Build the light orchestration layer that the Task tool will use to spin up subagents. It should read subagent configs, resolve referenced profiles, assemble isolated runtime bundles via `loadAgentRuntime`, and merge behavioural prompts from config and task invocation before launching `SubAgentScope`. Keep orchestration local to the Task/subagent flow—no global registries.

## Preconditions
- Tool enforcement plan (PLAN-20251029-TOOLENFORCEMENT) completed so runtime bundles already respect profile tool filters.
- Subagent configs managed via `/subagent` command exist under `~/.llxprt/subagents/`.
- Profiles referenced by subagent configs are accessible via ProfileManager.

## Plan (Test-First)

### P01 – Test Inventory
- Review existing tests for `SubAgentScope`, `profileCommand`, and `SubagentManager`.
- Identify helpers to load mock profiles/subagents in tests.
- Outline integration test strategy for Task tool once orchestration is wired.

### P02 – Red Tests: Config Resolution
- Add tests ensuring orchestrator:
  - Loads subagent config by name and errors cleanly when missing.
  - Resolves profile name to snapshot, including tool filters and model settings.
  - Merges behavioural prompt from config with task-provided prompt segments.

### P03 – Red Tests: Runtime Assembly
- Add tests guaranteeing orchestrator:
  - Calls `loadAgentRuntime` with the resolved profile and returns isolated history/todo instances.
  - Generates a unique agent id for each subagent run and threads it through tool calls.
  - Provides cleanup/disposal when subagent completes.

### P04 – Implementation (Green)
- Introduce a `SubagentOrchestrator` (or similar) module that:
  - Consumes SubagentManager + ProfileManager.
  - Given a subagent name and task prompt inputs, loads config/profile, invokes `loadAgentRuntime`, and prepares the prompt bundle.
  - Launches `SubAgentScope` with the runtime + merged prompt, returning run results and agent id.
- Ensure orchestration lives alongside Task tooling without introducing global registries.

### P05 – Verification
- Run focused tests (`npm run test -- SubAgentScope AgentRuntimeLoader SubagentOrchestrator`) then full suite/lint/typecheck.
- Manual sanity: create a subagent via CLI, invoke Task tool with additional prompt text, confirm subagent run uses combined prompt and isolated history.

### P06 – Documentation
- Add developer notes describing orchestration flow (subagent config → profile → runtime → SubAgentScope).
- Update Task tool design docs to reference the new orchestrator.

## Success Criteria
- Task tooling can spin up subagents by name, with merged prompts and isolated runtime bundles, without leaking state to the primary agent.
- Agent ids from orchestration are passed through scheduler/events so downstream consumers can filter by id.
- Cleanup path disposes runtime resources once subagent execution ends.
