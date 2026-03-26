/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll } from 'vitest';

// These module references will be populated at runtime inside the skipped block.
// The imports target subagentRuntimeSetup.js which does not exist yet — it will be created
// in Phase 2. The describe.skip wrapper keeps CI green in the meantime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let convertMetadataToFunctionDeclaration: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let validateToolsAgainstRuntime: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createToolExecutionConfig: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let buildEphemeralSettings: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let buildChatGenerationConfig: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let buildRuntimeFunctionDeclarations: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getScopeLocalFuncDefs: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let buildChatSystemPrompt: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let buildSchedulerConfig: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let applySchedulerToolRestrictions: any;

describe.skip('subagentRuntimeSetup (enable in Phase 2)', () => {
  beforeAll(async () => {
    const mod = await import('./subagentRuntimeSetup.js');
    convertMetadataToFunctionDeclaration =
      mod.convertMetadataToFunctionDeclaration;
    validateToolsAgainstRuntime = mod.validateToolsAgainstRuntime;
    createToolExecutionConfig = mod.createToolExecutionConfig;
    buildEphemeralSettings = mod.buildEphemeralSettings;
    buildChatGenerationConfig = mod.buildChatGenerationConfig;
    buildRuntimeFunctionDeclarations = mod.buildRuntimeFunctionDeclarations;
    getScopeLocalFuncDefs = mod.getScopeLocalFuncDefs;
    buildChatSystemPrompt = mod.buildChatSystemPrompt;
    buildSchedulerConfig = mod.buildSchedulerConfig;
    applySchedulerToolRestrictions = mod.applySchedulerToolRestrictions;
  });

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
      expect(decl.parameters).toBeDefined();
      expect(decl.parameters?.properties).toHaveProperty('foo');
    });

    it('should handle metadata without parameters', () => {
      const metadata = {
        name: 'no_params_tool',
        description: 'No parameters',
      };
      const decl = convertMetadataToFunctionDeclaration('fallback', metadata);
      expect(decl.name).toBe('no_params_tool');
      expect(decl.parameters).toBeDefined();
    });
  });

  describe('validateToolsAgainstRuntime', () => {
    it('should pass when all whitelisted tools exist in registry', async () => {
      const toolRegistry = {
        getTool: (name: string) =>
          name === 'allowed_tool' ? { name } : undefined,
      };
      const toolsView = {
        listToolNames: () => ['allowed_tool'],
        getToolMetadata: () => ({ name: 'allowed_tool', description: '' }),
      };
      const toolConfig = { tools: ['allowed_tool'] };
      await expect(
        validateToolsAgainstRuntime({ toolConfig, toolRegistry, toolsView }),
      ).resolves.not.toThrow();
    });

    it('should throw when whitelisted tool is not in runtime', async () => {
      const toolRegistry = { getTool: () => undefined };
      const toolsView = {
        listToolNames: () => ['other_tool'],
        getToolMetadata: () => undefined,
      };
      const toolConfig = { tools: ['missing_tool'] };
      await expect(
        validateToolsAgainstRuntime({ toolConfig, toolRegistry, toolsView }),
      ).rejects.toThrow(/not permitted/);
    });

    it('should pass with empty whitelist (allow all)', async () => {
      const toolRegistry = { getTool: () => undefined };
      const toolsView = {
        listToolNames: () => [],
        getToolMetadata: () => undefined,
      };
      const toolConfig = { tools: [] };
      await expect(
        validateToolsAgainstRuntime({ toolConfig, toolRegistry, toolsView }),
      ).resolves.not.toThrow();
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

  describe('buildChatGenerationConfig', () => {
    it('should set temperature from modelConfig', () => {
      const modelConfig = { model: 'gemini-1.5-flash', temp: 0.7, top_p: 1 };
      const genConfig = buildChatGenerationConfig(modelConfig);
      expect(genConfig.temperature).toBe(0.7);
    });

    it('should set topP from modelConfig', () => {
      const modelConfig = { model: 'gemini-1.5-flash', temp: 0.5, top_p: 0.9 };
      const genConfig = buildChatGenerationConfig(modelConfig);
      expect(genConfig.topP).toBe(0.9);
    });

    it('should handle defaults when optional fields missing', () => {
      const modelConfig = { model: 'gemini-1.5-flash', temp: 1, top_p: 1 };
      const genConfig = buildChatGenerationConfig(modelConfig);
      expect(genConfig).toBeDefined();
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
    it('should combine core system prompt with behaviour prompts', () => {
      const params = {
        corePrompt: 'You are a helpful assistant.',
        behaviourPrompts: ['Be concise.', 'Be accurate.'],
      };
      const result = buildChatSystemPrompt(params);
      expect(result).toContain('You are a helpful assistant.');
      expect(result).toContain('Be concise.');
    });

    it('should handle empty behaviour prompts', () => {
      const params = {
        corePrompt: 'You are a helpful assistant.',
        behaviourPrompts: [],
      };
      const result = buildChatSystemPrompt(params);
      expect(result).toContain('You are a helpful assistant.');
    });
  });

  describe('buildSchedulerConfig', () => {
    it('should create Config with correct model and run settings', () => {
      const params = {
        model: 'gemini-1.5-flash',
        sessionId: 'scheduler-session',
        approvalMode: 'DEFAULT',
        toolConfig: { tools: [] },
      };
      const config = buildSchedulerConfig(params);
      expect(config).toBeDefined();
    });
  });

  describe('applySchedulerToolRestrictions', () => {
    it('should apply whitelist to scheduler config', () => {
      const baseConfig = {};
      const toolConfig = { tools: ['allowed_tool'] };
      const result = applySchedulerToolRestrictions(baseConfig, toolConfig);
      expect(result).toBeDefined();
    });

    it('should handle no restrictions', () => {
      const baseConfig = {};
      const result = applySchedulerToolRestrictions(baseConfig, undefined);
      expect(result).toBeDefined();
    });
  });
});
