# Phase 07: A2A Utilities - TDD

## Phase ID

`PLAN-20260302-A2A.P07`

## Prerequisites

- Required: Phase 06 completed and verified
- Verification: `ls packages/core/src/agents/a2a-utils.ts` file exists
- Expected: Stub functions exist (extractMessageText, extractTaskText, extractIdsFromResponse)

## Requirements Implemented

### REQ A2A-EXEC-003: Terminal State Handling

**Full EARS Text**: When a remote agent task reaches a terminal state (completed, failed, canceled), the system shall clear the taskId from session state.

**Behavior Specification** (TDD Tests):
- GIVEN: A Task with status.state="completed"
- WHEN: extractIdsFromResponse processes it
- THEN: It shall return { contextId: task.contextId, taskId: undefined }

- GIVEN: A Task with status.state="working"
- WHEN: extractIdsFromResponse processes it
- THEN: It shall return { contextId: task.contextId, taskId: task.id }

**Why This Matters**: Tests verify that terminal state detection works correctly, ensuring task IDs are cleared when tasks complete but preserved when tasks are in-progress. This behavioral test will fail against the stub (which returns {}), proving it tests actual logic.

### REQ A2A-EXEC-004: Text Extraction from A2A Responses

**Full EARS Text**: The system shall extract text from remote agent responses (Message or Task) and return it as a ToolResult.

**Behavior Specification** (TDD Tests):
- GIVEN: A Message with parts=[{kind: 'text', text: 'Hello world'}]
- WHEN: extractMessageText processes it
- THEN: It shall return 'Hello world'

- GIVEN: A Task with status.message.parts=[{kind: 'text', text: 'Task completed'}]
- WHEN: extractTaskText processes it
- THEN: It shall include 'Task completed' in the returned text

**Why This Matters**: Tests verify actual data transformation from A2A SDK types to plain text. Stub returns empty string, so tests will fail until P08 implements extraction logic.

### REQ A2A-EXEC-008: Multi-Part Message Handling

**Full EARS Text**: The system shall support extracting text from DataPart and FilePart in remote agent responses.

**Behavior Specification** (TDD Tests):
- GIVEN: A Message with parts=[{kind: 'data', data: {result: 'success'}}]
- WHEN: extractMessageText processes it
- THEN: It shall return a text representation of the data

- GIVEN: A Message with parts=[{kind: 'file', file: {name: 'report.pdf', uri: 'gs://bucket/report.pdf'}}]
- WHEN: extractMessageText processes it
- THEN: It shall return a file reference description

**Why This Matters**: Tests verify multi-part handling works for structured data and file references, not just plain text. This ensures remote agents can return rich responses.

## Implementation Tasks

### File to Create

**`packages/core/src/agents/__tests__/a2a-utils.test.ts`** — Behavioral tests for A2A utility functions

### Test Structure and Requirements

**MANDATORY RULES**:
1. **Test BEHAVIOR, not structure**: Tests verify actual data transformation
2. **NO mocking**: Use real A2A SDK type objects (Message, Task)
3. **Tests WILL FAIL against stubs**: This proves tests verify real behavior
4. **Every test has markers**: `@plan`, `@requirement`, and `@scenario` in JSDoc
5. **Cover all part types**: TextPart, DataPart, FilePart, empty/null cases

### Required Tests

```typescript
import { describe, it, expect } from 'vitest';
import type { Message, Task, Part } from '@a2a-js/sdk';
import {
  extractMessageText,
  extractTaskText,
  extractIdsFromResponse,
} from '../a2a-utils.js';

/**
 * @plan PLAN-20260302-A2A.P07
 * @requirement A2A-EXEC-003
 * @requirement A2A-EXEC-004
 * @requirement A2A-EXEC-008
 * @scenario A2A utility functions behavioral tests
 */
describe('A2A Utilities', () => {
  /**
   * @plan PLAN-20260302-A2A.P07
   * @requirement A2A-EXEC-004
   * @scenario Extract text from Message with TextPart
   */
  describe('extractMessageText', () => {
    it('should extract text from single TextPart', () => {
      const message: Message = {
        kind: 'message',
        role: 'agent',
        messageId: 'msg-1',
        parts: [
          {
            kind: 'text',
            text: 'Hello world',
          } as Part,
        ],
      };

      const result = extractMessageText(message);
      expect(result).toBe('Hello world');
    });

    it('should concatenate multiple TextParts', () => {
      const message: Message = {
        kind: 'message',
        role: 'agent',
        messageId: 'msg-2',
        parts: [
          { kind: 'text', text: 'Part 1' } as Part,
          { kind: 'text', text: 'Part 2' } as Part,
        ],
      };

      const result = extractMessageText(message);
      expect(result).toContain('Part 1');
      expect(result).toContain('Part 2');
    });

    /**
     * @plan PLAN-20260302-A2A.P07
     * @requirement A2A-EXEC-008
     * @scenario Extract text from DataPart
     */
    it('should extract text from DataPart', () => {
      const message: Message = {
        kind: 'message',
        role: 'agent',
        messageId: 'msg-3',
        parts: [
          {
            kind: 'data',
            data: { result: 'success', count: 42 },
          } as Part,
        ],
      };

      const result = extractMessageText(message);
      // Should include some representation of the data
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('result');
      expect(result).toContain('success');
    });

    /**
     * @plan PLAN-20260302-A2A.P07
     * @requirement A2A-EXEC-008
     * @scenario Extract text from FilePart
     */
    it('should extract text from FilePart', () => {
      const message: Message = {
        kind: 'message',
        role: 'agent',
        messageId: 'msg-4',
        parts: [
          {
            kind: 'file',
            file: {
              name: 'report.pdf',
              uri: 'gs://bucket/report.pdf',
            },
          } as Part,
        ],
      };

      const result = extractMessageText(message);
      // Should include file reference
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('report.pdf');
    });

    it('should handle empty parts array', () => {
      const message: Message = {
        kind: 'message',
        role: 'agent',
        messageId: 'msg-5',
        parts: [],
      };

      const result = extractMessageText(message);
      expect(result).toBe('');
    });

    it('should handle mixed part types', () => {
      const message: Message = {
        kind: 'message',
        role: 'agent',
        messageId: 'msg-6',
        parts: [
          { kind: 'text', text: 'Analysis result:' } as Part,
          { kind: 'data', data: { score: 0.95 } } as Part,
          { kind: 'text', text: 'See attached file' } as Part,
          { kind: 'file', file: { name: 'data.csv', uri: 'gs://bucket/data.csv' } } as Part,
        ],
      };

      const result = extractMessageText(message);
      expect(result).toContain('Analysis result:');
      expect(result).toContain('score');
      expect(result).toContain('See attached file');
      expect(result).toContain('data.csv');
    });
  });

  /**
   * @plan PLAN-20260302-A2A.P07
   * @requirement A2A-EXEC-004
   * @scenario Extract text from Task responses
   */
  describe('extractTaskText', () => {
    it('should extract text from Task with status message', () => {
      const task: Task = {
        kind: 'task',
        id: 'task-1',
        contextId: 'ctx-1',
        status: {
          state: 'completed',
          message: {
            kind: 'message',
            role: 'agent',
            messageId: 'msg-7',
            parts: [
              { kind: 'text', text: 'Task completed successfully' } as Part,
            ],
          },
        },
      };

      const result = extractTaskText(task);
      expect(result).toContain('completed');
      expect(result).toContain('Task completed successfully');
    });

    it('should include task state in output', () => {
      const task: Task = {
        kind: 'task',
        id: 'task-2',
        contextId: 'ctx-2',
        status: {
          state: 'working',
        },
      };

      const result = extractTaskText(task);
      expect(result).toContain('working');
    });

    it('should extract text from Task artifacts', () => {
      const task: Task = {
        kind: 'task',
        id: 'task-3',
        contextId: 'ctx-3',
        status: {
          state: 'completed',
        },
        artifacts: [
          {
            artifactId: 'artifact-1',
            parts: [
              { kind: 'text', text: 'Artifact content' } as Part,
            ],
          },
        ],
      };

      const result = extractTaskText(task);
      expect(result).toContain('Artifact content');
    });

    it('should handle failed task state', () => {
      const task: Task = {
        kind: 'task',
        id: 'task-4',
        contextId: 'ctx-4',
        status: {
          state: 'failed',
          message: {
            kind: 'message',
            role: 'agent',
            messageId: 'msg-8',
            parts: [
              { kind: 'text', text: 'Task failed due to error' } as Part,
            ],
          },
        },
      };

      const result = extractTaskText(task);
      expect(result).toContain('failed');
      expect(result).toContain('Task failed due to error');
    });

    it('should handle canceled task state', () => {
      const task: Task = {
        kind: 'task',
        id: 'task-5',
        contextId: 'ctx-5',
        status: {
          state: 'canceled',
        },
      };

      const result = extractTaskText(task);
      expect(result).toContain('canceled');
    });

    it('should handle Task without status message', () => {
      const task: Task = {
        kind: 'task',
        id: 'task-6',
        contextId: 'ctx-6',
        status: {
          state: 'submitted',
        },
      };

      const result = extractTaskText(task);
      expect(result).toContain('submitted');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  /**
   * @plan PLAN-20260302-A2A.P07
   * @requirement A2A-EXEC-003
   * @scenario Extract contextId and taskId from responses, clear taskId on terminal states
   */
  describe('extractIdsFromResponse', () => {
    it('should extract contextId and taskId from Message', () => {
      const message: Message = {
        kind: 'message',
        role: 'agent',
        messageId: 'msg-9',
        contextId: 'ctx-7',
        taskId: 'task-7',
        parts: [],
      };

      const result = extractIdsFromResponse(message);
      expect(result.contextId).toBe('ctx-7');
      expect(result.taskId).toBe('task-7');
    });

    it('should extract contextId from Task and preserve taskId for working state', () => {
      const task: Task = {
        kind: 'task',
        id: 'task-8',
        contextId: 'ctx-8',
        status: {
          state: 'working',
        },
      };

      const result = extractIdsFromResponse(task);
      expect(result.contextId).toBe('ctx-8');
      expect(result.taskId).toBe('task-8');
    });

    it('should clear taskId for completed Task (terminal state)', () => {
      const task: Task = {
        kind: 'task',
        id: 'task-9',
        contextId: 'ctx-9',
        status: {
          state: 'completed',
        },
      };

      const result = extractIdsFromResponse(task);
      expect(result.contextId).toBe('ctx-9');
      expect(result.taskId).toBeUndefined();
    });

    it('should clear taskId for failed Task (terminal state)', () => {
      const task: Task = {
        kind: 'task',
        id: 'task-10',
        contextId: 'ctx-10',
        status: {
          state: 'failed',
        },
      };

      const result = extractIdsFromResponse(task);
      expect(result.contextId).toBe('ctx-10');
      expect(result.taskId).toBeUndefined();
    });

    it('should clear taskId for canceled Task (terminal state)', () => {
      const task: Task = {
        kind: 'task',
        id: 'task-11',
        contextId: 'ctx-11',
        status: {
          state: 'canceled',
        },
      };

      const result = extractIdsFromResponse(task);
      expect(result.contextId).toBe('ctx-11');
      expect(result.taskId).toBeUndefined();
    });

    it('should preserve taskId for submitted Task (non-terminal)', () => {
      const task: Task = {
        kind: 'task',
        id: 'task-12',
        contextId: 'ctx-12',
        status: {
          state: 'submitted',
        },
      };

      const result = extractIdsFromResponse(task);
      expect(result.contextId).toBe('ctx-12');
      expect(result.taskId).toBe('task-12');
    });

    it('should preserve taskId for input-required Task (non-terminal)', () => {
      const task: Task = {
        kind: 'task',
        id: 'task-13',
        contextId: 'ctx-13',
        status: {
          state: 'input-required',
        },
      };

      const result = extractIdsFromResponse(task);
      expect(result.contextId).toBe('ctx-13');
      expect(result.taskId).toBe('task-13');
    });

    it('should handle Message without taskId', () => {
      const message: Message = {
        kind: 'message',
        role: 'agent',
        messageId: 'msg-10',
        contextId: 'ctx-14',
        parts: [],
      };

      const result = extractIdsFromResponse(message);
      expect(result.contextId).toBe('ctx-14');
      expect(result.taskId).toBeUndefined();
    });
  });
});
```

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 07 of 27 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 06 completed by checking:
- `ls packages/core/src/agents/a2a-utils.ts` file exists
- `grep -c "@plan:PLAN-20260302-A2A.P06" packages/core/src/agents/a2a-utils.ts` returns 3
- File `project-plans/gmerge-0.24.5/a2a/plan/.verified/P06a-report.md` exists

YOUR TASK:
Create `packages/core/src/agents/__tests__/a2a-utils.test.ts` with behavioral tests for utility functions.

MANDATORY RULES:
1. Test ACTUAL DATA TRANSFORMATION (not just structure)
2. Use real A2A SDK type objects (Message, Task with all fields)
3. NO mocking - tests verify actual extraction logic
4. Every test has `@plan PLAN-20260302-A2A.P07`, `@requirement`, and `@scenario` markers in JSDoc
5. Tests WILL FAIL against stubs (proving they test real behavior)

TEST COVERAGE REQUIRED:

**extractMessageText tests** (6+ tests):
1. Single TextPart extraction
2. Multiple TextParts concatenation
3. DataPart extraction (JSON representation)
4. FilePart extraction (file reference)
5. Empty parts array
6. Mixed part types

**extractTaskText tests** (6+ tests):
1. Task with status message
2. Task state included in output
3. Task with artifacts
4. Failed task state
5. Canceled task state
6. Task without status message

**extractIdsFromResponse tests** (9+ tests):
1. Extract from Message with taskId
2. Extract from Task with working state (preserve taskId)
3. Clear taskId for completed Task (terminal)
4. Clear taskId for failed Task (terminal)
5. Clear taskId for canceled Task (terminal)
6. Preserve taskId for submitted Task (non-terminal)
7. Preserve taskId for input-required Task (non-terminal)
8. Message without taskId

IMPORTS:
```typescript
import { describe, it, expect } from 'vitest';
import type { Message, Task, Part } from '@a2a-js/sdk';
import {
  extractMessageText,
  extractTaskText,
  extractIdsFromResponse,
} from '../a2a-utils.js';
```

**Note:** SDK import will fail for now (module not found) — this is expected until P15.

DELIVERABLES:
- a2a-utils.test.ts with 21+ behavioral tests (3 describe blocks as shown above)
- All tests have @plan, @requirement, @scenario markers
- Tests use real A2A SDK type objects (no mocks)
- Tests WILL FAIL against stubs (this is expected and proves behavioral testing)
- Coverage: text extraction, multi-part handling, terminal state detection

DO NOT:
- Mock any A2A SDK types
- Test for NotYetImplemented
- Add validation logic (that's P08)
- Make tests pass (they should fail against stubs)
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers exist
grep -c "@plan:PLAN-20260302-A2A.P07" packages/core/src/agents/__tests__/a2a-utils.test.ts
# Expected: 21+ occurrences (one per test)

# Check requirements covered
grep -c "@requirement:A2A-EXEC" packages/core/src/agents/__tests__/a2a-utils.test.ts
# Expected: 21+ occurrences (each test has requirement marker)

# Run tests (they SHOULD FAIL against stubs, proving behavioral testing)
npm test -- packages/core/src/agents/__tests__/a2a-utils.test.ts 2>&1 | grep -E "(FAIL|failing|expected)"
# Expected: Tests fail (stubs return empty/wrong values)

# Check for mocks (should be NONE)
grep -E "(vi\.mock|jest\.mock|createMock)" packages/core/src/agents/__tests__/a2a-utils.test.ts
# Expected: No matches (no mocking allowed)
```

### Deferred Implementation Detection

```bash
# Check for TODO/FIXME/HACK markers
grep -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/core/src/agents/__tests__/a2a-utils.test.ts
# Expected: No matches
```

### Semantic Verification Checklist

**Does the code DO what the requirement says?**
- [ ] I read the test file (not just checked file exists)
- [ ] Tests verify extractMessageText returns actual text from Message parts (not just that function runs)
- [ ] Tests verify extractTaskText includes task state and status message
- [ ] Tests verify extractIdsFromResponse clears taskId for terminal states (completed, failed, canceled)
- [ ] Tests verify extractIdsFromResponse preserves taskId for non-terminal states (working, submitted, input-required)
- [ ] All tests have @plan, @requirement, @scenario markers

**Is this REAL testing, not placeholder?**
- [ ] No mocking (tests use real A2A SDK type objects)
- [ ] Tests verify actual data transformation (input Message/Task → output string/object)
- [ ] Tests FAIL against stubs (checked by running npm test)
- [ ] All tests have assertions (expect statements)

**Would tests FAIL if extraction logic was broken?**
- [ ] If extractMessageText returned empty string for TextPart, test would fail
- [ ] If extractIdsFromResponse didn't clear taskId for completed state, test would fail
- [ ] If extractTaskText didn't include state, test would fail

**What's MISSING (acceptable for TDD phase)?**
- Implementation logic (P08)
- SDK dependency (P15)

## Success Criteria

- All verification commands return expected results
- 21+ tests exist covering all scenarios
- Tests FAIL against stubs (proving behavioral testing)
- No mocking, no stubs
- All tests have @plan, @requirement, @scenario markers
- Tests verify actual data transformation

## Failure Recovery

If this phase fails:

1. Rollback commands:
   ```bash
   rm -f packages/core/src/agents/__tests__/a2a-utils.test.ts
   ```
2. Fix issues based on verification failures
3. Cannot proceed to Phase 07a until tests are correct and failing against stubs

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P07.md`

Contents:
```markdown
Phase: P07
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Created: packages/core/src/agents/__tests__/a2a-utils.test.ts (~300 lines)
Tests Added: 
  - extractMessageText tests (6 tests)
  - extractTaskText tests (6 tests)
  - extractIdsFromResponse tests (9 tests)
Total Tests: 21
Test Results: All FAIL against stubs (expected - proves behavioral testing)
Verification: [paste npm test output showing failures]

Next Phase: P07a (Verification of P07)
```
