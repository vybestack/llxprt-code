# Phase 02: Pseudocode Generation

## Phase ID
`PLAN-20250117-SUBAGENTCONFIG.P02`

## Prerequisites
- Phase 01 completed
- Verification: `grep -r "@plan:PLAN-20250117-SUBAGENTCONFIG.P01" project-plans/subagentconfig/`
- Expected files from previous phase:
  - `project-plans/subagentconfig/analysis/findings.md`

## Implementation Tasks

### Pseudocode Documents to Create

#### 1. SubagentManager Pseudocode
**File**: `project-plans/subagentconfig/analysis/pseudocode/SubagentManager.md`

**Contents**:
- Line-by-line pseudocode for all SubagentManager methods
- Constructor and initialization logic
- saveSubagent (create and update paths)
- loadSubagent with error handling
- listSubagents with directory reading
- deleteSubagent with file removal
- subagentExists check
- validateProfileReference with ProfileManager integration
- Private helper methods (getSubagentPath, ensureDirectory)

**Pattern Reference**: ProfileManager implementation
**Requirements**: REQ-002, REQ-013

#### 2. SubagentCommand Pseudocode
**File**: `project-plans/subagentconfig/analysis/pseudocode/SubagentCommand.md`

**Contents**:
- Argument parsing logic for save command
- Auto mode flow (LLM call, response handling)
- Manual mode flow (direct save)
- List command formatting and display
- Show command config display
- Delete command with confirmation flow
- Edit command with editor launch
- Multi-level autocomplete logic
- Error handling for all commands
- Success message formatting

**Pattern Reference**: profileCommand.ts, chatCommand.ts
**Requirements**: REQ-003 through REQ-009, REQ-011, REQ-014, REQ-015

#### 3. Integration Pseudocode
**File**: `project-plans/subagentconfig/analysis/pseudocode/Integration.md`

**Contents**:
- SubagentManager initialization in BuiltinCommandLoader
- Command registration steps
- Services object construction
- TypeScript interface definitions
- Export/import structure

**Pattern Reference**: BuiltinCommandLoader.ts
**Requirements**: REQ-010, REQ-012

### Pseudocode Requirements

Each pseudocode file MUST include:

1. **Line Numbers**: Every line numbered for reference in implementation
2. **Explicit Logic**: No hand-waving, every conditional and loop spelled out
3. **Error Handling**: Try-catch blocks and error paths clearly marked
4. **Type Annotations**: Expected types for all variables and returns
5. **Comments**: Explain why, not what (what is in the pseudocode itself)
6. **Edge Cases**: Handle empty inputs, missing files, invalid data
7. **Requirements Mapping**: Each section maps to specific REQ-IDs

### Pseudocode Format Example

```
1. FUNCTION saveSubagent(name: string, profile: string, systemPrompt: string): Promise<void>
2.   // @requirement:REQ-002
3.   
4.   // Validate inputs
5.   IF name is empty OR name contains invalid characters THEN
6.     THROW Error("Invalid subagent name")
7.   END IF
8.   
9.   IF systemPrompt is empty THEN
10.    THROW Error("System prompt cannot be empty")
11.  END IF
12.  
13.  // Validate profile exists
14.  isValidProfile = AWAIT this.profileManager.listProfiles()
15.  IF NOT isValidProfile.includes(profile) THEN
16.    THROW Error("Profile not found")
17.  END IF
18.  
19.  // Check if subagent exists
20.  exists = AWAIT this.subagentExists(name)
21.  
22.  IF exists THEN
23.    // Load existing to preserve createdAt
24.    existing = AWAIT this.loadSubagent(name)
25.    config = {
26.      name: name,
27.      profile: profile,
28.      systemPrompt: systemPrompt,
29.      createdAt: existing.createdAt,  // Preserve
30.      updatedAt: new Date().toISOString()  // Update
31.    }
32.  ELSE
33.    // Create new with current timestamp
34.    config = {
35.      name: name,
36.      profile: profile,
37.      systemPrompt: systemPrompt,
38.      createdAt: new Date().toISOString(),
39.      updatedAt: new Date().toISOString()
40.    }
41.  END IF
42.  
43.  // Ensure directory exists
44.  AWAIT this.ensureDirectory()
45.  
46.  // Write to file
47.  filePath = this.getSubagentPath(name)
48.  jsonString = JSON.stringify(config, null, 2)
49.  
50.  TRY
51.    AWAIT fs.writeFile(filePath, jsonString, 'utf-8')
52.  CATCH error
53.    LOG error "Failed to save subagent"
54.    THROW Error("Cannot save subagent. Check permissions and disk space.")
55.  END TRY
56. END FUNCTION
```

## Verification Commands

### All Pseudocode Files Created
```bash
# Check SubagentManager pseudocode exists
[ -f "project-plans/subagentconfig/analysis/pseudocode/SubagentManager.md" ] || exit 1

# Check SubagentCommand pseudocode exists
[ -f "project-plans/subagentconfig/analysis/pseudocode/SubagentCommand.md" ] || exit 1

# Check Integration pseudocode exists
[ -f "project-plans/subagentconfig/analysis/pseudocode/Integration.md" ] || exit 1
```

### Pseudocode Quality Checks
```bash
# All files have line numbers
for file in project-plans/subagentconfig/analysis/pseudocode/*.md; do
  grep -q "^1\." "$file" || exit 1
done

# All files have requirement markers
for file in project-plans/subagentconfig/analysis/pseudocode/*.md; do
  grep -q "@requirement:REQ-" "$file" || exit 1
done

# SubagentManager has all required methods
grep -q "FUNCTION saveSubagent" project-plans/subagentconfig/analysis/pseudocode/SubagentManager.md || exit 1
grep -q "FUNCTION loadSubagent" project-plans/subagentconfig/analysis/pseudocode/SubagentManager.md || exit 1
grep -q "FUNCTION listSubagents" project-plans/subagentconfig/analysis/pseudocode/SubagentManager.md || exit 1
grep -q "FUNCTION deleteSubagent" project-plans/subagentconfig/analysis/pseudocode/SubagentManager.md || exit 1
grep -q "FUNCTION validateProfileReference" project-plans/subagentconfig/analysis/pseudocode/SubagentManager.md || exit 1

# SubagentCommand has all required commands
grep -q "saveCommand" project-plans/subagentconfig/analysis/pseudocode/SubagentCommand.md || exit 1
grep -q "listCommand" project-plans/subagentconfig/analysis/pseudocode/SubagentCommand.md || exit 1
grep -q "showCommand" project-plans/subagentconfig/analysis/pseudocode/SubagentCommand.md || exit 1
grep -q "deleteCommand" project-plans/subagentconfig/analysis/pseudocode/SubagentCommand.md || exit 1
grep -q "editCommand" project-plans/subagentconfig/analysis/pseudocode/SubagentCommand.md || exit 1
grep -q "completion" project-plans/subagentconfig/analysis/pseudocode/SubagentCommand.md || exit 1
```

## Manual Verification Checklist

- [ ] SubagentManager pseudocode covers all methods from REQ-002
- [ ] SubagentCommand pseudocode covers all subcommands
- [ ] Auto mode LLM call logic is detailed
- [ ] Manual mode argument parsing is explicit
- [ ] Multi-level autocomplete logic is position-aware
- [ ] Error handling paths are clearly marked
- [ ] Integration steps are specific and actionable
- [ ] All edge cases are handled
- [ ] Line numbers are sequential and consistent
- [ ] All REQ-IDs are mapped to pseudocode sections

## Success Criteria

- Three pseudocode files created
- All files have line numbers
- All files map to requirements
- All methods and commands covered
- Error handling explicit
- No hand-waving or TODO markers
- Implementation phases can reference line numbers

## Failure Recovery

If pseudocode is incomplete or unclear:

1. Review specification.md requirements
2. Review technical-overview.md patterns
3. Add missing methods or logic
4. Ensure line numbers are sequential
5. Test readability (can a junior dev follow it?)

## Phase Completion Marker

Create: `project-plans/subagentconfig/.completed/P02.md`

Contents:
```markdown
# Phase 02: Pseudocode Complete

**Completed**: [TIMESTAMP]

## Pseudocode Files Created
- SubagentManager.md ([LINE_COUNT] lines)
- SubagentCommand.md ([LINE_COUNT] lines)
- Integration.md ([LINE_COUNT] lines)

## Methods Covered
### SubagentManager
- constructor
- saveSubagent
- loadSubagent
- listSubagents
- deleteSubagent
- subagentExists
- validateProfileReference
- getSubagentPath (private)
- ensureDirectory (private)

### SubagentCommand
- saveCommand (auto and manual modes)
- listCommand
- showCommand
- deleteCommand
- editCommand
- completion (multi-level)

### Integration
- SubagentManager initialization
- Command registration
- Interface definitions

## Requirements Mapped
- REQ-001 through REQ-015 all covered

## Next Phase
Ready for Phase 03: SubagentManager Stub
```

---

**Note**: Pseudocode must be detailed enough for a junior developer to implement without guessing. If implementation phases deviate from pseudocode, that's fraud detection - the implementation must match or the pseudocode must be updated.
