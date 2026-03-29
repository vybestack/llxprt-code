/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
// This import will fail until we create the types.ts file
import type {
  ToolActionReturn,
  MessageActionReturn,
  LoadHistoryActionReturn,
  SubmitPromptActionReturn,
  CommandActionReturn,
} from './types.js';

describe('Command Action Return Types', () => {
  it('should support ToolActionReturn type', () => {
    const toolAction: ToolActionReturn = {
      type: 'tool',
      toolName: 'test_tool',
      toolArgs: { arg1: 'value1' },
    };
    expect(toolAction.type).toBe('tool');
    expect(toolAction.toolName).toBe('test_tool');
  });

  it('should support MessageActionReturn type', () => {
    const messageAction: MessageActionReturn = {
      type: 'message',
      messageType: 'info',
      content: 'Test message',
    };
    expect(messageAction.type).toBe('message');
    expect(messageAction.messageType).toBe('info');
  });

  it('should support LoadHistoryActionReturn type', () => {
    const loadHistoryAction: LoadHistoryActionReturn<unknown[]> = {
      type: 'load_history',
      history: [],
      clientHistory: [],
    };
    expect(loadHistoryAction.type).toBe('load_history');
  });

  it('should support SubmitPromptActionReturn type', () => {
    const submitPromptAction: SubmitPromptActionReturn = {
      type: 'submit_prompt',
      content: [{ text: 'Test prompt' }],
    };
    expect(submitPromptAction.type).toBe('submit_prompt');
  });

  it('should support CommandActionReturn discriminated union', () => {
    const actions: Array<CommandActionReturn<unknown[]>> = [
      { type: 'tool', toolName: 'test', toolArgs: {} },
      { type: 'message', messageType: 'info', content: 'test' },
      { type: 'load_history', history: [], clientHistory: [] },
      { type: 'submit_prompt', content: [] },
    ];

    expect(actions).toHaveLength(4);
    expect(actions[0].type).toBe('tool');
    expect(actions[1].type).toBe('message');
    expect(actions[2].type).toBe('load_history');
    expect(actions[3].type).toBe('submit_prompt');
  });

  it('should allow type narrowing with discriminated union', () => {
    const action: CommandActionReturn<unknown[]> = {
      type: 'message',
      messageType: 'error',
      content: 'An error occurred',
    };

    if (action.type === 'message') {
      // Type should be narrowed to MessageActionReturn
      expect(action.messageType).toBe('error');
      expect(action.content).toBe('An error occurred');
    }
  });
});
