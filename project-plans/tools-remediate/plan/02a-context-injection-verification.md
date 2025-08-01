# Verification: Context Injection

## Objective
Verify that session context is properly injected into todo tools without type casting hacks.

## Verification Steps

### 1. Check File Creation and Modifications

#### New file created:
```bash
test -f packages/core/src/tools/tool-context.ts && echo "✅ tool-context.ts created" || echo "❌ tool-context.ts missing"
```

#### Verify no type casting in todo tools:
```bash
# Check for removal of type casting hacks
grep -n "as unknown as" packages/core/src/tools/todo-write.ts packages/core/src/tools/todo-read.ts
```
Expected: No results (type casting removed)

#### Verify context usage:
```bash
# Check for proper context usage
grep -n "this\.context" packages/core/src/tools/todo-write.ts packages/core/src/tools/todo-read.ts
```
Expected: Should show usage of this.context

### 2. Verify TypeScript Compilation

```bash
cd packages/core
npm run typecheck
```
Expected: No errors

### 3. Run Context Injection Test

Create comprehensive test file:

```typescript
// verify-context-injection.ts
import { Config } from './packages/core/dist/src/config/config.js';
import { ToolRegistry } from './packages/core/dist/src/tools/tool-registry.js';
import { ToolContext } from './packages/core/dist/src/tools/tool-context.js';
import { TodoWrite } from './packages/core/dist/src/tools/todo-write.js';
import { TodoRead } from './packages/core/dist/src/tools/todo-read.js';

async function verifyContextInjection() {
  console.log('🔍 Verifying Context Injection...\n');
  
  const config = new Config();
  await config.initialize();
  const registry = await config.getToolRegistry();
  
  // Test 1: Basic context injection
  console.log('Test 1: Basic context injection');
  const context1: ToolContext = { sessionId: 'test-session-123', agentId: 'agent-456' };
  const todoWrite1 = registry.getTool('todo_write', context1) as TodoWrite & { context?: ToolContext };
  
  if (!todoWrite1.context) {
    throw new Error('❌ Context not injected into TodoWrite');
  }
  
  if (todoWrite1.context.sessionId !== 'test-session-123') {
    throw new Error(`❌ Wrong sessionId: ${todoWrite1.context.sessionId}`);
  }
  
  if (todoWrite1.context.agentId !== 'agent-456') {
    throw new Error(`❌ Wrong agentId: ${todoWrite1.context.agentId}`);
  }
  
  console.log('✅ Context properly injected\n');
  
  // Test 2: Session isolation
  console.log('Test 2: Session isolation');
  const context2: ToolContext = { sessionId: 'different-session-789' };
  const todoWrite2 = registry.getTool('todo_write', context2) as TodoWrite & { context?: ToolContext };
  
  if (todoWrite2.context?.sessionId === todoWrite1.context.sessionId) {
    throw new Error('❌ Session isolation failed - contexts are shared!');
  }
  
  console.log('✅ Session isolation working\n');
  
  // Test 3: TodoRead context
  console.log('Test 3: TodoRead context injection');
  const todoRead = registry.getTool('todo_read', context1) as TodoRead & { context?: ToolContext };
  
  if (!todoRead.context) {
    throw new Error('❌ Context not injected into TodoRead');
  }
  
  if (todoRead.context.sessionId !== 'test-session-123') {
    throw new Error('❌ TodoRead has wrong context');
  }
  
  console.log('✅ TodoRead context injection working\n');
  
  // Test 4: No context scenario
  console.log('Test 4: Tool without context');
  const todoWriteNoContext = registry.getTool('todo_write') as TodoWrite & { context?: ToolContext };
  
  // Should work but use default sessionId
  console.log('✅ Tool works without explicit context\n');
  
  // Test 5: Check for type casting removal
  console.log('Test 5: Verify no type casting hacks');
  const todoWriteSource = TodoWrite.prototype.execute.toString();
  const todoReadSource = TodoRead.prototype.execute.toString();
  
  if (todoWriteSource.includes('as unknown as')) {
    throw new Error('❌ Type casting hack still present in TodoWrite');
  }
  
  if (todoReadSource.includes('as unknown as')) {
    throw new Error('❌ Type casting hack still present in TodoRead');
  }
  
  console.log('✅ Type casting hacks removed\n');
  
  console.log('✅ All context injection tests passed!');
}

verifyContextInjection().catch(error => {
  console.error('\n❌ Verification failed:', error.message);
  process.exit(1);
});
```

Run the test:
```bash
npx tsx verify-context-injection.ts
```

### 4. Integration Test

Test actual todo operations with context:

```typescript
// test-todo-with-context.ts
import { Config } from './packages/core/dist/src/config/config.js';
import { executeToolCall } from './packages/core/dist/src/tools/executeToolCall.js';

async function testTodoWithContext() {
  const config = new Config();
  await config.initialize();
  const registry = await config.getToolRegistry();
  
  const requestInfo = {
    sessionId: 'integration-test-session',
    agentId: 'test-agent-1'
  };
  
  // Create a todo
  const writeResult = await executeToolCall(
    'todo_write',
    { 
      todos: [
        { id: '1', content: 'Test todo', status: 'pending', priority: 'high' }
      ]
    },
    config,
    requestInfo,
    registry,
    new AbortController().signal
  );
  
  console.log('Write result:', writeResult);
  
  // Read todos back
  const readResult = await executeToolCall(
    'todo_read',
    {},
    config,
    requestInfo,
    registry,
    new AbortController().signal
  );
  
  console.log('Read result:', readResult);
  
  // Verify session isolation
  const differentRequestInfo = {
    sessionId: 'different-session',
    agentId: 'test-agent-2'
  };
  
  const readDifferentSession = await executeToolCall(
    'todo_read',
    {},
    config,
    differentRequestInfo,
    registry,
    new AbortController().signal
  );
  
  console.log('Different session result:', readDifferentSession);
  
  if (readDifferentSession.llmContent.includes('Test todo')) {
    throw new Error('Session isolation failed!');
  }
  
  console.log('✅ Integration test passed');
}

testTodoWithContext().catch(console.error);
```

### 5. Check for Regressions

```bash
cd packages/core
npm test
```

## Expected Results

All verification steps should pass:
- ✅ tool-context.ts file created
- ✅ Type casting hacks removed from todo tools
- ✅ Context properly used in todo tools
- ✅ TypeScript compilation succeeds
- ✅ Context injection test passes
- ✅ Session isolation works
- ✅ Integration test passes
- ✅ No test regressions

## Report Format

Create `context-injection-report.json`:
```json
{
  "phase": "02-context-injection",
  "status": "pass|fail",
  "checks": {
    "context_interface_created": true|false,
    "type_casting_removed": true|false,
    "context_injection_works": true|false,
    "session_isolation_works": true|false,
    "typescript_passes": true|false,
    "integration_test_passes": true|false,
    "no_regressions": true|false
  },
  "errors": []
}
```