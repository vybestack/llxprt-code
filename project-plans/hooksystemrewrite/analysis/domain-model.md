# Domain Model

## Contexts
1. Configuration context: enableHooks gating and HookSystem ownership.
2. Infrastructure context: HookRegistry/HookPlanner/HookRunner/HookAggregator.
3. Event handling context: HookEventHandler input construction and orchestration.
4. Trigger context: event-specific trigger contracts and result mapping.
5. Caller context: coreToolScheduler and geminiChat output application semantics.
6. Compatibility context: script protocol, output fields, merged requirement handling.

## Core Entities
- Config
- HookSystem
- HookEventHandler
- HookExecutionPlan and HookExecutionResult
- DefaultHookOutput and event-specific outputs
- Tool pipeline result adapter
- Model pipeline result adapter

## State Model
1. Hooks disabled -> no hook object allocation.
2. HookSystem allocated -> not initialized.
3. HookSystem initialized -> ready event handler.
4. Event fired -> plan created -> hooks executed -> outputs aggregated -> caller applies result.

## Invariants
- No per-event infrastructure re-instantiation.
- No fake llm_request/llm_response placeholders in target behavior.
- Stop/block semantics are explicit and caller-applied where required.
- Disabled/no-match paths avoid spawning hook processes.
- Scope boundary preserves non-applied outputs for out-of-scope events.

## Edge Cases
- Exit code 2 with/without stderr and JSON reason fields.
- Double-encoded JSON stdout from hook scripts.
- Invalid matcher regex fallback to literal matching.
- Timeout and signal kill handling in fail-open path.
- Streaming interruption before complete model response assembly.

## Error Scenarios
- HookSystem initialization failures.
- Planner failures and no-match fast paths.
- Runner spawn/write errors including EPIPE.
- Translator conversion gaps and compatibility fallback behavior.
