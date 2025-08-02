# Verification: Tool Registration

## Objective
Verify that TodoWrite and TodoRead tools are properly registered and available in the system.

## Verification Steps

### 1. Check File Modifications

Verify that the following files have been modified correctly:

#### packages/core/src/tools/index.ts
```bash
grep -E "export.*TodoWrite|export.*TodoRead" packages/core/src/tools/index.ts
```
Expected: Should show export statements for both tools

#### packages/core/src/config/config.ts
```bash
# Check imports
grep -E "import.*TodoWrite|import.*TodoRead" packages/core/src/config/config.ts

# Check registration
grep -E "registerCoreTool.*TodoWrite|registerCoreTool.*TodoRead" packages/core/src/config/config.ts
```
Expected: Should show both import and registerCoreTool statements

### 2. Verify TypeScript Compilation

```bash
cd packages/core
npm run typecheck
```
Expected: No errors

### 3. Verify Linting

```bash
cd packages/core
npm run lint
```
Expected: No errors

### 4. Run Integration Test

Create and run this verification script:

```typescript
// save as verify-todo-tools.ts
import { Config } from './packages/core/dist/src/config/config.js';
import { ToolRegistry } from './packages/core/dist/src/tools/tool-registry.js';

async function verifyTodoTools() {
  console.log('🔍 Verifying Todo Tool Registration...\n');
  
  // Test 1: Basic registration
  const config = new Config();
  await config.initialize();
  
  const registry = await config.getToolRegistry();
  const tools = registry.getFunctionDeclarations();
  
  const todoWrite = tools.find(t => t.name === 'todo_write');
  const todoRead = tools.find(t => t.name === 'todo_read');
  
  if (!todoWrite) {
    throw new Error('❌ TodoWrite tool not found in registry');
  }
  console.log('✅ TodoWrite tool registered');
  
  if (!todoRead) {
    throw new Error('❌ TodoRead tool not found in registry');
  }
  console.log('✅ TodoRead tool registered');
  
  // Test 2: Tool instantiation
  const writeToolInstance = registry.getTool('todo_write');
  const readToolInstance = registry.getTool('todo_read');
  
  if (!writeToolInstance) {
    throw new Error('❌ Failed to instantiate TodoWrite tool');
  }
  console.log('✅ TodoWrite tool instantiates correctly');
  
  if (!readToolInstance) {
    throw new Error('❌ Failed to instantiate TodoRead tool');
  }
  console.log('✅ TodoRead tool instantiates correctly');
  
  // Test 3: Function declarations
  console.log('\n📋 TodoWrite function declaration:');
  console.log(`  - Name: ${todoWrite.name}`);
  console.log(`  - Description: ${todoWrite.description}`);
  console.log(`  - Parameters: ${Object.keys(todoWrite.parameters.properties || {}).join(', ')}`);
  
  console.log('\n📋 TodoRead function declaration:');
  console.log(`  - Name: ${todoRead.name}`);
  console.log(`  - Description: ${todoRead.description}`);
  console.log(`  - Parameters: ${Object.keys(todoRead.parameters.properties || {}).join(', ')}`);
  
  console.log('\n✅ All verification checks passed!');
}

verifyTodoTools().catch(error => {
  console.error('\n❌ Verification failed:', error.message);
  process.exit(1);
});
```

Run the verification:
```bash
npx tsx verify-todo-tools.ts
```

### 5. Check for Regressions

Run existing tests to ensure no regressions:
```bash
cd packages/core
npm test
```

## Expected Results

All checks should pass:
- ✅ Both tools exported from index.ts
- ✅ Both tools imported in config.ts
- ✅ Both tools registered with registerCoreTool
- ✅ TypeScript compilation succeeds
- ✅ Linting passes
- ✅ Verification script confirms registration
- ✅ Existing tests still pass

## Failure Conditions

The verification fails if:
- ❌ Export statements missing from index.ts
- ❌ Import statements missing from config.ts
- ❌ registerCoreTool calls missing
- ❌ TypeScript compilation errors
- ❌ Lint errors introduced
- ❌ Tools not found in registry
- ❌ Existing tests fail

## Report Format

Create a file `verification-report.json`:
```json
{
  "phase": "01-tool-registration",
  "status": "pass|fail",
  "checks": {
    "exports_added": true|false,
    "imports_added": true|false,
    "registration_added": true|false,
    "typescript_passes": true|false,
    "lint_passes": true|false,
    "tools_in_registry": true|false,
    "no_regressions": true|false
  },
  "errors": []
}
```