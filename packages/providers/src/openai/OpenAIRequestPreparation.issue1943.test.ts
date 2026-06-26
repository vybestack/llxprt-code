/**
 * @issue #1943 - Request/message path coverage for OpenAIRequestPreparation
 *
 * Behavioral tests for prepareRequest() verifying that tool format detection,
 * message building, tool conversion, and request body construction all use
 * the per-call resolved model (options.resolved.model) rather than relying
 * on defaults, and that provider toolFormat overrides suppress auto-detection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prepareRequest } from './OpenAIRequestPreparation.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('test system prompt'),
}));

vi.mock('../../prompt-config/subagent-delegation.js', () => ({
  shouldIncludeSubagentDelegation: vi.fn().mockResolvedValue(false),
}));

vi.mock('../utils/userMemory.js', () => ({
  resolveUserMemory: vi.fn().mockResolvedValue(''),
}));

function createMockOptions(
  overrides: Partial<NormalizedGenerateChatOptions> = {},
  modelBehavior: Record<string, unknown> = {},
): NormalizedGenerateChatOptions {
  const settings = new SettingsService();
  return {
    contents: [],
    tools: undefined,
    metadata: {},
    settings,
    config: undefined,
    invocation: {
      requestId: 'test-request',
      timestamp: Date.now(),
      modelBehavior,
    },
    resolved: {
      model: 'gpt-4o',
      authToken: { token: 'test-token', type: 'api-key' },
    },
    ...overrides,
  } as unknown as NormalizedGenerateChatOptions;
}

describe('OpenAIRequestPreparation.prepareRequest (issue #1943)', () => {
  let logger: DebugLogger;

  beforeEach(() => {
    logger = new DebugLogger('llxprt:provider:openai:test');
  });

  it('uses options.resolved.model for tool format detection when resolved model differs from default', async () => {
    const settings = new SettingsService();
    const options = createMockOptions({
      settings,
      resolved: {
        model: 'kimi-k2',
        authToken: { token: 'test-token', type: 'api-key' },
      },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o', // default model is gpt-4o
      undefined,
      logger,
      'openai',
    );

    // Should use kimi-k2 (resolved model) not gpt-4o (default)
    expect(result.model).toBe('kimi-k2');
    expect(result.detectedFormat).toBe('kimi');
  });

  it('uses options.resolved.model for mistral model detection', async () => {
    const settings = new SettingsService();
    const options = createMockOptions({
      settings,
      resolved: {
        model: 'mistral-large-latest',
        authToken: { token: 'test-token', type: 'api-key' },
      },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    expect(result.model).toBe('mistral-large-latest');
    expect(result.detectedFormat).toBe('mistral');
  });

  it('falls back to defaultModel when options.resolved.model is empty', async () => {
    const settings = new SettingsService();
    const options = createMockOptions({
      settings,
      resolved: {
        model: '',
        authToken: { token: 'test-token', type: 'api-key' },
      },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    expect(result.model).toBe('gpt-4o');
    expect(result.detectedFormat).toBe('openai');
  });

  it('applies explicit openai override to suppress kimi auto-detection for resolved kimi model', async () => {
    const settings = new SettingsService();
    settings.setProviderSetting('openai', 'toolFormat', 'openai');
    const options = createMockOptions({
      settings,
      resolved: {
        model: 'moonshot-v1-kimi-k2',
        authToken: { token: 'test-token', type: 'api-key' },
      },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    expect(result.model).toBe('moonshot-v1-kimi-k2');
    expect(result.detectedFormat).toBe('openai'); // override suppresses kimi auto-detect
  });

  it('applies explicit openai override to suppress mistral auto-detection for resolved mistral model', async () => {
    const settings = new SettingsService();
    settings.setProviderSetting('openai', 'toolFormat', 'openai');
    const options = createMockOptions({
      settings,
      resolved: {
        model: 'mistral-large-latest',
        authToken: { token: 'test-token', type: 'api-key' },
      },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    expect(result.model).toBe('mistral-large-latest');
    expect(result.detectedFormat).toBe('openai'); // override suppresses mistral auto-detect
  });

  it('ignores invalid toolFormat override and auto-detects for kimi model', async () => {
    const settings = new SettingsService();
    settings.setProviderSetting('openai', 'toolFormat', 'bogus-format');
    const options = createMockOptions({
      settings,
      resolved: {
        model: 'kimi-k2',
        authToken: { token: 'test-token', type: 'api-key' },
      },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    expect(result.detectedFormat).toBe('kimi'); // invalid override ignored, auto-detected
  });

  it('includes model in request body matching resolved model', async () => {
    const settings = new SettingsService();
    const options = createMockOptions({
      settings,
      resolved: {
        model: 'gpt-4-turbo',
        authToken: { token: 'test-token', type: 'api-key' },
      },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    expect(result.requestBody.model).toBe('gpt-4-turbo');
  });

  it('includes system prompt message in messagesWithSystem', async () => {
    const settings = new SettingsService();
    const options = createMockOptions({
      settings,
      resolved: {
        model: 'gpt-4o',
        authToken: { token: 'test-token', type: 'api-key' },
      },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    expect(result.messagesWithSystem.length).toBeGreaterThan(0);
    expect(result.messagesWithSystem[0].role).toBe('system');
  });

  it('detects qwen format for GLM-4 resolved model', async () => {
    const settings = new SettingsService();
    const options = createMockOptions({
      settings,
      resolved: {
        model: 'glm-4-plus',
        authToken: { token: 'test-token', type: 'api-key' },
      },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    expect(result.detectedFormat).toBe('qwen');
  });

  it('detects deepseek format for deepseek-reasoner resolved model', async () => {
    const settings = new SettingsService();
    const options = createMockOptions({
      settings,
      resolved: {
        model: 'deepseek-reasoner',
        authToken: { token: 'test-token', type: 'api-key' },
      },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    expect(result.detectedFormat).toBe('deepseek');
  });

  it('uses "auto" toolFormat override to allow auto-detection for kimi model', async () => {
    const settings = new SettingsService();
    settings.setProviderSetting('openai', 'toolFormat', 'auto');
    const options = createMockOptions({
      settings,
      resolved: {
        model: 'kimi-k2',
        authToken: { token: 'test-token', type: 'api-key' },
      },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    expect(result.detectedFormat).toBe('kimi'); // auto overrides → auto-detect
  });

  it('sets thinking enabled on request body when reasoning.enabled is true', async () => {
    const settings = new SettingsService();
    const options = createMockOptions(
      {
        settings,
        resolved: {
          model: 'gpt-4o',
          authToken: { token: 'test-token', type: 'api-key' },
        },
      },
      { 'reasoning.enabled': true },
    );

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    expect(result.requestBody).toHaveProperty('thinking', { type: 'enabled' });
  });

  it('sets thinking disabled on request body when reasoning.enabled is false', async () => {
    const settings = new SettingsService();
    const options = createMockOptions(
      {
        settings,
        resolved: {
          model: 'gpt-4o',
          authToken: { token: 'test-token', type: 'api-key' },
        },
      },
      { 'reasoning.enabled': false },
    );

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    expect(result.requestBody).toHaveProperty('thinking', { type: 'disabled' });
  });

  it('does not set thinking on request body when reasoning.enabled is undefined', async () => {
    const settings = new SettingsService();
    const options = createMockOptions(
      {
        settings,
        resolved: {
          model: 'gpt-4o',
          authToken: { token: 'test-token', type: 'api-key' },
        },
      },
      {},
    );

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    expect(result.requestBody).not.toHaveProperty('thinking');
  });
});
