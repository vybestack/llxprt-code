# Pseudocode 02: HookEventHandler Flow

## Interface Contracts

### Inputs
- event name and event-specific payload fields
- session/workdir/transcript metadata from Config

### Outputs
- AggregatedHookResult with finalOutput, allOutputs, errors, and duration

### Dependencies
- HookPlanner, HookRunner, HookAggregator, HookTranslator

## Integration Points (Line-by-Line)
- Line 11: base HookInput includes session_id, cwd, timestamp, hook_event_name, transcript_path
- Line 13: planner returns null for no-match fast path
- Line 16-19: sequential vs parallel execution path
- Line 20: aggregate by event family merge strategy

## Anti-Pattern Warnings
- [ERROR] Passing llm_request placeholders instead of translated request data
- [ERROR] Dropping errors without warnings in fail-open model
- [OK] Returning empty success result for no-match path

## Numbered Pseudocode
10: METHOD HookEventHandler.fireEvent(eventName, payload)
11: input = buildBaseInput(config, eventName)
12: input = mergeEventSpecificPayload(input, payload)
13: plan = planner.createExecutionPlan(eventName, payload.matcherContext)
14: IF plan is null THEN RETURN emptySuccessResult
15: IF plan.sequential is true THEN
16:   results = AWAIT runner.executeHooksSequential(plan.hookConfigs, eventName, input)
17: ELSE
18:   results = AWAIT runner.executeHooksParallel(plan.hookConfigs, eventName, input)
19: ENDIF
20: RETURN aggregator.aggregateResults(results, eventName)
