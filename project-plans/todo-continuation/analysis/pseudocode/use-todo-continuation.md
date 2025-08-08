# Pseudocode: useTodoContinuation Hook

## Purpose
React hook that monitors stream completion and triggers continuation prompts when active todos exist but no tool calls were made.

## Integration Points
- Integrates with `useGeminiStream` hook via completion callback
- Accesses todos via `useTodoContext()`
- Uses config ephemeral settings via `config.getEphemeralSetting('todo-continuation')`
- Sends out-of-band prompts via `geminiClient.sendMessageStream()`

## Hook Signature

```typescript
function useTodoContinuation(
  geminiClient: GeminiClient,
  config: Config,
  isResponding: boolean,
  onDebugMessage: (message: string) => void
): {
  handleStreamCompleted: (hadToolCalls: boolean) => void;
  continuationState: ContinuationState;
}
```

## Types

```typescript
interface ContinuationState {
  isActive: boolean;
  taskDescription?: string;
  attemptCount: number;
  lastPromptTime?: Date;
}

interface ContinuationConditions {
  streamCompleted: boolean;
  noToolCallsMade: boolean;
  hasActiveTodos: boolean;
  continuationEnabled: boolean;
  notAlreadyContinuing: boolean;
}
```

## Core Algorithm

### Initialization
```
FUNCTION useTodoContinuation(geminiClient, config, isResponding, onDebugMessage):
  // State management
  SET continuationState = {
    isActive: false,
    attemptCount: 0
  }
  
  // Dependencies
  GET todoContext = useTodoContext()
  GET todoContinuationService = useTodoContinuationService()
  
  // Refs for stable callbacks
  CREATE abortControllerRef = useRef<AbortController>()
  CREATE continuationTimeoutRef = useRef<NodeJS.Timeout>()
```

### Stream Completion Handler
```
FUNCTION handleStreamCompleted(hadToolCalls):
  onDebugMessage("[TodoContinuation] Stream completed, hadToolCalls: " + hadToolCalls)
  
  // Check all continuation conditions
  SET conditions = evaluateContinuationConditions(hadToolCalls)
  
  IF NOT shouldTriggerContinuation(conditions):
    onDebugMessage("[TodoContinuation] Conditions not met for continuation")
    RETURN
  
  // Find the most relevant active todo
  SET activeTodo = findMostRelevantActiveTodo(todoContext.todos)
  
  IF NOT activeTodo:
    onDebugMessage("[TodoContinuation] No active todo found")
    RETURN
  
  // Start continuation process
  triggerContinuation(activeTodo)
```

### Continuation Condition Evaluation
```
FUNCTION evaluateContinuationConditions(hadToolCalls):
  SET isEnabled = config.getEphemeralSetting('todo-continuation') !== false
  SET hasActiveTodos = todoContext.todos.some(todo => 
    todo.status === 'pending' OR todo.status === 'in_progress'
  )
  
  RETURN {
    streamCompleted: true,
    noToolCallsMade: NOT hadToolCalls,
    hasActiveTodos: hasActiveTodos,
    continuationEnabled: isEnabled,
    notAlreadyContinuing: NOT continuationState.isActive
  }
```

### Continuation Decision Logic
```
FUNCTION shouldTriggerContinuation(conditions):
  RETURN conditions.streamCompleted AND
         conditions.noToolCallsMade AND  
         conditions.hasActiveTodos AND
         conditions.continuationEnabled AND
         conditions.notAlreadyContinuing
```

### Find Most Relevant Todo
```
FUNCTION findMostRelevantActiveTodo(todos):
  // Priority order: in_progress > pending
  SET inProgressTodos = todos.filter(todo => todo.status === 'in_progress')
  
  IF inProgressTodos.length > 0:
    // Return first in_progress todo (there should typically be only one)
    RETURN inProgressTodos[0]
  
  SET pendingTodos = todos.filter(todo => todo.status === 'pending')
  
  IF pendingTodos.length > 0:
    // Return first pending todo
    RETURN pendingTodos[0]
  
  RETURN null
```

### Trigger Continuation
```
FUNCTION triggerContinuation(activeTodo):
  onDebugMessage("[TodoContinuation] Triggering continuation for: " + activeTodo.content)
  
  // Update state
  SET continuationState = {
    isActive: true,
    taskDescription: activeTodo.content,
    attemptCount: continuationState.attemptCount + 1,
    lastPromptTime: new Date()
  }
  
  // Generate continuation prompt
  SET isYoloMode = config.getApprovalMode() === ApprovalMode.YOLO
  SET promptConfig = {
    taskDescription: activeTodo.content,
    isYoloMode: isYoloMode
  }
  
  SET continuationPrompt = todoContinuationService.generateContinuationPrompt(promptConfig)
  
  // Send out-of-band prompt (not stored in history)
  sendOutOfBandPrompt(continuationPrompt)
```

### Out-of-Band Prompt Sending
```
FUNCTION sendOutOfBandPrompt(prompt):
  // Create new abort controller for this continuation
  abortControllerRef.current?.abort()
  abortControllerRef.current = new AbortController()
  
  TRY:
    onDebugMessage("[TodoContinuation] Sending continuation prompt")
    
    // Send prompt without storing in conversation history
    SET stream = geminiClient.sendMessageStream(
      prompt,
      abortControllerRef.current.signal,
      generatePromptId(), // Generate new prompt ID
      {
        skipHistoryStorage: true,  // Critical: don't store in history
        isContinuationPrompt: true // Mark as continuation
      }
    )
    
    // Process the response stream normally
    // The main useGeminiStream will handle the response
    
  CATCH error:
    onDebugMessage("[TodoContinuation] Error sending continuation prompt: " + error.message)
    handleContinuationError(error)
```

### Error Handling
```
FUNCTION handleContinuationError(error):
  onDebugMessage("[TodoContinuation] Continuation error: " + error.message)
  
  // Reset continuation state
  SET continuationState = {
    isActive: false,
    attemptCount: continuationState.attemptCount,
    lastPromptTime: continuationState.lastPromptTime
  }
  
  // Clean up any pending operations
  abortControllerRef.current?.abort()
  clearTimeout(continuationTimeoutRef.current)
```

### Todo Pause Handler (called by todo_pause tool)
```
FUNCTION handleTodoPause(reason):
  onDebugMessage("[TodoContinuation] Todo paused: " + reason)
  
  // Stop continuation loop
  SET continuationState = {
    isActive: false,
    taskDescription: continuationState.taskDescription,
    attemptCount: continuationState.attemptCount,
    lastPromptTime: continuationState.lastPromptTime
  }
  
  // Abort any pending continuation
  abortControllerRef.current?.abort()
  
  // Return control to user with pause reason
  RETURN {
    type: 'pause',
    reason: reason,
    message: "Task paused: " + reason
  }
```

## Cleanup and Memory Management

### Cleanup Effect
```
useEffect(() => {
  // Cleanup function
  RETURN () => {
    abortControllerRef.current?.abort()
    clearTimeout(continuationTimeoutRef.current)
  }
}, [])
```

### Dependencies Array
```
// Memoize callbacks to prevent unnecessary re-renders
SET handleStreamCompleted = useCallback(handleStreamCompletedImpl, [
  config,
  todoContext.todos,
  continuationState.isActive,
  todoContinuationService,
  geminiClient
])
```

## Integration with useGeminiStream

### Modified useGeminiStream Integration Point
```
// In useGeminiStream hook:
GET todoContinuation = useTodoContinuation(geminiClient, config, isResponding, onDebugMessage)

// After processGeminiStreamEvents completes:
IF processingStatus === StreamProcessingStatus.Completed:
  // Track if any tool calls were made during this stream
  SET hadToolCalls = toolCallRequests.length > 0
  
  // Trigger continuation check
  todoContinuation.handleStreamCompleted(hadToolCalls)
```

## Error Recovery

### Continuation Loop Protection
```
FUNCTION shouldTriggerContinuation(conditions):
  // Add loop protection
  IF continuationState.attemptCount >= MAX_CONTINUATION_ATTEMPTS:
    onDebugMessage("[TodoContinuation] Max continuation attempts reached")
    RETURN false
  
  // Add time-based protection
  IF continuationState.lastPromptTime:
    SET timeSinceLastPrompt = Date.now() - continuationState.lastPromptTime.getTime()
    IF timeSinceLastPrompt < MIN_CONTINUATION_INTERVAL_MS:
      onDebugMessage("[TodoContinuation] Too soon since last continuation")
      RETURN false
  
  RETURN conditions.streamCompleted AND
         conditions.noToolCallsMade AND  
         conditions.hasActiveTodos AND
         conditions.continuationEnabled AND
         conditions.notAlreadyContinuing
```

## Constants

```typescript
const MAX_CONTINUATION_ATTEMPTS = 3;
const MIN_CONTINUATION_INTERVAL_MS = 1000; // 1 second minimum between attempts
const CONTINUATION_TIMEOUT_MS = 30000; // 30 second timeout for responses
```