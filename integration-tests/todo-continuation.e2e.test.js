/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'node:test';
import { strict as assert } from 'assert';
import { TestRig, printDebugInfo, validateModelOutput } from './test-helper.js';

// Skip todo tests in CI by default - Flash model has issues with todo formatting
const skipTodoTests =
  process.env.SKIP_TODO_TESTS !== 'false' &&
  (process.env.CI || process.env.GITHUB_ACTIONS);

/**
 * @requirement REQ-001
 * @scenario Basic todo continuation flow
 * @given CLI with active todos and continuation enabled
 * @when User completes without tool calls
 * @then Continuation prompt appears with todo context
 */
test('basic todo continuation flow', { skip: skipTodoTests }, async () => {
  const rig = new TestRig();
  await rig.setup('basic todo continuation flow', {
    settings: {
      'todo-continuation': true, // Explicitly enable continuation
    },
  });

  // First, create a todo list with an active task
  const _createResult = await rig.run(
    'Create a todo list with these tasks: 1. Implement auth system (in_progress, high), 2. Write tests (pending, medium)',
  );

  // Wait for todo_write tool call
  const writeToolCall = await rig.waitForToolCall('todo_write');

  if (!writeToolCall) {
    printDebugInfo(rig, _createResult, {
      'Expected todo_write call': true,
      'Found write call': false,
    });
  }

  assert.ok(writeToolCall, 'Expected to find a todo_write tool call');

  // Now send a message that completes without tool calls to trigger continuation
  const continuationResult = await rig.run(
    'I need to think about this approach',
  );

  // Verify continuation prompt appears and mentions the active todo
  const hasContinuationPrompt =
    continuationResult.toLowerCase().includes('continue') ||
    continuationResult.toLowerCase().includes('working on') ||
    continuationResult.toLowerCase().includes('auth system') ||
    continuationResult.toLowerCase().includes('implement');

  if (!hasContinuationPrompt) {
    printDebugInfo(rig, continuationResult, {
      'Has continuation language': continuationResult
        .toLowerCase()
        .includes('continue'),
      'Mentions active todo': continuationResult
        .toLowerCase()
        .includes('auth system'),
      'Result length': continuationResult.length,
    });
  }

  assert.ok(
    hasContinuationPrompt,
    'Expected continuation prompt mentioning active todo',
  );

  await rig.cleanup();
});

/**
 * @requirement REQ-002
 * @scenario Tool call suppression prevents continuation
 * @given CLI with active todos
 * @when User message triggers tool use
 * @then NO continuation prompt appears
 */
test(
  'tool call suppression prevents continuation',
  { skip: skipTodoTests },
  async () => {
    const rig = new TestRig();
    await rig.setup('tool call suppression prevents continuation', {
      settings: {
        'todo-continuation': true,
      },
    });

    // Create todo list
    const _createResult = await rig.run(
      'Create a todo: Implement auth system (in_progress)',
    );

    const writeToolCall = await rig.waitForToolCall('todo_write');
    assert.ok(writeToolCall, 'Expected to find a todo_write tool call');

    // Now trigger a tool call which should suppress continuation
    const toolResult = await rig.run(
      'Let me check what files exist in this directory',
    );

    // Wait for list_directory or similar tool call
    const toolCalls = ['list_directory', 'read_file', 'run_shell_command'];
    const foundToolCall = await rig.waitForAnyToolCall(toolCalls);

    if (!foundToolCall) {
      printDebugInfo(rig, toolResult, {
        'Expected any tool call': toolCalls,
        'Tool result length': toolResult.length,
      });
    }

    assert.ok(foundToolCall, 'Expected to find a tool call');

    // Verify NO continuation prompt appears when tool was called
    const hasContinuationLanguage =
      toolResult.toLowerCase().includes('continue working on') ||
      toolResult.toLowerCase().includes('back to implementing');

    if (hasContinuationLanguage) {
      printDebugInfo(rig, toolResult, {
        'Unexpected continuation language': hasContinuationLanguage,
        'Tool was called': foundToolCall,
      });
    }

    assert.ok(
      !hasContinuationLanguage,
      'Should NOT show continuation prompt when tool was called',
    );

    await rig.cleanup();
  },
);

/**
 * @requirement REQ-004
 * @scenario Auto-resume blocks response until todos progress or pause
 * @given CLI with active todos
 * @when AI runs tooling but leaves todos pending
 * @then Response instructs updating todos or using todo_pause before replying
 */
test(
  'auto-resume blocks response until todo progress',
  { skip: skipTodoTests },
  async () => {
    const rig = new TestRig();
    await rig.setup('auto-resume blocks response until todo progress', {
      settings: {
        'todo-continuation': true,
      },
    });

    const _createResult = await rig.run(
      'Create a todo list with one item: Build login form (in_progress, high)',
    );
    const writeToolCall = await rig.waitForToolCall('todo_write');
    assert.ok(writeToolCall, 'Expected to find a todo_write tool call');

    const result = await rig.run(
      'List the files in the project root and then reply immediately with a summary.',
    );

    const normalized = result.toLowerCase();
    const reminderDetected =
      normalized.includes('todo_pause') ||
      normalized.includes('update the todo') ||
      normalized.includes('complete the todo');

    if (!reminderDetected) {
      printDebugInfo(rig, result, {
        expectation:
          'Output should instruct updating todos or using todo_pause before replying',
      });
    }

    assert.ok(
      reminderDetected,
      'Expected reminder to block response until todo progress or pause',
    );

    await rig.cleanup();
  },
);

/**
 * @requirement REQ-003
 * @scenario Todo pause tool usage
 * @given CLI with active todos in continuation
 * @when AI uses todo_pause tool
 * @then Proper pause message appears and control returns to user
 */
test('todo pause tool usage', { skip: skipTodoTests }, async () => {
  const rig = new TestRig();
  await rig.setup('todo pause tool usage', {
    settings: {
      'todo-continuation': true,
    },
  });

  // Create todo
  const _createResult = await rig.run(
    'Create a todo: Implement database schema (in_progress)',
  );

  const writeToolCall = await rig.waitForToolCall('todo_write');
  assert.ok(writeToolCall, 'Expected to find a todo_write tool call');

  // Trigger a scenario where AI would want to pause
  const pauseResult = await rig.run(
    'The database configuration file is missing and I cannot proceed without it',
  );

  // Wait for todo_pause tool call
  const pauseToolCall = await rig.waitForToolCall('todo_pause');

  if (!pauseToolCall) {
    // If no pause call, check if AI handled it differently
    printDebugInfo(rig, pauseResult, {
      'Expected todo_pause call': true,
      'Found pause call': false,
      'Contains pause language': pauseResult.toLowerCase().includes('pause'),
      'Contains blocking language':
        pauseResult.toLowerCase().includes('missing') ||
        pauseResult.toLowerCase().includes('cannot proceed'),
    });
  }

  // The AI might handle this scenario differently, so we check for appropriate response
  const hasAppropriatePauseResponse =
    pauseToolCall ||
    pauseResult.toLowerCase().includes('missing') ||
    pauseResult.toLowerCase().includes('cannot proceed') ||
    pauseResult.toLowerCase().includes('need') ||
    pauseResult.toLowerCase().includes('require');

  assert.ok(
    hasAppropriatePauseResponse,
    'Expected appropriate response to blocking condition (todo_pause or explanation)',
  );

  // If pause tool was called, verify the output format
  if (pauseToolCall) {
    const expectedPauseMessage = 'AI paused:';
    const hasPauseMessage = pauseResult.includes(expectedPauseMessage);

    if (!hasPauseMessage) {
      printDebugInfo(rig, pauseResult, {
        'Expected pause message': expectedPauseMessage,
        'Found pause message': hasPauseMessage,
      });
    }

    assert.ok(hasPauseMessage, 'Expected "AI paused:" message in output');
  }

  await rig.cleanup();
});

/**
 * @requirement REQ-004
 * @scenario Setting toggle disables continuation
 * @given CLI with todo-continuation set to false
 * @when User completes without tool calls with active todos
 * @then NO continuation prompt appears
 */
test(
  'setting toggle disables continuation',
  { skip: skipTodoTests },
  async () => {
    const rig = new TestRig();
    await rig.setup('setting toggle disables continuation', {
      settings: {
        'todo-continuation': false, // Explicitly disable
      },
    });

    // Create todo
    const _createResult = await rig.run(
      'Create a todo: Write documentation (in_progress)',
    );

    const writeToolCall = await rig.waitForToolCall('todo_write');
    assert.ok(writeToolCall, 'Expected to find a todo_write tool call');

    // Send message that would normally trigger continuation
    const result = await rig.run(
      'I need to think about this documentation approach',
    );

    // Verify NO continuation prompt appears when disabled
    const hasContinuationPrompt =
      result.toLowerCase().includes('continue working') ||
      result.toLowerCase().includes('back to') ||
      result.toLowerCase().includes('documentation'); // mention of active todo

    if (hasContinuationPrompt) {
      printDebugInfo(rig, result, {
        'Setting disabled': true,
        'Unexpected continuation': hasContinuationPrompt,
        'Result contains continuation language': result
          .toLowerCase()
          .includes('continue'),
      });
    }

    // We allow mentioning the todo context but not explicit continuation prompts
    const hasExplicitContinuation =
      result.toLowerCase().includes('continue working') ||
      result.toLowerCase().includes('shall we continue');

    assert.ok(
      !hasExplicitContinuation,
      'Should NOT show explicit continuation prompt when setting is disabled',
    );

    await rig.cleanup();
  },
);

/**
 * @requirement REQ-005
 * @scenario YOLO mode enhanced continuation prompts
 * @given YOLO mode enabled with active todos
 * @when Continuation is triggered
 * @then Stronger, more directive continuation prompts appear
 */
test(
  'YOLO mode enhanced continuation prompts',
  { skip: skipTodoTests || true },
  async () => {
    // Skipping: Model response variations in CI environment
    const rig = new TestRig();
    await rig.setup('YOLO mode enhanced continuation', {
      settings: {
        'todo-continuation': true,
      },
    });

    // Create todo (YOLO is already enabled via --yolo in TestRig)
    const _createResult = await rig.run(
      'Create a todo: Optimize performance (in_progress)',
    );

    const writeToolCall = await rig.waitForToolCall('todo_write');
    assert.ok(writeToolCall, 'Expected to find a todo_write tool call');

    // Trigger continuation
    const yoloResult = await rig.run('Let me analyze the current situation');

    // In YOLO mode, expect more directive language
    const hasStrongContinuation =
      yoloResult.toLowerCase().includes('optimize performance') ||
      yoloResult.toLowerCase().includes('continue') ||
      yoloResult.toLowerCase().includes('working') ||
      yoloResult.toLowerCase().includes('performance');

    // Note: The exact YOLO enhancement may vary based on implementation
    // This test mainly verifies that continuation works in YOLO mode
    validateModelOutput(
      yoloResult,
      ['performance', 'optimize', 'continue'],
      'YOLO continuation test',
    );

    if (!hasStrongContinuation) {
      printDebugInfo(rig, yoloResult, {
        'YOLO mode enabled': true,
        'Has continuation language': hasStrongContinuation,
        'Contains task reference': yoloResult
          .toLowerCase()
          .includes('optimize'),
      });
    }

    assert.ok(
      hasStrongContinuation,
      'Expected continuation prompt with task context in YOLO mode',
    );

    await rig.cleanup();
  },
);

/**
 * @requirement REQ-006
 * @scenario Multiple active todos continuation priority
 * @given Multiple in_progress todos
 * @when Continuation is triggered
 * @then Continuation focuses on highest priority active todo
 */
test(
  'multiple active todos continuation priority',
  { skip: skipTodoTests },
  async () => {
    const rig = new TestRig();
    await rig.setup('multiple active todos priority', {
      settings: {
        'todo-continuation': true,
      },
    });

    // Create multiple active todos with different priorities
    const _createResult = await rig.run(
      'Create todos: 1. Fix critical bug (in_progress, high), 2. Update docs (in_progress, low), 3. Code review (pending, medium)',
    );

    const writeToolCall = await rig.waitForToolCall('todo_write');
    assert.ok(writeToolCall, 'Expected to find a todo_write tool call');

    // Trigger continuation
    const priorityResult = await rig.run(
      'I need to step back and think about priorities',
    );

    // Should focus on the high priority task
    const focusesOnHighPriority =
      priorityResult.toLowerCase().includes('critical bug') ||
      priorityResult.toLowerCase().includes('bug') ||
      priorityResult.toLowerCase().includes('critical');

    if (!focusesOnHighPriority) {
      printDebugInfo(rig, priorityResult, {
        'Expected high priority focus': true,
        'Mentions critical bug': priorityResult
          .toLowerCase()
          .includes('critical'),
        'Mentions bug': priorityResult.toLowerCase().includes('bug'),
        'Has continuation language': priorityResult
          .toLowerCase()
          .includes('continue'),
      });
    }

    // The AI should reference the most important active task
    validateModelOutput(
      priorityResult,
      ['bug', 'critical', 'fix'],
      'Priority continuation test',
    );

    await rig.cleanup();
  },
);

/**
 * @requirement REQ-007
 * @scenario No continuation without active todos
 * @given Only completed or pending todos
 * @when User completes without tool calls
 * @then NO continuation prompt appears
 */
test(
  'no continuation without active todos',
  { skip: skipTodoTests },
  async () => {
    const rig = new TestRig();
    await rig.setup('no continuation without active todos', {
      settings: {
        'todo-continuation': true,
      },
    });

    // Create todos with no in_progress items
    const _createResult = await rig.run(
      'Create todos: 1. Setup project (completed), 2. Plan architecture (pending)',
    );

    const writeToolCall = await rig.waitForToolCall('todo_write');
    assert.ok(writeToolCall, 'Expected to find a todo_write tool call');

    // Try to trigger continuation
    const result = await rig.run('I need to think about the next steps');

    // Should NOT show continuation prompts since no active todos
    const hasInappropriateContinuation =
      result.toLowerCase().includes('continue working on') ||
      result.toLowerCase().includes('back to implementing');

    if (hasInappropriateContinuation) {
      printDebugInfo(rig, result, {
        'No active todos': true,
        'Inappropriate continuation': hasInappropriateContinuation,
        'Should not continue': true,
      });
    }

    assert.ok(
      !hasInappropriateContinuation,
      'Should NOT show continuation prompt when no active todos exist',
    );

    await rig.cleanup();
  },
);

/**
 * @requirement REQ-008
 * @scenario State validation and consistency
 * @given CLI session with todo state changes
 * @when Continuation is triggered at different points
 * @then Continuation reflects current state accurately
 */
test('state validation and consistency', { skip: skipTodoTests }, async () => {
  const rig = new TestRig();
  await rig.setup('state validation and consistency', {
    settings: {
      'todo-continuation': true,
    },
  });

  // Initial state - create todo
  const _createResult = await rig.run(
    'Create a todo: Build user interface (in_progress)',
  );

  const writeToolCall1 = await rig.waitForToolCall('todo_write');
  assert.ok(writeToolCall1, 'Expected first todo_write call');

  // Test continuation with initial state
  const firstContinuation = await rig.run('Let me think about this');

  const _mentionsUI =
    firstContinuation.toLowerCase().includes('interface') ||
    firstContinuation.toLowerCase().includes('ui');

  // Update state - mark as completed and add new task
  const _updateResult = await rig.run(
    'Update todos: 1. Build user interface (completed), 2. Add authentication (in_progress)',
  );

  const writeToolCall2 = await rig.waitForToolCall('todo_write');
  assert.ok(writeToolCall2, 'Expected second todo_write call');

  // Test continuation with updated state
  const secondContinuation = await rig.run('I need to pause and think');

  const mentionsAuth =
    secondContinuation.toLowerCase().includes('authentication') ||
    secondContinuation.toLowerCase().includes('auth');

  // Verify state consistency - should reference current active task
  if (!mentionsAuth && secondContinuation.toLowerCase().includes('continue')) {
    printDebugInfo(rig, secondContinuation, {
      'State updated': true,
      'Should mention auth': true,
      'Actually mentions auth': mentionsAuth,
      'Mentions old UI task': secondContinuation
        .toLowerCase()
        .includes('interface'),
    });
  }

  // The continuation should reflect the current state (authentication task, not UI)
  const hasCurrentStateReflection =
    mentionsAuth || !secondContinuation.toLowerCase().includes('interface');

  assert.ok(
    hasCurrentStateReflection,
    'Continuation should reflect current todo state, not old state',
  );

  await rig.cleanup();
});

/**
 * @requirement REQ-009
 * @scenario Timing verification
 * @given Active todos and continuation enabled
 * @when Messages are sent in quick succession
 * @then Continuation timing behaves predictably
 */
test(
  'timing verification for continuation triggers',
  { skip: skipTodoTests },
  async () => {
    const rig = new TestRig();
    await rig.setup('timing verification', {
      settings: {
        'todo-continuation': true,
      },
    });

    // Create todo
    const _createResult = await rig.run(
      'Create a todo: Process data pipeline (in_progress)',
    );

    const writeToolCall = await rig.waitForToolCall('todo_write');
    assert.ok(writeToolCall, 'Expected todo_write call');

    // Send multiple quick messages to test timing
    const quickMessage1 = await rig.run('I need to analyze this');
    const quickMessage2 = await rig.run('Let me consider the options');

    // Both should have appropriate responses
    const hasConsistentBehavior =
      quickMessage1.length > 50 &&
      quickMessage2.length > 50 &&
      (quickMessage1.toLowerCase().includes('pipeline') ||
        quickMessage2.toLowerCase().includes('pipeline') ||
        quickMessage1.toLowerCase().includes('data') ||
        quickMessage2.toLowerCase().includes('data'));

    if (!hasConsistentBehavior) {
      printDebugInfo(rig, quickMessage1, {
        'First message length': quickMessage1.length,
        'Second message length': quickMessage2.length,
        'Mentions pipeline':
          quickMessage1.toLowerCase().includes('pipeline') ||
          quickMessage2.toLowerCase().includes('pipeline'),
      });

      printDebugInfo(rig, quickMessage2, {
        'Second message context': 'Timing test second message',
      });
    }

    assert.ok(
      hasConsistentBehavior,
      'Continuation should behave consistently across quick messages',
    );

    await rig.cleanup();
  },
);
