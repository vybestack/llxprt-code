/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'bun:test';
import {
  getToolGovernanceEphemerals,
  readToolList,
  buildToolDeclarationsFromView,
  getEnabledToolNamesForPrompt,
  shouldIncludeSubagentDelegationForConfig,
} from './clientToolGovernance.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { ToolRegistryView } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';

function makeConfig(settings: Record<string, unknown> = {}): Config {
  return new Config({
    sessionId: 'tool-governance',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'governance-model',
    initialSettings: settings,
  });
}

function makeView(toolNames: string[]): ToolRegistryView {
  return {
    listToolNames: () => toolNames,
  } as ToolRegistryView;
}

describe('getToolGovernanceEphemerals', () => {
  it('returns undefined when no allowed or disabled tools', () => {
    const config = makeConfig({});
    expect(
      getToolGovernanceEphemerals({
        allowed:
          readToolList(config.getInitialSettings()['tools.allowed']).length ===
            0 && !Array.isArray(config.getInitialSettings()['tools.allowed'])
            ? undefined
            : readToolList(config.getInitialSettings()['tools.allowed']),
        disabled: readToolList(config.getInitialSettings()['tools.disabled']),
      }),
    ).toBeUndefined();
  });

  it('returns allowed list when present', () => {
    const config = makeConfig({ 'tools.allowed': ['bash', 'read_file'] });
    const result = getToolGovernanceEphemerals({
      allowed:
        readToolList(config.getInitialSettings()['tools.allowed']).length ===
          0 && !Array.isArray(config.getInitialSettings()['tools.allowed'])
          ? undefined
          : readToolList(config.getInitialSettings()['tools.allowed']),
      disabled: readToolList(config.getInitialSettings()['tools.disabled']),
    });
    expect(result).toStrictEqual({
      allowed: ['bash', 'read_file'],
      disabled: undefined,
    });
  });

  it('returns disabled list when present via tools.disabled', () => {
    const config = makeConfig({ 'tools.disabled': ['write_file'] });
    const result = getToolGovernanceEphemerals({
      allowed:
        readToolList(config.getInitialSettings()['tools.allowed']).length ===
          0 && !Array.isArray(config.getInitialSettings()['tools.allowed'])
          ? undefined
          : readToolList(config.getInitialSettings()['tools.allowed']),
      disabled: readToolList(config.getInitialSettings()['tools.disabled']),
    });
    expect(result).toStrictEqual({
      allowed: undefined,
      disabled: ['write_file'],
    });
  });

  it('ignores the legacy disabled-tools key', () => {
    const config = makeConfig({ 'disabled-tools': ['dangerous_tool'] });
    const result = getToolGovernanceEphemerals({
      allowed:
        readToolList(config.getInitialSettings()['tools.allowed']).length ===
          0 && !Array.isArray(config.getInitialSettings()['tools.allowed'])
          ? undefined
          : readToolList(config.getInitialSettings()['tools.allowed']),
      disabled: readToolList(config.getInitialSettings()['tools.disabled']),
    });
    expect(result).toBeUndefined();
  });

  it('reads only tools.disabled when the legacy key is also present', () => {
    const config = makeConfig({
      'tools.disabled': ['new_tool'],
      'disabled-tools': ['old_tool'],
    });
    const result = getToolGovernanceEphemerals({
      allowed:
        readToolList(config.getInitialSettings()['tools.allowed']).length ===
          0 && !Array.isArray(config.getInitialSettings()['tools.allowed'])
          ? undefined
          : readToolList(config.getInitialSettings()['tools.allowed']),
      disabled: readToolList(config.getInitialSettings()['tools.disabled']),
    });
    expect(result?.disabled).toStrictEqual(['new_tool']);
  });

  it('returns both allowed and disabled when both present', () => {
    const config = makeConfig({
      'tools.allowed': ['bash'],
      'tools.disabled': ['write_file'],
    });
    const result = getToolGovernanceEphemerals({
      allowed:
        readToolList(config.getInitialSettings()['tools.allowed']).length ===
          0 && !Array.isArray(config.getInitialSettings()['tools.allowed'])
          ? undefined
          : readToolList(config.getInitialSettings()['tools.allowed']),
      disabled: readToolList(config.getInitialSettings()['tools.disabled']),
    });
    expect(result).toStrictEqual({
      allowed: ['bash'],
      disabled: ['write_file'],
    });
  });
});

describe('readToolList', () => {
  it('returns empty array for non-array input', () => {
    expect(readToolList(null)).toStrictEqual([]);
    expect(readToolList(undefined)).toStrictEqual([]);
    expect(readToolList('bash')).toStrictEqual([]);
    expect(readToolList(42)).toStrictEqual([]);
  });

  it('filters out non-string entries', () => {
    expect(readToolList(['bash', 123, null, 'read_file'])).toStrictEqual([
      'bash',
      'read_file',
    ]);
  });

  it('filters out empty/whitespace entries', () => {
    expect(readToolList(['bash', '', '   ', 'read_file'])).toStrictEqual([
      'bash',
      'read_file',
    ]);
  });

  it('returns valid string entries', () => {
    expect(readToolList(['tool1', 'tool2', 'tool3'])).toStrictEqual([
      'tool1',
      'tool2',
      'tool3',
    ]);
  });

  it('returns empty array for empty array input', () => {
    expect(readToolList([])).toStrictEqual([]);
  });

  it('trims whitespace from tool names', () => {
    expect(readToolList([' bash ', '  read_file  '])).toStrictEqual([
      'bash',
      'read_file',
    ]);
  });
});

describe('buildToolDeclarationsFromView', () => {
  it('returns empty array for undefined registry', () => {
    const view = makeView(['tool1']);
    expect(buildToolDeclarationsFromView(undefined, view)).toStrictEqual([]);
  });

  it('returns empty array when no tool names in view', () => {
    const registry = {
      getAllTools: vi.fn().mockReturnValue([]),
    } as unknown as ToolRegistry;
    const view = makeView([]);
    expect(buildToolDeclarationsFromView(registry, view)).toStrictEqual([]);
  });

  it('prefers getFunctionDeclarations for transformed schemas', () => {
    const decl1 = { name: 'bash', description: 'Run bash' };
    const decl2 = { name: 'read_file', description: 'Read a file' };
    const registry = {
      getFunctionDeclarations: vi.fn().mockReturnValue([decl1, decl2]),
    } as unknown as ToolRegistry;
    const view = makeView(['bash']);
    const result = buildToolDeclarationsFromView(registry, view);
    // toToolDeclaration normalizes to a neutral ToolDeclaration, defaulting
    // parametersJsonSchema to {} when no schema is present on the source.
    expect(result).toStrictEqual([
      { name: 'bash', description: 'Run bash', parametersJsonSchema: {} },
    ]);
  });

  it('falls back to getAllTools when getFunctionDeclarations not available', () => {
    const schema1 = {
      name: 'bash',
      description: 'Run bash',
      parametersJsonSchema: {},
    };
    const schema2 = {
      name: 'read_file',
      description: 'Read a file',
      parametersJsonSchema: {},
    };
    const registry = {
      getAllTools: vi.fn().mockReturnValue([
        { name: 'bash', schema: schema1 },
        { name: 'read_file', schema: schema2 },
        { name: 'other', schema: { name: 'other', description: 'Other' } },
      ]),
    } as unknown as ToolRegistry;
    const view = makeView(['bash', 'read_file']);
    const result = buildToolDeclarationsFromView(registry, view);
    expect(result).toStrictEqual([schema1, schema2]);
  });

  it('skips tools without schema in getAllTools', () => {
    const schema1 = {
      name: 'bash',
      description: 'Run bash',
      parametersJsonSchema: {},
    };
    const registry = {
      getAllTools: vi.fn().mockReturnValue([
        { name: 'bash', schema: schema1 },
        { name: 'no_schema_tool' }, // no schema property
      ]),
    } as unknown as ToolRegistry;
    const view = makeView(['bash', 'no_schema_tool']);
    const result = buildToolDeclarationsFromView(registry, view);
    expect(result).toStrictEqual([schema1]);
  });
});

describe('getEnabledToolNamesForPrompt', () => {
  it('rejects an absent tool selection', () => {
    expect(() =>
      Reflect.apply(getEnabledToolNamesForPrompt, undefined, [undefined]),
    ).toThrow(TypeError);
  });

  it('rejects a selection without enabled tool operations', () => {
    expect(() =>
      Reflect.apply(getEnabledToolNamesForPrompt, undefined, [{}]),
    ).toThrow(TypeError);
  });

  it('returns deduplicated enabled tool names', () => {
    expect(
      getEnabledToolNamesForPrompt({
        getFunctionDeclarations: () => [
          { name: 'bash' },
          { name: 'bash' },
          { name: 'read_file' },
        ],
      }),
    ).toStrictEqual(['bash', 'read_file']);
  });

  it('filters out empty tool names', () => {
    const result = getEnabledToolNamesForPrompt({
      getFunctionDeclarations: () => [
        { name: 'bash' },
        { name: '' },
        { name: 'read_file' },
      ],
    });
    expect(result).not.toContain('');
    expect(result).toContain('bash');
    expect(result).toContain('read_file');
  });
});

function makeConfigWithSubagentManager(
  subagentManager: Pick<SubagentManager, 'listSubagents'> | undefined,
): Pick<SubagentManager, 'listSubagents'> | undefined {
  return subagentManager;
}

describe('shouldIncludeSubagentDelegationForConfig', () => {
  it('returns false when neither task nor list_subagents tools are enabled', async () => {
    const config = makeConfigWithSubagentManager(undefined);
    const result = await shouldIncludeSubagentDelegationForConfig(config, [
      'bash',
      'read_file',
    ]);
    expect(result).toBe(false);
  });

  it('returns false when only task tool is enabled (no list_subagents)', async () => {
    const config = makeConfigWithSubagentManager(undefined);
    const result = await shouldIncludeSubagentDelegationForConfig(config, [
      'task',
      'bash',
    ]);
    expect(result).toBe(false);
  });

  it('returns false when only list_subagents tool is enabled (no task)', async () => {
    const config = makeConfigWithSubagentManager(undefined);
    const result = await shouldIncludeSubagentDelegationForConfig(config, [
      'list_subagents',
    ]);
    expect(result).toBe(false);
  });

  it('returns false when both tools present but no subagent manager', async () => {
    const config = makeConfigWithSubagentManager(undefined);
    const result = await shouldIncludeSubagentDelegationForConfig(config, [
      'task',
      'list_subagents',
    ]);
    expect(result).toBe(false);
  });

  it('returns false when both tools present and subagent manager returns empty list', async () => {
    const mockManager = {
      listSubagents: vi.fn().mockResolvedValue([]),
    } as unknown as SubagentManager;
    const config = makeConfigWithSubagentManager(mockManager);
    const result = await shouldIncludeSubagentDelegationForConfig(config, [
      'task',
      'list_subagents',
    ]);
    expect(result).toBe(false);
  });

  it('returns true when both tools present and subagents exist', async () => {
    const mockManager = {
      listSubagents: vi.fn().mockResolvedValue(['agent1', 'agent2']),
    } as unknown as SubagentManager;
    const config = makeConfigWithSubagentManager(mockManager);
    const result = await shouldIncludeSubagentDelegationForConfig(config, [
      'task',
      'list_subagents',
    ]);
    expect(result).toBe(true);
  });

  it('is case-insensitive for tool name matching', async () => {
    const mockManager = {
      listSubagents: vi.fn().mockResolvedValue(['agent1']),
    } as unknown as SubagentManager;
    const config = makeConfigWithSubagentManager(mockManager);
    const result = await shouldIncludeSubagentDelegationForConfig(config, [
      'TASK',
      'LIST_SUBAGENTS',
    ]);
    expect(result).toBe(true);
  });
});
