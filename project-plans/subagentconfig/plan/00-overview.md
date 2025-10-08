# Subagent Configuration Management - Plan Overview

**Plan ID**: PLAN-20250117-SUBAGENTCONFIG  
**Generated**: 2025-01-17  
**Total Phases**: 16  
**Requirements**: REQ-001 through REQ-015

---

## Purpose

Implement a `/subagent` slash command system that allows users to create, manage, and configure subagent definitions stored as JSON files in `~/.llxprt/subagents/`. This system provides both auto-generated (LLM-assisted) and manual configuration modes, with full CRUD operations and intelligent autocomplete.

---

## Implementation Sequence

### Phase 1: Analysis (01-02)
- **Phase 01**: Deep code analysis and investigation
- **Phase 02**: Pseudocode generation

### Phase 2: SubagentManager Core (03-05)
- **Phase 03**: SubagentManager stub
- **Phase 04**: SubagentManager TDD
- **Phase 05**: SubagentManager implementation

### Phase 3: Basic Commands (06-08)
- **Phase 06**: SubagentCommand stub (save, list, show, delete)
- **Phase 07**: SubagentCommand TDD (basic commands)
- **Phase 08**: SubagentCommand implementation (basic commands)

### Phase 4: Advanced Features (09-11)
- **Phase 09**: Advanced features stub (edit, autocomplete)
- **Phase 10**: Advanced features TDD
- **Phase 11**: Advanced features implementation

### Phase 5: Auto Mode Integration (12-14)
- **Phase 12**: Auto mode stub (LLM integration)
- **Phase 13**: Auto mode TDD
- **Phase 14**: Auto mode implementation

### Phase 6: Final Integration (15-16)
- **Phase 15**: System integration and registration
- **Phase 16**: End-to-end verification

---

## Critical Requirements

### 1. Phase 01 is BLOCKING
**Cannot proceed past Phase 01 until multi-level autocomplete is proven achievable.**
- Phase 01 MUST investigate completion system and document feasibility
- If fullLine is not available, flag required changes for the advanced phases (P09-P11) which will implement the enhancement via TDD
- If enhancement not feasible, PAUSE entire plan
- No "fallback to subcommand-only" - REQ-009 must be fully satisfied

### 2. NO NotYetImplemented
Stubs return empty values of correct types:
- `SubagentConfig`: Return object with empty strings and current timestamp
- `string[]`: Return empty array `[]`
- `boolean`: Return `false`
- `void`: Return without error

### 3. Behavioral Tests Only
Tests verify data transformation and business logic:
- [OK] Test: "saveSubagent creates file with correct JSON structure"
- [OK] Test: "validateProfileReference returns true for existing profile"
- [ERROR] NO: "saveSubagent throws NotYetImplemented"

### 4. Follow Pseudocode
Implementation phases MUST reference pseudocode line numbers:
```typescript
/**
 * Implements SubagentManager.saveSubagent
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P05
 * @requirement:REQ-002
 * @pseudocode lines 45-67
 */
```

### 5. Use Existing Patterns
- Editor launch: Follow `text-buffer.ts` (spawnSync, not spawn)
- Autocomplete: Enhancement scheduled for Phases 09-11 if required (based on Phase 01 findings)
- Modify `BuiltinCommandLoader.ts` (don't create new loader)
- Add to existing `types.ts` files
- Test mocking: Follow existing patterns in codebase

### 6. Integration Required
Must integrate with:
- Existing command system (BuiltinCommandLoader)
- ProfileManager for validation
- GeminiClient for auto mode
- Enhanced autocomplete system (from Phase 01)

---

## Files to Create

### New Files
- `packages/core/src/config/subagentManager.ts` - Business logic
- `packages/core/src/config/test/subagentManager.test.ts` - Unit tests
- `packages/cli/src/ui/commands/subagentCommand.ts` - Slash command
- `packages/cli/src/ui/commands/test/subagentCommand.test.ts` - Integration tests

### Files to Modify
- `packages/core/src/config/types.ts` - Add SubagentConfig interface
- `packages/cli/src/services/BuiltinCommandLoader.ts` - Register command
- `packages/cli/src/ui/hooks/slashCommandProcessor.ts` - May need completion enhancement

---

## Requirements Coverage

| Phase | Requirements | Description |
|-------|--------------|-------------|
| P03-P05 | REQ-001, REQ-002, REQ-012, REQ-013 | SubagentManager and types |
| P06-P08 | REQ-004, REQ-005, REQ-006, REQ-007, REQ-011 | Basic commands (manual, list, show, delete) |
| P09-P11 | REQ-008, REQ-009, REQ-014, REQ-015 | Advanced features (edit, autocomplete) |
| P12-P14 | REQ-003 | Auto mode (LLM integration) |
| P15-P16 | REQ-010 | Integration and verification |

---

## Success Criteria

### Functional
- [ ] Users can create subagents with auto mode (LLM-generated prompts)
- [ ] Users can create subagents with manual mode (user-provided prompts)
- [ ] Users can list all subagents with details
- [ ] Users can show full subagent configuration
- [ ] Users can delete subagents with confirmation
- [ ] Users can edit subagents in system editor
- [ ] Multi-level autocomplete works for all commands
- [ ] Profile validation prevents invalid references
- [ ] Overwrite confirmation prevents accidental data loss

### Technical
- [ ] All code includes @plan:markers
- [ ] All code includes @requirement:markers
- [ ] SubagentManager follows ProfileManager pattern exactly
- [ ] TypeScript compiles with strict mode
- [ ] Unit tests achieve >80% coverage
- [ ] Integration tests cover all commands
- [ ] No phases skipped (03→04→05→06...)
- [ ] Pseudocode compliance verified

### Quality
- [ ] Error messages are user-friendly and actionable
- [ ] Success messages provide clear feedback
- [ ] Code follows existing style conventions
- [ ] Documentation includes usage examples
- [ ] No TODO or NotYetImplemented in final code

---

## Pattern References

### 1. Manager Pattern
**Source**: `packages/core/src/config/profileManager.ts`

**Key Elements:**
- Constructor with baseDir parameter
- Private path helper methods
- Async file I/O with fs/promises
- Directory creation on initialization
- JSON parsing with error handling
- Validation methods

### 2. Command Pattern
**Source**: `packages/cli/src/ui/commands/profileCommand.ts`

**Key Elements:**
- Parent command with subCommands array
- Each subcommand as separate SlashCommand object
- Completion function for autocomplete
- MessageActionReturn for user feedback
- Confirmation prompts for destructive operations
- React components for styled output

### 3. Confirmation Pattern
**Source**: `packages/cli/src/ui/commands/chatCommand.ts` (saveCommand)

**Key Elements:**
- Check `context.overwriteConfirmed` before destructive action
- Return `confirm_action` with prompt
- Store `originalInvocation.raw` for retry
- Execute action when confirmed

### 4. Autocomplete Pattern
**Source**: `packages/cli/src/ui/commands/profileCommand.ts`, `chatCommand.ts`

**Key Elements:**
- `completion` function in command definition
- Filter results by `partialArg`
- Async loading of available options
- Return array of matching strings

---

## Testing Strategy

### Unit Tests (Phases 04, 07)

**SubagentManager Tests:**
```typescript
describe('SubagentManager', () => {
  // File I/O tests
  it('should create subagent file with correct structure');
  it('should update existing subagent and preserve createdAt');
  it('should load subagent and parse JSON correctly');
  it('should list all subagent names');
  it('should delete subagent file');
  it('should check subagent existence');
  
  // Validation tests
  it('should validate existing profile reference');
  it('should reject non-existent profile reference');
  
  // Error handling tests
  it('should handle invalid JSON gracefully');
  it('should handle missing directory');
  it('should handle file permission errors');
});
```

### Integration Tests (Phases 10, 13)

**Command Tests:**
```typescript
describe('subagentCommand', () => {
  // Save command tests
  it('should save subagent with manual mode');
  it('should prompt for confirmation on overwrite');
  it('should reject invalid profile name');
  
  // List command tests
  it('should list all subagents with details');
  it('should show message when no subagents exist');
  
  // Show command tests
  it('should display full subagent configuration');
  it('should show error for non-existent subagent');
  
  // Delete command tests
  it('should delete subagent with confirmation');
  it('should show error for non-existent subagent');
  
  // Edit command tests
  it('should launch editor for existing subagent');
  it('should validate JSON after edit');
  
  // Autocomplete tests
  it('should complete subcommand names');
  it('should complete subagent names for show/delete/edit');
  it('should complete profile names for save');
  it('should complete mode for save (auto/manual)');
});
```

### Auto Mode Tests (Phase 13)

**LLM Integration Tests:**
```typescript
describe('subagentCommand - auto mode', () => {
  beforeEach(() => {
    // Mock GeminiClient.sendMessage()
  });
  
  it('should generate system prompt using LLM');
  it('should handle LLM generation failure');
  it('should handle empty LLM response');
  it('should use generated prompt in saved config');
});
```

### End-to-End Tests (Phase 16)

**Full Workflow Tests:**
```typescript
describe('subagent system - E2E', () => {
  it('should complete full workflow: create → list → show → edit → delete');
  it('should handle autocomplete through full save command');
  it('should integrate with ProfileManager correctly');
  it('should prevent invalid profile references');
});
```

---

## Implementation Notes

### Argument Parsing for Save Command

The save command has complex argument structure:
```
/subagent save <name> <profile> auto "<description>"
/subagent save <name> <profile> manual "<prompt>"
```

**Parsing Strategy:**
```typescript
const args = commandArgs.trim();
const match = args.match(/^(\S+)\s+(\S+)\s+(auto|manual)\s+"(.+)"$/);

if (!match) {
  return {
    type: 'message',
    messageType: 'error',
    content: 'Usage: /subagent save <name> <profile> auto|manual "<text>"'
  };
}

const [, name, profile, mode, input] = match;
```

### Auto Mode Prompt Template

```typescript
const AUTO_MODE_PROMPT_TEMPLATE = `Generate a detailed system prompt for a subagent with the following purpose:

{DESCRIPTION}

Requirements:
- Create a comprehensive system prompt that defines the subagent's role, capabilities, and behavior
- Be specific and actionable
- Use clear, professional language
- Output ONLY the system prompt text, no explanations or metadata`;

const prompt = AUTO_MODE_PROMPT_TEMPLATE.replace('{DESCRIPTION}', description);
```

### Timestamp Handling

```typescript
// On first save (create)
const config: SubagentConfig = {
  name,
  profile,
  systemPrompt,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

// On overwrite (update)
const existing = await this.loadSubagent(name);
const config: SubagentConfig = {
  ...existing,
  profile,  // Allow profile change
  systemPrompt,  // Allow prompt change
  updatedAt: new Date().toISOString()  // Update timestamp
  // createdAt preserved from existing
};
```

---

## Rollback and Recovery

### Per-Phase Verification

Before proceeding to next phase, verify:
```bash
# Check previous phase markers exist
grep -r "@plan:PLAN-20250117-SUBAGENTCONFIG.P$(($CURRENT_PHASE - 1))" . || exit 1

# Check tests exist (for TDD phases)
[ -f "packages/core/src/config/test/subagentManager.test.ts" ] || exit 1

# Check TypeScript compiles
npm run typecheck || exit 1
```

### Phase Rollback

If phase fails:
```bash
# Identify files modified in phase
git diff --name-only

# Revert specific files
git checkout -- packages/core/src/config/subagentManager.ts

# Or revert entire phase commit
git revert HEAD

# Re-run phase from markdown
```

---

## Completion Checklist

After Phase 16, verify:

- [ ] All 15 requirements have @requirement:markers in code
- [ ] All 16 phases have @plan:markers in code
- [ ] SubagentManager unit tests pass
- [ ] SubagentCommand integration tests pass
- [ ] End-to-end tests pass
- [ ] TypeScript compiles with strict mode
- [ ] All verification commands succeed
- [ ] Manual testing of all commands successful
- [ ] Documentation complete
- [ ] No TODO or NotYetImplemented in code
- [ ] Git history shows sequential phase commits (03→04→05...)

---

## Future Enhancements (Out of Scope)

The following are explicitly OUT OF SCOPE for this plan:

- Subagent execution/invocation commands
- Integration with SubAgentScope runtime
- Tool configuration in subagent files
- Run configuration (max_turns, max_time) in subagent files
- SubAgentScope modifications to match config structure
- Subagent templates or presets
- Export/import of subagent configurations
- Subagent versioning or history

These may be addressed in future plans once the configuration management system is stable.
