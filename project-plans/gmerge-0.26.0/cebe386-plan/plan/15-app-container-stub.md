# Phase 15: AppContainer Wiring Stub

## Phase ID

`PLAN-20260325-MCPSTATUS.P15`

## Prerequisites

- Required: Phase 14a (useMessageQueue Impl Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P14a.md`
- Expected files from previous phase: Working `useMcpStatus` and `useMessageQueue` hooks
- Preflight verification: Phase 0.5 MUST be completed

## Requirements Implemented (Expanded)

### REQ-GATE-001: Slash Command Immediate Execution

**Full Text**: Slash commands shall execute immediately via `submitQuery`, regardless of MCP discovery state.
**Behavior**:
- GIVEN: `discoveryState === IN_PROGRESS` (MCP not ready)
- WHEN: User submits `/help`
- THEN: `submitQuery("/help")` called immediately, NOT queued
**Why This Matters**: Users must always be able to use slash commands regardless of MCP state.

### REQ-GATE-002: Prompt Queuing When MCP Not Ready

**Full Text**: When a user submits a non-slash-command prompt and `isMcpReady` is false, the system shall add the prompt to the message queue instead of calling `submitQuery`.
**Behavior**:
- GIVEN: `isMcpReady === false`
- WHEN: User submits "hello world"
- THEN: Prompt added to message queue, `submitQuery` NOT called
**Why This Matters**: Prevents sending prompts before MCP tools are available.

### REQ-GATE-003: Prompt Direct Submission When MCP Ready

**Full Text**: When a user submits a non-slash-command prompt and `isMcpReady` is true and `streamingState` is `Idle`, the system shall call `submitQuery` directly.
**Behavior**:
- GIVEN: `isMcpReady === true`, `streamingState === Idle`
- WHEN: User submits "hello world"
- THEN: `submitQuery("hello world")` called directly, queue not used
**Why This Matters**: Normal fast path — no delay when everything is ready.

### REQ-GATE-005: Non-Idle Prompt Submission Behavior

**Full Text**: When a user submits a non-slash-command prompt and `isMcpReady` is true and `streamingState` is not `Idle`, the system shall queue the prompt for deferred submission.
**Behavior**:
- GIVEN: `isMcpReady === true`, `streamingState === Responding`
- WHEN: User submits "hello world"
- THEN: Prompt added to message queue, `submitQuery` NOT called
**Why This Matters**: Prevents overlapping submissions during active streaming.

### REQ-UI-001: First-Queue Info Message

**Full Text**: When the first non-slash-command prompt is queued while MCP is not ready, emit a user feedback message. The counter resets per discovery cycle.
**Behavior**:
- GIVEN: `isMcpReady === false`, first prompt queued this cycle
- WHEN: User submits a prompt
- THEN: Info message emitted via `coreEvents.emitFeedback`
**Why This Matters**: Reassures users that their input is not lost.

## Implementation Tasks

### Files to Modify

- `packages/cli/src/ui/AppContainer.tsx`
  - ADD imports for `useMcpStatus`, `useMessageQueue`, `isSlashCommand`, `coreEvents`, `CoreEvent`
  - ADD `useMcpStatus(config)` call after existing `useGeminiStream` call
  - ADD `useMessageQueue({...})` call after `useMcpStatus` call
  - ADD `useRef<boolean>(false)` for `hasShownMcpQueueMessage`
  - ADD `useEffect` to reset `hasShownMcpQueueMessage` when `discoveryState === IN_PROGRESS`
  - MODIFY `handleFinalSubmit` to implement gating logic:
    1. `inputHistoryStore.addInput(trimmedValue)` BEFORE branch
    2. `isSlashCommand(trimmedValue)` → `submitQuery` immediately
    3. `isMcpReady && streamingState === Idle` → `submitQuery` directly
    4. Otherwise → info message (if first queue) + `addMessage`
  - ADD `@plan:PLAN-20260325-MCPSTATUS.P15` marker
  - ADD `@requirement:REQ-GATE-001` through `@requirement:REQ-GATE-005`, `@requirement:REQ-UI-001` markers

### Implementation from Pseudocode (app-container.md)

- Lines 01-04: Hook calls (useMcpStatus, useMessageQueue)
- Lines 07-12: useMessageQueue options (all 4 gate parameters)
- Lines 14-21: Info message tracking (useRef + useEffect reset)
- Lines 24-54: handleFinalSubmit rewrite (slash check → gate check → direct/queue)

### Key Implementation Rules

1. **inputHistoryStore.addInput BEFORE branch**: Queued prompts must still be recallable with up-arrow
2. **Slash commands never enter the queue**: `isSlashCommand` check FIRST
3. **Info message once per cycle**: useRef (not useState) — resets on IN_PROGRESS transition
4. **Dependency array for handleFinalSubmit**: `[submitQuery, addMessage, isMcpReady, streamingState, inputHistoryStore]`
5. **hasShownMcpQueueMessage is a ref**: Not in dependency array (synchronous read/write)

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-MCPSTATUS.P15
 * @requirement:REQ-GATE-001, REQ-GATE-002, REQ-GATE-003, REQ-GATE-004, REQ-GATE-005, REQ-UI-001
 * @pseudocode app-container.md lines 01-54
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -c "@plan:PLAN-20260325-MCPSTATUS.P15" packages/cli/src/ui/AppContainer.tsx
# Expected: 1+

# Check hook imports
grep "useMcpStatus" packages/cli/src/ui/AppContainer.tsx
# Expected: 1+ (import + call)
grep "useMessageQueue" packages/cli/src/ui/AppContainer.tsx
# Expected: 1+ (import + call)

# Check slash command bypass
grep "isSlashCommand" packages/cli/src/ui/AppContainer.tsx
# Expected: 1+ (import + usage in handleFinalSubmit)

# Check info message
grep "emitFeedback\|Waiting for MCP" packages/cli/src/ui/AppContainer.tsx
# Expected: 1+

# Check hasShownMcpQueueMessage ref
grep "hasShownMcpQueueMessage" packages/cli/src/ui/AppContainer.tsx
# Expected: 3+ (declaration, reset, check)

# TypeScript compiles
npm run typecheck
```


### Structural Verification Checklist

- [ ] Previous phase markers present
- [ ] No skipped phases
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

### Semantic Verification Checklist

1. **Does the code DO what the requirement says?**
   - [ ] Slash commands bypass the queue (isSlashCommand check before gating)
   - [ ] Non-slash prompts gated on isMcpReady + streamingState
   - [ ] Info message shown once per discovery cycle
   - [ ] inputHistoryStore.addInput called BEFORE queue/direct branch

2. **Is this REAL implementation, not placeholder?**
   - [ ] Real conditional logic in handleFinalSubmit
   - [ ] Real useRef + useEffect for info message tracking

3. **Would the test FAIL if implementation was removed?**
   - [ ] P16 tests will verify behavior

4. **Is the feature REACHABLE?**
   - [ ] handleFinalSubmit is called from the existing input handler
   - [ ] useMcpStatus/useMessageQueue are called in component body

5. **What's MISSING?** (expected — none for this phase)
   - [ ] (check for gaps)

## Success Criteria

- `useMcpStatus` and `useMessageQueue` hooks wired into AppContainer
- `handleFinalSubmit` implements slash bypass → gate check → direct/queue logic
- Info message emitted on first queue entry per discovery cycle
- `inputHistoryStore.addInput` called before queue/direct branch
- TypeScript compiles
- Plan markers present

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/ui/AppContainer.tsx`
2. Re-read pseudocode `app-container.md`
3. Retry the integration incrementally (hooks first, then handleFinalSubmit)

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P15.md`
