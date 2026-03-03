# CoreToolScheduler Refactoring Project

**Status:** Design Phase  
**Target:** Reduce CoreToolScheduler from 2,139 lines to ~1,329 lines through modular extraction  
**Approach:** Incremental refactoring based on upstream patterns, preserving LLxprt's parallel batching

---

## Quick Links

- **[Design Specification](./design.md)** — Complete technical design with architecture analysis
- **[Requirements (EARS)](./requirements.md)** — 73 formal requirements in EARS format
- **Upstream Reference Commits:**
  - `5566292cc83f` — Extract static concerns
  - `b4b49e7029d3` — Extract ToolExecutor

---

## Problem Summary

`packages/core/src/core/coreToolScheduler.ts` is **2,139 lines** — a maintenance burden that:
- Makes testing difficult (requires full scheduler setup)
- Makes onboarding hard (steep learning curve)
- Increases merge conflict risk
- Violates Single Responsibility Principle
- Mixes concerns: types, validation, execution, batching, completion, utilities

---

## Proposed Solution

Extract cohesive modules while **preserving parallel batching** (LLxprt's competitive advantage):

### New Modules

| Module | Lines | Purpose |
|--------|-------|---------|
| `scheduler/types.ts` | 130 | All ToolCall state types, handler types, request/response types |
| `scheduler/tool-executor.ts` | 300 | Single-tool execution with hooks, PID, truncation, error handling |
| `scheduler/tool-validator.ts` | 80 | Tool lookup, validation, invocation building |
| `scheduler/completion-tracker.ts` | 30 | Batch completion detection |
| `utils/generateContentResponseUtilities.ts` | +150 | Response formatting, metadata extraction |
| `utils/fileUtils.ts` | +70 | Output truncation and file saving |
| `utils/tool-utils.ts` | +50 | Tool suggestions, error responses |

### What Stays in CoreToolScheduler (~1,329 lines)

- **Scheduling & queueing** — request queue management
- **State machine** — setStatusInternal, setArgsInternal, setPidInternal
- **Confirmation orchestration** — handleConfirmationResponse, message bus integration
- **Policy evaluation** — policy engine integration
- **Parallel batch orchestration (LLxprt-specific):**
  - applyBatchOutputLimits
  - bufferResult, publishBufferedResults (ordered publishing)
  - attemptExecutionOfScheduledCalls (parallel launch)
- **Inline modification** — edit-before-execute flow
- **Auto-approval** — allowlist-based confirmation bypass
- **Lifecycle** — constructor, dispose, cancelAll

---

## Key Design Decisions

1. **Types First** — Zero dependencies, safe to extract first (upstream did this)
2. **ToolExecutor as Stateless Worker** — Scheduler controls parallelism, executor doesn't know about batches
3. **Keep Parallel Batching in Scheduler** — Stateful orchestration with high coupling to scheduler state
4. **Backward Compatibility via Re-exports** — All moved types re-exported from coreToolScheduler.ts
5. **Incremental Implementation** — Multiple small PRs instead of one big bang

---

## Parallel Batching Preservation

**Critical:** LLxprt's parallel execution must be preserved exactly.

### Current Flow
1. **Batch Execution** — Launch all scheduled tools via `Promise.all()`
2. **Buffering** — Each tool buffers its result with an `executionIndex`
3. **Ordered Publishing** — Results published in execution order (0, 1, 2, ...) even if they complete out of order

### After Refactoring
- `attemptExecutionOfScheduledCalls()` still launches parallel batch
- `launchToolExecution()` delegates to `ToolExecutor.execute()` but still buffers results
- `publishBufferedResults()` still publishes in order
- **No behavioral change** — only code organization improves

### Why It's Safe
- ToolExecutor is **stateless** — returns `Promise<CompletedToolCall>`
- Scheduler maintains **all batch state**: `pendingResults`, `nextPublishIndex`, `currentBatchSize`
- Extraction boundaries don't cross batch orchestration logic

---

## Implementation Roadmap

### Phase 1: Types & Utilities (Low Risk)
- [ ] Create `scheduler/types.ts`, move all type definitions
- [ ] Move `convertToFunctionResponse` → `utils/generateContentResponseUtilities.ts`
- [ ] Move truncation → `utils/fileUtils.ts`
- [ ] Move `getToolSuggestion` → `utils/tool-utils.ts`
- [ ] Update imports, add re-exports
- [ ] Run tests (should pass unchanged)

### Phase 2: Validation (Medium Risk)
- [ ] Create `scheduler/tool-validator.ts`
- [ ] Move `buildInvocation()` and tool lookup logic
- [ ] Update scheduler to use `ToolValidator`
- [ ] Run tests

### Phase 3: Execution (Medium-High Risk)
- [ ] Create `scheduler/tool-executor.ts`
- [ ] Extract execution logic from `launchToolExecution()`
- [ ] Update scheduler to use `ToolExecutor.execute()`
- [ ] **Test parallel batching extensively**
- [ ] Run full integration tests

### Phase 4: Completion (Low Risk)
- [ ] Create `scheduler/completion-tracker.ts`
- [ ] Update `checkAndNotifyCompletion()` to use tracker
- [ ] Run tests

### Phase 5: Cleanup & Documentation
- [ ] Update nonInteractiveToolExecutor to use ToolExecutor
- [ ] Add README to `packages/core/src/scheduler/`
- [ ] Update JSDoc comments
- [ ] Final integration testing

---

## Success Criteria

- CoreToolScheduler: ~1,329 lines (38% reduction from 2,139)
- All existing tests pass without modification (except moved tests)
- No breaking changes for consumers (GeminiChat, CLI, etc.)
- Parallel batching preserves exact ordering behavior
- TypeScript compilation time maintained or improved
- Runtime performance within 5% of baseline
- Code coverage >= 90% for all extracted modules

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking imports | High | Re-export all types from coreToolScheduler.ts |
| Parallel batching regression | Critical | Keep buffering/ordering in scheduler, extensive testing |
| Hidden state dependencies | Medium | Explicit parameters, run tests after each extraction |
| Circular dependencies | Medium | Use `import type`, avoid index.ts in type files |
| Test coverage loss | Medium | Move tests with code, maintain integration tests |

---

## Testing Strategy

### Unit Tests (New Files)
- `scheduler/tool-executor.test.ts` — Single-tool execution edge cases
- `scheduler/tool-validator.test.ts` — Validation errors, tool suggestions
- `scheduler/completion-tracker.test.ts` — Completion detection
- `utils/generateContentResponseUtilities.test.ts` — Multimodal formatting
- `utils/fileUtils.test.ts` — Truncation logic
- `utils/tool-utils.test.ts` — Tool suggestions

### Integration Tests (Existing File)
- `core/coreToolScheduler.test.ts` — Full flow, parallel batching, confirmation, policy

---

## References

- **Upstream Commits:**
  - [5566292cc83f](https://github.com/google/genai-cli/commit/5566292cc83f) — Extract static concerns (+984/-949 LoC)
  - [b4b49e7029d3](https://github.com/google/genai-cli/commit/b4b49e7029d3) — Extract ToolExecutor (+653/-189 LoC)
- **Related Issues:**
  - #987 — Parallel execution race condition (already fixed)
  - #1150 — Duplicate tool_use blocks (already fixed)
  - #1301 — Batch output limits (already implemented)

---

## Questions / Decisions Log

### Q: Should we extract batch orchestration too?
**A:** No. It's tightly coupled to scheduler state and LLxprt-specific. Low ROI, high risk.

### Q: Can ToolExecutor be reused in nonInteractiveToolExecutor?
**A:** Yes. That's a key benefit — eliminates code duplication.

### Q: Will this break upstream merges?
**A:** Partially. Upstream's ToolExecutor is simpler (no parallel batching). We'll need custom merge logic for scheduler changes, but type/utility extractions will align well.

### Q: What if we discover new seam lines during implementation?
**A:** Update the design doc and requirements, communicate changes. Design is a living document.

---

## Contact / Ownership

- **Design Author:** AI Assistant (2026-03-02)
- **Reviewer:** [TBD]
- **Implementation Lead:** [TBD]
- **Target Completion:** [TBD]
