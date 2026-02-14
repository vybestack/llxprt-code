# Phase 21a: Enriched Prompts — Stub Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P21a`

## Purpose

Verify the 4 new XML sections were added to both prompt files correctly, the CompressionContext interface has the new fields, existing sections are unchanged, and no regressions were introduced.

## Structural Checks

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

# 4. No deferred work
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/core/src/core/prompts.ts | grep -i "task_context\|user_directives\|errors_encountered\|code_references"
# Expected: No matches

# 5. No cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/prompts.ts | tail -5
# Expected: No new matches in the new sections
```

## Behavioral Verification

### prompts.ts Verification

The verifier MUST read `getCompressionPrompt()` in `packages/core/src/core/prompts.ts` and confirm:

- [ ] `<task_context>` section is inside `<state_snapshot>`, after `<open_questions>`
- [ ] `<task_context>` has instructive comments about: why tasks exist, what originated them, constraints, approach chosen, what's been tried
- [ ] `<user_directives>` section is inside `<state_snapshot>`, after `<task_context>`
- [ ] `<user_directives>` has instructive comments about: user feedback, corrections, preferences, exact quotes
- [ ] `<errors_encountered>` section is inside `<state_snapshot>`, after `<user_directives>`
- [ ] `<errors_encountered>` has instructive comments about: error messages, root causes, resolutions
- [ ] `<code_references>` section is inside `<state_snapshot>`, after `<errors_encountered>`
- [ ] `<code_references>` has instructive comments about: code snippets, file paths, function signatures
- [ ] Closing `</state_snapshot>` tag is AFTER all 9 sections (5 existing + 4 new)
- [ ] Existing 5 sections (`overall_goal`, `key_knowledge`, `current_progress`, `active_tasks`, `open_questions`) are UNCHANGED

### compression.md Verification

The verifier MUST read `packages/core/src/prompt-config/defaults/compression.md` and confirm:

- [ ] `<task_context>` section is inside `<state_snapshot>`, after `<current_plan>`
- [ ] `<user_directives>` section is inside `<state_snapshot>`, after `<task_context>`
- [ ] `<errors_encountered>` section is inside `<state_snapshot>`, after `<user_directives>`
- [ ] `<code_references>` section is inside `<state_snapshot>`, after `<errors_encountered>`
- [ ] Closing `</state_snapshot>` tag is AFTER all sections
- [ ] Existing sections (`overall_goal`, `key_knowledge`, `file_system_state`, `recent_actions`, `current_plan`) are UNCHANGED
- [ ] One-shot framing ("distill the entire history") is preserved — not changed to middle-out framing

### Prompt Consistency Check

- [ ] All 4 new section tag names match between prompts.ts and compression.md
- [ ] Instructive comments convey the same intent in both files (exact wording may differ to match framing)

### CompressionContext Type Verification

The verifier MUST read `packages/core/src/core/compression/types.ts` and confirm:

- [ ] `activeTodos?: readonly Todo[]` field present in CompressionContext
- [ ] `transcriptPath?: string` field present in CompressionContext
- [ ] Both fields are optional (marked with `?`)
- [ ] Todo type is properly imported or referenced
- [ ] Existing CompressionContext fields are UNCHANGED
- [ ] Plan marker `@plan:PLAN-20260211-HIGHDENSITY.P21` present
- [ ] Requirement markers `@requirement:REQ-HD-011.1, REQ-HD-012.1` present

### Regression Verification

```bash
# All existing tests still pass
npm run test -- --run 2>&1 | tail -10
# Expected: All pass

# All HD tests still pass
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-settings.test.ts
npm run test -- --run packages/core/src/core/__tests__/geminiChat-density.test.ts
# Expected: All pass

# Lint
npm run lint
# Expected: 0 errors

# Typecheck
npm run typecheck
# Expected: 0 errors
```

### Import Verification

- [ ] No circular imports introduced by Todo type import
- [ ] prompts.ts has NO new imports (it's just string templates)
- [ ] Existing imports in types.ts preserved

## Success Criteria

- TypeScript compiles
- 4 new sections correctly placed in both prompt files
- CompressionContext has `activeTodos` and `transcriptPath` fields
- Existing prompt content unchanged
- All tests pass
- Plan and requirement markers present

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P21 to fix
3. Re-run P21a
