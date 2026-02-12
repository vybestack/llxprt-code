# Phase 21: Enriched Prompts — Stub

## Phase ID

`PLAN-20260211-HIGHDENSITY.P21`

## Prerequisites

- Required: Phase 20 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P20" packages/core/src/core/geminiChat.ts | wc -l` → ≥ 1
- Expected files from previous phase:
  - `packages/core/src/core/geminiChat.ts` (orchestration fully implemented)
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### REQ-HD-010.1: Task Context Section

**Full Text**: The compression prompt template shall include a `<task_context>` section instructing the LLM to capture, for each active task or todo item: why it exists, what user request originated it, what constraints apply, what approach was chosen, and what has been tried.
**Behavior**:
- GIVEN: The compression prompt template is rendered
- WHEN: The LLM reads the prompt
- THEN: A `<task_context>` section is present inside `<state_snapshot>` with instructive comments explaining what to capture
**Why This Matters**: Without task context, the LLM loses the "why" behind each todo item after compression.

### REQ-HD-010.2: User Directives Section

**Full Text**: The compression prompt template shall include a `<user_directives>` section instructing the LLM to capture specific user feedback, corrections, and preferences, using exact quotes where possible.
**Behavior**:
- GIVEN: The compression prompt template is rendered
- WHEN: The LLM reads the prompt
- THEN: A `<user_directives>` section is present inside `<state_snapshot>` with instructive comments
**Why This Matters**: User corrections and preferences are high-value context easily lost in summarization.

### REQ-HD-010.3: Errors Encountered Section

**Full Text**: The compression prompt template shall include an `<errors_encountered>` section instructing the LLM to record errors hit, exact messages, root causes, and resolutions.
**Behavior**:
- GIVEN: The compression prompt template is rendered
- WHEN: The LLM reads the prompt
- THEN: An `<errors_encountered>` section is present inside `<state_snapshot>`
**Why This Matters**: Prevents the agent from repeating mistakes after compression loses error context.

### REQ-HD-010.4: Code References Section

**Full Text**: The compression prompt template shall include a `<code_references>` section instructing the LLM to preserve important code snippets, exact file paths, and function signatures.
**Behavior**:
- GIVEN: The compression prompt template is rendered
- WHEN: The LLM reads the prompt
- THEN: A `<code_references>` section is present inside `<state_snapshot>`
**Why This Matters**: File paths and function signatures are precise references that prose summaries tend to lose.

### REQ-HD-010.5: Prompt File Update

**Full Text**: The updated prompt sections shall be reflected in both `prompts.ts` (`getCompressionPrompt()`) and the default prompt markdown file (`compression.md` in `prompt-config/defaults/`).
**Behavior**:
- GIVEN: Both prompts.ts and compression.md exist
- WHEN: The 4 new sections are added
- THEN: Both files contain matching `<task_context>`, `<user_directives>`, `<errors_encountered>`, and `<code_references>` sections inside `<state_snapshot>`
**Why This Matters**: prompts.ts is the hardcoded fallback; compression.md is the configurable override. Both must stay in sync.

### REQ-HD-011.1: CompressionContext Todo Field

**Full Text**: The `CompressionContext` interface shall include an optional `activeTodos?: readonly Todo[]` field.
**Behavior**:
- GIVEN: The CompressionContext interface in types.ts
- WHEN: Phase 21 adds the field
- THEN: `activeTodos` is an optional readonly field of type `readonly Todo[]`
**Why This Matters**: This field enables LLM strategies to receive todo state for context-aware summarization.

### REQ-HD-012.1: CompressionContext Transcript Field

**Full Text**: The `CompressionContext` interface shall include an optional `transcriptPath?: string` field.
**Behavior**:
- GIVEN: The CompressionContext interface in types.ts
- WHEN: Phase 21 adds the field
- THEN: `transcriptPath` is an optional string field
**Why This Matters**: Enables LLM strategies to include a transcript fallback reference in summaries.

## Implementation Tasks

### Files to Modify

- `packages/core/src/core/prompts.ts`
  - ADD 4 new XML sections inside `<state_snapshot>` in `getCompressionPrompt()`:
    - `<task_context>` after `<open_questions>`
    - `<user_directives>` after `<task_context>`
    - `<errors_encountered>` after `<user_directives>`
    - `<code_references>` after `<errors_encountered>`
  - All sections added BEFORE the closing `</state_snapshot>` tag
  - Existing 5 sections (`overall_goal`, `key_knowledge`, `current_progress`, `active_tasks`, `open_questions`) UNCHANGED
  - ADD marker: `@plan:PLAN-20260211-HIGHDENSITY.P21`
  - ADD marker: `@requirement:REQ-HD-010.1, REQ-HD-010.2, REQ-HD-010.3, REQ-HD-010.4, REQ-HD-010.5`

- `packages/core/src/prompt-config/defaults/compression.md`
  - ADD same 4 new XML sections inside `<state_snapshot>`:
    - `<task_context>` after `<current_plan>`
    - `<user_directives>` after `<task_context>`
    - `<errors_encountered>` after `<user_directives>`
    - `<code_references>` after `<errors_encountered>`
  - Existing sections (`overall_goal`, `key_knowledge`, `file_system_state`, `recent_actions`, `current_plan`) UNCHANGED
  - NOTE: compression.md uses one-shot framing ("distill the entire history") — the new sections work with both framings

- `packages/core/src/core/compression/types.ts`
  - ADD `activeTodos?: readonly Todo[]` to `CompressionContext` interface
  - ADD `transcriptPath?: string` to `CompressionContext` interface
  - ADD import for Todo type from `../../tools/todo-schemas.js` (or inline the type if import causes issues)
  - ADD marker: `@plan:PLAN-20260211-HIGHDENSITY.P21`
  - ADD marker: `@requirement:REQ-HD-011.1, REQ-HD-012.1`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P21
 * @requirement REQ-HD-010.1, REQ-HD-010.2, REQ-HD-010.3, REQ-HD-010.4, REQ-HD-010.5
 * @pseudocode prompts-todos.md lines 10-95
 */
```

### Anti-Patterns to Avoid (from pseudocode)

- **DO NOT** add new XML sections OUTSIDE the `<state_snapshot>` tags
- **DO NOT** make the new sections mandatory ("You MUST fill all sections") — use instructive comments
- **DO NOT** modify the framing of existing sections
- **DO NOT** import CLI-layer types into prompts.ts — it's just a string template
- **DO NOT** change the existing 5 sections in getCompressionPrompt() or the existing 6 sections in compression.md

## Verification Commands

### Automated Checks

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. Plan markers for P21
grep -rn "@plan.*HIGHDENSITY.P21" packages/core/src/core/prompts.ts packages/core/src/core/compression/types.ts | wc -l
# Expected: ≥ 2

# 3. Requirement markers for REQ-HD-010
grep -rn "@requirement.*REQ-HD-010" packages/core/src/core/prompts.ts | wc -l
# Expected: ≥ 1

# 4. New sections exist in prompts.ts
grep -c "task_context\|user_directives\|errors_encountered\|code_references" packages/core/src/core/prompts.ts
# Expected: ≥ 4

# 5. New sections exist in compression.md
grep -c "task_context\|user_directives\|errors_encountered\|code_references" packages/core/src/prompt-config/defaults/compression.md
# Expected: ≥ 4

# 6. activeTodos field in CompressionContext
grep "activeTodos" packages/core/src/core/compression/types.ts
# Expected: ≥ 1

# 7. transcriptPath field in CompressionContext
grep "transcriptPath" packages/core/src/core/compression/types.ts
# Expected: ≥ 1

# 8. Existing sections unchanged in prompts.ts
grep -c "overall_goal\|key_knowledge\|current_progress\|active_tasks\|open_questions" packages/core/src/core/prompts.ts
# Expected: Same count as before P21

# 9. Existing sections unchanged in compression.md
grep -c "overall_goal\|key_knowledge\|file_system_state\|recent_actions\|current_plan" packages/core/src/prompt-config/defaults/compression.md
# Expected: Same count as before P21
```

### Structural Verification Checklist

- [ ] Previous phase markers present (P20 in geminiChat.ts)
- [ ] All 4 new XML sections inside `<state_snapshot>` in prompts.ts
- [ ] All 4 new XML sections inside `<state_snapshot>` in compression.md
- [ ] `activeTodos` field added to CompressionContext
- [ ] `transcriptPath` field added to CompressionContext
- [ ] Existing prompt sections unchanged
- [ ] Plan markers added to all changes
- [ ] No "TODO" or "NotImplemented" in new prompt text

### Semantic Verification Checklist (MANDATORY)

1. **Does the code DO what the requirement says?**
   - [ ] `<task_context>` section present with correct instructive comments (REQ-HD-010.1)
   - [ ] `<user_directives>` section present with correct instructive comments (REQ-HD-010.2)
   - [ ] `<errors_encountered>` section present with correct instructive comments (REQ-HD-010.3)
   - [ ] `<code_references>` section present with correct instructive comments (REQ-HD-010.4)
   - [ ] Both prompts.ts and compression.md updated consistently (REQ-HD-010.5)
   - [ ] CompressionContext has `activeTodos` field (REQ-HD-011.1)
   - [ ] CompressionContext has `transcriptPath` field (REQ-HD-012.1)

2. **Is this REAL implementation, not placeholder?**
   - [ ] Sections have substantive instructive comments (not empty tags)
   - [ ] Field types are correct (readonly Todo[], string)

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests in P22 will verify prompt output contains new sections
   - [ ] Tests in P22 will verify CompressionContext type has new fields

## Success Criteria

- TypeScript compiles
- 4 new XML sections in prompts.ts `getCompressionPrompt()`
- 4 new XML sections in compression.md
- `activeTodos` and `transcriptPath` in CompressionContext
- Existing prompt sections and structure unchanged
- All existing tests pass (no regression)

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/prompts.ts`
2. `git checkout -- packages/core/src/prompt-config/defaults/compression.md`
3. `git checkout -- packages/core/src/core/compression/types.ts`
4. Cannot proceed to Phase 22 until fixed

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P21.md`
Contents:
```markdown
Phase: P21
Completed: [timestamp]
Files Modified:
  - packages/core/src/core/prompts.ts [added 4 XML sections]
  - packages/core/src/prompt-config/defaults/compression.md [added 4 XML sections]
  - packages/core/src/core/compression/types.ts [added activeTodos, transcriptPath fields]
Verification: [paste verification output]
```
