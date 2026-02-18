# Pseudocode 04: Model Hook Pipeline

## Interface Contracts

### Inputs
- Config, assembled GenerateContentParameters request, provider model call callback

### Outputs
- final response (original, modified, replaced, or synthetic)

### Dependencies
- fireBeforeToolSelectionHook, fireBeforeModelHook, fireAfterModelHook, HookTranslator

## Integration Points (Line-by-Line)
- Line 11: apply toolConfig modifications while leaving tools definitions intact
- Line 13: before-model block/synthetic/modified-request application
- Line 16: provider call only executes if no blocking decision
- Line 17: after-model modifications applied to complete response object

## Anti-Pattern Warnings
- [ERROR] Hardcoded finishReason values in hook payloads
- [ERROR] Using AggregatedHookResult.success as policy decision source
- [OK] Explicit shouldStop/stopReason contract for continue=false behavior

## Numbered Pseudocode
10: METHOD runModelWithHooks(config, request, callProvider)
11: toolSel = AWAIT fireBeforeToolSelectionHook(config, request)
12: request = applyToolSelectionResult(request, toolSel)
13: before = AWAIT fireBeforeModelHook(config, request)
14: IF before.blocked is true THEN RETURN before.syntheticResponse OR emptyBlockedResponse()
15: request = applyBeforeModelModifications(request, before)
16: response = AWAIT callProvider(request)
17: after = AWAIT fireAfterModelHook(config, request, response)
18: response = applyAfterModelModifications(response, after)
19: IF after.shouldStop is true THEN return with stop metadata
20: RETURN response
