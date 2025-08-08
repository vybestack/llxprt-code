# Pseudocode: todo_pause Tool

## Purpose
Tool that allows AI models to explicitly pause the continuation loop when encountering errors or blockers. Provides a clean exit mechanism from the continuation system.

## Tool Integration
- Extends existing tool system (`BaseTool`)
- Registered conditionally only during continuation scenarios
- Not available during normal operation (outside continuation context)
- Integrated with `todoContinuationService` for state management

## Tool Definition

```typescript
interface TodoPauseTool extends BaseTool {
  name: 'todo_pause';
  description: string;
  parameters: TodoPauseParametersSchema;
  execute: (input: TodoPauseInput, context: ToolExecutionContext) => Promise<TodoPauseResult>;
}

interface TodoPauseInput {
  reason: string; // Required: 1-500 characters explaining why pausing
}

interface TodoPauseResult {
  type: 'pause';
  reason: string;
  message: string;
  timestamp: Date;
}
```

## Core Implementation

### Tool Class Structure
```
CLASS TodoPauseTool EXTENDS BaseTool:
  
  CONSTRUCTOR(continuationService: TodoContinuationService):
    super()
    this.continuationService = continuationService
  
  PROPERTIES:
    name = 'todo_pause'
    description = "Pause the current todo continuation when encountering errors or blockers"
    parameters = TodoPauseParametersSchema
    version = "1.0.0"
    category = "todo"
```

### Parameter Schema Definition
```
CONST TodoPauseParametersSchema = {
  type: "object",
  properties: {
    reason: {
      type: "string",
      minLength: 1,
      maxLength: 500,
      description: "Explanation of why the task needs to be paused (e.g., missing file, configuration error, blocked dependency)"
    }
  },
  required: ["reason"],
  additionalProperties: false
}
```

### Tool Description Generation
```
FUNCTION generateDescription(): string
  RETURN [
    "Pause the current todo continuation when encountering errors or blockers.",
    "",
    "Use this tool when:",
    "- Required files or resources are missing",  
    "- Configuration issues prevent progress",
    "- Dependencies are blocking completion",
    "- Unexpected errors occur that require human intervention",
    "",
    "DO NOT use this tool for:",
    "- Normal task completion (use todo_write to update status instead)",
    "- Requesting clarification (continue with your best understanding)",
    "- Minor issues that can be worked around",
    "",
    "The reason should clearly explain what specific issue is preventing progress."
  ].join('\n')
```

### Main Execution Logic
```
FUNCTION execute(input: TodoPauseInput, context: ToolExecutionContext): Promise<TodoPauseResult>
  // Validate input
  SET validation = validatePauseInput(input)
  IF NOT validation.isValid:
    THROW new Error("Invalid pause reason: " + validation.error)
  
  // Log the pause event
  context.logger.info("[TodoPause] Task paused", {
    reason: input.reason,
    timestamp: new Date().toISOString(),
    continuationContext: context.continuationContext
  })
  
  // Signal continuation service to stop
  continuationService.handlePauseRequest(input.reason, context)
  
  // Create user-friendly message
  SET userMessage = formatPauseMessage(input.reason)
  
  // Return pause result
  RETURN {
    type: 'pause',
    reason: input.reason,
    message: userMessage,
    timestamp: new Date()
  }
```

### Input Validation
```
FUNCTION validatePauseInput(input: TodoPauseInput): ValidationResult
  IF NOT input:
    RETURN { isValid: false, error: "Input is required" }
  
  IF NOT input.reason:
    RETURN { isValid: false, error: "Reason is required" }
  
  IF typeof input.reason !== 'string':
    RETURN { isValid: false, error: "Reason must be a string" }
  
  SET trimmedReason = input.reason.trim()
  
  IF trimmedReason.length === 0:
    RETURN { isValid: false, error: "Reason cannot be empty" }
  
  IF trimmedReason.length > 500:
    RETURN { isValid: false, error: "Reason too long (max 500 characters)" }
  
  IF trimmedReason.length < 10:
    RETURN { isValid: false, error: "Reason too brief (min 10 characters for clarity)" }
  
  // Check for vague reasons
  SET vaguePhrases = [
    "can't continue",
    "stuck",
    "don't know",
    "confused",
    "need help"
  ]
  
  SET lowerReason = trimmedReason.toLowerCase()
  FOR phrase IN vaguePhrases:
    IF lowerReason.includes(phrase) AND trimmedReason.length < 50:
      RETURN { 
        isValid: false, 
        error: "Please provide a more specific explanation of the blocking issue" 
      }
  
  RETURN { isValid: true }
```

### Message Formatting
```
FUNCTION formatPauseMessage(reason: string): string
  SET timestamp = new Date().toLocaleTimeString()
  
  SET message = [
    "🛑 Task Paused",
    "",
    "Reason: " + reason,
    "Time: " + timestamp,
    "",
    "The continuation process has been stopped. You can now:",
    "• Address the blocking issue mentioned above",
    "• Modify the current task or add new tasks",  
    "• Continue with other work",
    "",
    "Resume work when the blocking issue is resolved."
  ].join('\n')
  
  RETURN message
```

### Continuation Service Integration
```
FUNCTION handlePauseRequest(reason: string, context: ToolExecutionContext): void
  // Stop any ongoing continuation processes
  context.continuationState?.abort()
  
  // Clear continuation timers
  clearContinuationTimers()
  
  // Update continuation state to paused
  SET pausedState = {
    isActive: false,
    isPaused: true,
    pauseReason: reason,
    pauseTimestamp: new Date(),
    taskDescription: context.continuationState?.taskDescription
  }
  
  // Notify continuation hook
  context.onContinuationPaused?.(pausedState)
  
  // Log pause event for debugging
  context.logger.debug("[TodoPause] Continuation paused", {
    reason: reason,
    previousState: context.continuationState,
    newState: pausedState
  })
```

### Tool Registration Logic
```
FUNCTION shouldRegisterTool(context: ToolRegistrationContext): boolean
  // Only register during continuation scenarios
  RETURN context.isContinuationActive === true
```

### Dynamic Tool Registration
```
FUNCTION registerTodoPauseTool(
  toolRegistry: ToolRegistry, 
  continuationService: TodoContinuationService,
  isContinuationActive: boolean
): void
  
  IF isContinuationActive:
    IF NOT toolRegistry.hasTool('todo_pause'):
      SET pauseTool = new TodoPauseTool(continuationService)
      toolRegistry.registerTool(pauseTool)
      
  ELSE:
    IF toolRegistry.hasTool('todo_pause'):
      toolRegistry.unregisterTool('todo_pause')
```

## Integration with Continuation System

### Hook Integration Points
```
// In useTodoContinuation hook:
FUNCTION triggerContinuation(activeTodo):
  // Register pause tool before sending continuation prompt
  registerTodoPauseTool(toolRegistry, todoContinuationService, true)
  
  // Send continuation prompt with pause tool available
  sendContinuationPrompt(prompt, { 
    includePauseTool: true 
  })

FUNCTION handleContinuationComplete():
  // Unregister pause tool after continuation ends
  registerTodoPauseTool(toolRegistry, todoContinuationService, false)
```

### Continuation State Management
```
INTERFACE ContinuationState:
  isActive: boolean
  isPaused: boolean
  pauseReason?: string
  pauseTimestamp?: Date
  taskDescription?: string
  attemptCount: number
  lastPromptTime?: Date

FUNCTION createPausedState(reason: string, currentState: ContinuationState): ContinuationState
  RETURN {
    ...currentState,
    isActive: false,
    isPaused: true,
    pauseReason: reason,
    pauseTimestamp: new Date()
  }
```

## Error Handling

### Tool Execution Errors
```
FUNCTION execute(input: TodoPauseInput, context: ToolExecutionContext): Promise<TodoPauseResult>
  TRY:
    // Main execution logic here
    RETURN pauseResult
    
  CATCH error:
    context.logger.error("[TodoPause] Tool execution error", {
      error: error.message,
      input: input,
      stack: error.stack
    })
    
    // Still try to pause continuation even if tool fails
    TRY:
      continuationService.forceStop("Tool execution error: " + error.message)
    CATCH innerError:
      context.logger.error("[TodoPause] Failed to stop continuation", innerError)
    
    // Re-throw with user-friendly message
    THROW new Error("Failed to pause task: " + error.message)
```

### Validation Error Handling
```
FUNCTION validatePauseInput(input: TodoPauseInput): ValidationResult
  TRY:
    // Validation logic here
    
  CATCH error:
    // Log validation errors but don't throw
    logger.warn("[TodoPause] Validation error", error)
    RETURN { 
      isValid: false, 
      error: "Unable to validate pause reason. Please try again." 
    }
```

## Usage Examples and Patterns

### Common Pause Scenarios
```
// Missing file
todo_pause("Cannot find config file 'app.config.js' mentioned in the task")

// Permission denied
todo_pause("Permission denied when trying to write to /etc/nginx/. Need sudo access")

// Dependency missing  
todo_pause("Package 'react-router-dom' is not installed but required for routing implementation")

// Configuration issue
todo_pause("Database connection string is missing from environment variables")

// API/Service unavailable
todo_pause("External API service is returning 503 errors. Cannot complete integration test")
```

### Invalid Pause Examples (Should be rejected)
```
// Too vague
todo_pause("stuck") // ❌ Not specific enough

// Not actually blocking
todo_pause("not sure about the best approach") // ❌ Should continue with best guess

// Task completion (wrong tool)
todo_pause("task is finished") // ❌ Should use todo_write instead
```

## Testing Support

### Mock Tool for Testing
```
CLASS MockTodoPauseTool EXTENDS TodoPauseTool:
  
  PRIVATE pauseEvents: PauseEvent[] = []
  
  FUNCTION execute(input: TodoPauseInput, context: ToolExecutionContext): Promise<TodoPauseResult>
    SET result = await super.execute(input, context)
    
    // Record pause event for test verification
    pauseEvents.push({
      reason: input.reason,
      timestamp: result.timestamp,
      context: context
    })
    
    RETURN result
  
  FUNCTION getPauseEvents(): PauseEvent[]
    RETURN [...pauseEvents]
  
  FUNCTION clearPauseEvents(): void
    pauseEvents.length = 0
```

### Test Utilities
```
FUNCTION createTestToolContext(overrides?: Partial<ToolExecutionContext>): ToolExecutionContext
  RETURN {
    logger: createMockLogger(),
    continuationState: createMockContinuationState(),
    onContinuationPaused: jest.fn(),
    ...overrides
  }
```

## Performance Considerations

### Fast Execution
```
// Tool should execute quickly to avoid blocking
FUNCTION execute(input: TodoPauseInput, context: ToolExecutionContext): Promise<TodoPauseResult>
  // Perform expensive operations asynchronously after returning result
  setImmediate(() => {
    performCleanupOperations(context)
  })
  
  // Return immediately with result
  RETURN createPauseResult(input.reason)
```

### Memory Management
```
// Clean up references when pausing
FUNCTION handlePauseRequest(reason: string, context: ToolExecutionContext): void
  // Clear any cached data
  context.continuationState?.clearCache?.()
  
  // Remove event listeners
  context.continuationState?.removeAllListeners?.()
  
  // Set continuation state to paused
  updateContinuationState(reason, context)
```