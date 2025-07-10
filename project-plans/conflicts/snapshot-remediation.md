# Snapshot Remediation - prompts.test.ts

## Date: 2025-07-09

## Summary

Updated failing snapshot tests in `packages/core/src/core/prompts.test.ts` to reflect changes in the system prompt.

## Changes Made

- Ran `npm test -- prompts.test.ts -u` in the `packages/core` directory to update 9 failing snapshots
- All snapshots were successfully updated to match the current output of `getCoreSystemPrompt()`

## Reason for Changes

The snapshots were outdated due to recent changes to the system prompt, which now includes:

- New "Task Management" section with detailed instructions for using TodoWrite and TodoRead tools
- Todo usage examples showing when to use and when not to use todo tracking
- Additional guidelines for task states and management

## Tests Updated

1. `should return the base prompt when no userMemory is provided`
2. `should return the base prompt when userMemory is empty string`
3. `should return the base prompt when userMemory is whitespace only`
4. `should append userMemory with separator when provided`
5. `should include sandbox-specific instructions when SANDBOX env var is set`
6. `should include seatbelt-specific instructions when SANDBOX env var is "sandbox-exec"`
7. `should include non-sandbox instructions when SANDBOX env var is not set`
8. `should include git instructions when in a git repo`
9. `should not include git instructions when not in a git repo`

## Verification

All tests now pass successfully after updating the snapshots.
