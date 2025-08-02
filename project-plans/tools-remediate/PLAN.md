# 🗂️ Todo List Integration Implementation Plan

This plan defines the implementation strategy for properly integrating the todo list functionality into llxprt-code to achieve parity with Claude Code.

---

## Plan Structure

```
project-plans/tools-remediate/
  overview.md                    ← Requirements specification
  plan/
    00-overview.md              ← This plan overview
    01-tool-registration.md     ← Register todo tools
    01a-tool-registration-verification.md
    02-context-injection.md     ← Session context system
    02a-context-injection-verification.md
    03-reminder-service.md      ← System reminder infrastructure
    03a-reminder-service-verification.md
    04-reminder-integration.md  ← Hook reminders into tools
    04a-reminder-integration-verification.md
    05-complexity-analyzer.md   ← Detect when todos needed
    05a-complexity-analyzer-verification.md
    06-proactive-integration.md ← Wire complexity detection
    06a-proactive-integration-verification.md
    07-response-enhancement.md  ← Enhance tool responses
    07a-response-enhancement-verification.md
    08-comprehensive-tests.md   ← Behavioral test suite
    08a-comprehensive-tests-verification.md
```

---

## Phase 1: Tool Registration [REQ-001]

### File: `01-tool-registration.md`

```markdown
# Task: Register Todo Tools in Core System

## Objective
Add TodoWrite and TodoRead tools to the core tool registry so they are available to the model.

## Requirements
- REQ-001.1: Import todo tool classes
- REQ-001.2: Register tools in createToolRegistry
- REQ-001.3: Export from tools index

## Implementation Steps

1. Edit `packages/core/src/config/config.ts`:
   - Add imports for TodoWrite and TodoRead
   - Add registerCoreTool calls in createToolRegistry method

2. Edit `packages/core/src/tools/index.ts`:
   - Export TodoWrite and TodoRead classes

## Validation
- Run `npm run typecheck` - must pass
- Run `npm run lint` - must pass
- Verify tools appear in registry.getFunctionDeclarations()

## Files to Modify
- packages/core/src/config/config.ts
- packages/core/src/tools/index.ts
```

### File: `01a-tool-registration-verification.md`

```markdown
# Verification: Tool Registration

## Checks

1. Verify imports added correctly
2. Verify registerCoreTool calls present
3. Run test to confirm tools in registry
4. Check TypeScript compilation
5. Verify no lint errors

## Test Code
```typescript
// Create test file: test-registration.ts
import { Config } from '@vybestack/llxprt-code-core';

async function verifyRegistration() {
  const config = new Config();
  await config.initialize();
  
  const registry = await config.getToolRegistry();
  const tools = registry.getFunctionDeclarations();
  
  const hasTodoWrite = tools.some(t => t.name === 'todo_write');
  const hasTodoRead = tools.some(t => t.name === 'todo_read');
  
  console.log('TodoWrite registered:', hasTodoWrite);
  console.log('TodoRead registered:', hasTodoRead);
  
  if (!hasTodoWrite || !hasTodoRead) {
    throw new Error('Todo tools not properly registered');
  }
}

verifyRegistration().catch(console.error);
```
```

---

## Phase 2: Session Context Injection [REQ-002]

### File: `02-context-injection.md`

```markdown
# Task: Implement Proper Session Context Injection

## Objective
Modify ToolRegistry to properly inject sessionId and agentId into tool instances.

## Requirements
- REQ-002.1: Inject sessionId during tool instantiation
- REQ-002.2: Support agentId for subagents
- REQ-002.3: Remove type casting hacks
- REQ-002.4: Ensure context flows through pipeline

## Implementation Steps

1. Create `packages/core/src/tools/tool-context.ts`:
   - Define ToolContext interface with sessionId and agentId
   - Create context injection mechanism

2. Modify `packages/core/src/tools/tool-registry.ts`:
   - Add context parameter to getTool method
   - Inject context into tool instances after creation

3. Update `packages/core/src/tools/todo-write.ts` and `todo-read.ts`:
   - Add context property to class
   - Remove type casting hacks
   - Use injected context

4. Update tool execution pipeline to pass context

## Validation
- Tools receive proper context without type casting
- Session isolation works correctly
- TypeScript compiles without errors

## Files to Modify
- packages/core/src/tools/tool-context.ts (new)
- packages/core/src/tools/tool-registry.ts
- packages/core/src/tools/todo-write.ts
- packages/core/src/tools/todo-read.ts
- packages/core/src/tools/tools.ts
```

### File: `02a-context-injection-verification.md`

```markdown
# Verification: Context Injection

## Checks

1. Verify ToolContext interface created
2. Verify ToolRegistry modified correctly
3. Test context injection with mock session
4. Verify no type casting in todo tools
5. Test session isolation

## Test Code
```typescript
// test-context.ts
import { ToolRegistry, TodoWrite } from '@vybestack/llxprt-code-core';

async function verifyContext() {
  const registry = new ToolRegistry();
  const context = { sessionId: 'test-123', agentId: 'agent-456' };
  
  const tool = registry.getTool('todo_write', context);
  
  // Verify context injected
  if (!tool.context || tool.context.sessionId !== 'test-123') {
    throw new Error('Context not properly injected');
  }
  
  // Test isolation
  const tool2 = registry.getTool('todo_write', { sessionId: 'test-789' });
  if (tool2.context.sessionId === tool.context.sessionId) {
    throw new Error('Session isolation failed');
  }
}
```
```

---

## Phase 3: Reminder Service Infrastructure [REQ-003]

### File: `03-reminder-service.md`

```markdown
# Task: Create Todo Reminder Service

## Objective
Build service that monitors todo state and generates appropriate system reminders.

## Requirements
- REQ-003.1: Create TodoReminderService
- REQ-003.2: Detect empty todo scenarios
- REQ-003.3: Generate state change reminders
- REQ-003.4: Format as system-reminder tags
- REQ-003.5: Include current state in reminders

## Implementation Steps

1. Create `packages/core/src/services/todo-reminder-service.ts`:
   - TodoReminderService class
   - Methods for different reminder types
   - State tracking logic

2. Define reminder templates:
   - Empty todo list reminder
   - Todo state changed reminder
   - Complex task detection reminder

3. Implement state tracking:
   - Track previous todo state
   - Detect changes
   - Generate appropriate reminders

## Validation
- Service generates correct reminder format
- Reminders include proper context
- State tracking works correctly

## Files to Create
- packages/core/src/services/todo-reminder-service.ts
- packages/core/src/services/todo-reminder-service.test.ts
```

### File: `03a-reminder-service-verification.md`

```markdown
# Verification: Reminder Service

## Behavioral Tests Required

1. Test empty todo reminder generation
2. Test state change reminder generation  
3. Test reminder formatting
4. Test state tracking accuracy
5. Test edge cases (malformed state, etc)

## Test Scenarios
```typescript
/**
 * @requirement REQ-003.2
 * @scenario Empty todo list for complex task
 * @given User asks multi-step question, todo list empty
 * @when getReminderForEmptyTodos() called
 * @then Returns reminder suggesting todo usage
 */

/**
 * @requirement REQ-003.3
 * @scenario Todo state changes
 * @given Previous state has 2 todos, new state has 3
 * @when getReminderForStateChange() called
 * @then Returns reminder with current todo list
 */
```
```

---

## Phase 4: Reminder Integration [REQ-003/004]

### File: `04-reminder-integration.md`

```markdown
# Task: Hook Reminders into Tool Execution

## Objective
Integrate reminder service with tool execution pipeline to inject reminders after todo operations.

## Requirements
- REQ-003: System reminder integration
- REQ-004.1: Trigger reminders from TodoWrite
- REQ-004.2: Add state change metadata

## Implementation Steps

1. Modify `packages/core/src/tools/todo-write.ts`:
   - Inject TodoReminderService
   - Add reminder trigger to response
   - Include state change metadata

2. Update tool execution pipeline:
   - Check for reminder triggers in responses
   - Inject reminders into conversation
   - Maintain reminder invisibility to users

3. Add reminder injection point:
   - After tool execution
   - Before response to model
   - Preserve conversation flow

## Validation
- Reminders appear after TodoWrite operations
- Reminders invisible to end users
- Model receives reminder context

## Files to Modify
- packages/core/src/tools/todo-write.ts
- packages/core/src/tools/executeToolCall.ts
- packages/core/src/core/client.ts
```

---

## Phase 5: Complexity Analyzer [REQ-005]

### File: `05-complexity-analyzer.md`

```markdown
# Task: Build Task Complexity Analyzer

## Objective
Create service that analyzes user messages to detect when todos should be used.

## Requirements
- REQ-005.1: Create ComplexityAnalyzer service
- REQ-005.2: Detect multi-step task indicators
- REQ-005.3: Generate proactive reminders
- REQ-005.4: Track usage patterns

## Implementation Steps

1. Create `packages/core/src/services/complexity-analyzer.ts`:
   - Analyze message for complexity indicators
   - Numbered lists, multiple requests
   - Multi-step instructions
   - Return complexity score

2. Define complexity rules:
   - 3+ distinct tasks mentioned
   - Numbered/bulleted lists
   - Words like "then", "after", "next"
   - Multiple questions in one message

3. Create reminder generation:
   - If complexity > threshold
   - Generate todo suggestion reminder
   - Include detected tasks

## Validation
- Correctly identifies complex requests
- Generates appropriate suggestions
- Doesn't over-trigger

## Files to Create
- packages/core/src/services/complexity-analyzer.ts
- packages/core/src/services/complexity-analyzer.test.ts
```

### File: `05a-complexity-analyzer-verification.md`

```markdown
# Verification: Complexity Analyzer

## Behavioral Tests

```typescript
/**
 * @requirement REQ-005.2
 * @scenario Multi-step request detection
 * @given "1. Add auth 2. Create tests 3. Deploy"
 * @when analyzeComplexity() called
 * @then Returns high complexity score
 * @and Identifies 3 distinct tasks
 */

/**
 * @requirement REQ-005.2
 * @scenario Simple request
 * @given "What is 2+2?"
 * @when analyzeComplexity() called
 * @then Returns low complexity score
 * @and No todo suggestion generated
 */
```
```

---

## Phase 6: Proactive Integration [REQ-005]

### File: `06-proactive-integration.md`

```markdown
# Task: Wire Complexity Detection into Message Flow

## Objective
Integrate complexity analyzer to inject todo suggestions for complex requests.

## Requirements
- REQ-005.3: Inject reminders for complex tasks
- REQ-005.5: Integrate with prompt system

## Implementation Steps

1. Modify message processing pipeline:
   - Run complexity analysis on user messages
   - Inject reminders when threshold met
   - Preserve natural conversation flow

2. Add to `packages/core/src/core/client.ts`:
   - Hook before model receives message
   - Analyze and inject if needed
   - Track reminder injection

3. Configure thresholds:
   - Complexity score threshold
   - Cooldown between suggestions
   - Context awareness

## Validation
- Complex requests trigger suggestions
- Simple requests don't
- Suggestions appear naturally

## Files to Modify
- packages/core/src/core/client.ts
- packages/core/src/config/config.ts
```

---

## Phase 7: Response Enhancement [REQ-004]

### File: `07-response-enhancement.md`

```markdown
# Task: Enhance Todo Tool Responses

## Objective
Improve todo tool responses to better guide model behavior.

## Requirements
- REQ-004.2: Add state change metadata
- REQ-004.3: Include next action suggestions
- REQ-004.4: Maintain concise format

## Implementation Steps

1. Enhance TodoWrite response:
   - Add task statistics
   - Suggest next todo to work on
   - Include completion percentage

2. Enhance TodoRead response:
   - Better formatting
   - Group by status
   - Highlight in-progress items

3. Add response metadata:
   - State change indicators
   - Reminder triggers
   - Usage hints

## Validation
- Responses guide model behavior
- Format remains concise
- Metadata properly included

## Files to Modify
- packages/core/src/tools/todo-write.ts
- packages/core/src/tools/todo-read.ts
```

---

## Phase 8: Comprehensive Testing [REQ-007]

### File: `08-comprehensive-tests.md`

```markdown
# Task: Create Behavioral Test Suite

## Objective
Build comprehensive tests validating all todo functionality.

## Requirements
- REQ-007: All behavioral test scenarios

## Test Scenarios

1. **Todo Persistence**
   - Create todos in session
   - Read back in new request
   - Verify persistence

2. **Reminder Injection**
   - Write todos
   - Verify reminder generated
   - Check reminder content

3. **Complexity Detection**
   - Test various message patterns
   - Verify correct detection
   - Check suggestion generation

4. **Multi-Agent Isolation**
   - Create todos in main session
   - Launch subagent
   - Verify isolation

5. **Error Handling**
   - Malformed todo data
   - Storage failures
   - Recovery scenarios

## Implementation
- Create test files for each component
- Use behavioral test patterns
- Achieve >90% coverage

## Files to Create
- packages/core/src/integration-tests/todo-system.test.ts
- Additional test files as needed
```

---

## Execution Protocol

### Parallel Phases
These can be executed concurrently:
- Phase 1: Tool Registration
- Phase 3: Reminder Service Infrastructure  
- Phase 5: Complexity Analyzer

### Sequential Dependencies
These must be done in order:
- Phase 2: Context Injection (after Phase 1)
- Phase 4: Reminder Integration (after Phase 3)
- Phase 6: Proactive Integration (after Phase 5)
- Phase 7: Response Enhancement (after Phase 4)
- Phase 8: Comprehensive Tests (after all others)

### Subagent Task Assignment

Each phase file is designed to be given to a subagent with:
```typescript
Task(
  description="Implement <phase-name>",
  prompt="Execute the plan in project-plans/tools-remediate/plan/<phase-file>.md. Follow all requirements exactly. Run tests and linting after implementation.",
  subagent_type="typescript-coder"
)
```

Verification phases use:
```typescript
Task(
  description="Verify <phase-name>",
  prompt="Execute verification in project-plans/tools-remediate/plan/<verification-file>.md. Run all checks and report results.",
  subagent_type="typescript-code-reviewer"
)
```

---

## Success Metrics

1. **All todo tools properly registered** and available to models
2. **Context injection works** without type casting hacks
3. **System reminders guide behavior** invisibly to users
4. **Complex tasks trigger todo suggestions** appropriately
5. **All behavioral tests pass** with >90% coverage
6. **Models consistently use todos** for multi-step tasks
7. **No regressions** in existing functionality