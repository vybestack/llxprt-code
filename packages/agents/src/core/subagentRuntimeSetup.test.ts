/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  convertMetadataToFunctionDeclaration,
  filterToolsAgainstRuntime,
  buildEphemeralSettings,
  createEmojiFilter,
  buildRuntimeFunctionDeclarations,
} from './subagentRuntimeSetup.js';
import type { ToolRegistryView } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';

describe('convertMetadataToFunctionDeclaration', () => {
  it('should convert tool metadata to FunctionDeclaration with fallbackName and description', () => {
    const metadata = {
      name: 'my_tool',
      description: 'A test tool',
      parameterSchema: { type: 'OBJECT', properties: {} },
    };
    const decl = convertMetadataToFunctionDeclaration('fallback', metadata);
    expect(decl.name).toBe('my_tool');
    expect(decl.description).toBe('A test tool');
  });

  it('should use fallbackName when metadata.name is absent', () => {
    const metadata = {
      description: 'No name tool',
      parameterSchema: { type: 'OBJECT', properties: {} },
    };
    const decl = convertMetadataToFunctionDeclaration(
      'fallback_name',
      metadata,
    );
    expect(decl.name).toBe('fallback_name');
  });

  it('should include parameters schema when present', () => {
    const metadata = {
      name: 'tool_with_params',
      description: 'Has params',
      parameterSchema: {
        type: 'OBJECT',
        properties: { foo: { type: 'STRING' } },
      },
    };
    const decl = convertMetadataToFunctionDeclaration('fallback', metadata);
    expect(decl.parametersJsonSchema).toBeDefined();
    expect(decl.parametersJsonSchema).toStrictEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          foo: expect.anything(),
        }),
      }),
    );
  });

  it('should handle metadata without parameters', () => {
    const metadata = {
      name: 'no_params_tool',
      description: 'No parameters',
    };
    const decl = convertMetadataToFunctionDeclaration('fallback', metadata);
    expect(decl.name).toBe('no_params_tool');
    expect(decl.parametersJsonSchema).toBeDefined();
  });
});

describe('filterToolsAgainstRuntime', () => {
  it('should return filtered ToolConfig with only allowed tools', async () => {
    const toolsView: ToolRegistryView = {
      listToolNames: () => ['allowed_tool'],
      getToolMetadata: () => ({ name: 'allowed_tool', description: '' }),
    };
    const toolConfig = { tools: ['allowed_tool'] };
    const result = await filterToolsAgainstRuntime({
      toolConfig,
      toolsView,
    });
    expect(result.tools).toStrictEqual(['allowed_tool']);
  });

  it('should filter out disabled tools not in runtime', async () => {
    const toolsView: ToolRegistryView = {
      listToolNames: () => ['other_tool'],
      getToolMetadata: () => undefined,
    };
    const toolConfig = { tools: ['google_web_fetch'] };
    const result = await filterToolsAgainstRuntime({
      toolConfig,
      toolsView,
    });
    expect(result.tools).toStrictEqual([]);
  });

  it('should preserve tools that are present in toolsView', async () => {
    const toolsView: ToolRegistryView = {
      listToolNames: () => ['google_web_fetch', 'read_file'],
      getToolMetadata: (name: string) => ({ name, description: '' }),
    };
    const toolConfig = { tools: ['google_web_fetch', 'read_file'] };
    const result = await filterToolsAgainstRuntime({
      toolConfig,
      toolsView,
    });
    expect(result.tools).toStrictEqual(['google_web_fetch', 'read_file']);
  });

  it('should handle mixed allowed and disallowed tools', async () => {
    const toolsView: ToolRegistryView = {
      listToolNames: () => ['read_file', 'write_file'],
      getToolMetadata: (name: string) => ({ name, description: '' }),
    };
    const toolConfig = {
      tools: ['read_file', 'google_web_fetch', 'write_file'],
    };
    const result = await filterToolsAgainstRuntime({
      toolConfig,
      toolsView,
    });
    // google_web_fetch should be filtered out
    expect(result.tools).toStrictEqual(['read_file', 'write_file']);
  });

  it('should return empty tools array when all tools are filtered out', async () => {
    const toolsView: ToolRegistryView = {
      listToolNames: () => ['other_tool'],
      getToolMetadata: () => undefined,
    };
    const toolConfig = { tools: ['missing_tool'] };
    const result = await filterToolsAgainstRuntime({
      toolConfig,
      toolsView,
    });
    expect(result.tools).toStrictEqual([]);
  });

  it('should pass with empty whitelist (allow all)', async () => {
    const toolsView: ToolRegistryView = {
      listToolNames: () => [],
      getToolMetadata: () => undefined,
    };
    const toolConfig = { tools: [] };
    const result = await filterToolsAgainstRuntime({
      toolConfig,
      toolsView,
    });
    expect(result.tools).toStrictEqual([]);
  });
});

describe('buildEphemeralSettings', () => {
  it('should merge model overrides into base settings', () => {
    const snapshot = {
      emojifilter: 'off' as const,
      tools: { allowed: ['tool_a'], disabled: [] },
    };
    const result = buildEphemeralSettings(snapshot);
    expect(result.emojifilter).toBe('off');
    expect(result['tools.allowed']).toContain('tool_a');
  });

  it('should handle empty overrides (no snapshot)', () => {
    const result = buildEphemeralSettings(undefined);
    expect(result).toBeDefined();
    expect(result.emojifilter).toBe('auto');
  });
});

describe('createEmojiFilter', () => {
  it('should return EmojiFilter for auto mode', () => {
    const filter = createEmojiFilter({ emojifilter: 'auto' });
    expect(filter).toBeDefined();
  });

  it('should return undefined for allowed mode', () => {
    const filter = createEmojiFilter({ emojifilter: 'allowed' });
    expect(filter).toBeUndefined();
  });

  it('should default to auto when no snapshot', () => {
    const filter = createEmojiFilter(undefined);
    expect(filter).toBeDefined();
  });
});

describe('buildRuntimeFunctionDeclarations', () => {
  it('should map all registry metadata to declarations', () => {
    const toolsView: ToolRegistryView = {
      listToolNames: () => ['tool_a', 'tool_b'],
      getToolMetadata: (name: string) => ({
        name,
        description: `Description of ${name}`,
        parameterSchema: { type: 'OBJECT', properties: {} },
      }),
    };
    const toolConfig = { tools: ['tool_a', 'tool_b'] };
    const decls = buildRuntimeFunctionDeclarations(toolsView, toolConfig);
    expect(decls.length).toBe(2);
    expect(decls.map((d) => d.name)).toContain('tool_a');
  });

  it('should filter based on tool whitelist', () => {
    const toolsView: ToolRegistryView = {
      listToolNames: () => ['tool_a', 'tool_b', 'tool_c'],
      getToolMetadata: (name: string) => ({
        name,
        description: '',
        parameterSchema: { type: 'OBJECT', properties: {} },
      }),
    };
    const toolConfig = { tools: ['tool_a'] };
    const decls = buildRuntimeFunctionDeclarations(toolsView, toolConfig);
    expect(decls.every((d) => d.name === 'tool_a')).toBe(true);
  });

  it('should handle empty registry', () => {
    const toolsView: ToolRegistryView = {
      listToolNames: () => [],
      getToolMetadata: () => undefined,
    };
    const toolConfig = { tools: [] };
    const decls = buildRuntimeFunctionDeclarations(toolsView, toolConfig);
    expect(decls).toStrictEqual([]);
  });

  // Issue #2069: omitted toolConfig must use runtime default tools, not no tools
  it('uses all runtime tools when toolConfig is undefined (omitted)', () => {
    const toolsView: ToolRegistryView = {
      listToolNames: () => ['read_file', 'write_file', 'edit_file'],
      getToolMetadata: (name: string) => ({
        name,
        description: `Description of ${name}`,
        parameterSchema: { type: 'OBJECT', properties: {} },
      }),
    };
    const decls = buildRuntimeFunctionDeclarations(toolsView, undefined);
    expect(decls.length).toBe(3);
    expect(decls.map((d) => d.name)).toStrictEqual([
      'read_file',
      'write_file',
      'edit_file',
    ]);
  });

  // Issue #2069: explicit empty toolConfig must remain no tools (fail-closed)
  it('returns no tools when toolConfig has explicit empty tools array', () => {
    const toolsView: ToolRegistryView = {
      listToolNames: () => ['read_file', 'write_file'],
      getToolMetadata: (name: string) => ({
        name,
        description: '',
        parameterSchema: { type: 'OBJECT', properties: {} },
      }),
    };
    const decls = buildRuntimeFunctionDeclarations(toolsView, {
      tools: [],
    });
    expect(decls).toStrictEqual([]);
  });

  // Issue #2069: canonicalization must match task.ts canonical (full snake_case)
  it('matches CamelCase tool names in whitelist against snake_case registry via canonicalization', () => {
    const toolsView: ToolRegistryView = {
      listToolNames: () => ['read_file', 'write_file'],
      getToolMetadata: (name: string) => ({
        name,
        description: '',
        parameterSchema: { type: 'OBJECT', properties: {} },
      }),
    };
    const decls = buildRuntimeFunctionDeclarations(toolsView, {
      tools: ['ReadFile'],
    });
    expect(decls.map((d) => d.name)).toStrictEqual(['read_file']);
  });

  // Issue #2069: excluded task/list_subagents must be excluded from default
  it('excludes task and list_subagents from runtime default tools', () => {
    const toolsView: ToolRegistryView = {
      listToolNames: () => [
        'read_file',
        'write_file',
        'task',
        'list_subagents',
      ],
      getToolMetadata: (name: string) => ({
        name,
        description: '',
        parameterSchema: { type: 'OBJECT', properties: {} },
      }),
    };
    const decls = buildRuntimeFunctionDeclarations(toolsView, undefined);
    const names = decls.map((d) => d.name);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).not.toContain('task');
    expect(names).not.toContain('list_subagents');
  });

  // Issue #2069: non-string FunctionDeclaration entries named task must be
  // excluded even when injected via an explicit ToolConfig.
  it('excludes non-string FunctionDeclaration named task from explicit toolConfig', () => {
    const toolsView: ToolRegistryView = {
      listToolNames: () => ['read_file'],
      getToolMetadata: (name: string) => ({
        name,
        description: '',
        parameterSchema: { type: 'OBJECT', properties: {} },
      }),
    };
    const taskDecl = { name: 'task', description: 'nested task' };
    const toolConfig = { tools: [taskDecl] };
    const decls = buildRuntimeFunctionDeclarations(toolsView, toolConfig);
    expect(decls).toStrictEqual([]);
  });

  // Issue #2069: non-string FunctionDeclaration entries named list_subagents
  // must be excluded even when injected via an explicit ToolConfig.
  it('excludes non-string FunctionDeclaration named list_subagents from explicit toolConfig', () => {
    const toolsView: ToolRegistryView = {
      listToolNames: () => ['read_file'],
      getToolMetadata: (name: string) => ({
        name,
        description: '',
        parameterSchema: { type: 'OBJECT', properties: {} },
      }),
    };
    const listSubagentsDecl = {
      name: 'list_subagents',
      description: 'enumerate subagents',
    };
    const toolConfig = { tools: [listSubagentsDecl] };
    const decls = buildRuntimeFunctionDeclarations(toolsView, toolConfig);
    expect(decls).toStrictEqual([]);
  });

  // Issue #2069: canonical variants of excluded tool names in non-string
  // declarations must also be excluded.
  it('excludes non-string FunctionDeclaration with CamelCase name matching excluded tool', () => {
    const toolsView: ToolRegistryView = {
      listToolNames: () => ['read_file'],
      getToolMetadata: (name: string) => ({
        name,
        description: '',
        parameterSchema: { type: 'OBJECT', properties: {} },
      }),
    };
    const taskDecl = { name: 'Task', description: 'nested task' };
    const goodDecl = { name: 'read_file', description: 'read' };
    const toolConfig = { tools: [taskDecl, goodDecl] };
    const decls = buildRuntimeFunctionDeclarations(toolsView, toolConfig);
    const names = decls.map((d) => d.name);
    expect(names).not.toContain('Task');
    expect(names).not.toContain('task');
    expect(names).toContain('read_file');
  });

  // Issue #2069: non-string FunctionDeclaration with no name is preserved
  // (cannot match excluded tools).
  it('preserves non-string FunctionDeclaration with no name', () => {
    const toolsView: ToolRegistryView = {
      listToolNames: () => [],
      getToolMetadata: () => undefined,
    };
    const anonDecl = { description: 'anonymous' };
    const toolConfig = { tools: [anonDecl] };
    const decls = buildRuntimeFunctionDeclarations(toolsView, toolConfig);
    expect(decls).toHaveLength(1);
    expect(decls[0]).toBe(anonDecl);
  });
});
