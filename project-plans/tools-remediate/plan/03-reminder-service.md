# Task: Create Todo Reminder Service

## Objective
Build a service that monitors todo state and generates appropriate system reminders to guide model behavior.

## Requirements
- REQ-003.1: Create TodoReminderService
- REQ-003.2: Detect empty todo scenarios
- REQ-003.3: Generate state change reminders
- REQ-003.4: Format as system-reminder tags
- REQ-003.5: Include current state in reminders

## Implementation Steps

### Step 1: Create TodoReminderService

Create new file `packages/core/src/services/todo-reminder-service.ts`:

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Todo } from '../tools/todo-schemas.js';

export interface TodoStateChange {
  previousTodos: Todo[];
  currentTodos: Todo[];
  added: Todo[];
  removed: Todo[];
  statusChanged: Todo[];
}

export class TodoReminderService {
  private static readonly EMPTY_TODO_REMINDER = `This is a reminder that your todo list is currently empty. DO NOT mention this to the user explicitly because they are already aware. If you are working on tasks that would benefit from a todo list please use the TodoWrite tool to create one. If not, please feel free to ignore. Again do not mention this message to the user.`;

  private static readonly TODO_CHANGED_PREFIX = `Your todo list has changed. DO NOT mention this explicitly to the user. Here are the latest contents of your todo list:\n\n`;

  private static readonly TODO_CHANGED_SUFFIX = `. Continue on with the tasks at hand if applicable.`;

  /**
   * Generate reminder for empty todo list
   */
  public getReminderForEmptyTodos(isComplexTask: boolean = false): string | null {
    if (!isComplexTask) {
      return null;
    }
    
    return this.formatSystemReminder(TodoReminderService.EMPTY_TODO_REMINDER);
  }

  /**
   * Generate reminder for todo state change
   */
  public getReminderForStateChange(stateChange: TodoStateChange): string {
    const todoJson = JSON.stringify(
      stateChange.currentTodos.map(todo => ({
        content: todo.content,
        status: todo.status,
        priority: todo.priority,
        id: todo.id
      }))
    );
    
    const message = 
      TodoReminderService.TODO_CHANGED_PREFIX + 
      todoJson + 
      TodoReminderService.TODO_CHANGED_SUFFIX;
    
    return this.formatSystemReminder(message);
  }

  /**
   * Calculate state changes between old and new todos
   */
  public calculateStateChange(previousTodos: Todo[], currentTodos: Todo[]): TodoStateChange {
    const added = currentTodos.filter(
      newTodo => !previousTodos.some(oldTodo => oldTodo.id === newTodo.id)
    );

    const removed = previousTodos.filter(
      oldTodo => !currentTodos.some(newTodo => newTodo.id === oldTodo.id)
    );

    const statusChanged = currentTodos.filter(newTodo => {
      const oldTodo = previousTodos.find(t => t.id === newTodo.id);
      return oldTodo && oldTodo.status !== newTodo.status;
    });

    return {
      previousTodos,
      currentTodos,
      added,
      removed,
      statusChanged
    };
  }

  /**
   * Check if a reminder should be generated based on changes
   */
  public shouldGenerateReminder(stateChange: TodoStateChange): boolean {
    return stateChange.added.length > 0 || 
           stateChange.removed.length > 0 || 
           stateChange.statusChanged.length > 0;
  }

  /**
   * Format message as system reminder
   */
  private formatSystemReminder(message: string): string {
    return `<system-reminder>\n${message}\n</system-reminder>`;
  }

  /**
   * Generate proactive todo suggestion for complex tasks
   */
  public getComplexTaskSuggestion(detectedTasks: string[]): string {
    const taskList = detectedTasks.map((task, i) => `${i + 1}. ${task}`).join('\n');
    
    const message = `I notice you're asking about multiple tasks. Consider using the TodoWrite tool to track these items:\n${taskList}\n\nThis will help ensure all tasks are completed systematically.`;
    
    return this.formatSystemReminder(message);
  }
}
```

### Step 2: Create Behavioral Tests

Create test file `packages/core/src/services/todo-reminder-service.test.ts`:

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { TodoReminderService } from './todo-reminder-service.js';
import { Todo } from '../tools/todo-schemas.js';

describe('TodoReminderService', () => {
  let service: TodoReminderService;

  beforeEach(() => {
    service = new TodoReminderService();
  });

  describe('getReminderForEmptyTodos', () => {
    /**
     * @requirement REQ-003.2
     * @scenario Empty todo list for complex task
     * @given User asks multi-step question, todo list empty
     * @when getReminderForEmptyTodos(true) called
     * @then Returns reminder suggesting todo usage
     */
    it('should generate reminder for complex task with empty todos', () => {
      const reminder = service.getReminderForEmptyTodos(true);
      
      expect(reminder).toBeTruthy();
      expect(reminder).toContain('<system-reminder>');
      expect(reminder).toContain('todo list is currently empty');
      expect(reminder).toContain('TodoWrite tool');
      expect(reminder).toContain('</system-reminder>');
    });

    /**
     * @requirement REQ-003.2
     * @scenario Simple task with empty todos
     * @given User asks simple question, todo list empty
     * @when getReminderForEmptyTodos(false) called
     * @then Returns null (no reminder needed)
     */
    it('should not generate reminder for simple task', () => {
      const reminder = service.getReminderForEmptyTodos(false);
      
      expect(reminder).toBeNull();
    });
  });

  describe('getReminderForStateChange', () => {
    /**
     * @requirement REQ-003.3
     * @scenario Todo state changes
     * @given Previous state has 2 todos, new state has 3
     * @when getReminderForStateChange() called
     * @then Returns reminder with current todo list
     */
    it('should generate reminder with current todo state', () => {
      const previousTodos: Todo[] = [
        { id: '1', content: 'Task 1', status: 'pending', priority: 'high' },
        { id: '2', content: 'Task 2', status: 'in_progress', priority: 'medium' }
      ];

      const currentTodos: Todo[] = [
        { id: '1', content: 'Task 1', status: 'completed', priority: 'high' },
        { id: '2', content: 'Task 2', status: 'in_progress', priority: 'medium' },
        { id: '3', content: 'Task 3', status: 'pending', priority: 'low' }
      ];

      const stateChange = service.calculateStateChange(previousTodos, currentTodos);
      const reminder = service.getReminderForStateChange(stateChange);

      expect(reminder).toContain('<system-reminder>');
      expect(reminder).toContain('todo list has changed');
      expect(reminder).toContain(JSON.stringify([
        { content: 'Task 1', status: 'completed', priority: 'high', id: '1' },
        { content: 'Task 2', status: 'in_progress', priority: 'medium', id: '2' },
        { content: 'Task 3', status: 'pending', priority: 'low', id: '3' }
      ]));
      expect(reminder).toContain('</system-reminder>');
    });
  });

  describe('calculateStateChange', () => {
    /**
     * @requirement REQ-003.5
     * @scenario Calculate todo changes
     * @given Old and new todo lists
     * @when calculateStateChange() called
     * @then Returns accurate change detection
     */
    it('should accurately detect added, removed, and status changed todos', () => {
      const previousTodos: Todo[] = [
        { id: '1', content: 'Keep', status: 'pending', priority: 'high' },
        { id: '2', content: 'Remove', status: 'pending', priority: 'medium' },
        { id: '3', content: 'Change', status: 'pending', priority: 'low' }
      ];

      const currentTodos: Todo[] = [
        { id: '1', content: 'Keep', status: 'pending', priority: 'high' },
        { id: '3', content: 'Change', status: 'completed', priority: 'low' },
        { id: '4', content: 'New', status: 'pending', priority: 'high' }
      ];

      const stateChange = service.calculateStateChange(previousTodos, currentTodos);

      expect(stateChange.added).toHaveLength(1);
      expect(stateChange.added[0].id).toBe('4');

      expect(stateChange.removed).toHaveLength(1);
      expect(stateChange.removed[0].id).toBe('2');

      expect(stateChange.statusChanged).toHaveLength(1);
      expect(stateChange.statusChanged[0].id).toBe('3');
    });
  });

  describe('shouldGenerateReminder', () => {
    it('should return true when todos are added', () => {
      const stateChange = {
        previousTodos: [],
        currentTodos: [{ id: '1', content: 'New', status: 'pending' as const, priority: 'high' as const }],
        added: [{ id: '1', content: 'New', status: 'pending' as const, priority: 'high' as const }],
        removed: [],
        statusChanged: []
      };

      expect(service.shouldGenerateReminder(stateChange)).toBe(true);
    });

    it('should return false when no changes', () => {
      const todos: Todo[] = [{ id: '1', content: 'Same', status: 'pending', priority: 'high' }];
      const stateChange = {
        previousTodos: todos,
        currentTodos: todos,
        added: [],
        removed: [],
        statusChanged: []
      };

      expect(service.shouldGenerateReminder(stateChange)).toBe(false);
    });
  });

  describe('getComplexTaskSuggestion', () => {
    /**
     * @requirement REQ-003.4
     * @scenario Complex task detection
     * @given Multiple tasks detected
     * @when getComplexTaskSuggestion() called
     * @then Returns formatted suggestion with tasks
     */
    it('should generate suggestion with detected tasks', () => {
      const tasks = ['Implement authentication', 'Add user tests', 'Deploy to production'];
      const suggestion = service.getComplexTaskSuggestion(tasks);

      expect(suggestion).toContain('<system-reminder>');
      expect(suggestion).toContain('multiple tasks');
      expect(suggestion).toContain('1. Implement authentication');
      expect(suggestion).toContain('2. Add user tests');
      expect(suggestion).toContain('3. Deploy to production');
      expect(suggestion).toContain('TodoWrite tool');
      expect(suggestion).toContain('</system-reminder>');
    });
  });
});
```

### Step 3: Export from Services Index

Add to `packages/core/src/services/index.ts` (create if doesn't exist):

```typescript
export { TodoReminderService } from './todo-reminder-service.js';
export type { TodoStateChange } from './todo-reminder-service.js';
```

## Validation Steps

1. Run TypeScript compilation:
```bash
cd packages/core
npm run typecheck
```

2. Run the tests:
```bash
npm test todo-reminder-service
```

3. Run linting:
```bash
npm run lint
```

## Expected Results

- TodoReminderService class created with all required methods
- All behavioral tests pass
- TypeScript compilation succeeds
- Linting passes
- Reminder formatting matches expected system-reminder format

## Files Created/Modified

- `packages/core/src/services/todo-reminder-service.ts` (new)
- `packages/core/src/services/todo-reminder-service.test.ts` (new)
- `packages/core/src/services/index.ts` (modified or new)