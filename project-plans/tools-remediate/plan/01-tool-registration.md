# Task: Register Todo Tools in Core System

## Objective
Add TodoWrite and TodoRead tools to the core tool registry so they are available to the model.

## Requirements
- REQ-001.1: Import todo tool classes
- REQ-001.2: Register tools in createToolRegistry
- REQ-001.3: Export from tools index

## Implementation Steps

### Step 1: Add Exports to Tools Index

Edit `packages/core/src/tools/index.ts`:

```typescript
// Add these exports
export { TodoWrite } from './todo-write.js';
export { TodoRead } from './todo-read.js';
```

### Step 2: Update Config Imports

Edit `packages/core/src/config/config.ts`:

1. Add imports after the other tool imports (around line 30):
```typescript
import { TodoWrite } from '../tools/todo-write.js';
import { TodoRead } from '../tools/todo-read.js';
```

### Step 3: Register Tools in createToolRegistry

In `packages/core/src/config/config.ts`, find the `createToolRegistry()` method.

Add these lines after the other `registerCoreTool` calls (around line 650):
```typescript
registerCoreTool(TodoWrite);
registerCoreTool(TodoRead);
```

## Validation Steps

1. Run TypeScript compilation:
```bash
cd packages/core
npm run typecheck
```

2. Run linting:
```bash
npm run lint
```

3. Create a test file `test-todo-registration.ts` in the project root:
```typescript
import { Config } from './packages/core/dist/src/config/config.js';

async function testRegistration() {
  const config = new Config();
  await config.initialize();
  
  const registry = await config.getToolRegistry();
  const tools = registry.getFunctionDeclarations();
  
  const todoWrite = tools.find(t => t.name === 'todo_write');
  const todoRead = tools.find(t => t.name === 'todo_read');
  
  console.log('TodoWrite found:', !!todoWrite);
  console.log('TodoRead found:', !!todoRead);
  
  if (!todoWrite || !todoRead) {
    throw new Error('Todo tools not properly registered');
  }
  
  console.log('✅ Todo tools successfully registered');
}

testRegistration().catch(console.error);
```

4. Run the test:
```bash
npx tsx test-todo-registration.ts
```

## Expected Results

- TypeScript compilation passes without errors
- Linting passes without errors
- Test script confirms both todo tools are registered
- No existing tests fail

## Common Issues

1. If you get import errors, ensure the `.js` extension is used in imports
2. If tools don't appear, check that the tool classes have static `Name` properties
3. Ensure the tools are imported before being registered

## Files Modified

- `packages/core/src/tools/index.ts`
- `packages/core/src/config/config.ts`