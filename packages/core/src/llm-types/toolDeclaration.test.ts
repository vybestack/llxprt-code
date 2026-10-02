/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-003.1, REQ-003.3
 */
import { describe, expect, it } from 'bun:test';
import type { ToolChoice } from './toolDeclaration.js';

describe('ToolChoice orthogonality', () => {
  it('auto mode without allowedToolNames', () => {
    const choice: ToolChoice = { mode: 'auto' };
    expect(choice.mode).toBe('auto');
    expect(choice.allowedToolNames).toBeUndefined();
  });

  it('required mode with allowedToolNames', () => {
    const choice: ToolChoice = {
      mode: 'required',
      allowedToolNames: ['a', 'b'],
    };
    expect(choice.mode).toBe('required');
    expect(choice.allowedToolNames).toStrictEqual(['a', 'b']);
  });

  it('none mode ignores allowedToolNames', () => {
    const choice: ToolChoice = { mode: 'none' };
    expect(choice.mode).toBe('none');
  });
});
