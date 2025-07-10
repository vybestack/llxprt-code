# Task: Resolve packages/core/src/tools/shell.ts Conflict

## Objective

Resolve the merge conflict in shell tool to support provider-specific formatting while keeping improvements from main.

## File

`packages/core/src/tools/shell.ts`

## Context

- **multi-provider branch**: May have provider-specific tool response formatting
- **main branch**: Added shell command improvements and safety features

## Resolution Strategy

1. Keep provider-aware tool response format
2. Include safety improvements from main
3. Merge command execution enhancements
4. Preserve both feature sets

## Key Items to Preserve

### From multi-provider:

- Provider-specific response formatting
- Tool response structure for different providers
- Proper tool result encoding

### From main:

- Command safety checks
- Improved error handling
- Timeout improvements
- Better output capture

## Expected Implementation

- Safe command execution from main
- Flexible response format for providers
- Comprehensive error handling
- Proper timeout management

## Commands to Execute

```bash
# After resolution:
git add packages/core/src/tools/shell.ts
```

## Validation

1. Shell commands execute safely
2. Output formatted correctly for all providers
3. Timeouts work properly
4. Error handling comprehensive
