/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { createCompletionHandler } from '../schema/index.js';
import type { CommandArgumentSchema } from '../schema/types.js';
import { createMockCommandContext } from '../../../test-utils/mockCommandContext.js';

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

const createContext = () =>
  createMockCommandContext({
    services: {
      subagentManager: {
        listSubagents: vi.fn(async () => Object.keys(mockSubagents)),
        loadSubagent: vi.fn(async (name: string) => mockSubagents[name]),
        saveSubagent: vi.fn(async () => undefined),
        deleteSubagent: vi.fn(async () => undefined),
      },
    },
  });

const subagentSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'name',
    description: 'Enter subagent name',
    completer: async (ctx, partial) => {
      const manager = ctx.services.subagentManager;
      if (!manager) {
        return [];
      }

      const names = await manager.listSubagents();
      const normalized = partial.toLowerCase();
      const matching = names.filter((name) =>
        normalized.length === 0
          ? true
          : name.toLowerCase().startsWith(normalized),
      );

      const entries = await Promise.all(
        matching.map(async (name) => {
          const details = await manager.loadSubagent?.(name);
          return {
            value: name,
            description: `Profile: ${details?.profile ?? 'default'}`,
          };
        }),
      );

      return entries;
    },
  },
  {
    kind: 'value',
    name: 'profile',
    description: 'Select profile configuration',
    options: [
      { value: 'default', description: 'Default configuration' },
      { value: 'custom', description: 'Custom settings' },
      { value: 'coding', description: 'Code generation focused' },
    ],
  },
  {
    kind: 'literal',
    value: 'auto',
    description: 'Automatic mode',
    next: [
      {
        kind: 'value',
        name: 'prompt',
        description: 'Enter system prompt for automatic mode',
      },
    ],
  },
  {
    kind: 'literal',
    value: 'manual',
    description: 'Manual mode',
    next: [
      {
        kind: 'value',
        name: 'prompt',
        description: 'Enter system prompt for manual mode',
      },
    ],
  },
];

const invoke = async (
  fullLine: string,
  input: Parameters<ReturnType<typeof createCompletionHandler>>[1] = {
    args: '',
    completedArgs: [],
    partialArg: '',
    commandPathLength: 2,
  },
) => {
  const handler = createCompletionHandler(subagentSchema);
  return handler(createContext(), input, fullLine);
};

describe('subagent schema resolver integration @plan:PLAN-20250214-AUTOCOMPLETE.P08 @requirement:REQ-002 @requirement:REQ-003 @requirement:REQ-005', () => {
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

    expect(result.suggestions.map((s) => s.value)).toEqual([
      'default',
      'custom',
      'coding',
    ]);
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
