# Task: Hook Reminders into Tool Execution

## Objective
Integrate the reminder service with the tool execution pipeline to inject reminders after todo operations.

## Requirements
- REQ-003: System reminder integration
- REQ-004.1: Trigger reminders from TodoWrite
- REQ-004.2: Add state change metadata

## Implementation Steps

### Step 1: Update TodoWrite Tool

Edit `packages/core/src/tools/todo-write.ts`:

1. Import the reminder service:
```typescript
import { TodoReminderService } from '../services/todo-reminder-service.js';
```

2. Add reminder service instance and modify the response:
```typescript
export class TodoWrite extends BaseTool<TodoWriteParams, ToolResult> {
  private reminderService = new TodoReminderService();
  
  // ... existing code ...

  async execute(
    params: TodoWriteParams,
    _signal: AbortSignal,
    _updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    // ... existing validation code ...

    const sessionId = this.context?.sessionId || 'default';
    const agentId = this.context?.agentId;

    const store = new TodoStore(sessionId, agentId);

    // Read old todos for diff tracking
    const oldTodos = await store.readTodos();

    // Write new todos
    await store.writeTodos(params.todos);

    // Calculate state change
    const stateChange = this.reminderService.calculateStateChange(oldTodos, params.todos);
    
    // Generate reminder if needed
    let reminder: string | null = null;
    if (this.reminderService.shouldGenerateReminder(stateChange)) {
      reminder = this.reminderService.getReminderForStateChange(stateChange);
    }

    // Generate output
    const output = this.generateOutput(oldTodos, params.todos);

    return {
      llmContent: output + (reminder || ''),
      returnDisplay: output,
      metadata: {
        stateChanged: this.reminderService.shouldGenerateReminder(stateChange),
        todosAdded: stateChange.added.length,
        todosRemoved: stateChange.removed.length,
        statusChanged: stateChange.statusChanged.length
      }
    };
  }
```

### Step 2: Update ToolResult Interface

Edit `packages/core/src/tools/tools.ts`:

Add optional metadata field to ToolResult:
```typescript
export interface ToolResult {
  /** Content returned to the language model */
  llmContent?: string;
  /** Markdown content to display to the user */
  returnDisplay: string;
  /** Optional metadata about the tool execution */
  metadata?: Record<string, unknown>;
}
```

### Step 3: Create Reminder Injection Middleware

Create new file `packages/core/src/tools/reminder-middleware.ts`:

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ToolResult } from './tools.js';
import { TodoReminderService } from '../services/todo-reminder-service.js';
import { Content } from '@google/genai';

export class ReminderMiddleware {
  private todoReminderService = new TodoReminderService();

  /**
   * Process tool results and inject reminders if needed
   */
  processToolResult(
    toolName: string,
    result: ToolResult,
    sessionId: string
  ): ToolResult {
    // Currently only process todo_write results
    if (toolName !== 'todo_write') {
      return result;
    }

    // Reminder is already included in llmContent by TodoWrite
    // This middleware can be extended for other tools in the future
    return result;
  }

  /**
   * Check if a user message needs a complexity reminder
   */
  async checkComplexityReminder(
    userMessage: string,
    currentTodos: number,
    sessionId: string
  ): Promise<string | null> {
    // If todos already exist, don't suggest
    if (currentTodos > 0) {
      return null;
    }

    // This will be implemented in Phase 5 (Complexity Analyzer)
    // For now, return null
    return null;
  }

  /**
   * Extract reminders from tool results
   */
  extractReminders(content: string): {
    mainContent: string;
    reminders: string[];
  } {
    const reminderRegex = /<system-reminder>([\s\S]*?)<\/system-reminder>/g;
    const reminders: string[] = [];
    let match;

    while ((match = reminderRegex.exec(content)) !== null) {
      reminders.push(match[0]);
    }

    const mainContent = content.replace(reminderRegex, '').trim();

    return { mainContent, reminders };
  }
}
```

### Step 4: Update Tool Execution Pipeline

Edit `packages/core/src/tools/executeToolCall.ts`:

1. Import the middleware:
```typescript
import { ReminderMiddleware } from './reminder-middleware.js';
```

2. Add reminder processing:
```typescript
export async function executeToolCall(
  functionName: string,
  args: unknown,
  config: Config,
  requestInfo: ToolCallRequestInfo,
  toolRegistry: ToolRegistry,
  signal: AbortSignal,
): Promise<ToolResult> {
  // ... existing code for getting tool ...

  // Create context
  const context: ToolContext = {
    sessionId: requestInfo.sessionId || 'default',
    agentId: requestInfo.agentId,
  };

  // Get tool with context
  const tool = toolRegistry.getTool(functionName, context);

  if (!tool) {
    throw new Error(`Tool not found: ${functionName}`);
  }

  // ... existing execution code ...

  try {
    // Execute the tool
    const result = await tool.execute(args, signal, updateOutput);

    // Process through reminder middleware
    const reminderMiddleware = new ReminderMiddleware();
    const processedResult = reminderMiddleware.processToolResult(
      functionName,
      result,
      context.sessionId
    );

    return processedResult;
  } catch (error) {
    // ... existing error handling ...
  }
}
```

### Step 5: Add Empty Todo Reminder Check

Edit `packages/core/src/tools/todo-read.ts`:

```typescript
import { TodoReminderService } from '../services/todo-reminder-service.js';

export class TodoRead extends BaseTool<TodoReadParams, ToolResult> {
  private reminderService = new TodoReminderService();
  
  // ... existing code ...

  async execute(
    _params: TodoReadParams,
    _signal: AbortSignal,
    _updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const sessionId = this.context?.sessionId || 'default';
    const agentId = this.context?.agentId;

    const store = new TodoStore(sessionId, agentId);
    const todos = await store.readTodos();

    if (todos.length === 0) {
      // Check if this is part of a complex task (will be enhanced in Phase 5)
      const isComplexTask = false; // Placeholder - will be determined by context
      const reminder = this.reminderService.getReminderForEmptyTodos(isComplexTask);
      
      return {
        llmContent: 'No todos found' + (reminder || ''),
        returnDisplay: 'No todos found',
      };
    }

    // ... rest of existing code ...
  }
}
```

## Validation Steps

1. Compile TypeScript:
```bash
cd packages/core
npm run typecheck
```

2. Run tests:
```bash
npm test
```

3. Integration test:
```typescript
// test-reminder-integration.ts
import { Config } from './packages/core/dist/src/config/config.js';
import { executeToolCall } from './packages/core/dist/src/tools/executeToolCall.js';

async function testReminderIntegration() {
  const config = new Config();
  await config.initialize();
  const registry = await config.getToolRegistry();
  
  const requestInfo = { sessionId: 'test-reminder-session' };
  
  // Create todos
  const result = await executeToolCall(
    'todo_write',
    { 
      todos: [
        { id: '1', content: 'Test reminder', status: 'pending', priority: 'high' }
      ]
    },
    config,
    requestInfo,
    registry,
    new AbortController().signal
  );
  
  console.log('Result:', result);
  
  // Check for reminder in llmContent
  if (!result.llmContent?.includes('<system-reminder>')) {
    throw new Error('Reminder not found in response');
  }
  
  // Check metadata
  if (!result.metadata?.stateChanged) {
    throw new Error('Metadata not included');
  }
  
  console.log('✅ Reminder integration working');
}

testReminderIntegration().catch(console.error);
```

## Expected Results

- TodoWrite includes reminders in llmContent
- Reminders are properly formatted
- Metadata is included in responses
- TypeScript compiles without errors
- Tests pass

## Files Modified

- `packages/core/src/tools/todo-write.ts`
- `packages/core/src/tools/todo-read.ts`
- `packages/core/src/tools/tools.ts`
- `packages/core/src/tools/reminder-middleware.ts` (new)
- `packages/core/src/tools/executeToolCall.ts`