/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'bun:test';
import { createCompletionHandler } from '../schema/index.js';
import { parseCommandArguments } from '../../hooks/slashCommandPathUtils.js';
import { createMockCommandContext } from '../../../test-utils/mockCommandContext.js';
import { subagentCommand, subagentNameSchema } from '../subagentCommand.js';
import { assertDefined } from '../../../test-utils/assertions.js';

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

  assertDefined(saveCommand?.schema);

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

    expect(result.suggestions).toStrictEqual([
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

    expect(result.suggestions.map((s) => s.value)).toStrictEqual([
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

    expect(result.suggestions.map((s) => s.value)).toStrictEqual(mockProfiles);
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

    expect(result.suggestions.map((s) => s.value)).toStrictEqual([
      'auto',
      'manual',
    ]);
    expect(result.hint).toBe('Select mode');
  });

  it('requests prompt text after auto literal and trailing space', async () => {
    const result = await invoke('/subagent save agent1 default auto ', {
      args: 'agent1 default auto ',
      completedArgs: ['agent1', 'default', 'auto'],
      partialArg: '',
      commandPathLength: 2,
    });

    expect(result.suggestions).toStrictEqual([]);
    expect(result.hint).toBe('Enter system prompt for automatic mode');
  });
});

const getSubCommand = (subName: string) =>
  subagentCommand.subCommands?.find((cmd) => cmd.name === subName);

function nullableSubcommand(
  subcommand: ReturnType<typeof getSubCommand>,
): NonNullable<ReturnType<typeof getSubCommand>> | null {
  return subcommand ?? null;
}

async function loadSubagentWithBrokenEntry(
  name: string,
): Promise<{ profile: string; source: string }> {
  if (name === 'broken') {
    throw new Error('corrupted file');
  }
  return { profile: 'default', source: 'user' };
}

const invokeSub = async (
  subName: string,
  fullLine: string,
  input: Parameters<ReturnType<typeof createCompletionHandler>>[1],
) => {
  const sub = getSubCommand(subName);

  assertDefined(sub?.schema);

  const handler = createCompletionHandler(sub.schema);
  return handler(createContext(), input, fullLine);
};

describe.each(['edit', 'show', 'delete'])(
  'subagent %s name autocomplete @issue:1115',
  (subName) => {
    it('exposes a schema so the completion engine offers argument suggestions', () => {
      const sub = getSubCommand(subName);

      expect(sub?.schema).toBeDefined();
    });

    it('suggests existing subagent names on the first argument', async () => {
      const result = await invokeSub(subName, `/subagent ${subName} `, {
        args: '',
        completedArgs: [],
        partialArg: '',
        commandPathLength: 2,
      });

      expect(result.suggestions).toStrictEqual([
        { value: 'agent1', description: 'Profile: default' },
        { value: 'agent2', description: 'Profile: custom' },
        { value: 'code-helper', description: 'Profile: coding' },
      ]);
      expect(result.hint).toBe('Enter subagent name');
      expect(result.position).toBe(1);
    });

    it('filters the subagent name suggestions by the partial token', async () => {
      const result = await invokeSub(subName, `/subagent ${subName} a`, {
        args: 'a',
        completedArgs: [],
        partialArg: 'a',
        commandPathLength: 2,
      });

      expect(result.suggestions.map((s) => s.value)).toStrictEqual([
        'agent1',
        'agent2',
      ]);
      expect(result.hint).toBe('Enter subagent name');
    });
  },
);

describe('subagent name completer edge cases @issue:1115', () => {
  it('returns empty suggestions when no subagents exist', async () => {
    const ctx = createMockCommandContext({
      services: {
        subagentManager: {
          listSubagents: vi.fn(async () => []),
          loadSubagent: vi.fn(async () => undefined),
        },
      },
    });

    const handler = createCompletionHandler(subagentNameSchema);
    const result = await handler(
      ctx,
      {
        args: '',
        completedArgs: [],
        partialArg: '',
        commandPathLength: 2,
      },
      '/subagent edit ',
    );

    expect(result.suggestions).toStrictEqual([]);
  });

  it('returns empty suggestions when subagentManager is unavailable', async () => {
    const ctx = createMockCommandContext({
      services: {},
    });

    const handler = createCompletionHandler(subagentNameSchema);
    const result = await handler(
      ctx,
      {
        args: '',
        completedArgs: [],
        partialArg: '',
        commandPathLength: 2,
      },
      '/subagent edit ',
    );

    expect(result.suggestions).toStrictEqual([]);
  });

  it('falls back to generic description when loadSubagent fails', async () => {
    const ctx = createMockCommandContext({
      services: {
        subagentManager: {
          listSubagents: vi.fn(async () => ['good', 'broken']),
          loadSubagent: vi.fn(loadSubagentWithBrokenEntry),
        },
      },
    });

    const handler = createCompletionHandler(subagentNameSchema);
    const result = await handler(
      ctx,
      {
        args: '',
        completedArgs: [],
        partialArg: '',
        commandPathLength: 2,
      },
      '/subagent edit ',
    );

    expect(result.suggestions).toStrictEqual([
      { value: 'good', description: 'Profile: default' },
      { value: 'broken', description: 'Subagent' },
    ]);
  });
});

describe.each(['edit', 'show', 'delete'])(
  'subagent %s parseCommandArguments integration @issue:1115',
  (subName) => {
    it('marks the leaf command as supporting argument completion', () => {
      const sub = getSubCommand(subName);

      const result = parseCommandArguments(
        [],
        true,
        nullableSubcommand(sub),
        subagentCommand.subCommands,
      );

      expect(result.leafSupportsArguments).toBe(true);
    });

    it('extracts argument partial when typing a partial name', () => {
      const sub = getSubCommand(subName);

      const result = parseCommandArguments(
        ['ag'],
        false,
        nullableSubcommand(sub),
        subagentCommand.subCommands,
      );

      expect(result.argumentPartial).toBe('ag');
      expect(result.leafSupportsArguments).toBe(true);
    });
  },
);
