/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { test, expect } from 'vitest';
import { TestRig, printDebugInfo } from './test-helper.js';

const skipTodoTests =
  process.env.SKIP_TODO_TESTS !== 'false' &&
  (process.env.CI || process.env.GITHUB_ACTIONS);

/**
 * @requirement REQ-005
 * @scenario Hidden todo reminders are not shown to the user
 * @given CLI without active todo list guidance
 * @when Agent makes repeated tool calls without creating todos
 * @then Transcript should not display todo reminder copy
 */
const conditionalTest = skipTodoTests ? test.skip : test;

conditionalTest('hidden todo reminders stay out of transcript', async () => {
  const rig = new TestRig();
  await rig.setup('hidden todo reminders stay out of transcript', {
    settings: {
      'todo-continuation': true,
    },
  });

  const result = await rig.run(
    'Without creating a todo list, run list_directory on "." followed by read_file on package.json, then respond with your findings.',
  );

  const visibleReminder =
    result.includes(
      'After this next tool call I need to call todo_write and create a todo list to organize this effort.',
    ) ||
    result.includes(
      'Immediately call todo_write after this next tool call to organize the work.',
    );

  if (visibleReminder) {
    printDebugInfo(rig, result, {
      message: 'Todo reminder copy leaked into user-visible transcript',
    });
  }

  expect(visibleReminder).toBe(false);
  expect(result.includes('System Note')).toBe(false);

  await rig.cleanup();
});
