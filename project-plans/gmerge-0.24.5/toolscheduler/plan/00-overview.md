# Plan: CoreToolScheduler Refactoring

Plan ID: PLAN-20260302-TOOLSCHEDULER
Generated: 2026-03-02
Total Phases: 11 (5 implementation + 5 verification + 1 preflight)
Requirements: All requirements from requirements.md (TS-TYPE-001 through TS-NFR-004)

## CRITICAL: This is an EXTRACT Refactoring, NOT a Rewrite

**Fundamental Approach:**
1. Write **characterization tests** that lock down EXISTING behavior of coreToolScheduler.ts
2. **Extract** (literally cut-paste) code from coreToolScheduler.ts into new modules
3. **Wire** coreToolScheduler to delegate to the extracted modules
4. **Verify** ALL existing tests + characterization tests still pass

**What This Means:**
- NO stubs that return dummy values — the extracted code IS the real code from day 1
- TDD means "write tests that characterize current behavior BEFORE extracting"
- Implementation means "move the code and update imports"
- The system is ALWAYS working at every step

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. [OK] Completed preflight verification (Phase 00a)
2. [OK] Read the design.md and requirements.md IN FULL
3. [OK] Understood this is an EXTRACT refactoring (move code, not rewrite)
4. [OK] All dependencies and types verified to exist as assumed
5. [OK] Understood the parallel batching system (LLxprt's competitive advantage)

## START HERE (For Context-Wiped Agents)

You are working on a **refactoring** of the CoreToolScheduler, a 2,139-line monolith that manages tool execution in LLxprt Code. Your job is to **extract** concerns into focused modules while preserving ALL existing behavior.

**What You MUST Read First:**
1. `project-plans/gmerge-0.24.5/toolscheduler/design.md` — Full technical design
2. `project-plans/gmerge-0.24.5/toolscheduler/requirements.md` — All EARS requirements
3. `packages/core/src/core/coreToolScheduler.ts` — The 2,139-line file being refactored
4. This plan's current phase file

**Critical Constraints:**
- This is NOT a rewrite — you extract from the existing file
- NO behavior changes — this is a refactoring
- Parallel batching MUST be preserved (see design.md §5)
- All existing tests must pass without modification
- Follow RULES.md testing requirements (behavioral tests, no mock theater)

**Key Architecture Points:**
- **Types** → Extract to `packages/core/src/scheduler/types.ts`
- **Tool Execution** → Extract to `packages/core/src/scheduler/tool-executor.ts`
- **Response Formatting** → Add to `packages/core/src/utils/generateContentResponseUtilities.ts`
- **File Truncation** → Add to `packages/core/src/utils/fileUtils.ts`
- **Tool Suggestions** → Add to `packages/core/src/utils/tool-utils.ts`
- **Scheduling/State/Batching** → Stays in `coreToolScheduler.ts`

## Context Recovery (If You've Lost Context)

If you're starting mid-plan and don't remember what's been done:

1. **Check execution tracker:** `project-plans/gmerge-0.24.5/toolscheduler/plan/execution-tracker.md`
2. **Check completed phases:** Look for `.completed/P##.md` files
3. **Check git:** `git log --oneline --grep="@plan PLAN-20260302-TOOLSCHEDULER"` to see what's been committed
4. **Read the last completed phase file** to understand what came before
5. **Run verification:** Execute the verification commands from your current phase to see what's missing

## Plan Overview

This refactoring **extracts** concerns from the 2,139-line coreToolScheduler.ts without changing behavior.

### Phase Pattern: Characterize → Extract → Verify

Each extraction follows this pattern:
1. **Characterize**: Write tests that exercise the EXISTING behavior to be extracted
2. **Verify Characterization**: Tests pass against unmodified coreToolScheduler.ts
3. **Extract**: CUT code from coreToolScheduler.ts, PASTE into new module, wire coreToolScheduler to delegate
4. **Verify Extraction**: ALL tests (existing + characterization) pass

### Extraction Targets

**Phase 01-02a: Type Definitions (CORRECT - Already Written)**
- Phase 01: Extract all ToolCall state types to `scheduler/types.ts`
- Phase 01a: Verify types extracted correctly
- Phase 02: Add re-exports for backward compatibility
- Phase 02a: Verify re-exports work
- **These phases are CORRECT** — types are pure data, no characterization needed

**Phase 03-05a: Tool Execution Extraction (NEW - Extract Pattern)**
- Phase 03: **Characterize tool execution** — Write tests that exercise `launchToolExecution` behavior through the public API
- Phase 03a: Verify characterization tests pass against UNMODIFIED coreToolScheduler.ts
- Phase 04: **Extract tool executor** — CUT launchToolExecution logic (lines ~1748-1927) into tool-executor.ts, wire coreToolScheduler to delegate
- Phase 04a: Verify ALL tests pass (existing + characterization), NO behavior change
- Phase 05: **Extract response formatting** — CUT convertToFunctionResponse + helpers (lines ~177-344) into generateContentResponseUtilities.ts
- Phase 05a: Verify ALL tests pass, file utilities added

**Note on Truncation/Suggestion Utilities:**
- `saveTruncatedContent` — Already implemented inside launchToolExecution, will be extracted WITH tool executor
- `getToolSuggestion` — Already exists in coreToolScheduler (lines 814-836), will be extracted separately if time permits
- `createErrorResponse` — Already exists (lines 346-368), will be extracted with response formatting

### What Stays in CoreToolScheduler

The following responsibilities remain in coreToolScheduler.ts because they're tightly coupled to state:

1. **Scheduling Queue Management** — Request queueing with abort handlers (lines 838-872, 874-1128)
2. **State Machine Management** — `setStatusInternal` with agent ID fallback (lines 548-728)
3. **Parallel Batch Orchestration** — LLxprt's competitive advantage:
   - `bufferResult`, `bufferError`, `bufferCancelled` (lines 1421-1486)
   - `publishBufferedResults` — Ordered publishing with reentrancy guard (lines 1496-1623)
   - `publishResult` — Single result publishing (lines 1625-1683)
   - `applyBatchOutputLimits` (lines 1694-1742)
   - `attemptExecutionOfScheduledCalls` — Parallel execution via Promise.all (lines 1929-1977)
4. **Confirmation Flow** — Message bus integration, stale correlation tracking (lines 448-526, 1130-1295)
5. **Policy Evaluation** — Policy engine integration (lines 1302-1360)
6. **Tool Governance** — Blocklist checking (lines 908-940)
7. **Validation & Context Injection** — `buildInvocation`, ContextAwareTool context (lines 797-809, 942-968)
8. **Inline Modification** — `_applyInlineModify` (lines 1384-1419)
9. **Lifecycle** — Constructor, dispose, cancelAll, isRunning (lines 421-546, 787-795, 2057-2138)
10. **Completion Detection** — checkAndNotifyCompletion (lines 1979-2008)
11. **Notification & Outcome** — notifyToolCallsUpdate, setToolCallOutcome (lines 2010-2024)
12. **Auto-Approval** — autoApproveCompatiblePendingTools (lines 2026-2055)
13. **Helper Methods** — setArgsInternal, setPidInternal (lines 730-785)

**Expected Outcome:**
- Current: 2,140 lines (actual)
- Types extracted: -130 lines (Phase 01-02)
- Tool executor extracted: NOT EXTRACTED (kept inline to preserve parallelism)
- Response formatting extracted: -150 lines (Phase 05, convertToFunctionResponse + helpers)
- **After extraction: ~1,860 lines (13% reduction)**

**Why This Differs from Design Doc:**
- Design doc proposed extracting ToolExecutor (~300 lines)
- After analysis, ToolExecutor extraction was deemed too risky for parallel batching
- Focus on safe, high-value extractions: types and pure utilities
- Tool execution logic stays inline to maintain scheduling control

## Requirements Coverage

All requirements from requirements.md are covered by this plan:

| Requirement Range | Phase Coverage | Verification Method |
|------------------|----------------|---------------------|
| TS-TYPE-001 to TS-TYPE-004 | Phase 01-02a | Compilation + runtime tests |
| TS-EXEC-001 to TS-EXEC-007 | Phase 03-05a | Characterization tests + extraction verification |
| TS-BATCH-001 to TS-BATCH-005 | Existing tests | Already covered by coreToolScheduler.raceCondition.test.ts etc. |
| TS-RESP-001 to TS-RESP-002 | Phase 05 | Extraction preserves existing behavior |
| TS-UTIL-001 to TS-UTIL-002 | Phase 05 | Extraction (getToolSuggestion, createErrorResponse already exist) |
| TS-COMPAT-001 to TS-COMPAT-002 | All phases | Compilation + existing tests |
| TS-STATE-001 to TS-STATE-003 | NOT extracted | Stays in coreToolScheduler (see "What Stays" section) |
| TS-CONFIRM-001 to TS-CONFIRM-003 | NOT extracted | Stays in coreToolScheduler (see "What Stays" section) |
| TS-LIFE-001 to TS-LIFE-003 | NOT extracted | Stays in coreToolScheduler (see "What Stays" section) |
| TS-TEST-001 to TS-TEST-004 | Phase 03-05a | Characterization tests + existing tests |
| TS-NFR-003 to TS-NFR-004 | Phase 05a | Line count + build analysis |

## Phase Execution Order

**CRITICAL:** Phases MUST be executed in exact numerical order. NO SKIPPING.

```
00a → 01 → 01a → 02 → 02a → 03 → 03a → 04 → 04a → 05 → 05a
```

**Phase Naming Convention:**
- Numbers (01, 02, 03...): Implementation/action phases
- "a" suffix (01a, 02a, 03a...): Verification phases for previous implementation
- Phase 00a: Preflight verification (must pass before any implementation)

**Phase Summary:**
- **00a**: Preflight verification (verify dependencies, types, call paths)
- **01/01a**: Extract type definitions to scheduler/types.ts
- **02/02a**: Add re-exports for backward compatibility
- **03/03a**: Characterize tool execution behavior (write tests BEFORE extracting)
- **04/04a**: Extract tool executor (CUT code, wire coreToolScheduler to delegate)
- **05/05a**: Extract response formatting utilities (CUT convertToFunctionResponse, etc.)

## Success Criteria

This plan succeeds when:

1. [ ] All 6 phases (00a through 05a) complete in order with verification passing
2. [ ] All existing tests pass without modification (behavioral tests verify no regression)
3. [ ] Characterization tests pass against BOTH old and new code (proves equivalence)
4. [ ] coreToolScheduler.ts reduced by at least 20% (target: ~460 lines, 21.5% reduction)
5. [ ] No circular dependencies detected by build tooling
6. [ ] Parallel batching behavior preserved (verified by existing tests)
7. [ ] TypeScript compilation succeeds with strict mode
8. [ ] All extracted modules use code from original file (NO rewrites)

## Failure Recovery

If any phase fails verification:

1. **DO NOT** proceed to the next phase
2. **DO** invoke an LLxprt Code Subagent to remediate the failed phase
3. **DO** re-run verification after remediation
4. **REPEAT** remediation loop until verification passes or blocked
5. **NEVER** skip ahead hoping to "come back later"

## Risk Mitigation

**High-Risk Areas:**
1. **Parallel batching logic** — Most complex, LLxprt-specific, must preserve exactly
2. **State machine transitions** — Any bugs here break tool execution
3. **Confirmation flow** — Message bus integration is subtle and race-prone
4. **Agent ID fallback** — Logic used in multiple places, must remain consistent

**Mitigation Strategies:**
1. Extract static concerns first (types, utilities) to reduce risk
2. Extract ToolExecutor with comprehensive tests before integrating
3. Write integration tests for parallel batching BEFORE touching scheduler
4. Maintain 100% backward compatibility (re-exports, same API)
5. Run full test suite after EVERY phase

## Plan Maintenance Notes

**When to Update This Plan:**
- Preflight verification finds incorrect assumptions → Update Phase 00a and affected phases
- New requirements discovered during implementation → Add new phases at end
- Phase dependencies change → Update phase prerequisite sections
- Integration points identified → Add to "What Stays in CoreToolScheduler" section

**How to Update:**
1. Update affected phase files with correct information
2. Update execution-tracker.md to reflect changes
3. DO NOT renumber existing phases (causes coordination confusion)
4. Add new phases with next available number (e.g., 22, 23...)

## Notes for Coordinator

This plan is designed for subagent-based execution per COORDINATING.md:

- Each phase gets exactly ONE subagent (worker or verifier)
- Verification must PASS before proceeding to next phase
- Use TodoWrite to create todos for ALL phases upfront
- Each todo MUST specify the intended LLxprt Code subagent type
- Track progress in execution-tracker.md after EACH phase
