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

  it('includes last user prompt context when provided without todos', () => {
    const result = buildContinuationDirective(
      undefined,
      'Fix the failing test in auth module',
    );
    expect(result).toContain('Fix the failing test in auth module');
    expect(result).toContain('most recent request');
  });

  it('combines todos and last user prompt context', () => {
    const todos = '- [in_progress] Fix auth bug';
    const result = buildContinuationDirective(
      todos,
      'The test is still failing after the last change',
    );
    expect(result).toContain('Fix auth bug');
    expect(result).toContain('The test is still failing after the last change');
  });

  it('ignores empty last user prompt context', () => {
    const result = buildContinuationDirective(undefined, '');
    expect(result).toBe('Understood. Continuing with the current task.');
  });

  it('ignores whitespace-only last user prompt context', () => {
    const result = buildContinuationDirective(undefined, '   \n  ');
    expect(result).toBe('Understood. Continuing with the current task.');
  });
});
