# CoreToolScheduler Refactoring Plan

**Plan ID:** PLAN-20260302-TOOLSCHEDULER  
**Status:** Ready for execution  
**Total Phases:** 21 main phases + 21 verification phases = 42 total

## Quick Start

1. **Read First:**
   - `../design.md` — Technical design specification
   - `../requirements.md` — All EARS requirements (TS-TYPE-* through TS-NFR-*)
   - `00-overview.md` — This plan's overview
   - `dev-docs/PLAN.md` — How to execute plans
   - `dev-docs/COORDINATING.md` — Subagent coordination rules

2. **Run Preflight:** Execute Phase 00a to verify all assumptions

3. **Execute in Order:** Phases MUST be done sequentially (no skipping)

4. **Track Progress:** Update `execution-tracker.md` after each phase

## Plan Structure

### Phase Naming Convention

- **Even numbers (01, 02, 03...):** Implementation/action phases
- **Odd "a" numbers (01a, 02a, 03a...):** Verification phases
- **Phase 00a:** Preflight verification (runs before all implementation)

### Phase Groupings

**Type Extraction (Phases 01-02)**
- 01: Extract type definitions to scheduler/types.ts
- 02: Add re-exports to coreToolScheduler.ts for backward compatibility

**Tool Executor Extraction (Phases 03-05)**
- 03: Create ToolExecutor stub
- 04: Write ToolExecutor TDD tests (behavioral, not mocks)
- 05: Implement ToolExecutor.execute() method

**Response Utilities (Phases 06-08)**
- 06: Create response utility stubs
- 07: Write response utility TDD tests
- 08: Implement convertToFunctionResponse and helpers

**File Utilities (Phases 09-11)**
- 09: Create file truncation stub
- 10: Write file truncation TDD tests
- 11: Implement saveTruncatedContent function

**Tool Utilities (Phases 12-14)**
- 12: Create tool utility stubs
- 13: Write tool utility TDD tests
- 14: Implement getToolSuggestion and createErrorResponse

**Integration (Phases 15-17)**
- 15: Integrate ToolExecutor into scheduler
- 16: Integrate response utilities into scheduler
- 17: Integrate file/tool utilities into scheduler

**Testing (Phases 18-20)**
- 18: Write parallel batch integration tests
- 19: Write reentrancy stress tests
- 20: Verify coverage and performance

**Cleanup (Phase 21)**
- 21: Remove dead code, update docs, final verification

## Critical Rules

1. **NO SKIPPING PHASES** — Execute in exact numerical order
2. **VERIFY BEFORE PROCEEDING** — Each verification phase must pass
3. **THIS IS A REFACTOR** — Extract from existing code, don't rewrite
4. **PRESERVE BEHAVIOR** — All existing tests must pass without modification
5. **PARALLEL BATCHING** — Must preserve LLxprt's competitive advantage (see design.md §5)

## File Locations

**Plan Files:**
- This directory: `project-plans/gmerge-0.24.5/toolscheduler/plan/`
- Design: `../design.md`
- Requirements: `../requirements.md`
- Validation: `../VALIDATION.md`

**Source Files Being Created:**
- `packages/core/src/scheduler/types.ts` — Type definitions (~130 lines)
- `packages/core/src/scheduler/tool-executor.ts` — Tool execution (~310 lines)

**Source Files Being Modified:**
- `packages/core/src/core/coreToolScheduler.ts` — Main scheduler (2,139 → ~1,559 lines)
- `packages/core/src/utils/generateContentResponseUtilities.ts` — Add response formatting (+150 lines)
- `packages/core/src/utils/fileUtils.ts` — Add truncation (+70 lines)
- `packages/core/src/utils/tool-utils.ts` — Add suggestions (+80 lines)

## Phase Dependencies

```
00a (preflight)
  ↓
01 (types) → 01a (verify) → 02 (re-exports) → 02a (verify)
  ↓
03 (executor stub) → 03a → 04 (executor TDD) → 04a → 05 (executor impl) → 05a
  ↓
06 (response stub) → 06a → 07 (response TDD) → 07a → 08 (response impl) → 08a
  ↓
09 (file stub) → 09a → 10 (file TDD) → 10a → 11 (file impl) → 11a
  ↓
12 (tool stub) → 12a → 13 (tool TDD) → 13a → 14 (tool impl) → 14a
  ↓
15 (executor integration) → 15a → 16 (response integration) → 16a → 17 (util integration) → 17a
  ↓
18 (batch tests) → 18a → 19 (reentrancy tests) → 19a → 20 (coverage) → 20a
  ↓
21 (cleanup) → 21a
```

## Success Criteria

This refactoring succeeds when:

1. All 42 phases complete in order
2. All existing tests pass without modification
3. New modules have 90%+ line coverage, 85%+ branch coverage
4. coreToolScheduler.ts reduced from 2,139 to ~1,559 lines (27%)
5. No circular dependencies
6. Parallel batching behavior preserved
7. All requirements from requirements.md satisfied

## Common Pitfalls

**DON'T:**
- Skip phases (even if they seem "obvious")
- Combine phases (each phase = one subagent)
- Rewrite from scratch (this is extraction)
- Change behavior (this is refactoring)
- Trust tests that only check mocks (behavioral tests required)
- Modify existing tests (they define the contract)

**DO:**
- Read design.md and requirements.md fully first
- Execute phases in exact order
- Verify after each implementation phase
- Preserve all existing behavior
- Write behavioral tests (input → output)
- Update execution-tracker.md after each phase

## Getting Help

**Lost context?** Read the "Context Recovery" section in 00-overview.md

**Phase failed?** Check the "Failure Recovery" section in that phase's file

**Unclear requirements?** Refer to requirements.md with stable requirement IDs

**Need clarification?** Read COORDINATING.md for subagent coordination rules

## Requirement Traceability

Every phase maps to specific requirements from requirements.md:

- Phases 01-02 → TS-TYPE-001 through TS-TYPE-004
- Phases 03-05 → TS-EXEC-001 through TS-EXEC-007
- Phases 06-08 → TS-RESP-001 through TS-RESP-002
- Phases 09-11 → TS-UTIL-001 (file truncation)
- Phases 12-14 → TS-UTIL-001 through TS-UTIL-002
- Phases 15-17 → TS-STATE-*, TS-CONFIRM-*, TS-LIFE-*, TS-COMPAT-*
- Phases 18-20 → TS-BATCH-001 through TS-BATCH-005, TS-TEST-*
- Phase 21 → TS-NFR-003 through TS-NFR-004

## Notes for Coordinator

This plan follows COORDINATING.md rules:

- Each phase = one LLxprt Code subagent (worker or verifier)
- Use TodoWrite to create todos for ALL phases upfront
- Specify intended subagent type in each todo
- Track progress in execution-tracker.md
- NO phase skipping under any circumstances
- Verification must PASS before proceeding
