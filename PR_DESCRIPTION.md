## Summary

This PR implements the complete fix for **Issue #1049**, addressing all requirements for timeout settings in task and shell tools.

## Problem Statement

The task and shell timeout ephemeral settings had several critical issues:

1. Not in autocomplete - Settings didn't appear in `/set` command suggestions
2. Missing from profiles - Settings weren't saved to or loaded from profiles
3. Cleared on provider switch - Settings were lost when switching providers
4. Outdated defaults - Default values were too low for real-world use
5. Minimal help text - Help didn't explain what/why/when to use different values

## Changes Made

### 1. Added to PROFILE_EPHEMERAL_KEYS

Settings are now properly saved to and loaded from profiles via `/profile save` and `/profile load`.

### 2. Added to preserveEphemerals

Settings now survive provider switches instead of being cleared.

### 3. Updated Default Values in task.ts

- DEFAULT_TASK_TIMEOUT_SECONDS: 60 → 900 (15 minutes)
- MAX_TASK_TIMEOUT_SECONDS: 300 → 1800 (30 minutes)

Better aligned with complex development tasks, data analysis, and multi-step workflows.

### 4. Updated Default Values in shell.ts

- DEFAULT_SHELL_TIMEOUT_SECONDS: 120 → 300 (5 minutes)
- MAX_SHELL_TIMEOUT_SECONDS: 600 → 900 (15 minutes)

Better aligned with long-running builds and downloads.

### 5. Enhanced Help Text

Replaced minimal help text with comprehensive explanations that explain:

- What the setting controls (subagent vs shell commands)
- Why you'd change it (complex tasks vs quick operations)
- When to use different values (examples provided)
- How to set unlimited (-1)

### 6. Added to directSettingSpecs

Settings now appear in enhanced autocomplete with:

- Custom hints showing examples
- Clear indication of -1 for unlimited
- Better user experience

### 7. Updated Test Expectations

Test expectations now match new default of 900 seconds.

## Verification

All changes have been verified:

- Type checking passes
- Formatting applied
- Tests pass: Task tool tests (15/15), Shell tool tests (45/45)

## How to Test

1. Autocomplete: Type `/set task_default_timeout_seconds` and see it appear in suggestions
2. Help text: Type `/set task_default_timeout_seconds` (no value) to see comprehensive help
3. Profile save: Set a timeout, run `/profile save myprofile`, verify it saves
4. Profile load: Run `/profile load myprofile`, verify timeout is restored
5. Provider switch: Set a timeout, switch providers, verify it survives
6. Default values: Create a new task/shell invocation, verify 900s/300s defaults are used

## Breaking Changes

None. The changes are backward compatible:

- Existing profiles without timeout settings will use new defaults
- The timeout setting keys already existed in code (just weren't in autocomplete/profiles)
- No migration needed

Closes #1049
