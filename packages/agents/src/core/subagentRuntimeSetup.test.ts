/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable max-lines, eslint-comments/disable-enable-pair -- Phase 5: large behavioral coverage file retained together to avoid fragmenting related scenarios. */

import { describe, it, expect, beforeAll } from 'vitest';
import type { CreateChatObjectParams } from './subagentRuntimeSetup.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let convertMetadataToFunctionDeclaration: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let filterToolsAgainstRuntime: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createToolExecutionConfig: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let buildEphemeralSettings: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let buildRuntimeFunctionDeclarations: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getScopeLocalFuncDefs: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let buildChatSystemPrompt: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createSchedulerConfig: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createEmojiFilter: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createChatObject: any;

describe('subagentRuntimeSetup', () => {
  beforeAll(async () => {
    const mod = await import('./subagentRuntimeSetup.js');
    convertMetadataToFunctionDeclaration =
      mod.convertMetadataToFunctionDeclaration;
    filterToolsAgainstRuntime = mod.filterToolsAgainstRuntime;
    createToolExecutionConfig = mod.createToolExecutionConfig;
    buildEphemeralSettings = mod.buildEphemeralSettings;
    buildRuntimeFunctionDeclarations = mod.buildRuntimeFunctionDeclarations;
    getScopeLocalFuncDefs = mod.getScopeLocalFuncDefs;
    buildChatSystemPrompt = mod.buildChatSystemPrompt;
    createSchedulerConfig = mod.createSchedulerConfig;
    createEmojiFilter = mod.createEmojiFilter;
    createChatObject = mod.createChatObject;
  }, 30000); // Increase timeout for dynamic import during full test suite runs

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
      const toolsView = {
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
      const toolsView = {
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
      const toolsView = {
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
      const toolsView = {
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
      const toolsView = {
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
      const toolsView = {
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

  describe('createToolExecutionConfig', () => {
    it('should build config from runtime context', () => {
      const runtimeBundle = {
        runtimeContext: { state: { sessionId: 'sess-123' } },
      };
      const toolRegistry = {
        getTool: () => undefined,
        getFunctionDeclarationsFiltered: () => [],
      };
      const foregroundConfig = {
        getOrCreateScheduler: () => {},
        disposeScheduler: () => {},
      };
      const config = createToolExecutionConfig(
        runtimeBundle,
        toolRegistry,
        foregroundConfig,
      );
      expect(config).toBeDefined();
      expect(config.getSessionId()).toBe('sess-123');
    });

    it('should apply tool whitelist restrictions', () => {
      const runtimeBundle = {
        runtimeContext: { state: { sessionId: 'sess-123' } },
      };
      const toolRegistry = {
        getTool: () => undefined,
        getFunctionDeclarationsFiltered: () => [],
      };
      const foregroundConfig = {
        getOrCreateScheduler: () => {},
        disposeScheduler: () => {},
      };
      const toolConfig = { tools: ['allowed_tool'] };
      const config = createToolExecutionConfig(
        runtimeBundle,
        toolRegistry,
        foregroundConfig,
        undefined,
        undefined,
        toolConfig,
      );
      const allowed = config.getEphemeralSetting('tools.allowed');
      expect(Array.isArray(allowed)).toBe(true);
      expect(allowed).toContain('allowed_tool');
    });

    it('should include ephemeral settings', () => {
      const runtimeBundle = {
        runtimeContext: { state: { sessionId: 'sess-456' } },
      };
      const toolRegistry = {
        getTool: () => undefined,
        getFunctionDeclarationsFiltered: () => [],
      };
      const foregroundConfig = {
        getOrCreateScheduler: () => {},
        disposeScheduler: () => {},
      };
      const config = createToolExecutionConfig(
        runtimeBundle,
        toolRegistry,
        foregroundConfig,
      );
      expect(config.getEphemeralSettings()).toBeDefined();
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
      const toolsView = {
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
      expect(decls.map((d: { name: string }) => d.name)).toContain('tool_a');
    });

    it('should filter based on tool whitelist', () => {
      const toolsView = {
        listToolNames: () => ['tool_a', 'tool_b', 'tool_c'],
        getToolMetadata: (name: string) => ({
          name,
          description: '',
          parameterSchema: { type: 'OBJECT', properties: {} },
        }),
      };
      const toolConfig = { tools: ['tool_a'] };
      const decls = buildRuntimeFunctionDeclarations(toolsView, toolConfig);
      expect(decls.every((d: { name: string }) => d.name === 'tool_a')).toBe(
        true,
      );
    });

    it('should handle empty registry', () => {
      const toolsView = {
        listToolNames: () => [],
        getToolMetadata: () => undefined,
      };
      const toolConfig = { tools: [] };
      const decls = buildRuntimeFunctionDeclarations(toolsView, toolConfig);
      expect(decls).toStrictEqual([]);
    });

    // Issue #2069: omitted toolConfig must use runtime default tools, not no tools
    it('uses all runtime tools when toolConfig is undefined (omitted)', () => {
      const toolsView = {
        listToolNames: () => ['read_file', 'write_file', 'edit_file'],
        getToolMetadata: (name: string) => ({
          name,
          description: `Description of ${name}`,
          parameterSchema: { type: 'OBJECT', properties: {} },
        }),
      };
      const decls = buildRuntimeFunctionDeclarations(toolsView, undefined);
      expect(decls.length).toBe(3);
      expect(decls.map((d: { name: string }) => d.name)).toStrictEqual([
        'read_file',
        'write_file',
        'edit_file',
      ]);
    });

    // Issue #2069: explicit empty toolConfig must remain no tools (fail-closed)
    it('returns no tools when toolConfig has explicit empty tools array', () => {
      const toolsView = {
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
      const toolsView = {
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
      expect(decls.map((d: { name: string }) => d.name)).toStrictEqual([
        'read_file',
      ]);
    });

    // Issue #2069: excluded task/list_subagents must be excluded from default
    it('excludes task and list_subagents from runtime default tools', () => {
      const toolsView = {
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
      const names = decls.map((d: { name: string }) => d.name);
      expect(names).toContain('read_file');
      expect(names).toContain('write_file');
      expect(names).not.toContain('task');
      expect(names).not.toContain('list_subagents');
    });

    // Issue #2069: non-string FunctionDeclaration entries named task must be
    // excluded even when injected via an explicit ToolConfig.
    it('excludes non-string FunctionDeclaration named task from explicit toolConfig', () => {
      const toolsView = {
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
      const toolsView = {
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
      const toolsView = {
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
      const names = decls.map((d: { name: string }) => d.name);
      expect(names).not.toContain('Task');
      expect(names).not.toContain('task');
      expect(names).toContain('read_file');
    });

    // Issue #2069: non-string FunctionDeclaration with no name is preserved
    // (cannot match excluded tools).
    it('preserves non-string FunctionDeclaration with no name', () => {
      const toolsView = {
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

  describe('getScopeLocalFuncDefs', () => {
    it('should return self_emitvalue declaration with output keys as enum', () => {
      const outputConfig = {
        outputs: { result: 'The result', count: 'A count' },
      };
      const decls = getScopeLocalFuncDefs(outputConfig);
      expect(decls.length).toBeGreaterThan(0);
      const emitDecl = decls.find(
        (d: { name: string }) => d.name === 'self_emitvalue',
      );
      expect(emitDecl).toBeDefined();
    });

    it('should return empty array when no outputs defined', () => {
      const decls = getScopeLocalFuncDefs(undefined);
      expect(decls).toStrictEqual([]);
    });
  });

  describe('buildChatSystemPrompt', () => {
    it('should template systemPrompt and add non-interactive rules', () => {
      const promptConfig = {
        systemPrompt: 'You are a ${role}.',
      };
      const context = {
        get: (k: string) => (k === 'role' ? 'tester' : ''),
        get_keys: () => ['role'],
        set: () => {},
      };
      const result = buildChatSystemPrompt(promptConfig, undefined, context);
      expect(result).toContain('You are a tester.');
      expect(result).toContain('non-interactive');
    });

    it('should add output instructions when outputConfig has outputs', () => {
      const promptConfig = {
        systemPrompt: 'Hello',
      };
      const outputConfig = { outputs: { summary: 'A summary' } };
      const context = { get: () => '', get_keys: () => [], set: () => {} };
      const result = buildChatSystemPrompt(promptConfig, outputConfig, context);
      expect(result).toContain('self_emitvalue');
      expect(result).toContain('summary');
    });

    it('should always append non-interactive rules even without outputConfig', () => {
      const promptConfig = {
        systemPrompt: 'Do the task.',
      };
      const context = { get: () => '', get_keys: () => [], set: () => {} };
      const result = buildChatSystemPrompt(promptConfig, undefined, context);
      expect(result).toContain('non-interactive');
      expect(result).toContain('stop calling tools');
    });

    it('should always append output instructions and non-interactive rules when outputConfig has outputs', () => {
      const promptConfig = {
        systemPrompt: 'Be helpful.',
      };
      const outputConfig = { outputs: { result: 'The answer' } };
      const context = { get: () => '', get_keys: () => [], set: () => {} };
      const result = buildChatSystemPrompt(promptConfig, outputConfig, context);
      expect(result).toContain('self_emitvalue');
      expect(result).toContain("emit the 'result' key");
      expect(result).toContain('non-interactive');
      expect(result).toContain('stop calling tools');
    });
  });

  describe('createChatObject', () => {
    it('should throw when PromptConfig lacks systemPrompt', async () => {
      // Bypass TypeScript's required systemPrompt via cast to simulate
      // a runtime-malformed PromptConfig that bypassed compile-time checks
      const malformedPromptConfig =
        {} as CreateChatObjectParams['promptConfig'];

      const params: CreateChatObjectParams = {
        promptConfig: malformedPromptConfig,
        modelConfig: { model: 'test-model', temp: 0, top_p: 1 },
        outputConfig: undefined,
        toolConfig: undefined,
        runtimeContext: {
          state: {
            sessionId: 'test-session',
            provider: 'gemini',
            model: 'test',
          },
          tools: { listToolNames: () => [], getToolMetadata: () => undefined },
        },
        contentGenerator: {},
        environmentContextLoader: async () => [],
        foregroundConfig: {
          getMcpClientManager: () => ({ getMcpInstructions: () => undefined }),
        } as unknown as CreateChatObjectParams['foregroundConfig'],
        context: { get: () => undefined, get_keys: () => [], set: () => {} },
      };

      await expect(createChatObject(params)).rejects.toThrow(
        'PromptConfig.systemPrompt must be a non-empty string.',
      );
    });

    it('should throw when systemPrompt is an empty string', async () => {
      const emptyPromptConfig = {
        systemPrompt: '',
      } as CreateChatObjectParams['promptConfig'];

      const params: CreateChatObjectParams = {
        promptConfig: emptyPromptConfig,
        modelConfig: { model: 'test-model', temp: 0, top_p: 1 },
        outputConfig: undefined,
        toolConfig: undefined,
        runtimeContext: {
          state: {
            sessionId: 'test-session',
            provider: 'gemini',
            model: 'test',
          },
          tools: { listToolNames: () => [], getToolMetadata: () => undefined },
        },
        contentGenerator: {},
        environmentContextLoader: async () => [],
        foregroundConfig: {
          getMcpClientManager: () => ({ getMcpInstructions: () => undefined }),
        } as unknown as CreateChatObjectParams['foregroundConfig'],
        context: { get: () => undefined, get_keys: () => [], set: () => {} },
      };

      await expect(createChatObject(params)).rejects.toThrow(
        'PromptConfig.systemPrompt must be a non-empty string.',
      );
    });

    it('should throw when systemPrompt is whitespace-only', async () => {
      const whitespacePromptConfig = {
        systemPrompt: '   \t\n  ',
      } as CreateChatObjectParams['promptConfig'];

      const params: CreateChatObjectParams = {
        promptConfig: whitespacePromptConfig,
        modelConfig: { model: 'test-model', temp: 0, top_p: 1 },
        outputConfig: undefined,
        toolConfig: undefined,
        runtimeContext: {
          state: {
            sessionId: 'test-session',
            provider: 'gemini',
            model: 'test',
          },
          tools: { listToolNames: () => [], getToolMetadata: () => undefined },
        },
        contentGenerator: {},
        environmentContextLoader: async () => [],
        foregroundConfig: {
          getMcpClientManager: () => ({ getMcpInstructions: () => undefined }),
        } as unknown as CreateChatObjectParams['foregroundConfig'],
        context: { get: () => undefined, get_keys: () => [], set: () => {} },
      };

      await expect(createChatObject(params)).rejects.toThrow(
        'PromptConfig.systemPrompt must be a non-empty string.',
      );
    });

    it('should throw when systemPrompt is a non-string type', async () => {
      const numericPromptConfig = {
        systemPrompt: 42,
      } as unknown as CreateChatObjectParams['promptConfig'];

      const params: CreateChatObjectParams = {
        promptConfig: numericPromptConfig,
        modelConfig: { model: 'test-model', temp: 0, top_p: 1 },
        outputConfig: undefined,
        toolConfig: undefined,
        runtimeContext: {
          state: {
            sessionId: 'test-session',
            provider: 'gemini',
            model: 'test',
          },
          tools: { listToolNames: () => [], getToolMetadata: () => undefined },
        },
        contentGenerator: {},
        environmentContextLoader: async () => [],
        foregroundConfig: {
          getMcpClientManager: () => ({ getMcpInstructions: () => undefined }),
        } as unknown as CreateChatObjectParams['foregroundConfig'],
        context: { get: () => undefined, get_keys: () => [], set: () => {} },
      };

      await expect(createChatObject(params)).rejects.toThrow(
        'PromptConfig.systemPrompt must be a non-empty string.',
      );
    });
  });

  describe('createToolExecutionConfig — fail-closed empty whitelist (#2069)', () => {
    const makeFixture = () => ({
      runtimeBundle: {
        runtimeContext: { state: { sessionId: 'sess-fc' } },
      },
      toolRegistry: {
        getTool: () => undefined,
        getFunctionDeclarationsFiltered: () => [],
      },
      foregroundConfig: {
        getOrCreateScheduler: () => {},
        disposeScheduler: () => {},
      },
    });

    it('preserves explicit empty tools array as tools.allowed=[]', () => {
      const { runtimeBundle, toolRegistry, foregroundConfig } = makeFixture();
      const config = createToolExecutionConfig(
        runtimeBundle,
        toolRegistry,
        foregroundConfig,
        undefined,
        undefined,
        { tools: [] },
      );
      expect(config.getEphemeralSetting('tools.allowed')).toStrictEqual([]);
      expect(config.getEphemeralSettings()['tools.allowed']).toStrictEqual([]);
    });

    it('preserves parent explicit empty tools.allowed when intersecting with a non-empty whitelist', () => {
      const { runtimeBundle, toolRegistry, foregroundConfig } = makeFixture();
      const config = createToolExecutionConfig(
        runtimeBundle,
        toolRegistry,
        foregroundConfig,
        undefined,
        { tools: { allowed: [] } },
        { tools: ['read_file'] },
      );
      expect(config.getEphemeralSetting('tools.allowed')).toStrictEqual([]);
      expect(config.getEphemeralSettings()['tools.allowed']).toStrictEqual([]);
    });
    it('does not set tools.allowed when toolConfig is undefined', () => {
      const { runtimeBundle, toolRegistry, foregroundConfig } = makeFixture();
      const config = createToolExecutionConfig(
        runtimeBundle,
        toolRegistry,
        foregroundConfig,
        undefined,
        undefined,
        undefined,
      );
      expect(config.getEphemeralSetting('tools.allowed')).toBeUndefined();
      expect(config.getEphemeralSettings()['tools.allowed']).toBeUndefined();
    });

    it('does not set tools.allowed when toolConfig is omitted', () => {
      const { runtimeBundle, toolRegistry, foregroundConfig } = makeFixture();
      const config = createToolExecutionConfig(
        runtimeBundle,
        toolRegistry,
        foregroundConfig,
      );
      expect(config.getEphemeralSetting('tools.allowed')).toBeUndefined();
    });
  });

  describe('createSchedulerConfig — fail-closed empty whitelist (#2069)', () => {
    it('getAllowedTools() returns [] for explicit empty even when foreground returns defaults', () => {
      const toolExecCtxWithEmpty = {
        getToolRegistry: () => ({}),
        getSessionId: () => 'sess-fc',
        getEphemeralSettings: () => ({ 'tools.allowed': [] }),
        getEphemeralSetting: (key: string) =>
          key === 'tools.allowed' ? [] : undefined,
        getExcludeTools: () => [],
        getTelemetryLogPromptsEnabled: () => false,
        getOrCreateScheduler: () => Promise.resolve({}),
        disposeScheduler: () => {},
      };
      const foregroundWithDefaults = {
        getApprovalMode: () => 'DEFAULT',
        getPolicyEngine: () => undefined,
        getOrCreateScheduler: () => Promise.resolve({}),
        disposeScheduler: () => {},
        getEphemeralSettings: () => ({}),
        getExcludeTools: () => [],
        getTelemetryLogPromptsEnabled: () => false,
        getAllowedTools: () => ['read_file', 'write_file'],
        getEnableHooks: () => false,
        getHooks: () => undefined,
        getHookSystem: () => undefined,
        getWorkingDir: () => '/tmp',
        getTargetDir: () => '/tmp',
      };
      const config = createSchedulerConfig(
        toolExecCtxWithEmpty,
        foregroundWithDefaults,
      );
      expect(config.getAllowedTools()).toStrictEqual([]);
    });

    it('getAllowedTools() falls back to foreground when ephemerals omit tools.allowed', () => {
      const toolExecCtxNoOverride = {
        getToolRegistry: () => ({}),
        getSessionId: () => 'sess-default',
        getEphemeralSettings: () => ({}),
        getEphemeralSetting: () => undefined,
        getExcludeTools: () => [],
        getTelemetryLogPromptsEnabled: () => false,
        getOrCreateScheduler: () => Promise.resolve({}),
        disposeScheduler: () => {},
      };
      const foregroundWithDefaults = {
        getApprovalMode: () => 'DEFAULT',
        getPolicyEngine: () => undefined,
        getOrCreateScheduler: () => Promise.resolve({}),
        disposeScheduler: () => {},
        getEphemeralSettings: () => ({}),
        getExcludeTools: () => [],
        getTelemetryLogPromptsEnabled: () => false,
        getAllowedTools: () => ['read_file'],
        getEnableHooks: () => false,
        getHooks: () => undefined,
        getHookSystem: () => undefined,
        getWorkingDir: () => '/tmp',
        getTargetDir: () => '/tmp',
      };
      const config = createSchedulerConfig(
        toolExecCtxNoOverride,
        foregroundWithDefaults,
      );
      expect(config.getAllowedTools()).toStrictEqual(['read_file']);
    });
  });

  describe('createToolExecutionConfig — scheduler delegation', () => {
    it('should forward toolRegistry to foregroundConfig.getOrCreateScheduler', async () => {
      const capturedDeps: Record<string, unknown> = {};
      const sentinelRegistry = { sentinel: 'subagent-registry' };
      const runtimeBundle = {
        runtimeContext: { state: { sessionId: 'sess-fwd' } },
      };
      const foregroundConfig = {
        getOrCreateScheduler: (
          _sid: string,
          _cb: unknown,
          _opts: unknown,
          deps: Record<string, unknown>,
        ) => {
          Object.assign(capturedDeps, deps);
          return Promise.resolve({});
        },
        disposeScheduler: () => {},
      };

      const config = createToolExecutionConfig(
        runtimeBundle,
        sentinelRegistry,
        foregroundConfig,
      );
      await config.getOrCreateScheduler('sess-fwd', {} as never, undefined, {});

      expect(capturedDeps.toolRegistry).toBe(sentinelRegistry);
    });

    it('should allow caller to override toolRegistry via dependencies', async () => {
      const capturedDeps: Record<string, unknown> = {};
      const defaultRegistry = { default: true };
      const overrideRegistry = { override: true };
      const runtimeBundle = {
        runtimeContext: { state: { sessionId: 'sess-override' } },
      };
      const foregroundConfig = {
        getOrCreateScheduler: (
          _sid: string,
          _cb: unknown,
          _opts: unknown,
          deps: Record<string, unknown>,
        ) => {
          Object.assign(capturedDeps, deps);
          return Promise.resolve({});
        },
        disposeScheduler: () => {},
      };

      const config = createToolExecutionConfig(
        runtimeBundle,
        defaultRegistry,
        foregroundConfig,
      );
      await config.getOrCreateScheduler(
        'sess-override',
        {} as never,
        undefined,
        {
          toolRegistry: overrideRegistry,
        } as never,
      );

      expect(capturedDeps.toolRegistry).toBe(overrideRegistry);
    });
  });

  describe('createSchedulerConfig', () => {
    it('should return a Config-shaped object', () => {
      const mockToolExecCtx = {
        getToolRegistry: () => ({}),
        getSessionId: () => 'test-session',
        getEphemeralSettings: () => ({}),
        getEphemeralSetting: () => undefined,
        getExcludeTools: () => [],
        getTelemetryLogPromptsEnabled: () => false,
        getOrCreateScheduler: () => ({}),
        disposeScheduler: () => {},
      };
      const mockConfig = {
        getApprovalMode: () => 'DEFAULT',
        getPolicyEngine: () => undefined,
        getOrCreateScheduler: () => ({}),
        disposeScheduler: () => {},
        getEphemeralSettings: () => ({}),
        getExcludeTools: () => [],
        getTelemetryLogPromptsEnabled: () => false,
        getAllowedTools: () => undefined,
        getEnableHooks: () => false,
        getHooks: () => undefined,
        getHookSystem: () => undefined,
        getWorkingDir: () => '/tmp',
        getTargetDir: () => '/tmp',
      };
      const config = createSchedulerConfig(mockToolExecCtx, mockConfig);
      expect(config).toBeDefined();
      expect(typeof config.getSessionId).toBe('function');
    });

    it('should delegate getOrCreateScheduler through toolExecutorContext, not foregroundConfig', async () => {
      let toolExecCalled = false;
      let foregroundCalled = false;
      const mockToolExecCtx = {
        getToolRegistry: () => ({}),
        getSessionId: () => 'test-session',
        getEphemeralSettings: () => ({}),
        getEphemeralSetting: () => undefined,
        getExcludeTools: () => [],
        getTelemetryLogPromptsEnabled: () => false,
        getOrCreateScheduler: (..._args: unknown[]) => {
          toolExecCalled = true;
          return Promise.resolve({});
        },
        disposeScheduler: () => {},
      };
      const mockConfig = {
        getApprovalMode: () => 'DEFAULT',
        getPolicyEngine: () => undefined,
        getOrCreateScheduler: () => {
          foregroundCalled = true;
          return Promise.resolve({});
        },
        disposeScheduler: () => {},
        getEphemeralSettings: () => ({}),
        getExcludeTools: () => [],
        getTelemetryLogPromptsEnabled: () => false,
        getAllowedTools: () => undefined,
        getEnableHooks: () => false,
        getHooks: () => undefined,
        getHookSystem: () => undefined,
        getWorkingDir: () => '/tmp',
        getTargetDir: () => '/tmp',
      };
      const config = createSchedulerConfig(mockToolExecCtx, mockConfig);
      await config.getOrCreateScheduler('test-session', {} as never);

      expect(toolExecCalled).toBe(true);
      expect(foregroundCalled).toBe(false);
    });

    it('should inject interactiveMode into scheduler options', async () => {
      let capturedOptions: Record<string, unknown> = {};
      const mockToolExecCtx = {
        getToolRegistry: () => ({}),
        getSessionId: () => 'test-session',
        getEphemeralSettings: () => ({}),
        getEphemeralSetting: () => undefined,
        getExcludeTools: () => [],
        getTelemetryLogPromptsEnabled: () => false,
        getOrCreateScheduler: (
          _sid: string,
          _cb: unknown,
          opts: Record<string, unknown>,
        ) => {
          capturedOptions = opts;
          return Promise.resolve({});
        },
        disposeScheduler: () => {},
      };
      const mockConfig = {
        getApprovalMode: () => 'DEFAULT',
        getPolicyEngine: () => undefined,
        getOrCreateScheduler: () => Promise.resolve({}),
        disposeScheduler: () => {},
        getEphemeralSettings: () => ({}),
        getExcludeTools: () => [],
        getTelemetryLogPromptsEnabled: () => false,
        getAllowedTools: () => undefined,
        getEnableHooks: () => false,
        getHooks: () => undefined,
        getHookSystem: () => undefined,
        getWorkingDir: () => '/tmp',
        getTargetDir: () => '/tmp',
      };
      const config = createSchedulerConfig(mockToolExecCtx, mockConfig, {
        interactive: true,
      });
      await config.getOrCreateScheduler('test-session', {} as never);

      expect(capturedOptions.interactiveMode).toBe(true);
    });

    it('should delegate disposeScheduler through toolExecutorContext', () => {
      let toolExecDisposeCalled = false;
      let foregroundDisposeCalled = false;
      const mockToolExecCtx = {
        getToolRegistry: () => ({}),
        getSessionId: () => 'test-session',
        getEphemeralSettings: () => ({}),
        getEphemeralSetting: () => undefined,
        getExcludeTools: () => [],
        getTelemetryLogPromptsEnabled: () => false,
        getOrCreateScheduler: () => Promise.resolve({}),
        disposeScheduler: () => {
          toolExecDisposeCalled = true;
        },
      };
      const mockConfig = {
        getApprovalMode: () => 'DEFAULT',
        getPolicyEngine: () => undefined,
        getOrCreateScheduler: () => Promise.resolve({}),
        disposeScheduler: () => {
          foregroundDisposeCalled = true;
        },
        getEphemeralSettings: () => ({}),
        getExcludeTools: () => [],
        getTelemetryLogPromptsEnabled: () => false,
        getAllowedTools: () => undefined,
        getEnableHooks: () => false,
        getHooks: () => undefined,
        getHookSystem: () => undefined,
        getWorkingDir: () => '/tmp',
        getTargetDir: () => '/tmp',
      };
      const config = createSchedulerConfig(mockToolExecCtx, mockConfig);
      config.disposeScheduler('test-session');

      expect(toolExecDisposeCalled).toBe(true);
      expect(foregroundDisposeCalled).toBe(false);
    });
  });

  describe('Issue #2069: scheduler governance excludes task/list_subagents', () => {
    const makeFixture = () => ({
      runtimeBundle: {
        runtimeContext: { state: { sessionId: 'sess-2069' } },
      },
      toolRegistry: {
        getTool: () => undefined,
        getFunctionDeclarationsFiltered: () => [],
      },
      foregroundConfig: {
        getOrCreateScheduler: () => {},
        disposeScheduler: () => {},
      },
    });

    it('createToolExecutionConfig().getExcludeTools() returns task and list_subagents', () => {
      const { runtimeBundle, toolRegistry, foregroundConfig } = makeFixture();
      const config = createToolExecutionConfig(
        runtimeBundle,
        toolRegistry,
        foregroundConfig,
      );
      const excluded = config.getExcludeTools();
      expect(excluded).toContain('task');
      expect(excluded).toContain('list_subagents');
    });

    it('createSchedulerConfig().getExcludeTools() surfaces task/list_subagents from toolExecutorContext', () => {
      const { runtimeBundle, toolRegistry, foregroundConfig } = makeFixture();
      const toolExecConfig = createToolExecutionConfig(
        runtimeBundle,
        toolRegistry,
        foregroundConfig,
      );
      const schedulerConfig = createSchedulerConfig(
        toolExecConfig,
        foregroundConfig,
      );
      const excluded = schedulerConfig.getExcludeTools();
      expect(excluded).toContain('task');
      expect(excluded).toContain('list_subagents');
    });

    it('buildToolGovernance from schedulerConfig marks task/list_subagents as blocked (fail-closed)', async () => {
      const { buildToolGovernance, isToolBlocked } = await import(
        './toolGovernance.js'
      );
      const { runtimeBundle, toolRegistry, foregroundConfig } = makeFixture();
      const toolExecConfig = createToolExecutionConfig(
        runtimeBundle,
        toolRegistry,
        foregroundConfig,
      );
      const schedulerConfig = createSchedulerConfig(
        toolExecConfig,
        foregroundConfig,
      );

      const governance = buildToolGovernance(schedulerConfig);
      expect(isToolBlocked('task', governance)).toBe(true);
      expect(isToolBlocked('list_subagents', governance)).toBe(true);
      // Non-excluded tool should not be blocked by excluded set alone
      expect(isToolBlocked('read_file', governance)).toBe(false);
    });

    it('applyToolWhitelistToEphemerals removes task/list_subagents from tools.allowed', () => {
      const { runtimeBundle, toolRegistry, foregroundConfig } = makeFixture();
      const toolConfig = { tools: ['read_file', 'task', 'list_subagents'] };
      const config = createToolExecutionConfig(
        runtimeBundle,
        toolRegistry,
        foregroundConfig,
        undefined,
        undefined,
        toolConfig,
      );
      const allowed = config.getEphemeralSetting('tools.allowed') as string[];
      expect(Array.isArray(allowed)).toBe(true);
      expect(allowed).toContain('read_file');
      expect(allowed).not.toContain('task');
      expect(allowed).not.toContain('list_subagents');
    });

    it('applyToolWhitelistToEphemerals sets tools.allowed to [] when only excluded tools remain', () => {
      const { runtimeBundle, toolRegistry, foregroundConfig } = makeFixture();
      const toolConfig = { tools: ['task', 'list_subagents'] };
      const config = createToolExecutionConfig(
        runtimeBundle,
        toolRegistry,
        foregroundConfig,
        undefined,
        undefined,
        toolConfig,
      );
      const allowed = config.getEphemeralSetting('tools.allowed') as string[];
      expect(Array.isArray(allowed)).toBe(true);
      expect(allowed).toStrictEqual([]);
    });

    it('applyToolWhitelistToEphemerals removes canonical variants (TaskTool, listSubagents)', () => {
      const { runtimeBundle, toolRegistry, foregroundConfig } = makeFixture();
      const toolConfig = {
        tools: ['ReadFileTool', 'TaskTool', 'listSubagents'],
      };
      const config = createToolExecutionConfig(
        runtimeBundle,
        toolRegistry,
        foregroundConfig,
        undefined,
        undefined,
        toolConfig,
      );
      const allowed = config.getEphemeralSetting('tools.allowed') as string[];
      expect(Array.isArray(allowed)).toBe(true);
      expect(allowed).toContain('read_file');
      expect(allowed).not.toContain('task');
      expect(allowed).not.toContain('list_subagents');
    });
  });
});
