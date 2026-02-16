/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { buildContinuationDirective } from '../utils.js';

describe('buildContinuationDirective', () => {
  it('returns simple continue when no todos are provided', () => {
    const result = buildContinuationDirective();
    expect(result).toBe('Understood. Continuing with the current task.');
  });

  it('returns simple continue when activeTodos is undefined', () => {
    const result = buildContinuationDirective(undefined);
    expect(result).toBe('Understood. Continuing with the current task.');
  });

  it('returns simple continue when activeTodos is empty string', () => {
    const result = buildContinuationDirective('');
    expect(result).toBe('Understood. Continuing with the current task.');
  });

  it('returns simple continue when activeTodos is whitespace-only', () => {
    const result = buildContinuationDirective('   \n  ');
    expect(result).toBe('Understood. Continuing with the current task.');
  });

  it('references the first task when activeTodos is provided', () => {
    const todos =
      '- [in_progress] Implement the auth middleware\n- [pending] Write tests';
    const result = buildContinuationDirective(todos);
    expect(result).toBe(
      'Understood. Continue with current task: "Implement the auth middleware". Use todo_read for full context.',
    );
  });

  it('extracts task content from single todo', () => {
    const todos = '- [pending] Fix the auth bug';
    const result = buildContinuationDirective(todos);
    expect(result).toBe(
      'Understood. Continue with current task: "Fix the auth bug". Use todo_read for full context.',
    );
  });

  it('uses only the first todo even when multiple exist', () => {
    const todos = [
      '- [in_progress] Refactor DB layer',
      '- [pending] Add caching',
      '- [pending] Update docs',
    ].join('\n');
    const result = buildContinuationDirective(todos);
    expect(result).toContain('Refactor DB layer');
    expect(result).not.toContain('Add caching');
    expect(result).not.toContain('Update docs');
  });
});
