/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  getScopeLocalFuncDefs,
  buildChatSystemPrompt,
  createChatObject,
  type CreateChatObjectParams,
} from './subagentRuntimeSetup.js';

describe('getScopeLocalFuncDefs', () => {
  it('should return self_emitvalue declaration with output keys as enum', () => {
    const outputConfig = {
      outputs: { result: 'The result', count: 'A count' },
    };
    const decls = getScopeLocalFuncDefs(outputConfig);
    expect(decls.length).toBeGreaterThan(0);
    const emitDecl = decls.find((d) => d.name === 'self_emitvalue');
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
    const malformedPromptConfig = {} as CreateChatObjectParams['promptConfig'];

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
