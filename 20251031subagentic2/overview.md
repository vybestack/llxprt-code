# Subagent Tool Flow Refactor Overview

## Goal

Bring interactive subagents back into the same tool-execution pipeline as the foreground agent so every tool request is visible, confirmable, and accounted for. Reserve the bespoke non-interactive loop for truly headless runs only.

## Issues Today

- `Task` always triggers `SubAgentScope.runNonInteractive`, bypassing `Turn` + `CoreToolScheduler`.
- `GemmaToolCallParser` is doing double duty. It was meant for provider-side parsing, but now also feeds the subagent’s direct `executeToolCall` path. That path produces malformed payloads and hides tool calls from the UI.
- User cannot approve/deny subagent tools, and telemetry/todo tracking miss those actions.

## Target Direction

1. Introduce an interactive runner inside `SubAgentScope` that:
   - Builds a `Turn` with the subagent’s `GeminiChat` and `agentId`.
   - Feeds streamed events into a `CoreToolScheduler` instance so the UI can confirm, diff, and track the tool call.
   - Relies on provider parsing (e.g., `parseResponsesStream`) to produce canonical tool events—no extra text parsing.

2. Update `Task`/`SubagentOrchestrator` to choose interactive vs non-interactive mode based on configuration (e.g., auto for interactive CLI, explicit flag for headless runs).

3. Keep `runNonInteractive` for true batch/scripting scenarios only. Make its role obvious in the API to avoid reusing it accidentally.

4. Propagate `agentId` everywhere tool calls touch (scheduler, trackers, telemetry) so foreground and subagents share infrastructure cleanly.

5. Remove redundant parsing from the interactive path and fix tool argument building inconsistencies.

## Next Steps

- Audit the existing `Client` → `Turn` → `CoreToolScheduler` pipeline to confirm what’s necessary to spin up a subagent scheduler instance.
- Sketch an API for `SubAgentScope.runInteractive` and how it exposes the same events the UI expects today.
- Decide where the headless/non-interactive flag comes from (Task tool params? profile config? CLI options?).
- Plan incremental migration: wire up interactive path, keep non-interactive fallback, tighten parser/test coverage.
- Prepare UI changes (if any) to differentiate subagent calls visually yet keep them in the queue.
