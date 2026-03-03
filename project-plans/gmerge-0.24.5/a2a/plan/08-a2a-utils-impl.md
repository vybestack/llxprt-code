# Phase 08: A2A Utilities - Implementation

## Phase ID

`PLAN-20260302-A2A.P08`

## Prerequisites

- Required: Phase 07 completed and verified (P07a)
- Verification: `npm test -- packages/core/src/agents/__tests__/a2a-utils.test.ts` tests FAIL against stubs
- Expected: Test file exists with 21+ behavioral tests

## Requirements Implemented

### REQ A2A-EXEC-003: Terminal State Handling

**Full EARS Text**: When a remote agent task reaches a terminal state (completed, failed, canceled), the system shall clear the taskId from session state.

**Behavior Specification** (Implementation):
- GIVEN: Task.status.state is one of ["completed", "failed", "canceled"]
- WHEN: extractIdsFromResponse processes the Task
- THEN: Return { contextId: task.contextId, taskId: undefined }

- GIVEN: Task.status.state is one of ["working", "submitted", "input-required"]
- WHEN: extractIdsFromResponse processes the Task
- THEN: Return { contextId: task.contextId, taskId: task.id }

**Why This Matters**: Correct terminal state detection ensures conversation context persists while allowing new tasks. This prevents queries from being bound to completed tasks while maintaining multi-turn conversation history.

### REQ A2A-EXEC-004: Text Extraction from A2A Responses

**Full EARS Text**: The system shall extract text from remote agent responses (Message or Task) and return it as a ToolResult.

**Behavior Specification** (Implementation):
- Extract text from Message.parts (TextPart, DataPart, FilePart)
- Extract text from Task.status.message and Task.artifacts
- Include task state in formatted output
- Handle empty/missing fields gracefully

**Why This Matters**: LLM needs textual representation of remote agent output. Implementation must handle all A2A response formats and normalize them into consistent text for LLM consumption.

### REQ A2A-EXEC-008: Multi-Part Message Handling

**Full EARS Text**: The system shall support extracting text from DataPart and FilePart in remote agent responses.

**Behavior Specification** (Implementation):
- DataPart: Convert data object to JSON string representation
- FilePart: Format as file reference with name and URI
- Concatenate multiple parts with separators

**Why This Matters**: Remote agents return rich structured data (JSON, files) that must be represented as text. Flexible part handling ensures all response types are processable.

## Implementation Tasks

### File to Modify

**`packages/core/src/agents/a2a-utils.ts`** — Implement utility functions

### Implementation Details

Replace stub functions with full implementations that make all tests pass.

**Implementation:**

```typescript
import type { Message, Task, Part } from '@a2a-js/sdk';

/**
 * Extract text from an A2A Message response.
 * Handles TextPart, DataPart, and FilePart.
 * @plan PLAN-20260302-A2A.P08
 * @requirement A2A-EXEC-004
 * @requirement A2A-EXEC-008
 */
export function extractMessageText(message: Message): string {
  if (!message.parts || message.parts.length === 0) {
    return '';
  }

  const textParts: string[] = [];

  for (const part of message.parts) {
    if (part.kind === 'text' && part.text) {
      textParts.push(part.text);
    } else if (part.kind === 'data' && part.data) {
      // Convert data object to JSON string for text representation
      try {
        textParts.push(JSON.stringify(part.data, null, 2));
      } catch {
        textParts.push('[Data object]');
      }
    } else if (part.kind === 'file' && part.file) {
      // Format file reference as text
      const fileName = part.file.name || 'file';
      const fileUri = part.file.uri || '';
      textParts.push(`[File: ${fileName}${fileUri ? ` (${fileUri})` : ''}]`);
    }
  }

  return textParts.join('\n');
}

/**
 * Extract text from an A2A Task response.
 * Formats task state, status message, and artifacts.
 * @plan PLAN-20260302-A2A.P08
 * @requirement A2A-EXEC-004
 */
export function extractTaskText(task: Task): string {
  const parts: string[] = [];

  // Include task state
  parts.push(`Task [${task.id}]: ${task.status.state}`);

  // Extract text from status message if present
  if (task.status.message) {
    const messageText = extractMessageText(task.status.message);
    if (messageText) {
      parts.push(messageText);
    }
  }

  // Extract text from artifacts if present
  if (task.artifacts && task.artifacts.length > 0) {
    for (const artifact of task.artifacts) {
      if (artifact.parts && artifact.parts.length > 0) {
        // Treat artifact parts like message parts
        const artifactMessage: Message = {
          kind: 'message',
          role: 'agent',
          messageId: artifact.artifactId,
          parts: artifact.parts,
        };
        const artifactText = extractMessageText(artifactMessage);
        if (artifactText) {
          parts.push(`Artifact [${artifact.artifactId}]:\n${artifactText}`);
        }
      }
    }
  }

  return parts.join('\n');
}

/**
 * Extract contextId and taskId from an A2A response.
 * Clears taskId if task is in terminal state (completed, failed, canceled).
 * @plan PLAN-20260302-A2A.P08
 * @requirement A2A-EXEC-003
 */
export function extractIdsFromResponse(result: Message | Task): {
  contextId?: string;
  taskId?: string;
} {
  if (result.kind === 'message') {
    return {
      contextId: result.contextId,
      taskId: result.taskId,
    };
  }

  // Task response
  const isTerminal = ['completed', 'failed', 'canceled'].includes(
    result.status.state,
  );

  return {
    contextId: result.contextId,
    taskId: isTerminal ? undefined : result.id,
  };
}
```

**Update markers:**
- Change @plan markers from P06 to P08 in function JSDoc
- Keep @requirement markers unchanged

**Key implementation notes:**
1. **extractMessageText**: Handles all part types (text, data, file), concatenates with newlines
2. **extractTaskText**: Formats as "Task [id]: state" + message + artifacts
3. **extractIdsFromResponse**: Terminal state detection uses array includes check for ["completed", "failed", "canceled"]
4. **Error handling**: JSON.stringify wrapped in try/catch for malformed data
5. **Empty handling**: Returns empty string for empty parts, not null/undefined

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 08 of 27 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 07a completed by checking:
- `npm test -- packages/core/src/agents/__tests__/a2a-utils.test.ts` shows FAIL output
- File `project-plans/gmerge-0.24.5/a2a/plan/.verified/P07a-report.md` exists

YOUR TASK:
Implement the three utility functions in `packages/core/src/agents/a2a-utils.ts` to make all tests pass.

FUNCTIONS TO IMPLEMENT:

1. **extractMessageText(message: Message): string**
   - Iterate over message.parts
   - For TextPart: extract text field
   - For DataPart: convert data to JSON string (try/catch)
   - For FilePart: format as "[File: name (uri)]"
   - Concatenate with newlines
   - Return empty string if no parts

2. **extractTaskText(task: Task): string**
   - Start with "Task [id]: state"
   - If task.status.message exists, call extractMessageText on it
   - If task.artifacts exists, iterate and extract text from artifact.parts
   - Concatenate all parts with newlines
   - Return formatted string

3. **extractIdsFromResponse(result: Message | Task): { contextId?: string; taskId?: string }**
   - If result.kind === 'message': return { contextId: result.contextId, taskId: result.taskId }
   - If result.kind === 'task':
     - Check if task.status.state is in ['completed', 'failed', 'canceled'] (terminal)
     - If terminal: return { contextId: result.contextId, taskId: undefined }
     - If non-terminal: return { contextId: result.contextId, taskId: result.id }

IMPLEMENTATION REQUIREMENTS:
- All 21+ tests must PASS after implementation
- No TODO comments
- Update @plan markers from P06 to P08 in JSDoc
- Handle edge cases (empty parts, missing fields, malformed JSON)
- Use try/catch for JSON.stringify (DataPart handling)

DELIVERABLES:
- a2a-utils.ts fully implemented (~80 lines total)
- All tests PASS: `npm test -- packages/core/src/agents/__tests__/a2a-utils.test.ts`
- No TODO/STUB comments

DO NOT:
- Add new functions (only implement existing 3)
- Change function signatures
- Add validation beyond what's needed for tests
- Mock test data (tests already have real objects)
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers updated to P08
grep -c "@plan PLAN-20260302-A2A.P08" packages/core/src/agents/a2a-utils.ts
# Expected: 3 (all functions updated)

# Check requirements still present
grep -c "@requirement A2A-EXEC" packages/core/src/agents/a2a-utils.ts
# Expected: 4+ (unchanged from stub)

# Run ALL tests (MUST PASS)
npm test -- packages/core/src/agents/__tests__/a2a-utils.test.ts
# Expected: All 21+ tests PASS

# Check for TODO/FIXME
grep -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/agents/a2a-utils.ts
# Expected: No matches (only NOTE comment at top is OK)

# Check for empty returns in implementation (should be conditional, not always empty)
grep -A 1 "export function extract" packages/core/src/agents/a2a-utils.ts | grep "return ''"
# Expected: Only in conditional branches (if no parts), not as sole return statement
```

### Deferred Implementation Detection

```bash
# Check for placeholder implementations
grep -E "return \[\]|return null|throw new Error\('Not" packages/core/src/agents/a2a-utils.ts
# Expected: No matches (real implementation, not placeholders)
```

### Semantic Verification Checklist

**Does the code DO what the requirement says?**
- [ ] extractMessageText handles TextPart, DataPart, FilePart
- [ ] extractMessageText concatenates multiple parts
- [ ] extractTaskText includes task state, status message, and artifacts
- [ ] extractIdsFromResponse clears taskId for terminal states
- [ ] extractIdsFromResponse preserves taskId for non-terminal states
- [ ] All 21+ tests PASS

**Would tests FAIL if implementation was broken?**
- [ ] If extractMessageText always returned '', tests would fail
- [ ] If extractIdsFromResponse didn't check terminal states, tests would fail
- [ ] If extractTaskText didn't include state, tests would fail

**Implementation Quality:**
- [ ] No hardcoded test data (functions work generically)
- [ ] Error handling for JSON.stringify (DataPart)
- [ ] Empty/null checks (parts array, status message, artifacts)
- [ ] No code duplication (extractMessageText reused in extractTaskText)

## Success Criteria

- All verification commands return expected results
- ALL 21+ tests PASS
- @plan markers updated to P08
- No TODO/STUB comments
- Implementations handle all part types and edge cases
- Functions are generic (work for any A2A response, not just test data)

## Failure Recovery

If this phase fails:

1. **Tests still failing**:
   - Review test expectations vs implementation
   - Check terminal state list (completed, failed, canceled)
   - Verify part type handling (text, data, file)
   - Re-run tests with verbose output

2. **Implementation issues**:
   - git checkout -- packages/core/src/agents/a2a-utils.ts (revert to stub)
   - Re-implement based on test requirements
   - Re-run verification

3. Cannot proceed to Phase 08a until all tests pass

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P08.md`

Contents:
```markdown
Phase: P08
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Modified: packages/core/src/agents/a2a-utils.ts (~80 lines total)

Functions Implemented:
  - extractMessageText(message: Message): string — handles TextPart, DataPart, FilePart
  - extractTaskText(task: Task): string — formats task state + message + artifacts
  - extractIdsFromResponse(result: Message | Task): { contextId?: string; taskId?: string } — terminal state detection

Test Results: All 21+ tests PASS
Verification: [paste npm test output showing all passing]

Key Implementation Details:
- Terminal states: ["completed", "failed", "canceled"]
- DataPart: JSON.stringify with try/catch
- FilePart: "[File: name (uri)]" format
- extractTaskText reuses extractMessageText for artifacts

Next Phase: P08a (Verification of P08)
```
