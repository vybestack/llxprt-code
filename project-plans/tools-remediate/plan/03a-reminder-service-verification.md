# Verification: Reminder Service

## Objective
Verify that TodoReminderService correctly generates system reminders for various todo states.

## Verification Steps

### 1. Check File Creation

```bash
# Verify service file exists
test -f packages/core/src/services/todo-reminder-service.ts && echo "✅ Service file created" || echo "❌ Service file missing"

# Verify test file exists
test -f packages/core/src/services/todo-reminder-service.test.ts && echo "✅ Test file created" || echo "❌ Test file missing"
```

### 2. Run Behavioral Tests

```bash
cd packages/core
npm test todo-reminder-service
```

Expected output should show all tests passing with behavioral descriptions.

### 3. Verify Reminder Format

Create test script to verify reminder formatting:

```typescript
// verify-reminder-format.ts
import { TodoReminderService } from './packages/core/dist/src/services/todo-reminder-service.js';
import { Todo } from './packages/core/dist/src/tools/todo-schemas.js';

function verifyReminderFormat() {
  console.log('🔍 Verifying Reminder Service Format...\n');
  
  const service = new TodoReminderService();
  
  // Test 1: Empty todo reminder format
  console.log('Test 1: Empty todo reminder format');
  const emptyReminder = service.getReminderForEmptyTodos(true);
  
  if (!emptyReminder?.startsWith('<system-reminder>')) {
    throw new Error('❌ Empty reminder missing opening tag');
  }
  
  if (!emptyReminder?.endsWith('</system-reminder>')) {
    throw new Error('❌ Empty reminder missing closing tag');
  }
  
  if (!emptyReminder?.includes('DO NOT mention')) {
    throw new Error('❌ Empty reminder missing instruction to not mention to user');
  }
  
  console.log('✅ Empty todo reminder format correct\n');
  
  // Test 2: State change reminder format
  console.log('Test 2: State change reminder format');
  const todos: Todo[] = [
    { id: '1', content: 'Test task', status: 'pending', priority: 'high' }
  ];
  
  const stateChange = service.calculateStateChange([], todos);
  const changeReminder = service.getReminderForStateChange(stateChange);
  
  if (!changeReminder.includes('<system-reminder>')) {
    throw new Error('❌ Change reminder missing system tags');
  }
  
  const todoData = JSON.parse(
    changeReminder
      .replace(/<system-reminder>[\s\S]*?list:\n\n/, '')
      .replace(/\. Continue[\s\S]*<\/system-reminder>/, '')
  );
  
  if (!Array.isArray(todoData)) {
    throw new Error('❌ Todo data not properly formatted as JSON array');
  }
  
  if (todoData[0].content !== 'Test task') {
    throw new Error('❌ Todo content not preserved in reminder');
  }
  
  console.log('✅ State change reminder format correct\n');
  
  // Test 3: Complex task suggestion format
  console.log('Test 3: Complex task suggestion format');
  const tasks = ['Task A', 'Task B', 'Task C'];
  const suggestion = service.getComplexTaskSuggestion(tasks);
  
  if (!suggestion.includes('1. Task A')) {
    throw new Error('❌ Tasks not properly numbered');
  }
  
  if (!suggestion.includes('TodoWrite tool')) {
    throw new Error('❌ Missing TodoWrite tool mention');
  }
  
  console.log('✅ Complex task suggestion format correct\n');
  
  console.log('✅ All reminder formats verified!');
}

verifyReminderFormat();
```

Run verification:
```bash
npx tsx verify-reminder-format.ts
```

### 4. Test State Change Detection

```typescript
// test-state-detection.ts
import { TodoReminderService } from './packages/core/dist/src/services/todo-reminder-service.js';
import { Todo } from './packages/core/dist/src/tools/todo-schemas.js';

function testStateDetection() {
  console.log('🔍 Testing State Change Detection...\n');
  
  const service = new TodoReminderService();
  
  // Scenario 1: Adding todos
  const prev1: Todo[] = [];
  const curr1: Todo[] = [
    { id: '1', content: 'New task', status: 'pending', priority: 'high' }
  ];
  
  const change1 = service.calculateStateChange(prev1, curr1);
  console.log('Added todos:', change1.added.length);
  console.log('Should generate reminder:', service.shouldGenerateReminder(change1));
  
  if (change1.added.length !== 1) {
    throw new Error('Failed to detect added todo');
  }
  
  // Scenario 2: Status change
  const prev2 = curr1;
  const curr2: Todo[] = [
    { id: '1', content: 'New task', status: 'completed', priority: 'high' }
  ];
  
  const change2 = service.calculateStateChange(prev2, curr2);
  console.log('\nStatus changed todos:', change2.statusChanged.length);
  
  if (change2.statusChanged.length !== 1) {
    throw new Error('Failed to detect status change');
  }
  
  // Scenario 3: No changes
  const change3 = service.calculateStateChange(curr2, curr2);
  console.log('\nNo changes detected:', !service.shouldGenerateReminder(change3));
  
  if (service.shouldGenerateReminder(change3)) {
    throw new Error('False positive on change detection');
  }
  
  console.log('\n✅ State detection working correctly');
}

testStateDetection();
```

### 5. TypeScript and Lint Check

```bash
cd packages/core
npm run typecheck
npm run lint
```

## Expected Results

All checks should pass:
- ✅ Service and test files created
- ✅ All behavioral tests pass (100% coverage)
- ✅ Reminder format includes system-reminder tags
- ✅ State change detection accurate
- ✅ TypeScript compilation succeeds
- ✅ Linting passes

## Behavioral Test Coverage

Verify all requirements are tested:
- REQ-003.1: Service created ✓
- REQ-003.2: Empty todo detection ✓
- REQ-003.3: State change reminders ✓
- REQ-003.4: System-reminder formatting ✓
- REQ-003.5: Current state included ✓

## Report Format

Create `reminder-service-report.json`:
```json
{
  "phase": "03-reminder-service",
  "status": "pass|fail",
  "checks": {
    "service_created": true|false,
    "tests_created": true|false,
    "all_tests_pass": true|false,
    "reminder_format_correct": true|false,
    "state_detection_works": true|false,
    "typescript_passes": true|false,
    "lint_passes": true|false
  },
  "test_results": {
    "total": 0,
    "passed": 0,
    "failed": 0,
    "coverage": 0
  },
  "errors": []
}
```