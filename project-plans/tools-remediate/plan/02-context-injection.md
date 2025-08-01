# Task: Implement Proper Session Context Injection

## Objective
Modify ToolRegistry to properly inject sessionId and agentId into tool instances, removing the need for type casting hacks.

## Requirements
- REQ-002.1: Inject sessionId during tool instantiation
- REQ-002.2: Support agentId for subagents
- REQ-002.3: Remove type casting hacks
- REQ-002.4: Ensure context flows through pipeline

## Implementation Steps

### Step 1: Create Tool Context Interface

Create new file `packages/core/src/tools/tool-context.ts`:

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ToolContext {
  /** Unique session identifier */
  sessionId: string;
  /** Optional agent identifier for subagent contexts */
  agentId?: string;
}

export interface ContextAwareTool {
  context?: ToolContext;
}
```

### Step 2: Update Base Tool Class

Edit `packages/core/src/tools/tools.ts`:

1. Import the context interface:
```typescript
import { ToolContext, ContextAwareTool } from './tool-context.js';
```

2. Update BaseTool class to implement ContextAwareTool:
```typescript
export abstract class BaseTool<TParams, TResult>
  implements Tool<TParams, TResult>, ContextAwareTool {
  // Add context property
  context?: ToolContext;
  
  // ... rest of the class
}
```

### Step 3: Update Tool Registry

Edit `packages/core/src/tools/tool-registry.ts`:

1. Import context types:
```typescript
import { ToolContext } from './tool-context.js';
```

2. Update the `getTool` method signature and implementation:
```typescript
getTool(name: string, context?: ToolContext): Tool<unknown, ToolResult> | undefined {
  const tool = this.tools.get(name);
  if (tool && context) {
    // Inject context into tool instance
    (tool as any).context = context;
  }
  return tool;
}
```

### Step 4: Update Todo Tools

Edit `packages/core/src/tools/todo-write.ts`:

1. Remove the hacky type casting and use proper context:
```typescript
async execute(
  params: TodoWriteParams,
  _signal: AbortSignal,
  _updateOutput?: (output: string) => void,
): Promise<ToolResult> {
  // Remove these lines:
  // const sessionId = (this as unknown as { sessionId?: string }).sessionId || 'default';
  // const agentId = (this as unknown as { agentId?: string }).agentId;
  
  // Replace with:
  const sessionId = this.context?.sessionId || 'default';
  const agentId = this.context?.agentId;
  
  const store = new TodoStore(sessionId, agentId);
  // ... rest of the method
}
```

Edit `packages/core/src/tools/todo-read.ts` similarly:

```typescript
async execute(
  _params: TodoReadParams,
  _signal: AbortSignal,
  _updateOutput?: (output: string) => void,
): Promise<ToolResult> {
  // Remove hacky type casting
  const sessionId = this.context?.sessionId || 'default';
  const agentId = this.context?.agentId;
  
  const store = new TodoStore(sessionId, agentId);
  // ... rest of the method
}
```

### Step 5: Update Tool Execution Pipeline

Edit `packages/core/src/tools/executeToolCall.ts`:

1. Find where tools are retrieved and add context injection:
```typescript
// Look for where registry.getTool is called
const tool = toolRegistry.getTool(toolName);

// Replace with:
const context: ToolContext = {
  sessionId: requestInfo.sessionId || 'default',
  agentId: requestInfo.agentId,
};
const tool = toolRegistry.getTool(toolName, context);
```

## Validation Steps

1. Compile TypeScript:
```bash
cd packages/core
npm run typecheck
```

2. Run linting:
```bash
npm run lint
```

3. Test context injection:
```typescript
// test-context-injection.ts
import { Config } from './packages/core/dist/src/config/config.js';
import { ToolContext } from './packages/core/dist/src/tools/tool-context.js';

async function testContextInjection() {
  const config = new Config();
  await config.initialize();
  
  const registry = await config.getToolRegistry();
  
  // Test with different contexts
  const context1: ToolContext = { sessionId: 'session-123', agentId: 'agent-456' };
  const tool1 = registry.getTool('todo_write', context1);
  
  const context2: ToolContext = { sessionId: 'session-789' };
  const tool2 = registry.getTool('todo_write', context2);
  
  console.log('Tool 1 context:', (tool1 as any).context);
  console.log('Tool 2 context:', (tool2 as any).context);
  
  if ((tool1 as any).context.sessionId !== 'session-123') {
    throw new Error('Context injection failed for tool1');
  }
  
  if ((tool2 as any).context.sessionId !== 'session-789') {
    throw new Error('Context injection failed for tool2');
  }
  
  console.log('✅ Context injection working correctly');
}

testContextInjection().catch(console.error);
```

## Expected Results

- No TypeScript errors
- No lint errors
- Context properly injected into tools
- No type casting hacks remain
- Session isolation works correctly

## Files Modified

- `packages/core/src/tools/tool-context.ts` (new)
- `packages/core/src/tools/tools.ts`
- `packages/core/src/tools/tool-registry.ts`
- `packages/core/src/tools/todo-write.ts`
- `packages/core/src/tools/todo-read.ts`
- `packages/core/src/tools/executeToolCall.ts`