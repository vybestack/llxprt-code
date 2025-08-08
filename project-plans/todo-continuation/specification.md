# Feature Specification: Todo Continuation System

## Purpose

Implement a system that prompts AI models to continue working when they have active tasks in their todo list but stop streaming without making tool calls. This addresses the issue where models (particularly Qwen3 480b) lose track of their tasks during longer agentic workflows.

## Architectural Decisions

- **Pattern**: Observer pattern for stream completion detection
- **Technology Stack**: TypeScript, existing todo system integration
- **Data Flow**: Stream completion → Todo check → Continuation prompt → Model response
- **Integration Points**: useGeminiStream hook, TodoContext, Tool system

## Project Structure

```
packages/cli/src/
  ui/
    hooks/
      useTodoContinuation.ts        # Main continuation logic hook
      useTodoContinuation.spec.ts   # Tests
    contexts/
      TodoContext.tsx               # Extended with pause functionality
  services/
    todo-continuation/
      todoContinuationService.ts    # Core service logic
      todoContinuationService.spec.ts
  tools/
    todo-pause.ts                   # New tool for explicit pausing
    todo-pause.spec.ts
```

## Technical Environment
- **Type**: CLI Tool enhancement
- **Runtime**: Node.js 20.x
- **Dependencies**: Existing todo system, streaming infrastructure

## Formal Requirements

[REQ-001] Todo Continuation Detection
  [REQ-001.1] Detect when model completes streaming without tool calls
  [REQ-001.2] Check for active todos (pending or in_progress status)
  [REQ-001.3] Only trigger when control would normally return to user
  [REQ-001.4] Respect ephemeral setting todo-continuation (default: true)

[REQ-002] Continuation Prompting
  [REQ-002.1] Send out-of-band prompt to model (not stored in context)
  [REQ-002.2] Include specific task description in prompt
  [REQ-002.3] Different prompt for YOLO mode (stronger expectation)
  [REQ-002.4] Do not add prompt to conversation history

[REQ-003] Todo Pause Tool
  [REQ-003.1] Implement todo_pause(reason: string) tool
  [REQ-003.2] Tool breaks continuation loop without changing task status
  [REQ-003.3] Display pause reason to user
  [REQ-003.4] Tool only available during continuation scenarios

[REQ-004] Configuration
  [REQ-004.1] Ephemeral setting: todo-continuation (boolean)
  [REQ-004.2] Default value: true
  [REQ-004.3] Setting can be changed via /set command
  [REQ-004.4] Setting persists only for current session

## Data Schemas

```typescript
// Continuation state
const ContinuationStateSchema = z.object({
  isActive: z.boolean(),
  taskDescription: z.string().optional(),
  attemptCount: z.number().default(0),
  lastPromptTime: z.date().optional()
});

// Todo pause tool input
const TodoPauseInputSchema = z.object({
  reason: z.string().min(1).max(500)
});

// Continuation prompt
const ContinuationPromptSchema = z.object({
  taskDescription: z.string(),
  isYoloMode: z.boolean(),
  prompt: z.string()
});
```

## Example Data

```json
{
  "activeTodo": {
    "id": "task-123",
    "content": "Implement user authentication",
    "status": "in_progress"
  },
  "continuationPrompt": {
    "standard": "You have an active task: 'Implement user authentication'. Continue working on this task. Call todo_pause('reason') ONLY if there's an error preventing you from continuing.",
    "yolo": "You have an active task: 'Implement user authentication'. Continue working on this task. Call todo_pause('reason') ONLY if there's an error preventing you from continuing. You MUST continue unless there is an error preventing you from proceeding."
  },
  "pauseExample": {
    "reason": "Cannot find the config file mentioned in the task"
  }
}
```

## Constraints

- No modification to existing todo system data structures
- Continuation prompts must not be stored in conversation history
- Must integrate with existing loop detection mechanisms
- Cannot interfere with normal tool call flow
- Must handle edge cases gracefully (empty todos, malformed tasks)

## Performance Requirements

- Continuation check: <10ms after stream completion
- Prompt generation: <5ms
- No noticeable delay in user experience
- Minimal memory overhead