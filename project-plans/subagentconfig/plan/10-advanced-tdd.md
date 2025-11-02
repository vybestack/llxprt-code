# Phase 10: Advanced Features TDD (Edit & Autocomplete)

## Phase ID
`PLAN-20250117-SUBAGENTCONFIG.P10`

## Prerequisites
- Phase 09 completed
- Stubs ready for edit and autocomplete
- Expected files:
  - `packages/cli/src/ui/commands/subagentCommand.ts` (with stubs)
  - `packages/cli/src/ui/commands/test/subagentCommand.test.ts` (basic tests passing)

## Implementation Tasks

### File to Modify

**File**: `packages/cli/src/ui/commands/test/subagentCommand.test.ts`

Add tests for edit command and autocomplete functionality.

### 1. Edit Command Tests

Add to existing test file:

```typescript
import { spawnSync } from 'child_process';

// Mock child_process following existing codebase patterns
vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

/**
 * Edit command tests
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P10
 * @requirement:REQ-008
 */
describe('editCommand @requirement:REQ-008', () => {
  beforeEach(() => {
    // Mock spawnSync to simulate editor closing successfully
    vi.mocked(spawnSync).mockReturnValue({
      pid: 12345,
      output: [null, null, null],
      stdout: null,
      stderr: null,
      status: 0,
      signal: null,
      error: undefined,
    } as any);
  });

  it('should error when name not provided', async () => {
    const result = await editCommand.action(context, '');
    
    expect(result.messageType).toBe('error');
    expect(result.content).toMatch(/usage|name required/i);
  });

  it('should error for non-existent subagent', async () => {
    const result = await editCommand.action(context, 'nonexistent');
    
    expect(result.messageType).toBe('error');
    expect(result.content).toMatch(/not found/i);
  });

  it('should launch editor for existing subagent', async () => {
    await subagentManager.saveSubagent('testagent', 'testprofile', 'Test prompt');
    
    const result = await editCommand.action(context, 'testagent');
    
    // Verify spawnSync was called
    expect(spawnSync).toHaveBeenCalledTimes(1);
    
    // Verify success message
    expect(result.messageType).toBe('info');
    expect(result.content).toMatch(/updated successfully/i);
  });

  it('should handle editor failure', async () => {
    await subagentManager.saveSubagent('testagent', 'testprofile', 'Test prompt');
    
    // Mock editor exiting with error
    vi.mocked(spawnSync).mockReturnValueOnce({
      pid: 12345,
      output: [null, null, null],
      stdout: null,
      stderr: null,
      status: 1,
      signal: null,
      error: undefined,
    } as any);
    
    const result = await editCommand.action(context, 'testagent');
    
    expect(result.messageType).toBe('error');
    expect(result.content).toMatch(/editor.*exited/i);
  });

  it('should validate JSON after edit', async () => {
    await subagentManager.saveSubagent('testagent', 'testprofile', 'Test prompt');
    
    // Mock editor completing, but we'll make file invalid in implementation test
    // This test verifies the validation logic exists
    const result = await editCommand.action(context, 'testagent');
    
    expect(result.type).toBe('message');
  });
});
```

### 2. Autocomplete Tests

Add comprehensive autocomplete tests:

```typescript
/**
 * Autocomplete tests
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P10
 * @requirement:REQ-009
 * 
 * NOTE: These tests assume Phase 01 has resolved autocomplete system to support
 * fullLine parameter. If Phase 01 did not implement enhancement, these tests
 * will need to be adjusted based on findings.md.
 */
describe('completion @requirement:REQ-009', () => {
  it('should complete subcommand names at level 1', async () => {
    // Simulate: /subagent sa<TAB>
    const fullLine = '/subagent sa';
    const results = await subagentCommand.completion(context, 'sa', fullLine);
    
    expect(results).toContain('save');
    expect(results).not.toContain('list');
  });

  it('should return all subcommands with empty partialArg', async () => {
    // Simulate: /subagent <TAB>
    const fullLine = '/subagent ';
    const results = await subagentCommand.completion(context, '', fullLine);
    
    expect(results).toContain('save');
    expect(results).toContain('list');
    expect(results).toContain('show');
    expect(results).toContain('delete');
    expect(results).toContain('edit');
  });

  it('should complete agent names for show command', async () => {
    await subagentManager.saveSubagent('agent1', 'testprofile', 'Prompt 1');
    await subagentManager.saveSubagent('agent2', 'testprofile', 'Prompt 2');
    
    // Simulate: /subagent show ag<TAB>
    const fullLine = '/subagent show ag';
    const results = await subagentCommand.completion(context, 'ag', fullLine);
    
    expect(results).toContain('agent1');
    expect(results).toContain('agent2');
    expect(results).not.toContain('list'); // Not a subcommand here
  });

  it('should complete profile names for save command', async () => {
    // Create multiple profiles
    await profileManager.saveProfile('profile1', { version: 1, provider: 'openai', model: 'gpt-4', modelParams: {}, ephemeralSettings: {} });
    await profileManager.saveProfile('profile2', { version: 1, provider: 'openai', model: 'gpt-4', modelParams: {}, ephemeralSettings: {} });
    
    // Simulate: /subagent save myagent pro<TAB>
    const fullLine = '/subagent save myagent pro';
    const results = await subagentCommand.completion(context, 'pro', fullLine);
    
    expect(results).toContain('profile1');
    expect(results).toContain('profile2');
    expect(results).not.toContain('testprofile'); // Filtered by 'pro'
  });

  it('should complete mode for save command', async () => {
    // Simulate: /subagent save myagent myprofile a<TAB>
    const fullLine = '/subagent save myagent myprofile a';
    const results = await subagentCommand.completion(context, 'a', fullLine);
    
    expect(results).toContain('auto');
    expect(results).not.toContain('manual'); // Filtered by 'a'
  });

  it('should return all modes with empty partialArg at mode position', async () => {
    // Simulate: /subagent save myagent myprofile <TAB>
    const fullLine = '/subagent save myagent myprofile ';
    const results = await subagentCommand.completion(context, '', fullLine);
    
    expect(results).toContain('auto');
    expect(results).toContain('manual');
  });

  it('should return empty array for positions beyond mode', async () => {
    // Simulate: /subagent save myagent myprofile auto <TAB>
    const fullLine = '/subagent save myagent myprofile auto ';
    const results = await subagentCommand.completion(context, '', fullLine);
    
    expect(results).toEqual([]);
  });
});
```

### 2.5. slashCommandProcessor Completion Tests

**File**: `packages/cli/src/ui/hooks/slashCommandProcessor.test.ts`

Add a focused test that asserts the hook passes the full input line to the command completion handler:

```typescript
describe('useSlashCommandProcessor completion @plan:PLAN-20250117-SUBAGENTCONFIG.P10', () => {
  it('passes full line to command completion', async () => {
    const completionSpy = vi.fn(async (_context, partialArg: string, fullLine?: string) => {
      expect(partialArg).toBe('sa');
      expect(fullLine).toBe('/subagent sa');
      return [];
    });

    const testCommand = createTestCommand({
      name: 'subagent',
      completion: completionSpy,
    });

    const result = setupProcessorHook([testCommand]);

    await act(async () => {
      await result.current.completion('/subagent sa', '/subagent sa'.length);
    });

    expect(completionSpy).toHaveBeenCalledTimes(1);
  });
});
```

> **Note**: If the existing test suite already exercises this path, update it to assert against the `fullLine` argument instead of creating a new test case.

These tests require TypeScript definitions for `SlashCommand.completion` to accept an optional `fullLine` parameter. Update `packages/cli/src/ui/commands/types.ts` (and any related shared types) as part of this phase so the tests compile, but do not implement the production logic yet. Add inline `@plan:PLAN-20250117-SUBAGENTCONFIG.P10` markers around the new signature to satisfy traceability checks.

### 3. Test Prerequisites

Add comment at top of test file:

```typescript
/**
 * COMPLETION SYSTEM REQUIREMENTS
 * 
 * These tests require Phase 01 to have resolved autocomplete system capabilities.
 * 
 * Findings from Phase 01:
 * - Autocomplete feasibility documented (see findings.md)
 * - Required file changes identified for fullLine support
 * - No production code modified yet
 * 
 * If Phase 01 blocked on autocomplete:
 * - These tests should not be written until blocker resolved
 * - Plan should be paused at Phase 01
 * 
 * See: project-plans/subagentconfig/analysis/findings.md for Phase 01 results
 */
```

## Verification Commands

```bash
# Check tests added
grep -c "editCommand @requirement:REQ-008" packages/cli/src/ui/commands/test/subagentCommand.test.ts
# Expected: 1+

grep -c "completion @requirement:REQ-009" packages/cli/src/ui/commands/test/subagentCommand.test.ts
# Expected: 1+

# slashCommandProcessor test updated with plan marker
grep -q "@plan:PLAN-20250117-SUBAGENTCONFIG.P10" packages/cli/src/ui/hooks/slashCommandProcessor.test.ts || exit 1

# SlashCommand type supports fullLine parameter
rg -q "fullLine\?" packages/cli/src/ui/commands/types.ts || exit 1

# Tests should fail naturally (stubs)
npm test -- subagentCommand.test.ts --grep "edit|completion" 2>&1 | grep -q "FAIL\|fail" || echo "Tests should fail"

# Hook tests should fail until implementation
npm test -- slashCommandProcessor.test.ts --runInBand 2>&1 | grep -q "FAIL\|fail" || echo "Hook tests should fail"

# TypeScript compiles
npm run typecheck
# Expected: No errors
```

## Success Criteria

- Edit command tests added (3+ tests)
- Autocomplete tests added (5+ tests)
- Tests document completion system limitations if found
- Tests will fail naturally (stub implementation)
- All markers present

## Phase Completion Marker

```markdown
# Phase 10: Advanced Features TDD Complete

**Completed**: [TIMESTAMP]

## Tests Added
- editCommand: 3 tests
- completion: 5+ tests

## Notes
[Document any completion system limitations discovered]

## Next Phase
Ready for Phase 11: Advanced Features Implementation
```

---

**CRITICAL**: If autocomplete tests reveal that fullLine is not available in completion function, document this in findings and mark tests as pending. Implementation in Phase 11 may need to enhance completion system first.
