# Phase 01: Code Analysis and Investigation

## Phase ID
`PLAN-20250117-SUBAGENTCONFIG.P01`

## Prerequisites
- None (first phase)
- Requirements document reviewed
- Technical overview reviewed

## CRITICAL: This Phase is BLOCKING

**This phase MUST resolve the autocomplete system capabilities before proceeding.**

If multi-level completion cannot be achieved, the entire plan must PAUSE for re-evaluation.

## Implementation Tasks

### Investigation Areas

#### 1. Autocomplete System Analysis (BLOCKING)
**Question**: Does `slashCommandProcessor.ts` support multi-argument completion?

**Investigation Steps:**
```bash
# Examine completion invocation in slashCommandProcessor.ts
grep -A 20 "completion.*function" packages/cli/src/ui/hooks/slashCommandProcessor.ts

# Check how completion is called
grep -A 10 "await.*completion" packages/cli/src/ui/hooks/slashCommandProcessor.ts

# Check existing multi-arg commands
grep -A 30 "completion:" packages/cli/src/ui/commands/*.ts

# Check completion function signature in types
grep -A 5 "completion.*CommandContext" packages/cli/src/ui/commands/types.ts
```

**Expected Findings:**
- Current signature of completion function
- Parameters currently passed (context, partialArg)
- Whether fullLine or equivalent is available
- Examples of position-based completion (if any)

**Action Items:**
- Document current completion function signature
- **If fullLine is NOT available:** capture the capability gaps and outline the required code changes for later phases (no production edits in Phase 01)
- Describe feasibility constraints that must be considered when implementing the command phases
- **If enhancement not feasible:** PAUSE PLAN and document blockers for coordinator review

#### 2. Editor Launch Pattern
**Question**: What existing patterns does llxprt-code use for launching editors?

**Investigation Steps:**
```bash
# Check existing editor utilities
cat packages/core/src/utils/editor.ts

# Check text-buffer.ts usage (simpler pattern)
grep -A 20 "spawnSync.*editor" packages/cli/src/ui/components/shared/text-buffer.ts

# Check how text-buffer handles temp files
grep -A 30 "openInExternalEditor" packages/cli/src/ui/components/shared/text-buffer.ts

# Look at test patterns for mocking editor
grep -B 5 -A 10 "spawnSync.*mock" packages/cli/src/ui/components/shared/text-buffer.test.ts
```

**Expected Findings:**
- `packages/core/src/utils/editor.ts` - Full editor abstraction (complex, for diffs)
- `text-buffer.ts` - Simple `spawnSync` pattern for blocking editor launch
- Environment variable handling: `process.env.VISUAL || process.env.EDITOR || 'vi'`
- Temp file pattern with cleanup
- Test mocking patterns for `child_process.spawnSync`

**Action Items:**
- Document the preferred pattern (likely `text-buffer.ts`)
- Capture temp file creation and cleanup approach for later implementation phases
- Document spawnSync mocking pattern for tests
- Note: Use `spawnSync` (blocking) not `spawn` (async)

#### 3. Services Initialization
**Question**: How are services added to CommandContext?

**Investigation Steps:**
```bash
# Examine BuiltinCommandLoader
grep -A 50 "registerBuiltinCommands" packages/cli/src/services/BuiltinCommandLoader.ts

# Check how ProfileManager is initialized
grep -A 10 "ProfileManager" packages/cli/src/services/BuiltinCommandLoader.ts

# Check CommandContext interface
grep -A 20 "interface CommandContext" packages/cli/src/ui/commands/types.ts
```

**Expected Findings:**
- How services object is constructed
- Where ProfileManager is instantiated
- How to add SubagentManager to services

**Action Items:**
- Document services initialization pattern
- Identify every touch point that will need updates when SubagentManager is introduced (BuiltinCommandLoader, CommandContext, mock helpers, prompt processors, integration tests)
- Note dependencies (needs ProfileManager reference)

#### 4. GeminiClient Usage for One-Off Prompts
**Question**: How to use GeminiClient for single-shot LLM calls (not chat)?

**Investigation Steps:**
```bash
# Check GeminiClient methods
grep -A 5 "async.*sendMessage\|async.*generate" packages/core/src/core/client.ts

# Look for single-shot usage examples
grep -r "sendMessage.*{.*message:" packages/cli/src/ui/commands/*.ts

# Check if there's a simpler API for one-off calls
grep -A 10 "generateContent\|singlePrompt" packages/core/src/core/*.ts
```

**Expected Findings:**
- Preferred method for one-off prompts
- Chat initialization requirements
- Error handling patterns

**Action Items:**
- Document recommended pattern for auto mode
- Note any required setup/teardown
- Plan error handling strategy so later phases can translate it into tests and implementation

#### 5. File Validation Patterns
**Question**: How does ProfileManager validate files?

**Investigation Steps:**
```bash
# Examine ProfileManager validation
grep -A 20 "validateProfile\|isValid" packages/core/src/config/profileManager.ts

# Check JSON schema validation
grep -r "schema\|validate.*json" packages/core/src/config/

# Look for filename validation
grep -A 10 "isValidFilename\|sanitize" packages/core/
```

**Expected Findings:**
- JSON validation approach
- Filename sanitization
- Schema enforcement

**Action Items:**
- Document validation patterns to follow
- Plan subagent config validation for later phases
- Note security considerations (path traversal, etc.)

### Analysis Output

Create document: `project-plans/subagentconfig/analysis/findings.md`

**Contents:**
1. **Autocomplete system capabilities (CRITICAL)**
   - Current completion function signature
   - Whether fullLine is available
   - If NOT available: Precise list of changes required in later phases (no implementation yet)
   - Feasibility assessment for multi-level completion
2. Editor launch pattern (use text-buffer.ts approach)
3. Services initialization steps for SubagentManager
4. GeminiClient usage pattern for auto mode
5. File validation patterns to follow
6. Any discovered blockers or required enhancements

### Enhancement Planning (if needed)

**If fullLine is NOT available in completion function:**

1. Document the missing capabilities and list every file that would require future updates (`slashCommandProcessor.ts`, completion signatures, affected commands, hook tests, etc.).
2. Capture the test strategy that future phases must follow (new hook tests, updated command completion tests, regression coverage).
3. Escalate unresolved feasibility concerns before Phase 02 so the coordinator can adjust subsequent phases or spawn a dedicated plan.

## Verification Commands

### Investigation Complete
```bash
# Check analysis document created
[ -f "project-plans/subagentconfig/analysis/findings.md" ] || exit 1

# Ensure all investigation areas covered
grep -q "Autocomplete" project-plans/subagentconfig/analysis/findings.md || exit 1
grep -q "Editor" project-plans/subagentconfig/analysis/findings.md || exit 1
grep -q "Services" project-plans/subagentconfig/analysis/findings.md || exit 1
grep -q "GeminiClient" project-plans/subagentconfig/analysis/findings.md || exit 1
grep -q "Validation" project-plans/subagentconfig/analysis/findings.md || exit 1
```

### Multi-Level Completion PROVEN (BLOCKING)
```bash
# CRITICAL: Do not proceed to Phase 02 until feasibility is confirmed
grep -q "Multi-level completion: ACHIEVABLE" project-plans/subagentconfig/analysis/findings.md || exit 1

# Ensure Phase 01 did not modify production code
git diff --name-only -- packages | grep -q '.' && { echo "ERROR: Phase 01 must not modify production code"; exit 1; }
```

### No Unresolved Blockers
```bash
# If blockers found, must be documented with resolution
if grep -q "BLOCKER" project-plans/subagentconfig/analysis/findings.md; then
  grep -q "Resolution: IMPLEMENTED" project-plans/subagentconfig/analysis/findings.md || exit 1
fi
```

## Manual Verification Checklist

- [ ] Autocomplete system capabilities documented
- [ ] Completion function signature confirmed
- [ ] Editor launch pattern identified or planned
- [ ] Services initialization steps clear
- [ ] GeminiClient usage pattern for auto mode documented
- [ ] File validation patterns identified
- [ ] No unresolved blockers
- [ ] Findings document is clear and actionable

## Success Criteria

- Analysis document exists and is complete
- All investigation areas have findings
- Clear action items for implementation phases
- No unresolved technical blockers
- Pattern references documented for each component

## Failure Recovery

### If Autocomplete Enhancement is Required

1. Document the required code changes and affected files in findings.md
2. Update pseudocode/phase plans (P09-P11) to incorporate the enhancement work
3. Confirm the TDD strategy (tests + implementation phases) before leaving Phase 01
4. Pause the plan if feasibility remains uncertain

### If Multi-Level Completion is NOT Achievable

1. **PAUSE PLAN** - Do not proceed to Phase 02
2. Document technical blocker in findings.md
3. Propose alternative approaches:
   - Downgrade REQ-009 to "subcommand-only"
   - Redesign completion system
   - Use alternative mechanism (not tab completion)
4. Seek guidance on whether to:
   - Continue with reduced requirements
   - Abandon plan until completion system is redesigned
   - Use alternative approach

### If Other Blockers Discovered

1. Document blocker clearly in findings.md
2. Propose resolution approach
3. If blocker is critical, pause plan and seek guidance
4. Update technical-overview.md with new findings
5. Adjust subsequent phases if needed

## Phase Completion Marker

Create: `project-plans/subagentconfig/.completed/P01.md`

Contents:
```markdown
# Phase 01: Analysis Complete

**Completed**: [TIMESTAMP]

## Investigation Results

### Autocomplete System (CRITICAL)
- Current signature: [documented]
- fullLine available: [YES/NO]
- Enhancement required: [YES/NO]
- Implementation phases: [P09-P11 updates scheduled]
- **Multi-level completion: ACHIEVABLE**

### Editor Launch
- Pattern: text-buffer.ts spawnSync approach
- Reusable code: packages/cli/src/ui/components/shared/text-buffer.ts
- Environment variables: process.env.VISUAL || process.env.EDITOR || 'vi'
- Test mocking: vi.mock('child_process') with spawnSync

### Services Initialization
- Steps: [documented]
- Dependencies: [documented]

### GeminiClient Usage
- Pattern: [documented]
- Error handling: [documented]

### File Validation
- Patterns: [documented]

## Blockers
- None / [All resolved]

## Files Created
- project-plans/subagentconfig/analysis/findings.md

## Files Modified
- None (analysis-only phase)

## Next Phase
Ready for Phase 02: Pseudocode Generation
```

---

**Note**: This phase is analysis-only. Any required enhancements discovered here must be implemented in later phases using the TDD workflow.
