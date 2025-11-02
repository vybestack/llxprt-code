# Phase 05: SubagentManager Implementation

## Phase ID
`PLAN-20250117-SUBAGENTCONFIG.P05`

## Prerequisites
- Phase 04 completed
- Verification: `grep -r "@plan:PLAN-20250117-SUBAGENTCONFIG.P04" packages/core/src/config/test/`
- Expected files from previous phase:
  - `packages/core/src/config/test/subagentManager.test.ts` (tests failing)
  - `packages/core/src/config/subagentManager.ts` (stub)

## Implementation Tasks

### File to Modify

**File**: `packages/core/src/config/subagentManager.ts`

Replace stub implementations with actual logic following pseudocode from `project-plans/subagentconfig/analysis/pseudocode/SubagentManager.md`

### Implementation Requirements

1. **Follow Pseudocode Exactly**: Each method must implement the logic from pseudocode line-by-line
2. **Reference Line Numbers**: Update @pseudocode markers with actual line numbers
3. **Keep @plan:Markers**: Update to P05 but keep REQ markers
4. **Pattern Match ProfileManager**: Use same patterns for file I/O, error handling
5. **All Tests Must Pass**: Run tests after each method implementation

### Methods to Implement

#### 1. Constructor and Private Helpers
```typescript
/**
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P05
 * @requirement:REQ-002
 * @pseudocode SubagentManager.md lines 1-15
 */
constructor(baseDir: string, profileManager: ProfileManager) {
  this.baseDir = baseDir;
  this.profileManager = profileManager;
}

/**
 * Get full path to subagent config file
 * @pseudocode SubagentManager.md lines 16-20
 */
private getSubagentPath(name: string): string {
  return path.join(this.baseDir, `${name}.json`);
}

/**
 * Ensure subagent directory exists, create if not
 * @pseudocode SubagentManager.md lines 21-30
 */
private async ensureDirectory(): Promise<void> {
  try {
    await fsPromises.mkdir(this.baseDir, { recursive: true });
  } catch (error) {
    // Ignore if already exists
  }
}
```

#### 2. Validation Methods
```typescript
/**
 * Validate subagent name
 * @pseudocode SubagentManager.md lines 31-42
 */
private validateName(name: string): void {
  if (!name || name.trim() === '') {
    throw new Error('Invalid subagent name. Name cannot be empty.');
  }
  
  // Only allow alphanumeric, hyphens, underscores
  const validNamePattern = /^[a-zA-Z0-9_-]+$/;
  if (!validNamePattern.test(name)) {
    throw new Error(
      'Invalid subagent name. Use alphanumeric characters, hyphens, and underscores only.'
    );
  }
}

/**
 * Validate system prompt
 * @pseudocode SubagentManager.md lines 43-48
 */
private validateSystemPrompt(systemPrompt: string): void {
  if (!systemPrompt || systemPrompt.trim() === '') {
    throw new Error('System prompt cannot be empty.');
  }
}
```

#### 3. Core Methods

Implement following the pseudocode:

- `saveSubagent()` - Lines [X-Y from pseudocode]
- `loadSubagent()` - Lines [X-Y from pseudocode]
- `listSubagents()` - Lines [X-Y from pseudocode]
- `deleteSubagent()` - Lines [X-Y from pseudocode]
- `subagentExists()` - Lines [X-Y from pseudocode]
- `validateProfileReference()` - Lines [X-Y from pseudocode]

### Implementation Pattern (Example: saveSubagent)

```typescript
/**
 * Save or update a subagent configuration
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P05
 * @requirement:REQ-002
 * @pseudocode SubagentManager.md lines 49-95
 */
async saveSubagent(
  name: string,
  profile: string,
  systemPrompt: string,
): Promise<void> {
  // Validate inputs (lines 49-58)
  this.validateName(name);
  this.validateSystemPrompt(systemPrompt);
  
  // Validate profile exists (lines 59-63)
  const isValidProfile = await this.validateProfileReference(profile);
  if (!isValidProfile) {
    throw new Error(
      `Profile '${profile}' not found. Use /profile list to see available profiles.`
    );
  }
  
  // Check if subagent exists (lines 64-68)
  const exists = await this.subagentExists(name);
  
  let config: SubagentConfig;
  
  if (exists) {
    // Load existing to preserve createdAt (lines 69-77)
    const existing = await this.loadSubagent(name);
    config = {
      name,
      profile,
      systemPrompt,
      createdAt: existing.createdAt, // Preserve
      updatedAt: new Date().toISOString(), // Update
    };
  } else {
    // Create new with current timestamp (lines 78-85)
    config = {
      name,
      profile,
      systemPrompt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  
  // Ensure directory exists (lines 86-87)
  await this.ensureDirectory();
  
  // Write to file (lines 88-95)
  const filePath = this.getSubagentPath(name);
  const jsonString = JSON.stringify(config, null, 2);
  
  try {
    await fsPromises.writeFile(filePath, jsonString, 'utf-8');
  } catch (error) {
    throw new Error(
      'Cannot save subagent. Check permissions and disk space.'
    );
  }
}
```

### Error Handling Requirements

All errors MUST be user-friendly:

- Invalid name: "Invalid subagent name. Use alphanumeric characters, hyphens, and underscores only."
- Empty prompt: "System prompt cannot be empty."
- Profile not found: "Profile 'xxx' not found. Use /profile list to see available profiles."
- File not found: "Subagent 'xxx' not found."
- Invalid JSON: "Invalid JSON format in subagent file."
- Missing fields: "Required field 'xxx' missing in subagent configuration."
- File I/O errors: "Cannot save/load subagent. Check permissions and disk space."

## Verification Commands

### Automated Checks

```bash
# Check plan markers updated to P05
grep -r "@plan:PLAN-20250117-SUBAGENTCONFIG.P05" packages/core/src/config/subagentManager.ts | wc -l
# Expected: 10+ occurrences

# Check pseudocode references added
grep -r "@pseudocode SubagentManager.md lines" packages/core/src/config/subagentManager.ts | wc -l
# Expected: 9+ occurrences

# TypeScript compiles
npm run typecheck
# Expected: No errors

# ALL TESTS MUST PASS
npm test -- subagentManager.test.ts
# Expected: All tests pass

# Check no stub patterns remain
grep -r "STUB:\|// STUB" packages/core/src/config/subagentManager.ts
# Expected: No matches

# Check no TODO or NotYetImplemented
grep -r "TODO\|NotYetImplemented" packages/core/src/config/subagentManager.ts
# Expected: No matches
```

### Manual Verification Checklist

- [ ] All stub implementations replaced with real logic
- [ ] All methods follow pseudocode line-by-line
- [ ] @plan:markers updated to P05
- [ ] @pseudocode markers include line numbers
- [ ] Pattern matches ProfileManager
- [ ] Error messages are user-friendly
- [ ] All validation methods implemented
- [ ] All tests pass (20+ tests)
- [ ] TypeScript compiles with strict mode
- [ ] No TODO or stub comments remain

## Success Criteria

- All tests pass (100% pass rate)
- All methods implemented (no stubs)
- All pseudocode lines referenced
- Error handling complete
- TypeScript compiles
- Code follows ProfileManager patterns exactly

## Failure Recovery

If tests fail:

1. Identify failing test
2. Compare implementation to pseudocode
3. Check error messages match expectations
4. Verify file I/O logic
5. Fix and re-run tests

If pseudocode is inadequate:

1. Update pseudocode document
2. Re-implement following updated pseudocode
3. Update @pseudocode line number references

## Phase Completion Marker

Create: `project-plans/subagentconfig/.completed/P05.md`

Contents:
```markdown
# Phase 05: SubagentManager Implementation Complete

**Completed**: [TIMESTAMP]

## Files Modified
- packages/core/src/config/subagentManager.ts (stub → full implementation)

## Methods Implemented
- constructor
- saveSubagent (following pseudocode lines X-Y)
- loadSubagent (following pseudocode lines X-Y)
- listSubagents (following pseudocode lines X-Y)
- deleteSubagent (following pseudocode lines X-Y)
- subagentExists (following pseudocode lines X-Y)
- validateProfileReference (following pseudocode lines X-Y)
- validateName (following pseudocode lines X-Y)
- validateSystemPrompt (following pseudocode lines X-Y)
- getSubagentPath (following pseudocode lines X-Y)
- ensureDirectory (following pseudocode lines X-Y)

## Test Results
```
$ npm test -- subagentManager.test.ts
[OK] All tests pass ([TEST_COUNT] passing)

$ npm run typecheck
[OK] No errors
```

## Verification
```
$ grep -c "@plan:PLAN-20250117-SUBAGENTCONFIG.P05" packages/core/src/config/subagentManager.ts
10+

$ grep -c "@pseudocode" packages/core/src/config/subagentManager.ts
9+

$ grep "STUB\|TODO" packages/core/src/config/subagentManager.ts
(no matches)
```

## Next Phase
Ready for Phase 06: SubagentCommand Stub
```

---

**CRITICAL**: Implementation must make ALL tests pass. If tests fail, implementation is wrong (not tests). Follow pseudocode exactly. No shortcuts, no "improvements" - implement as specified.
