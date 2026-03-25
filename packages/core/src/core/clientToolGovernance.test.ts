/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  getToolGovernanceEphemerals,
  readToolList,
  buildToolDeclarationsFromView,
  getEnabledToolNamesForPrompt,
  shouldIncludeSubagentDelegationForConfig,
} from './clientToolGovernance.js';
import type { Config } from '../config/config.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import type { ToolRegistryView } from '../runtime/AgentRuntimeContext.js';
import type { SubagentManager } from '../config/subagentManager.js';

function makeConfig(settings: Record<string, unknown> = {}): Config {
  return {
    getEphemeralSetting: (key: string) => settings[key],
    getToolRegistry: () => undefined,
    getSubagentManager: () => undefined,
  } as unknown as Config;
}

function makeConfigWithTools(
  settings: Record<string, unknown>,
  toolRegistry: ToolRegistry,
): Config {
  return {
    getEphemeralSetting: (key: string) => settings[key],
    getToolRegistry: () => toolRegistry,
    getSubagentManager: () => undefined,
  } as unknown as Config;
}

function makeView(toolNames: string[]): ToolRegistryView {
  return {
    listToolNames: () => toolNames,
  } as ToolRegistryView;
}

describe('getToolGovernanceEphemerals', () => {
  it('returns undefined when no allowed or disabled tools', () => {
    const config = makeConfig({});
    expect(getToolGovernanceEphemerals(config)).toBeUndefined();
  });

  it('returns allowed list when present', () => {
    const config = makeConfig({ 'tools.allowed': ['bash', 'read_file'] });
    const result = getToolGovernanceEphemerals(config);
    expect(result).toEqual({
      allowed: ['bash', 'read_file'],
      disabled: undefined,
    });
  });

  it('returns disabled list when present via tools.disabled', () => {
    const config = makeConfig({ 'tools.disabled': ['write_file'] });
    const result = getToolGovernanceEphemerals(config);
    expect(result).toEqual({ allowed: undefined, disabled: ['write_file'] });
  });

  it('returns disabled list when present via legacy disabled-tools key', () => {
    const config = makeConfig({ 'disabled-tools': ['dangerous_tool'] });
    const result = getToolGovernanceEphemerals(config);
    expect(result).toEqual({
      allowed: undefined,
      disabled: ['dangerous_tool'],
    });
  });

  it('prefers tools.disabled over disabled-tools', () => {
    const config = makeConfig({
      'tools.disabled': ['new_tool'],
      'disabled-tools': ['old_tool'],
    });
    const result = getToolGovernanceEphemerals(config);
    expect(result?.disabled).toEqual(['new_tool']);
  });

  it('returns both allowed and disabled when both present', () => {
    const config = makeConfig({
      'tools.allowed': ['bash'],
      'tools.disabled': ['write_file'],
    });
    const result = getToolGovernanceEphemerals(config);
    expect(result).toEqual({
      allowed: ['bash'],
      disabled: ['write_file'],
    });
  });
});

describe('readToolList', () => {
  it('returns empty array for non-array input', () => {
    expect(readToolList(null)).toEqual([]);
    expect(readToolList(undefined)).toEqual([]);
    expect(readToolList('bash')).toEqual([]);
    expect(readToolList(42)).toEqual([]);
  });

  it('filters out non-string entries', () => {
    expect(readToolList(['bash', 123, null, 'read_file'])).toEqual([
      'bash',
      'read_file',
    ]);
  });

  it('filters out empty/whitespace entries', () => {
    expect(readToolList(['bash', '', '   ', 'read_file'])).toEqual([
      'bash',
      'read_file',
    ]);
  });

  it('returns valid string entries', () => {
    expect(readToolList(['tool1', 'tool2', 'tool3'])).toEqual([
      'tool1',
      'tool2',
      'tool3',
    ]);
  });

  it('returns empty array for empty array input', () => {
    expect(readToolList([])).toEqual([]);
  });

  it('trims whitespace from tool names', () => {
    expect(readToolList([' bash ', '  read_file  '])).toEqual([
      'bash',
      'read_file',
    ]);
  });
});

describe('buildToolDeclarationsFromView', () => {
  it('returns empty array for undefined registry', () => {
    const view = makeView(['tool1']);
    expect(buildToolDeclarationsFromView(undefined, view)).toEqual([]);
  });

  it('returns empty array when no tool names in view', () => {
    const registry = {
      getAllTools: vi.fn().mockReturnValue([]),
    } as unknown as ToolRegistry;
    const view = makeView([]);
    expect(buildToolDeclarationsFromView(registry, view)).toEqual([]);
  });

  it('prefers getFunctionDeclarations for transformed schemas', () => {
    const decl1 = { name: 'bash', description: 'Run bash' };
    const decl2 = { name: 'read_file', description: 'Read a file' };
    const registry = {
      getFunctionDeclarations: vi.fn().mockReturnValue([decl1, decl2]),
    } as unknown as ToolRegistry;
    const view = makeView(['bash']);
    const result = buildToolDeclarationsFromView(registry, view);
    expect(result).toEqual([decl1]);
  });

  it('falls back to getAllTools when getFunctionDeclarations not available', () => {
    const schema1 = { name: 'bash', description: 'Run bash' };
    const schema2 = { name: 'read_file', description: 'Read a file' };
    const registry = {
      getAllTools: vi.fn().mockReturnValue([
        { name: 'bash', schema: schema1 },
        { name: 'read_file', schema: schema2 },
        { name: 'other', schema: { name: 'other', description: 'Other' } },
      ]),
    } as unknown as ToolRegistry;
    const view = makeView(['bash', 'read_file']);
    const result = buildToolDeclarationsFromView(registry, view);
    expect(result).toEqual([schema1, schema2]);
  });

  it('skips tools without schema in getAllTools', () => {
    const schema1 = { name: 'bash', description: 'Run bash' };
    const registry = {
      getAllTools: vi.fn().mockReturnValue([
        { name: 'bash', schema: schema1 },
        { name: 'no_schema_tool' }, // no schema property
      ]),
    } as unknown as ToolRegistry;
    const view = makeView(['bash', 'no_schema_tool']);
    const result = buildToolDeclarationsFromView(registry, view);
    expect(result).toEqual([schema1]);
  });
});

describe('getEnabledToolNamesForPrompt', () => {
  it('returns empty array when no tool registry', () => {
    const config = makeConfig({});
    expect(getEnabledToolNamesForPrompt(config)).toEqual([]);
  });

  it('returns empty array when toolRegistry has no getEnabledTools', () => {
    const config = makeConfigWithTools({}, {} as unknown as ToolRegistry);
    expect(getEnabledToolNamesForPrompt(config)).toEqual([]);
  });

  it('returns deduplicated enabled tool names', () => {
    const registry = {
      getEnabledTools: vi.fn().mockReturnValue([
        { name: 'bash' },
        { name: 'bash' }, // duplicate
        { name: 'read_file' },
      ]),
    } as unknown as ToolRegistry;
    const config = makeConfigWithTools({}, registry);
    expect(getEnabledToolNamesForPrompt(config)).toEqual(['bash', 'read_file']);
  });

  it('filters out empty tool names', () => {
    const registry = {
      getEnabledTools: vi.fn().mockReturnValue([
        { name: 'bash' },
        { name: '' }, // empty name
        { name: 'read_file' },
      ]),
    } as unknown as ToolRegistry;
    const config = makeConfigWithTools({}, registry);
    // filter(Boolean) removes empty strings
    const result = getEnabledToolNamesForPrompt(config);
    expect(result).not.toContain('');
    expect(result).toContain('bash');
    expect(result).toContain('read_file');
  });
});

function makeConfigWithSubagentManager(
  subagentManager: SubagentManager | undefined,
): Config {
  return {
    getEphemeralSetting: () => undefined,
    getToolRegistry: () => undefined,
    getSubagentManager: () => subagentManager,
  } as unknown as Config;
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
