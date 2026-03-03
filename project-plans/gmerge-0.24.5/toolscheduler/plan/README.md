# CoreToolScheduler Refactoring Plan

**Plan ID:** PLAN-20260302-TOOLSCHEDULER  
**Status:** Ready for execution  
**Total Phases:** 6 implementation phases + 6 verification phases = 12 total

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

**Preflight (Phase 00a)**
- 00a: Verify all assumptions, file existence, type availability

**Type Extraction (Phases 01-02)**
- 01: Extract type definitions to `scheduler/types.ts`
- 01a: Verify type extraction
- 02: Add re-exports to `coreToolScheduler.ts` for backward compatibility
- 02a: Verify re-exports

**Tool Executor Extraction (Phases 03-05)**
- 03: Write characterization tests for tool execution behavior
- 03a: Verify characterization tests
- 04: Extract `ToolExecutor` from coreToolScheduler.ts (cut-paste, not rewrite)
- 04a: Verify extraction preserves behavior
- 05: Extract response formatting utilities
- 05a: Verify response extraction

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
03 (characterize) → 03a (verify) → 04 (extract executor) → 04a (verify) → 05 (extract response) → 05a (verify)
```

## Success Criteria

This refactoring succeeds when:

1. All 12 phases complete in order
2. All existing tests pass without modification
3. New modules have characterization test coverage
4. Types extracted to `scheduler/types.ts` with backward-compatible re-exports
5. `ToolExecutor` extracted with identical behavior
6. Response formatting extracted to utilities
7. No circular dependencies
8. Parallel batching behavior preserved
9. All requirements from requirements.md satisfied

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
- Phases 03-05 → TS-EXEC-001 through TS-EXEC-007, TS-RESP-001, TS-RESP-002, TS-COMPAT-*

## Notes for Coordinator

This plan follows COORDINATING.md rules:

- Each phase = one LLxprt Code subagent (worker or verifier)
- Use TodoWrite to create todos for ALL phases upfront
- Specify intended subagent type in each todo
- Track progress in execution-tracker.md
- NO phase skipping under any circumstances
- Verification must PASS before proceeding
