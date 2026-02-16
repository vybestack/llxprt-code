# Pseudocode 05: Aggregation and Sequential Chaining

## Interface Contracts

### Inputs
- eventName and HookExecutionResult array

### Outputs
- aggregated output with event-family-specific merge behavior

### Dependencies
- HookAggregator, HookRunner.applyHookOutputToInput

## Integration Points (Line-by-Line)
- Line 14: OR-decision merge for tool events
- Line 16: field-replacement merge for model events
- Line 18: union merge for tool-selection outputs
- Line 31: sequential chaining applies prior output to next hook input

## Anti-Pattern Warnings
- [ERROR] Applying wrong merge strategy for event type
- [ERROR] Continuing sequential chain after explicit block decision
- [OK] Preserve deterministic ordering and precedence matrix

## Numbered Pseudocode
10: METHOD aggregate(eventName, results)
11: outputs = collectSuccessfulOutputs(results)
12: errors = collectErrors(results)
13: SWITCH eventName
14:   CASE BeforeTool/AfterTool => final = mergeToolOutputs(outputs)
15:   CASE BeforeModel/AfterModel => final = mergeModelOutputs(outputs)
16:   CASE BeforeToolSelection => final = mergeToolSelectionOutputs(outputs)
17: END SWITCH
18: RETURN { finalOutput: final, allOutputs: outputs, errors, success: errors.length === 0 }
30: METHOD applyHookOutputToInput(input, output, eventName)
31: apply event-specific modifications for sequential chaining
32: RETURN nextInput
