# Phase 06: A2A Utilities - Stub

## Phase ID

`PLAN-20260302-A2A.P06`

## Prerequisites

- Required: Phase 05a (Type System Implementation Verification) completed
- Verification: `npm test -- packages/core/src/agents/__tests__/types.test.ts` all tests PASS
- Expected files: 
  - `packages/core/src/agents/types.ts` with discriminated union types
  - Type guards (`isLocalAgent`, `isRemoteAgent`) and validation functions exist

## Requirements Implemented

### REQ A2A-EXEC-003: Terminal State Handling

**Full EARS Text**: When a remote agent task reaches a terminal state (completed, failed, canceled), the system shall clear the taskId from session state.

**Behavior Specification**:
- GIVEN: A remote agent returns a Task with status.state="completed"
- WHEN: The system persists session state
- THEN: It shall set taskId to undefined
- AND: contextId shall remain set for conversation continuity

- GIVEN: The next invocation to the same agent in the same session
- WHEN: The system sends a message
- THEN: It shall omit taskId, starting a new task in the same context

- GIVEN: A Task with status.state="working" or "submitted" or "input-required"
- WHEN: The system persists session state
- THEN: It shall preserve the taskId for task continuation

**Why This Matters**: Multi-turn conversations with remote agents require contextId persistence (to maintain conversation history) but must clear taskId after task completion (to allow new tasks in the same context). This prevents binding future queries to completed tasks while maintaining conversation continuity.

### REQ A2A-EXEC-004: Text Extraction from A2A Responses

**Full EARS Text**: The system shall extract text from remote agent responses (Message or Task) and return it as a ToolResult.

**Behavior Specification**:
- GIVEN: A remote agent returns a Message with parts=[{kind: 'text', text: 'Hello'}]
- WHEN: The system processes the response
- THEN: ToolResult.llmContent shall be [{text: 'Hello'}]

- GIVEN: A remote agent returns a Task with artifacts
- WHEN: The system processes the response
- THEN: ToolResult.llmContent shall include formatted task summary and artifact content
- AND: The format shall include: task state, status message (if present), and concatenated text from all artifact parts

- GIVEN: A remote agent Task reaches `failed` state
- THEN: ToolResult shall include error with type `ToolErrorType.EXECUTION_FAILED` and the failure message from the task status

- GIVEN: A remote agent Task reaches `canceled` state
- THEN: ToolResult shall include error with type `ToolErrorType.EXECUTION_FAILED` and message indicating cancellation

**Why This Matters**: LLM needs textual representation of remote agent output to understand results and continue the conversation. Text extraction must handle multiple A2A response formats (Message with text/data/file parts, Task with status messages and artifacts) and normalize them into a consistent structure for the LLM.

### REQ A2A-EXEC-008: Multi-Part Message Handling

**Full EARS Text**: The system shall support extracting text from DataPart and FilePart in remote agent responses.

**Behavior Specification**:
- GIVEN: A Message with parts=[{kind: 'data', data: {foo: 'bar'}}]
- WHEN: The system extracts text
- THEN: It shall return a representation of the data (e.g., JSON string)

- GIVEN: A Message with parts=[{kind: 'file', file: {name: 'report.pdf'}}]
- WHEN: The system extracts text
- THEN: It shall return a reference to the file

**Why This Matters**: Remote agents may return structured data (analytics results, JSON payloads) or file references (reports, diagrams) that need to be represented as text for LLM consumption. Flexible part handling ensures all response types can be processed.

## Implementation Tasks

### File to Create

**`packages/core/src/agents/a2a-utils.ts`** — Utility functions for A2A response processing

### Stub Implementation Details

For stub phase, create FUNCTION SIGNATURES with correct TypeScript types but minimal/empty implementations. Functions should return correct types to satisfy TypeScript compiler.

**Stub Functions:**

```typescript
import type { Message, Task, Part } from '@a2a-js/sdk';

/**
 * Extract text from an A2A Message response.
 * Handles TextPart, DataPart, and FilePart.
 * @plan PLAN-20260302-A2A.P06
 * @requirement A2A-EXEC-004
 * @requirement A2A-EXEC-008
 */
export function extractMessageText(message: Message): string {
  // STUB: Return empty string for now
  return '';
}

/**
 * Extract text from an A2A Task response.
 * Formats task state, status message, and artifacts.
 * @plan PLAN-20260302-A2A.P06
 * @requirement A2A-EXEC-004
 */
export function extractTaskText(task: Task): string {
  // STUB: Return empty string for now
  return '';
}

/**
 * Extract contextId and taskId from an A2A response.
 * Clears taskId if task is in terminal state (completed, failed, canceled).
 * @plan PLAN-20260302-A2A.P06
 * @requirement A2A-EXEC-003
 */
export function extractIdsFromResponse(result: Message | Task): {
  contextId?: string;
  taskId?: string;
} {
  // STUB: Return empty object for now
  return {};
}
```

**Type imports:**
- Import `Message`, `Task`, `Part` from `@a2a-js/sdk` (will be available after P15 when SDK is added)
- For stub phase, TypeScript may complain about missing SDK — this is expected and acceptable
- Comment at top: `// TODO: @a2a-js/sdk dependency will be added in Phase 15`

### Required Code Markers

Every function MUST include:
```typescript
/**
 * @plan PLAN-20260302-A2A.P06
 * @requirement A2A-EXEC-003 | A2A-EXEC-004 | A2A-EXEC-008
 */
```

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 06 of 27 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 05a completed by checking:
- `npm test -- packages/core/src/agents/__tests__/types.test.ts` all tests PASS (19+ tests)
- File `project-plans/gmerge-0.24.5/a2a/plan/.verified/P05a-report.md` exists

YOUR TASK:
Create `packages/core/src/agents/a2a-utils.ts` with stub utility functions for A2A response processing.

FUNCTIONS TO CREATE (stubs only, minimal implementations):

1. **extractMessageText(message: Message): string**
   - Purpose: Extract text from A2A Message parts (TextPart, DataPart, FilePart)
   - Stub: Return empty string ''
   - Markers: @plan PLAN-20260302-A2A.P06, @requirement A2A-EXEC-004, @requirement A2A-EXEC-008

2. **extractTaskText(task: Task): string**
   - Purpose: Format task state, status message, and artifacts as text
   - Stub: Return empty string ''
   - Markers: @plan PLAN-20260302-A2A.P06, @requirement A2A-EXEC-004

3. **extractIdsFromResponse(result: Message | Task): { contextId?: string; taskId?: string }**
   - Purpose: Extract contextId/taskId, clear taskId if terminal state
   - Stub: Return empty object {}
   - Markers: @plan PLAN-20260302-A2A.P06, @requirement A2A-EXEC-003

TYPE IMPORTS:
```typescript
import type { Message, Task, Part } from '@a2a-js/sdk';
```

**Note:** Add comment at top of file:
```typescript
// NOTE: @a2a-js/sdk dependency will be added in Phase 15
// TypeScript errors about missing module are expected for stub phase
```

STUB RULES:
- Functions return correct TypeScript types (string, object) but minimal content
- Empty string '' or empty object {} are acceptable stub returns
- No TODO comments in function bodies (clean stubs)
- All functions exported
- JSDoc includes @plan and @requirement markers

DELIVERABLES:
- a2a-utils.ts created (~40 lines)
- 3 exported functions with correct signatures
- All functions have JSDoc with markers
- File compiles (ignore SDK import errors for now)
- No implementation logic (that's P08)

DO NOT:
- Implement actual text extraction (that's P08)
- Write tests (that's P07)
- Add validation logic
- Import from @a2a-js/sdk without the TODO comment
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check file exists
ls packages/core/src/agents/a2a-utils.ts
# Expected: File exists

# Check plan markers exist
grep -c "@plan:PLAN-20260302-A2A.P06" packages/core/src/agents/a2a-utils.ts
# Expected: 3 occurrences (one per function)

# Check requirements covered
grep -c "@requirement:A2A-EXEC" packages/core/src/agents/a2a-utils.ts
# Expected: 4+ occurrences (A2A-EXEC-003, A2A-EXEC-004 x2, A2A-EXEC-008)

# Check exports
grep "^export function" packages/core/src/agents/a2a-utils.ts
# Expected: extractMessageText, extractTaskText, extractIdsFromResponse

# TypeScript compiles (will have import errors from missing SDK, acceptable)
npx tsc --noEmit packages/core/src/agents/a2a-utils.ts 2>&1 | grep "Cannot find module '@a2a-js/sdk'"
# Expected: Module not found error (acceptable for stub, SDK added in P15)
```

### Deferred Implementation Detection

```bash
# Check for TODO/FIXME in function bodies (should only be at file top)
grep -E "(TODO|FIXME|HACK|STUB)" packages/core/src/agents/a2a-utils.ts | grep -v "NOTE:"
# Expected: No matches in function bodies (only file-level comment allowed)
```

### Semantic Verification Checklist

**Does the code DO what the requirement says?**
- [ ] I read the a2a-utils.ts file (not just checked file exists)
- [ ] extractMessageText exists with signature: (message: Message) => string
- [ ] extractTaskText exists with signature: (task: Task) => string
- [ ] extractIdsFromResponse exists with signature: (result: Message | Task) => { contextId?: string; taskId?: string }
- [ ] All functions have JSDoc with @plan and @requirement markers

**Is this REAL stub implementation, not placeholder?**
- [ ] Functions return correct types (string, object)
- [ ] Stub returns are minimal but valid (empty string, empty object)
- [ ] No TODO comments in function bodies
- [ ] All functions exported

**Would stub prevent P07 tests from compiling?**
- [ ] Function signatures match what tests will expect
- [ ] Return types are correct
- [ ] SDK import has explanatory comment (so implementer knows it's expected to fail)

**What's MISSING (acceptable for stub phase)?**
- Actual text extraction logic (P08)
- Terminal state detection (P08)
- Part type handling (P08)
- Tests (P07)
- SDK dependency (P15)

## Success Criteria

- All verification commands return expected results
- a2a-utils.ts file created with 3 stub functions
- All functions have correct signatures and JSDoc markers
- File exports all functions
- Module import error for @a2a-js/sdk is expected (documented with comment)
- No TODO comments in function bodies
- Ready for P06a verification

## Failure Recovery

If this phase fails:

1. Rollback commands:
   ```bash
   rm -f packages/core/src/agents/a2a-utils.ts
   ```
2. Fix issues based on verification failures
3. Cannot proceed to Phase 06a until stubs are correct

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P06.md`

Contents:
```markdown
Phase: P06
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Created: packages/core/src/agents/a2a-utils.ts (~40 lines)

Functions Added (stubs):
  - extractMessageText(message: Message): string
  - extractTaskText(task: Task): string
  - extractIdsFromResponse(result: Message | Task): { contextId?: string; taskId?: string }

Markers: 3 @plan markers, 4+ @requirement markers

TypeScript Status: Module '@a2a-js/sdk' not found (expected, SDK added in P15)

Verification: [paste grep output showing exports and markers]

Next Phase: P06a (Verification of P06)
```
