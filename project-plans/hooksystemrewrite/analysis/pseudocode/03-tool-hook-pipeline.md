# Pseudocode 03: Tool Hook Pipeline

## Interface Contracts

### Inputs
- Config, toolName, toolInput, executeFn

### Outputs
- ToolResult with before/after hook effects applied

### Dependencies
- fireBeforeToolHook, fireAfterToolHook, ToolResult adapters

## Integration Points (Line-by-Line)
- Line 11: before-hook is awaited before execution starts
- Line 12: block decision returns terminal tool result
- Line 13: modified tool_input is applied to executeFn boundary
- Line 16: after-hook context/suppression/system-message effects are applied

## Anti-Pattern Warnings
- [ERROR] Executing tool before before-hook decision is processed
- [ERROR] Ignoring additionalContext/suppressOutput after tool execution
- [OK] Returning deterministic result for every policy path

## Numbered Pseudocode
10: METHOD executeToolWithHooks(config, toolName, toolInput, executeFn)
11: beforeResult = AWAIT fireBeforeToolHook(config, toolName, toolInput)
12: IF beforeResult indicates block THEN RETURN blockedToolResult(stopReason)
13: toolInput = applyBeforeToolModifications(toolInput, beforeResult)
14: rawResult = AWAIT executeFn(toolInput)
15: afterResult = AWAIT fireAfterToolHook(config, toolName, toolInput, serialize(rawResult))
16: finalResult = applyAfterToolOutput(rawResult, afterResult)
17: RETURN finalResult
