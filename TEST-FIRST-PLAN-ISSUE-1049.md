# Test-First Implementation Plan: Issue #1049

## Timeout Settings Autocomplete, Profile Support, and Default Values

### Summary

Fix timeout settings (`task_default_timeout_seconds`, `task_max_timeout_seconds`, `shell_default_timeout_seconds`, `shell_max_timeout_seconds`) to:

1. [OK] Show up in autocomplete with proper hints
2. [OK] Have comprehensive help text (explains what/why/when)
3. [OK] Be saved to and loaded from profiles
4. [OK] Use new default values (task=900/1800s, shell=300/900s)
5. [OK] Survive provider switches

### Analysis from CodeRabbit and Deep Code Review

#### Critical Issues Found:

1. **Missing from PROFILE_EPHEMERAL_KEYS** (`packages/cli/src/runtime/runtimeSettings.ts` line 895-933)
   - Settings are NOT saved to profiles
   - Settings are NOT loaded from profiles

2. **Missing from preserveEphemerals** (`packages/cli/src/runtime/profileApplication.ts` line 541-552)
   - Settings get cleared when switching providers

3. **Missing from directSettingSpecs** (`packages/cli/src/ui/commands/setCommand.ts` line ~106)
   - No enhanced autocomplete with custom hints
   - Fall back to generic handler only

4. **Outdated Help Text** (`packages/cli/src/settings/ephemeralSettings.ts` line 71-76)
   - Shows old defaults (60/300 for task, 120/600 for shell)
   - Minimal explanation, doesn't explain what/why/when

5. **Wrong Default Values** in code:
   - `packages/core/src/tools/task.ts` line 33-34: 60/300 (should be 900/1800)
   - `packages/core/src/tools/shell.ts` line 55-56: 120/600 (should be 300/900)

### Implementation Plan (Test-First)

#### Phase 1: Add to PROFILE_EPHEMERAL_KEYS

**File**: `packages/cli/src/runtime/runtimeSettings.ts`

**Test First** (`packages/cli/src/runtime/runtimeSettings.spec.ts`):

```typescript
describe('buildRuntimeProfileSnapshot', () => {
  it('should include timeout settings in profile snapshot', () => {
    const config = createMockConfig({
      ephemeralSettings: {
        task_default_timeout_seconds: 900,
        task_max_timeout_seconds: 1800,
        shell_default_timeout_seconds: 300,
        shell_max_timeout_seconds: 900,
      },
    });

    const snapshot = buildRuntimeProfileSnapshot();
    expect(snapshot.ephemeralSettings['task_default_timeout_seconds']).toBe(
      900,
    );
    expect(snapshot.ephemeralSettings['task_max_timeout_seconds']).toBe(1800);
    expect(snapshot.ephemeralSettings['shell_default_timeout_seconds']).toBe(
      300,
    );
    expect(snapshot.ephemeralSettings['shell_max_timeout_seconds']).toBe(900);
  });
});
```

**Implementation**: Add the 4 timeout keys to `PROFILE_EPHEMERAL_KEYS` array (after line 933).

#### Phase 2: Add to preserveEphemerals

**File**: `packages/cli/src/runtime/profileApplication.ts`

**Test First** (`packages/cli/src/runtime/profileApplication.spec.ts`):

```typescript
describe('applyProfileWithGuards - provider switch preservation', () => {
  it('should preserve timeout settings when switching providers', async () => {
    // Set timeout settings before switch
    const config = createMockConfig({
      ephemeralSettings: {
        task_default_timeout_seconds: 900,
        shell_default_timeout_seconds: 300,
      },
    });

    // Simulate provider switch
    const result = await applyProfileWithGuards(newProfile, {
      profileName: 'test',
    });

    // Verify timeout settings are preserved
    const ephemerals = config.getEphemeralSettings();
    expect(ephemerals['task_default_timeout_seconds']).toBe(900);
    expect(ephemerals['shell_default_timeout_seconds']).toBe(300);
  });
});
```

**Implementation**: Add the 4 timeout keys to `preserveEphemerals` array passed to `switchActiveProvider` (after line 551).

#### Phase 3: Update Default Values in task.ts and shell.ts

**File**: `packages/core/src/tools/task.ts`

**Test First** (`packages/core/src/tools/task.test.ts`):

```typescript
describe('timeout defaults', () => {
  it('should use new default timeout of 900 seconds (15 minutes)', async () => {
    const config = createMockConfig({
      ephemeralSettings: {}, // No timeout settings set
    });

    const tool = new TaskTool(config, {
      orchestratorFactory: () => mockOrchestrator,
    });

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Test',
    });

    await invocation.execute(signal);

    // Verify default timeout is used (900s = 15 minutes)
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        runConfig: expect.objectContaining({
          max_time_minutes: 15, // 900 seconds / 60
        }),
      }),
      expect.any(AbortSignal),
    );
  });

  it('should clamp to new max timeout of 1800 seconds (30 minutes)', async () => {
    const config = createMockConfig({
      ephemeralSettings: {
        task_max_timeout_seconds: 1800,
      },
    });

    const tool = new TaskTool(config, {
      orchestratorFactory: () => mockOrchestrator,
    });

    const invocation = tool.build({
      subagent_name: 'helper',
      goal_prompt: 'Test',
      timeout_seconds: 9999,
    });

    await invocation.execute(signal);

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        runConfig: expect.objectContaining({
          max_time_minutes: 30, // Clamped to 1800s / 60
        }),
      }),
      expect.any(AbortSignal),
    );
  });
});
```

**Implementation**: Update line 33-34:

```typescript
const DEFAULT_TASK_TIMEOUT_SECONDS = 900; // was 60
const MAX_TASK_TIMEOUT_SECONDS = 1800; // was 300
```

**File**: `packages/core/src/tools/shell.ts`

**Test First** (`packages/core/src/tools/shell.test.ts`):

```typescript
describe('timeout defaults', () => {
  it('should use new default timeout of 300 seconds (5 minutes)', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    mockConfig.getEphemeralSettings.mockReturnValue({
      shell_default_timeout_seconds: 300,
      shell_max_timeout_seconds: 900,
    });

    const invocation = shellTool.build({ command: 'ls' });
    const promise = invocation.execute(mockAbortSignal);
    resolveShellExecution({});

    await promise;

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 300000); // 300s = 300000ms
    setTimeoutSpy.mockRestore();
  });

  it('should clamp to new max timeout of 900 seconds (15 minutes)', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    mockConfig.getEphemeralSettings.mockReturnValue({
      shell_default_timeout_seconds: 300,
      shell_max_timeout_seconds: 900,
    });

    const invocation = shellTool.build({
      command: 'ls',
      timeout_seconds: 9999,
    });
    const promise = invocation.execute(mockAbortSignal);
    resolveShellExecution({});

    await promise;

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 900000); // Clamped to 900s = 900000ms
    setTimeoutSpy.mockRestore();
  });
});
```

**Implementation**: Update line 55-56:

```typescript
const DEFAULT_SHELL_TIMEOUT_SECONDS = 300; // was 120
const MAX_SHELL_TIMEOUT_SECONDS = 900; // was 600
```

#### Phase 4: Update Help Text

**File**: `packages/cli/src/settings/ephemeralSettings.ts`

**Test First** (`packages/cli/src/settings/ephemeralSettings.spec.ts`):

```typescript
describe('ephemeralSettingHelp', () => {
  it('should provide comprehensive help for timeout settings', () => {
    expect(ephemeralSettingHelp['task_default_timeout_seconds']).toBeDefined();
    expect(ephemeralSettingHelp['task_default_timeout_seconds']).toContain(
      'subagent',
    );
    expect(ephemeralSettingHelp['task_default_timeout_seconds']).toContain(
      '900',
    );
    expect(ephemeralSettingHelp['task_default_timeout_seconds']).toContain(
      '15 minutes',
    );

    expect(ephemeralSettingHelp['shell_default_timeout_seconds']).toBeDefined();
    expect(ephemeralSettingHelp['shell_default_timeout_seconds']).toContain(
      'shell command',
    );
    expect(ephemeralSettingHelp['shell_default_timeout_seconds']).toContain(
      '300',
    );
    expect(ephemeralSettingHelp['shell_default_timeout_seconds']).toContain(
      '5 minutes',
    );
  });
});
```

**Implementation**: Replace lines 71-76 with comprehensive help text:

```typescript
// Tool timeout settings (Issue #1049)
task_default_timeout_seconds:
  'Default timeout in seconds for task tool executions (launches subagents for complex autonomous work). Use higher values (e.g., 900-1800) for complex development tasks, data analysis, or multi-step workflows. Use lower values for quick operations. Set to -1 for unlimited. Default: 900 (15 minutes)',
task_max_timeout_seconds:
  'Maximum allowed timeout in seconds for task tool executions, enforcing an upper bound even when explicitly specified. Prevents runaway subagent processes. Default: 1800 (30 minutes)',
shell_default_timeout_seconds:
  'Default timeout in seconds for shell command executions (runs terminal commands like git, npm, build scripts). Use higher values (e.g., 300-900) for long-running builds or downloads. Use lower values for quick commands. Set to -1 for unlimited. Default: 300 (5 minutes)',
shell_max_timeout_seconds:
  'Maximum allowed timeout in seconds for shell command executions, enforcing an upper bound even when explicitly specified. Prevents hanging commands. Default: 900 (15 minutes)',
```

#### Phase 5: Add to directSettingSpecs for Enhanced Autocomplete

**File**: `packages/cli/src/ui/commands/setCommand.ts`

**Test First** (`packages/cli/src/ui/commands/setCommand.test.ts`):

```typescript
describe('/set command autocomplete', () => {
  it('should include timeout settings in directSettingSpecs', () => {
    const timeoutKeys = [
      'task_default_timeout_seconds',
      'task_max_timeout_seconds',
      'shell_default_timeout_seconds',
      'shell_max_timeout_seconds',
    ];

    for (const key of timeoutKeys) {
      const spec = directSettingSpecs.find((s) => s.value === key);
      expect(spec, `${key} should be in directSettingSpecs`).toBeDefined();
      expect(spec?.hint).toContain('seconds');
      expect(spec?.hint).toContain('-1');
    }
  });

  it('should provide helpful hints for timeout settings in autocomplete', async () => {
    const completion = await getCompletions(
      'set task_default_timeout_seconds',
      0,
    );

    expect(
      completion.some((c) => c.value === 'task_default_timeout_seconds'),
    ).toBe(true);
    const hint = completion.find(
      (c) => c.value === 'task_default_timeout_seconds',
    )?.hint;
    expect(hint).toContain('seconds');
    expect(hint).toContain('unlimited');
  });
});
```

**Implementation**: Add to `directSettingSpecs` array (around line 200, after reasoning settings):

```typescript
// Tool timeout settings (Issue #1049)
{
  value: 'task_default_timeout_seconds',
  hint: 'timeout in seconds (e.g., 900) or -1 (unlimited)',
  description: 'Task tool default timeout',
},
{
  value: 'task_max_timeout_seconds',
  hint: 'timeout in seconds (e.g., 1800) or -1 (unlimited)',
  description: 'Task tool max timeout',
},
{
  value: 'shell_default_timeout_seconds',
  hint: 'timeout in seconds (e.g., 300) or -1 (unlimited)',
  description: 'Shell tool default timeout',
},
{
  value: 'shell_max_timeout_seconds',
  hint: 'timeout in seconds (e.g., 900) or -1 (unlimited)',
  description: 'Shell tool max timeout',
},
```

### Test Execution Checklist

For each phase:

1. [OK] Write failing test (RED)
2. [OK] Run tests to confirm failure
3. [OK] Write minimal implementation to make test pass (GREEN)
4. [OK] Run all tests to ensure no regressions
5. [OK] Run linting, type checking, formatting
6. [OK] Verify with coderabbit standards

### Verification Scripts

```bash
# Run tests for affected packages
npm test -- packages/cli/src/runtime/runtimeSettings.spec.ts
npm test -- packages/cli/src/runtime/profileApplication.spec.ts
npm test -- packages/core/src/tools/task.test.ts
npm test -- packages/core/src/tools/shell.test.ts
npm test -- packages/cli/src/settings/ephemeralSettings.spec.ts
npm test -- packages/cli/src/ui/commands/setCommand.test.ts

# Run type checking
npm run typecheck

# Run linting
npm run lint

# Format code
npm run format
```

### Edge Cases to Test

1. **-1 (unlimited) timeout**: Verify both default and max can be -1
2. **Clamping behavior**: Ensure requested timeout > max gets clamped to max
3. **Profile round-trip**: Save profile with timeout settings, load it back, verify values persist
4. **Provider switch**: Set timeout settings, switch providers, verify they survive
5. **Autocomplete with -1**: Autocomplete should show "-1 (unlimited)" in hint
6. **Help text mentions -1**: Help text should explain unlimited option

### Success Criteria

1. [OK] All 4 timeout settings appear in `/set` autocomplete
2. [OK] Autocomplete provides helpful hints
3. [OK] Help text is comprehensive (what/why/when)
4. [OK] Settings are saved to profiles via `/profile save`
5. [OK] Settings are loaded from profiles via `/profile load`
6. [OK] Settings survive provider switches
7. [OK] New default values are used (900/1800 for task, 300/900 for shell)
8. [OK] All existing tests pass
9. [OK] New tests follow TDD principles
10. [OK] Code passes coderabbit review

### Files to Modify

1. `packages/cli/src/runtime/runtimeSettings.ts` - Add to PROFILE_EPHEMERAL_KEYS
2. `packages/cli/src/runtime/profileApplication.ts` - Add to preserveEphemerals
3. `packages/core/src/tools/task.ts` - Update DEFAULT and MAX constants
4. `packages/core/src/tools/shell.ts` - Update DEFAULT and MAX constants
5. `packages/cli/src/settings/ephemeralSettings.ts` - Update help text
6. `packages/cli/src/ui/commands/setCommand.ts` - Add to directSettingSpecs
7. Test files for all above (create or update as needed)

### Testing Strategy

**Unit Tests**:

- Each setting is in PROFILE_EPHEMERAL_KEYS
- Each setting is in preserveEphemerals
- Default values are correctly applied
- Clamping behavior works
- Help text is present and comprehensive

**Integration Tests**:

- Profile save/load round-trip
- Provider switch preservation
- Autocomplete functionality
- Set command validation

**Manual Verification**:

- Start CLI, use `/set <timeout-setting>` to see autocomplete
- Set a timeout, save profile, reload, verify it persists
- Set a timeout, switch providers, verify it survives
- Check help text with `/set <timeout-setting>` (no value)

### Notes

- Follow strict TDD: RED → GREEN → (maybe refactor)
- Tests should verify behavior, not implementation
- Use existing test patterns and helpers
- Ensure backward compatibility (profile migration not needed since keys already exist in code)
- Update this plan as we discover edge cases

### Estimated Timeline

- Phase 1 (PROFILE_EPHEMERAL_KEYS): 30 min
- Phase 2 (preserveEphemerals): 30 min
- Phase 3 (task.ts and shell.ts defaults): 1 hour
- Phase 4 (help text): 30 min
- Phase 5 (autocomplete): 1 hour
- Verification and cleanup: 1 hour

**Total**: ~4-5 hours

---

_This plan will be executed by the typescriptexpert subagent following test-first principles._
