/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setCommand } from './setCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { CommandContext } from './types.js';
import { IProvider } from '@vybestack/llxprt-code-core';
// import { getProviderManager } from '../../providers/providerManagerInstance.js';

// Mock the provider manager module
vi.mock('../../providers/providerManagerInstance.js', () => ({
  getProviderManager: vi.fn(),
}));

describe('setCommand', () => {
  let context: CommandContext;
  let mockProvider: IProvider & {
    setModelParams: ReturnType<typeof vi.fn>;
    getModelParams: ReturnType<typeof vi.fn>;
  };
  let mockProviderManager: {
    getActiveProvider: ReturnType<typeof vi.fn>;
  };
  let mockConfig: {
    getProviderManager: ReturnType<typeof vi.fn>;
    setEphemeralSetting: ReturnType<typeof vi.fn>;
    getEphemeralSetting: ReturnType<typeof vi.fn>;
    getEphemeralSettings: ReturnType<typeof vi.fn>;
    getGeminiClient: ReturnType<typeof vi.fn>;
    getSettingsService: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Create a mock provider with setModelParams and getModelParams methods
    mockProvider = {
      name: 'test-provider',
      getModels: vi.fn().mockResolvedValue([]),
      generateChatCompletion: vi.fn(),
      getDefaultModel: vi.fn().mockReturnValue('default'),
      getServerTools: vi.fn().mockReturnValue([]),
      invokeServerTool: vi.fn().mockResolvedValue(undefined),
      setModelParams: vi.fn(),
      getModelParams: vi.fn(),
    } as IProvider & {
      setModelParams: ReturnType<typeof vi.fn>;
      getModelParams: ReturnType<typeof vi.fn>;
    };

    // Create a mock provider manager
    mockProviderManager = {
      getActiveProvider: vi.fn().mockReturnValue(mockProvider),
    };

    // Create a mock config
    mockConfig = {
      getProviderManager: vi.fn().mockReturnValue(mockProviderManager),
      setEphemeralSetting: vi.fn(),
      getEphemeralSetting: vi.fn(() => undefined),
      getEphemeralSettings: vi.fn(() => ({})),
      getGeminiClient: vi.fn(() => null),
      getSettingsService: vi.fn().mockReturnValue(null), // Return null to use fallback behavior
    };

    // Create context with the mock config
    context = createMockCommandContext({
      services: {
        config: mockConfig as unknown as CommandContext['services']['config'],
      },
    });
  });

  it('should have correct metadata', () => {
    expect(setCommand.name).toBe('set');
    expect(setCommand.description).toBe(
      'set model parameters or ephemeral settings',
    );
  });

  it('should show usage when no arguments provided', async () => {
    const result = await setCommand.action!(context, '');
    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content:
        'Usage: /set <ephemeral-key> <value>\nExample: /set context-limit 100000\n\nFor model parameters use: /set modelparam <key> <value>',
    });
  });

  it('should show usage when insufficient arguments provided', async () => {
    const result = await setCommand.action!(context, 'temperature');
    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content:
        'Usage: /set temperature <value>\n\nValid ephemeral keys:\n  context-limit: Maximum number of tokens for the context window (e.g., 100000)\n  compression-threshold: Fraction of context limit that triggers compression (0.0-1.0, e.g., 0.7 for 70%)\n  base-url: Base URL for API requests\n  tool-format: Tool format override for the provider\n  api-version: API version to use\n  custom-headers: Custom HTTP headers as JSON object\n  stream-options: Stream options for OpenAI API (default: { include_usage: true })\n  streaming: Enable or disable streaming responses (enabled/disabled, default: enabled)\n  shell-replacement: Allow command substitution ($(), <(), backticks) in shell commands (default: false)\n  socket-timeout: Request timeout in milliseconds for local AI servers (default: 60000)\n  socket-keepalive: Enable TCP keepalive for local AI server connections (true/false, default: true)\n  socket-nodelay: Enable TCP_NODELAY concept for local AI servers (true/false, default: true)\n  tool-output-max-items: Maximum number of items/files/matches returned by tools (default: 50)\n  tool-output-max-tokens: Maximum tokens in tool output (default: 50000)\n  tool-output-truncate-mode: How to handle exceeding limits: warn, truncate, or sample (default: warn)\n  tool-output-item-size-limit: Maximum size per item/file in bytes (default: 524288 = 512KB)\n  max-prompt-tokens: Maximum tokens allowed in any prompt sent to LLM (default: 200000)\n  emojifilter: Emoji filter mode (allowed, auto, warn, error)\n  retries: Maximum number of retry attempts for API calls (default: varies by provider)\n  retrywait: Initial delay in milliseconds between retry attempts (default: varies by provider)\n  maxTurnsPerPrompt: Maximum number of turns allowed per prompt before stopping (default: 100, -1 for unlimited)\n  authOnly: Force providers to use OAuth authentication only, ignoring API keys and environment variables\n  dumponerror: Dump API request body to ~/.llxprt/dumps/ on errors (enabled/disabled, default: disabled)',
    });
  });

  it('should set model parameter successfully', async () => {
    const modelParamCommand = setCommand.subCommands![0];
    const result = await modelParamCommand.action!(context, 'temperature 0.7');

    expect(mockProvider.setModelParams).toHaveBeenCalledWith({
      temperature: 0.7,
    });
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content:
        "Model parameter 'temperature' set to 0.7 (use /profile save to persist)",
    });
  });

  it('should show error for modelparam with insufficient arguments', async () => {
    const modelParamCommand = setCommand.subCommands![0];
    const result = await modelParamCommand.action!(context, 'temperature');
    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content:
        'Usage: /set modelparam <key> <value>\nExample: /set modelparam temperature 0.7',
    });
  });

  it('should set ephemeral setting successfully', async () => {
    const result = await setCommand.action!(context, 'context-limit 32000');

    expect(mockConfig.setEphemeralSetting).toHaveBeenCalledWith(
      'context-limit',
      32000,
    );
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content:
        "Ephemeral setting 'context-limit' set to 32000 (session only, use /profile save to persist)",
    });
  });

  it('should show error for invalid ephemeral key', async () => {
    const result = await setCommand.action!(context, 'invalid-key some-value');
    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content:
        'Invalid setting key: invalid-key. Valid keys are: context-limit, compression-threshold, base-url, tool-format, api-version, custom-headers, stream-options, streaming, shell-replacement, socket-timeout, socket-keepalive, socket-nodelay, tool-output-max-items, tool-output-max-tokens, tool-output-truncate-mode, tool-output-item-size-limit, max-prompt-tokens, emojifilter, retries, retrywait, maxTurnsPerPrompt, authOnly',
    });
  });

  it('should handle multi-word JSON values correctly', async () => {
    const result = await setCommand.action!(
      context,
      'custom-headers {"Authorization": "Bearer token"}',
    );

    expect(mockConfig.setEphemeralSetting).toHaveBeenCalledWith(
      'custom-headers',
      {
        Authorization: 'Bearer token',
      },
    );
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content:
        'Ephemeral setting \'custom-headers\' set to {"Authorization":"Bearer token"} (session only, use /profile save to persist)',
    });
  });

  it('should normalize boolean streaming values to enabled/disabled', async () => {
    const disableResult = await setCommand.action!(context, 'streaming false');

    expect(mockConfig.setEphemeralSetting).toHaveBeenNthCalledWith(
      1,
      'streaming',
      'disabled',
    );
    expect(disableResult).toEqual({
      type: 'message',
      messageType: 'info',
      content:
        'Ephemeral setting \'streaming\' set to "disabled" (session only, use /profile save to persist)',
    });

    const enableResult = await setCommand.action!(context, 'streaming true');

    expect(mockConfig.setEphemeralSetting).toHaveBeenNthCalledWith(
      2,
      'streaming',
      'enabled',
    );
    expect(enableResult).toEqual({
      type: 'message',
      messageType: 'info',
      content:
        'Ephemeral setting \'streaming\' set to "enabled" (session only, use /profile save to persist)',
    });
  });

  it('should set authOnly flag via /set', async () => {
    const result = await setCommand.action!(context, 'authOnly true');

    expect(mockConfig.setEphemeralSetting).toHaveBeenCalledWith(
      'authOnly',
      true,
    );
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content:
        "Ephemeral setting 'authOnly' set to true (session only, use /profile save to persist)",
    });
  });

  describe('modelparam behavioral tests', () => {
    it('should call provider.setModelParams with correct parameters', async () => {
      const modelParamCommand = setCommand.subCommands![0];
      const result = await modelParamCommand.action!(
        context,
        'temperature 0.7',
      );

      // Verify the calls
      expect(mockConfig.getProviderManager).toHaveBeenCalled();
      expect(mockProviderManager.getActiveProvider).toHaveBeenCalled();
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        temperature: 0.7,
      });

      // Verify success message
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Model parameter 'temperature' set to 0.7 (use /profile save to persist)",
      });
    });

    it('should show warning if provider does not support setModelParams', async () => {
      // Create a provider without setModelParams method
      const providerWithoutModelParams = {
        name: 'basic-provider',
        getModels: vi.fn().mockResolvedValue([]),
        generateChatCompletion: vi.fn(),
        getServerTools: vi.fn().mockReturnValue([]),
        invokeServerTool: vi.fn().mockResolvedValue(undefined),
        // No setModelParams method
      };
      mockProviderManager.getActiveProvider.mockReturnValue(
        providerWithoutModelParams,
      );

      const modelParamCommand = setCommand.subCommands![0];
      const result = await modelParamCommand.action!(
        context,
        'temperature 0.7',
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: "Provider 'basic-provider' does not support model parameters",
      });
    });

    it('should parse numeric values correctly for temperature', async () => {
      const modelParamCommand = setCommand.subCommands![0];
      await modelParamCommand.action!(context, 'temperature 0.95');

      // Verify it was called with a number, not a string
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        temperature: 0.95,
      });
      expect(mockProvider.setModelParams).not.toHaveBeenCalledWith({
        temperature: '0.95',
      });
    });

    it('should parse integer values correctly for max_tokens', async () => {
      const modelParamCommand = setCommand.subCommands![0];
      await modelParamCommand.action!(context, 'max_tokens 4096');

      // Verify it was called with a number
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        max_tokens: 4096,
      });
      expect(
        typeof mockProvider.setModelParams.mock.calls[0][0].max_tokens,
      ).toBe('number');
    });

    it('should handle multiple modelparams being set sequentially', async () => {
      const modelParamCommand = setCommand.subCommands![0];
      // Set temperature first
      await modelParamCommand.action!(context, 'temperature 0.7');
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        temperature: 0.7,
      });

      // Set max_tokens second
      await modelParamCommand.action!(context, 'max_tokens 2048');
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        max_tokens: 2048,
      });

      // Verify both calls were made independently
      expect(mockProvider.setModelParams).toHaveBeenCalledTimes(2);
    });

    it('should handle string values without parsing', async () => {
      const modelParamCommand = setCommand.subCommands![0];
      await modelParamCommand.action!(context, 'model gpt-4-turbo');

      // Verify it was called with a string
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        model: 'gpt-4-turbo',
      });
      expect(typeof mockProvider.setModelParams.mock.calls[0][0].model).toBe(
        'string',
      );
    });

    it('should handle JSON values for complex parameters', async () => {
      const modelParamCommand = setCommand.subCommands![0];
      await modelParamCommand.action!(
        context,
        'response_format {"type":"json_object"}',
      );

      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        response_format: { type: 'json_object' },
      });
    });
  });

  describe('ephemeral settings behavioral tests', () => {
    it('should store context-limit as ephemeral setting', async () => {
      const result = await setCommand.action!(context, 'context-limit 32000');

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Ephemeral setting 'context-limit' set to 32000 (session only, use /profile save to persist)",
      });
    });

    it('should store compression-threshold as ephemeral setting', async () => {
      // Valid value
      const result = await setCommand.action!(
        context,
        'compression-threshold 0.8',
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Ephemeral setting 'compression-threshold' set to 0.8 (session only, use /profile save to persist)",
      });

      // Note: Validation of compression-threshold range should be done when the value is used,
      // not when it's set, as we're just storing ephemeral settings for now
    });

    it('should store auth-key as ephemeral setting', async () => {
      const result = await setCommand.action!(
        context,
        'auth-key sk-1234567890',
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content:
          'Invalid setting key: auth-key. Valid keys are: context-limit, compression-threshold, base-url, tool-format, api-version, custom-headers, stream-options, streaming, shell-replacement, socket-timeout, socket-keepalive, socket-nodelay, tool-output-max-items, tool-output-max-tokens, tool-output-truncate-mode, tool-output-item-size-limit, max-prompt-tokens, emojifilter, retries, retrywait, maxTurnsPerPrompt, authOnly',
      });
    });

    it('should store auth-keyfile path as ephemeral setting', async () => {
      const result = await setCommand.action!(
        context,
        'auth-keyfile ~/.keys/api-key',
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content:
          'Invalid setting key: auth-keyfile. Valid keys are: context-limit, compression-threshold, base-url, tool-format, api-version, custom-headers, stream-options, streaming, shell-replacement, socket-timeout, socket-keepalive, socket-nodelay, tool-output-max-items, tool-output-max-tokens, tool-output-truncate-mode, tool-output-item-size-limit, max-prompt-tokens, emojifilter, retries, retrywait, maxTurnsPerPrompt, authOnly',
      });
    });

    it('should store base-url as ephemeral setting', async () => {
      const result = await setCommand.action!(
        context,
        'base-url http://localhost:8080/v1',
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          'Ephemeral setting \'base-url\' set to "http://localhost:8080/v1" (session only, use /profile save to persist)',
      });
    });

    it('should store custom-headers as JSON', async () => {
      const result = await setCommand.action!(
        context,
        'custom-headers {"Authorization":"Bearer token","X-Custom":"value"}',
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          'Ephemeral setting \'custom-headers\' set to {"Authorization":"Bearer token","X-Custom":"value"} (session only, use /profile save to persist)',
      });
    });

    it('should store tool-output-max-items as ephemeral setting', async () => {
      const result = await setCommand.action!(
        context,
        'tool-output-max-items 100',
      );

      expect(mockConfig.setEphemeralSetting).toHaveBeenCalledWith(
        'tool-output-max-items',
        100,
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Ephemeral setting 'tool-output-max-items' set to 100 (session only, use /profile save to persist)",
      });
    });

    it('should store tool-output-max-tokens as ephemeral setting', async () => {
      const result = await setCommand.action!(
        context,
        'tool-output-max-tokens 75000',
      );

      expect(mockConfig.setEphemeralSetting).toHaveBeenCalledWith(
        'tool-output-max-tokens',
        75000,
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Ephemeral setting 'tool-output-max-tokens' set to 75000 (session only, use /profile save to persist)",
      });
    });

    it('should store tool-output-truncate-mode as ephemeral setting', async () => {
      const result = await setCommand.action!(
        context,
        'tool-output-truncate-mode truncate',
      );

      expect(mockConfig.setEphemeralSetting).toHaveBeenCalledWith(
        'tool-output-truncate-mode',
        'truncate',
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          'Ephemeral setting \'tool-output-truncate-mode\' set to "truncate" (session only, use /profile save to persist)',
      });
    });

    it('should validate tool-output-truncate-mode values', async () => {
      const result = await setCommand.action!(
        context,
        'tool-output-truncate-mode invalid-mode',
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content:
          'tool-output-truncate-mode must be one of: warn, truncate, sample',
      });
    });

    it('should store tool-output-item-size-limit as ephemeral setting', async () => {
      const result = await setCommand.action!(
        context,
        'tool-output-item-size-limit 1048576',
      );

      expect(mockConfig.setEphemeralSetting).toHaveBeenCalledWith(
        'tool-output-item-size-limit',
        1048576,
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Ephemeral setting 'tool-output-item-size-limit' set to 1048576 (session only, use /profile save to persist)",
      });
    });

    it('should store max-prompt-tokens as ephemeral setting', async () => {
      const result = await setCommand.action!(
        context,
        'max-prompt-tokens 150000',
      );

      expect(mockConfig.setEphemeralSetting).toHaveBeenCalledWith(
        'max-prompt-tokens',
        150000,
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Ephemeral setting 'max-prompt-tokens' set to 150000 (session only, use /profile save to persist)",
      });
    });

    it('should store stream-options as ephemeral setting', async () => {
      const result = await setCommand.action!(
        context,
        'stream-options {"include_usage":true}',
      );

      expect(mockConfig.setEphemeralSetting).toHaveBeenCalledWith(
        'stream-options',
        { include_usage: true },
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          'Ephemeral setting \'stream-options\' set to {"include_usage":true} (session only, use /profile save to persist)',
      });
    });

    it('should store stream-options as null when set to null', async () => {
      const result = await setCommand.action!(context, 'stream-options null');

      expect(mockConfig.setEphemeralSetting).toHaveBeenCalledWith(
        'stream-options',
        null,
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Ephemeral setting 'stream-options' set to null (session only, use /profile save to persist)",
      });
    });

    it('should validate numeric tool-output settings', async () => {
      // Test non-numeric value
      const result = await setCommand.action!(
        context,
        'tool-output-max-items not-a-number',
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'tool-output-max-items must be a positive integer',
      });

      // Test negative value
      const result2 = await setCommand.action!(
        context,
        'tool-output-max-tokens -100',
      );

      expect(result2).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'tool-output-max-tokens must be a positive integer',
      });

      // Test non-integer value
      const result3 = await setCommand.action!(
        context,
        'max-prompt-tokens 100.5',
      );

      expect(result3).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'max-prompt-tokens must be a positive integer',
      });
    });
  });

  describe('error handling behavioral tests', () => {
    it('should handle invalid JSON gracefully', async () => {
      // When value looks like JSON but isn't valid, it's treated as a string
      const modelParamCommand = setCommand.subCommands![0];
      const result = await modelParamCommand.action!(
        context,
        'response_format {invalid json}',
      );

      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        response_format: '{invalid json}',
      });
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          'Model parameter \'response_format\' set to "{invalid json}" (use /profile save to persist)',
      });
    });

    it('should handle provider errors gracefully', async () => {
      mockProvider.setModelParams = vi.fn().mockImplementation(() => {
        throw new Error('Provider error');
      });

      const modelParamCommand = setCommand.subCommands![0];
      const result = await modelParamCommand.action!(
        context,
        'temperature 0.7',
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Failed to set model parameter: Provider error',
      });
    });

    it('should handle missing config gracefully', async () => {
      context.services.config = null;

      const modelParamCommand = setCommand.subCommands![0];
      const result = await modelParamCommand.action!(
        context,
        'temperature 0.7',
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'No configuration available',
      });
    });
  });

  describe('value parsing behavioral tests', () => {
    it('should parse boolean values correctly', async () => {
      const modelParamCommand = setCommand.subCommands![0];
      await modelParamCommand.action!(context, 'stream true');

      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        stream: true,
      });
      expect(typeof mockProvider.setModelParams.mock.calls[0][0].stream).toBe(
        'boolean',
      );

      // Test false as well
      await modelParamCommand.action!(context, 'stream false');
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        stream: false,
      });
    });

    it('should handle null values', async () => {
      const modelParamCommand = setCommand.subCommands![0];
      await modelParamCommand.action!(context, 'stop null');

      expect(mockProvider.setModelParams).toHaveBeenCalledWith({ stop: null });
    });

    it('should preserve string values that look like numbers', async () => {
      // Quoted values are parsed as JSON, which preserves them as strings
      const modelParamCommand = setCommand.subCommands![0];
      await modelParamCommand.action!(context, 'api_version "2023-05-15"');

      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        api_version: '2023-05-15',
      });
      expect(
        typeof mockProvider.setModelParams.mock.calls[0][0].api_version,
      ).toBe('string');
    });

    it('should handle array values', async () => {
      const modelParamCommand = setCommand.subCommands![0];
      await modelParamCommand.action!(context, 'stop ["\\n","END"]');

      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        stop: ['\n', 'END'],
      });
    });
  });
});
