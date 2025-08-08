# Pseudocode: todoContinuationService

## Purpose
Service responsible for generating continuation prompts, managing continuation state, and providing utilities for the todo continuation system.

## Service Interface

```typescript
interface TodoContinuationService {
  generateContinuationPrompt(config: ContinuationPromptConfig): string;
  checkContinuationConditions(context: ContinuationContext): ContinuationEvaluation;
  formatTaskDescription(todo: Todo): string;
  shouldAllowContinuation(config: Config, state: ContinuationState): boolean;
  createContinuationState(): ContinuationState;
}

interface ContinuationPromptConfig {
  taskDescription: string;
  isYoloMode: boolean;
  attemptCount?: number;
  previousFailure?: string;
}

interface ContinuationContext {
  todos: Todo[];
  hadToolCalls: boolean;
  isResponding: boolean;
  config: Config;
  currentState: ContinuationState;
}

interface ContinuationEvaluation {
  shouldContinue: boolean;
  reason: string;
  activeTodo?: Todo;
  conditions: {
    hasActiveTodos: boolean;
    noToolCallsMade: boolean;
    continuationEnabled: boolean;
    notCurrentlyContinuing: boolean;
    withinAttemptLimits: boolean;
    withinTimeConstraints: boolean;
  };
}
```

## Core Implementation

### Service Class Structure
```
CLASS TodoContinuationService:
  
  PRIVATE CONSTANTS:
    MAX_CONTINUATION_ATTEMPTS = 3
    MIN_CONTINUATION_INTERVAL_MS = 1000
    CONTINUATION_TIMEOUT_MS = 30000
    MAX_TASK_DESCRIPTION_LENGTH = 200
  
  PRIVATE MEMBERS:
    logger: Logger
    promptTemplates: ContinuationPromptTemplates
```

### Continuation Prompt Generation
```
FUNCTION generateContinuationPrompt(config: ContinuationPromptConfig): string
  SET taskDescription = truncateTaskDescription(config.taskDescription)
  
  IF config.isYoloMode:
    RETURN generateYoloModePrompt(taskDescription, config.attemptCount)
  ELSE:
    RETURN generateStandardPrompt(taskDescription, config.attemptCount)
```

### Standard Prompt Template
```
FUNCTION generateStandardPrompt(taskDescription: string, attemptCount?: number): string
  SET basePrompt = [
    "You have an active task that needs completion:",
    "'" + taskDescription + "'",
    "",
    "Continue working on this task. Call todo_pause('reason') ONLY if there's an error preventing you from continuing.",
    "",
    "Remember to:",
    "- Focus on the specific task described",
    "- Make concrete progress toward completion", 
    "- Update the task status when appropriate",
    "- Use todo_pause() if you encounter blockers"
  ].join('\n')
  
  IF attemptCount AND attemptCount > 1:
    SET retryNote = "\n\nNote: This is continuation attempt #" + attemptCount + ". Please make sure to take concrete action."
    RETURN basePrompt + retryNote
  
  RETURN basePrompt
```

### YOLO Mode Prompt Template  
```
FUNCTION generateYoloModePrompt(taskDescription: string, attemptCount?: number): string
  SET basePrompt = [
    "CONTINUE TASK IMMEDIATELY:",
    "'" + taskDescription + "'",
    "",
    "You MUST continue working on this task. Call todo_pause('reason') ONLY if there's an error preventing you from proceeding.",
    "",
    "YOLO MODE - Take action now:",
    "- Execute the task without asking for confirmation",
    "- Make concrete progress immediately",
    "- Only pause if there are actual blocking errors",
    "- Update task status when complete"
  ].join('\n')
  
  IF attemptCount AND attemptCount > 1:
    SET urgentRetry = "\n\nATTEMPT #" + attemptCount + " - YOU MUST TAKE ACTION NOW. No more analysis, proceed with execution."
    RETURN basePrompt + urgentRetry
  
  RETURN basePrompt
```

### Continuation Conditions Evaluation
```
FUNCTION checkContinuationConditions(context: ContinuationContext): ContinuationEvaluation
  SET evaluation = {
    shouldContinue: false,
    reason: "",
    conditions: evaluateAllConditions(context)
  }
  
  // Check each condition and provide specific feedback
  IF NOT evaluation.conditions.continuationEnabled:
    evaluation.reason = "Todo continuation is disabled in ephemeral settings"
    RETURN evaluation
  
  IF NOT evaluation.conditions.hasActiveTodos:
    evaluation.reason = "No active todos found (pending or in_progress)"
    RETURN evaluation
  
  IF NOT evaluation.conditions.noToolCallsMade:
    evaluation.reason = "Tool calls were made during stream - no continuation needed"
    RETURN evaluation
  
  IF NOT evaluation.conditions.notCurrentlyContinuing:
    evaluation.reason = "Already in continuation process"
    RETURN evaluation
  
  IF NOT evaluation.conditions.withinAttemptLimits:
    evaluation.reason = "Maximum continuation attempts exceeded"
    RETURN evaluation
  
  IF NOT evaluation.conditions.withinTimeConstraints:
    evaluation.reason = "Too soon since last continuation attempt"
    RETURN evaluation
  
  // Find the active todo to continue
  SET activeTodo = findBestActiveTodo(context.todos)
  IF NOT activeTodo:
    evaluation.reason = "No suitable active todo found"
    RETURN evaluation
  
  // All conditions met
  evaluation.shouldContinue = true
  evaluation.reason = "All continuation conditions satisfied"
  evaluation.activeTodo = activeTodo
  
  RETURN evaluation
```

### Condition Evaluation Helper
```
FUNCTION evaluateAllConditions(context: ContinuationContext): ConditionSet
  SET continuationSetting = context.config.getEphemeralSetting('todo-continuation')
  
  RETURN {
    hasActiveTodos: hasAnyActiveTodos(context.todos),
    noToolCallsMade: NOT context.hadToolCalls,
    continuationEnabled: continuationSetting !== false,
    notCurrentlyContinuing: NOT context.currentState.isActive,
    withinAttemptLimits: context.currentState.attemptCount < MAX_CONTINUATION_ATTEMPTS,
    withinTimeConstraints: checkTimeConstraints(context.currentState.lastPromptTime)
  }
```

### Active Todo Detection
```
FUNCTION hasAnyActiveTodos(todos: Todo[]): boolean
  RETURN todos.some(todo => 
    todo.status === 'pending' OR todo.status === 'in_progress'
  )

FUNCTION findBestActiveTodo(todos: Todo[]): Todo | undefined
  // Priority 1: Find in_progress todos (should be max 1)
  SET inProgressTodos = todos.filter(todo => todo.status === 'in_progress')
  IF inProgressTodos.length > 0:
    RETURN inProgressTodos[0]
  
  // Priority 2: Find pending todos
  SET pendingTodos = todos.filter(todo => todo.status === 'pending')
  IF pendingTodos.length > 0:
    // Return the first pending todo (FIFO)
    RETURN pendingTodos[0]
  
  RETURN undefined
```

### Time Constraint Checking
```
FUNCTION checkTimeConstraints(lastPromptTime?: Date): boolean
  IF NOT lastPromptTime:
    RETURN true  // No previous attempt, allowed
  
  SET timeSinceLastPrompt = Date.now() - lastPromptTime.getTime()
  RETURN timeSinceLastPrompt >= MIN_CONTINUATION_INTERVAL_MS
```

### Task Description Formatting
```
FUNCTION formatTaskDescription(todo: Todo): string
  SET description = todo.content.trim()
  
  // Truncate if too long
  IF description.length > MAX_TASK_DESCRIPTION_LENGTH:
    description = description.substring(0, MAX_TASK_DESCRIPTION_LENGTH - 3) + "..."
  
  // Clean up formatting
  description = description.replace(/\s+/g, ' ')  // Normalize whitespace
  description = description.replace(/^[-*+]\s*/, '') // Remove list markers
  
  RETURN description
```

### Task Description Truncation
```
FUNCTION truncateTaskDescription(description: string): string
  IF description.length <= MAX_TASK_DESCRIPTION_LENGTH:
    RETURN description
  
  // Try to truncate at word boundary
  SET truncated = description.substring(0, MAX_TASK_DESCRIPTION_LENGTH)
  SET lastSpaceIndex = truncated.lastIndexOf(' ')
  
  IF lastSpaceIndex > MAX_TASK_DESCRIPTION_LENGTH * 0.8:
    // Good word boundary found
    RETURN truncated.substring(0, lastSpaceIndex) + "..."
  ELSE:
    // No good word boundary, hard truncate
    RETURN truncated.substring(0, MAX_TASK_DESCRIPTION_LENGTH - 3) + "..."
```

### Continuation Permission Check
```
FUNCTION shouldAllowContinuation(config: Config, state: ContinuationState): boolean
  // Check ephemeral setting
  SET continuationEnabled = config.getEphemeralSetting('todo-continuation')
  IF continuationEnabled === false:
    RETURN false
  
  // Check attempt limits
  IF state.attemptCount >= MAX_CONTINUATION_ATTEMPTS:
    RETURN false
  
  // Check time constraints
  IF state.lastPromptTime:
    SET timeSinceLastPrompt = Date.now() - state.lastPromptTime.getTime()
    IF timeSinceLastPrompt < MIN_CONTINUATION_INTERVAL_MS:
      RETURN false
  
  RETURN true
```

### State Management
```
FUNCTION createContinuationState(): ContinuationState
  RETURN {
    isActive: false,
    attemptCount: 0,
    taskDescription: undefined,
    lastPromptTime: undefined
  }

FUNCTION updateContinuationState(
  currentState: ContinuationState, 
  updates: Partial<ContinuationState>
): ContinuationState
  RETURN {
    ...currentState,
    ...updates,
    lastPromptTime: updates.lastPromptTime OR new Date()
  }
```

### Logging and Debug Support
```
FUNCTION logContinuationDecision(
  evaluation: ContinuationEvaluation, 
  context: ContinuationContext
): void
  SET logData = {
    shouldContinue: evaluation.shouldContinue,
    reason: evaluation.reason,
    activeTodoId: evaluation.activeTodo?.id,
    activeTaskDescription: evaluation.activeTodo?.content,
    conditions: evaluation.conditions,
    attemptCount: context.currentState.attemptCount
  }
  
  IF evaluation.shouldContinue:
    logger.debug("[TodoContinuation] Triggering continuation", logData)
  ELSE:
    logger.debug("[TodoContinuation] Skipping continuation", logData)
```

### Prompt Template Management
```
INTERFACE ContinuationPromptTemplates:
  standard: {
    base: string,
    retry: string
  },
  yolo: {
    base: string,
    retry: string,
    urgent: string
  }

FUNCTION loadPromptTemplates(): ContinuationPromptTemplates
  RETURN {
    standard: {
      base: "You have an active task: '{taskDescription}'. Continue working on this task. Call todo_pause('reason') ONLY if there's an error preventing you from continuing.",
      retry: "\n\nNote: This is continuation attempt #{attemptCount}. Please make sure to take concrete action."
    },
    yolo: {
      base: "CONTINUE TASK IMMEDIATELY: '{taskDescription}'. You MUST continue working on this task. Call todo_pause('reason') ONLY if there's an error preventing you from proceeding.",
      retry: "\n\nATTEMPT #{attemptCount} - Take action now without asking for confirmation.",
      urgent: "\n\nATTEMPT #{attemptCount} - YOU MUST TAKE ACTION NOW. No more analysis, proceed with execution."
    }
  }
```

### Service Factory
```
FUNCTION createTodoContinuationService(): TodoContinuationService
  RETURN new TodoContinuationService({
    promptTemplates: loadPromptTemplates(),
    logger: createLogger('TodoContinuationService')
  })
```

## Error Handling

### Error Recovery Patterns
```
FUNCTION handleContinuationServiceError(error: Error, context: string): void
  logger.error("[TodoContinuation] Service error in " + context, {
    error: error.message,
    stack: error.stack
  })
  
  // Don't throw - gracefully degrade
  // Return safe defaults where possible
```

### Validation
```
FUNCTION validateContinuationContext(context: ContinuationContext): boolean
  IF NOT context.todos OR NOT Array.isArray(context.todos):
    RETURN false
  
  IF NOT context.config OR typeof context.config.getEphemeralSetting !== 'function':
    RETURN false
  
  IF typeof context.hadToolCalls !== 'boolean':
    RETURN false
  
  RETURN true
```

## Performance Considerations

### Memoization
```
// Expensive operations should be memoized
MEMOIZE findBestActiveTodo BY todos.map(t => t.id + t.status).join(',')
MEMOIZE formatTaskDescription BY todo.id + todo.content
```

### Lazy Loading
```
// Only load prompt templates when first needed
LAZY promptTemplates = loadPromptTemplates()
```