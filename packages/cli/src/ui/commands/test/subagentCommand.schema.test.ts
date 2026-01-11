/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { createCompletionHandler } from '../schema/index.js';
import { createMockCommandContext } from '../../../test-utils/mockCommandContext.js';
import { subagentCommand } from '../subagentCommand.js';

type MockSubagentDetail = {
  name: string;
  profile: string;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
};

const mockSubagents: Record<string, MockSubagentDetail> = {
  agent1: {
    name: 'agent1',
    profile: 'default',
    systemPrompt: 'prompt-1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  agent2: {
    name: 'agent2',
    profile: 'custom',
    systemPrompt: 'prompt-2',
    createdAt: '2025-01-02T00:00:00Z',
    updatedAt: '2025-01-02T00:00:00Z',
  },
  'code-helper': {
    name: 'code-helper',
    profile: 'coding',
    systemPrompt: 'coding assistant',
    createdAt: '2025-01-03T00:00:00Z',
    updatedAt: '2025-01-03T00:00:00Z',
  },
};

const mockProfiles = ['default', 'analysis', 'ops'];

const createContext = () =>
  createMockCommandContext({
    services: {
      subagentManager: {
        listSubagents: vi.fn(async () => Object.keys(mockSubagents)),
        loadSubagent: vi.fn(async (name: string) => mockSubagents[name]),
        saveSubagent: vi.fn(async () => undefined),
        deleteSubagent: vi.fn(async () => undefined),
      },
      profileManager: {
        listProfiles: vi.fn(async () => mockProfiles),
      },
    },
  });

const invoke = async (
  fullLine: string,
  input: Parameters<ReturnType<typeof createCompletionHandler>>[1] = {
    args: '',
    completedArgs: [],
    partialArg: '',
    commandPathLength: 2,
  },
) => {
  const saveCommand = subagentCommand.subCommands?.find(
    (cmd) => cmd.name === 'save',
  );

  if (!saveCommand?.schema) {
    throw new Error('saveCommand schema is not configured');
  }

  const handler = createCompletionHandler(saveCommand.schema);
  return handler(createContext(), input, fullLine);
};

describe('subagent schema resolver integration @plan:PLAN-20250214-AUTOCOMPLETE.P08 @requirement:REQ-002 @requirement:REQ-003 @requirement:REQ-005', () => {
  it('has separate create command for interactive wizard', () => {
    const createCommand = subagentCommand.subCommands?.find(
      (cmd) => cmd.name === 'create',
    );

    expect(createCommand).toBeDefined();
    expect(createCommand?.description).toMatch(/create.*interactive/i);
  });

  it('suggests subagent names with hint on first argument', async () => {
    const result = await invoke('/subagent save ', {
      args: '',
      completedArgs: [],
      partialArg: '',
      commandPathLength: 2,
    });

    expect(result.suggestions).toEqual([
      { value: 'agent1', description: 'Profile: default' },
      { value: 'agent2', description: 'Profile: custom' },
      { value: 'code-helper', description: 'Profile: coding' },
    ]);
    expect(result.hint).toBe('Enter subagent name');
    expect(result.position).toBe(1);
  });

  it('filters name suggestions by partial token', async () => {
    const result = await invoke('/subagent save a', {
      args: 'a',
      completedArgs: [],
      partialArg: 'a',
      commandPathLength: 2,
    });

    expect(result.suggestions.map((s) => s.value)).toEqual([
      'agent1',
      'agent2',
    ]);
    expect(result.hint).toBe('Enter subagent name');
  });

  it('advances to profile options after name supplied', async () => {
    const result = await invoke('/subagent save agent1 ', {
      args: 'agent1 ',
      completedArgs: ['agent1'],
      partialArg: '',
      commandPathLength: 2,
    });

    expect(result.suggestions.map((s) => s.value)).toEqual(mockProfiles);
    expect(result.hint).toBe('Select profile configuration');
    expect(result.position).toBe(2);
  });

  it('surfaces literal mode choices after profile selection', async () => {
    const result = await invoke('/subagent save agent1 default ', {
      args: 'agent1 default ',
      completedArgs: ['agent1', 'default'],
      partialArg: '',
      commandPathLength: 2,
    });

    expect(result.suggestions.map((s) => s.value)).toEqual(['auto', 'manual']);
    expect(result.hint).toBe('Select mode');
  });

  it('requests prompt text after auto literal and trailing space', async () => {
    const result = await invoke('/subagent save agent1 default auto ', {
      args: 'agent1 default auto ',
      completedArgs: ['agent1', 'default', 'auto'],
      partialArg: '',
      commandPathLength: 2,
    });

    expect(result.suggestions).toEqual([]);
    expect(result.hint).toBe('Enter system prompt for automatic mode');
  });
});
