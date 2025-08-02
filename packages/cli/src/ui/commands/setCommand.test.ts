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
import { getProviderManager } from '../../providers/providerManagerInstance.js'; // eslint-disable-line @typescript-eslint/no-unused-vars

// Mock the provider manager module
vi.mock('../../providers/providerManagerInstance.js', () => ({
  getProviderManager: vi.fn(),
}));

describe('setCommand', () => {
  let context: CommandContext;
  let mockProvider: IProvider;
  let mockProviderManager: {
    getActiveProvider: ReturnType<typeof vi.fn>;
  };
  let mockConfig: {
    getProviderManager: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Create a mock provider with setModelParams and getModelParams methods
    mockProvider = {
      name: 'test-provider',
      getModels: vi.fn().mockResolvedValue([]),
      generateChatCompletion: vi.fn(),
      getServerTools: vi.fn().mockReturnValue([]),
      invokeServerTool: vi.fn().mockResolvedValue(undefined),
      setModelParams: vi.fn(),
      getModelParams: vi.fn(),
    };

    // Create a mock provider manager
    mockProviderManager = {
      getActiveProvider: vi.fn().mockReturnValue(mockProvider),
    };

    // Create a mock config
    mockConfig = {
      getProviderManager: vi.fn().mockReturnValue(mockProviderManager),
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
        'Usage: /set modelparam <key> <value> or /set <ephemeral-key> <value>',
    });
  });

  it('should show usage when insufficient arguments provided', async () => {
    const result = await setCommand.action!(context, 'temperature');
    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content:
        'Usage: /set modelparam <key> <value> or /set <ephemeral-key> <value>',
    });
  });

  it('should set model parameter successfully', async () => {
    const result = await setCommand.action!(
      context,
      'modelparam temperature 0.7',
    );

    expect(mockProvider.setModelParams).toHaveBeenCalledWith({
      temperature: 0.7,
    });
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: "Model parameter 'temperature' set to 0.7",
    });
  });

  it('should show error for modelparam with insufficient arguments', async () => {
    const result = await setCommand.action!(context, 'modelparam temperature');
    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Usage: /set modelparam <key> <value>',
    });
  });

  it('should set ephemeral setting successfully', async () => {
    const result = await setCommand.action!(context, 'context-limit 32000');

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: "Ephemeral setting 'context-limit' set to 32000",
    });
  });

  it('should show error for invalid ephemeral key', async () => {
    const result = await setCommand.action!(context, 'invalid-key some-value');
    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content:
        'Invalid setting key: invalid-key. Valid keys are: context-limit, compression-threshold, auth-key, auth-keyfile, base-url, tool-format, api-version, custom-headers',
    });
  });

  it('should handle multi-word JSON values correctly', async () => {
    const result = await setCommand.action!(
      context,
      'modelparam custom-headers {"Authorization": "Bearer token"}',
    );

    expect(mockProvider.setModelParams).toHaveBeenCalledWith({
      'custom-headers': { Authorization: 'Bearer token' },
    });
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content:
        'Model parameter \'custom-headers\' set to {"Authorization":"Bearer token"}',
    });
  });

  describe('modelparam behavioral tests', () => {
    it('should call provider.setModelParams with correct parameters', async () => {
      const result = await setCommand.action!(
        context,
        'modelparam temperature 0.7',
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
        content: "Model parameter 'temperature' set to 0.7",
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

      const result = await setCommand.action!(
        context,
        'modelparam temperature 0.7',
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: "Provider 'basic-provider' does not support model parameters",
      });
    });

    it('should parse numeric values correctly for temperature', async () => {
      await setCommand.action!(context, 'modelparam temperature 0.95');

      // Verify it was called with a number, not a string
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        temperature: 0.95,
      });
      expect(mockProvider.setModelParams).not.toHaveBeenCalledWith({
        temperature: '0.95',
      });
    });

    it('should parse integer values correctly for max_tokens', async () => {
      await setCommand.action!(context, 'modelparam max_tokens 4096');

      // Verify it was called with a number
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        max_tokens: 4096,
      });
      expect(
        typeof mockProvider.setModelParams.mock.calls[0][0].max_tokens,
      ).toBe('number');
    });

    it('should handle multiple modelparams being set sequentially', async () => {
      // Set temperature first
      await setCommand.action!(context, 'modelparam temperature 0.7');
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        temperature: 0.7,
      });

      // Set max_tokens second
      await setCommand.action!(context, 'modelparam max_tokens 2048');
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        max_tokens: 2048,
      });

      // Verify both calls were made independently
      expect(mockProvider.setModelParams).toHaveBeenCalledTimes(2);
    });

    it('should handle string values without parsing', async () => {
      await setCommand.action!(context, 'modelparam model gpt-4-turbo');

      // Verify it was called with a string
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        model: 'gpt-4-turbo',
      });
      expect(typeof mockProvider.setModelParams.mock.calls[0][0].model).toBe(
        'string',
      );
    });

    it('should handle JSON values for complex parameters', async () => {
      await setCommand.action!(
        context,
        'modelparam response_format {"type":"json_object"}',
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
        content: "Ephemeral setting 'context-limit' set to 32000",
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
        content: "Ephemeral setting 'compression-threshold' set to 0.8",
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
        messageType: 'info',
        content: 'Ephemeral setting \'auth-key\' set to "sk-1234567890"',
      });
    });

    it('should store auth-keyfile path as ephemeral setting', async () => {
      const result = await setCommand.action!(
        context,
        'auth-keyfile ~/.keys/api-key',
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'Ephemeral setting \'auth-keyfile\' set to "~/.keys/api-key"',
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
          'Ephemeral setting \'base-url\' set to "http://localhost:8080/v1"',
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
          'Ephemeral setting \'custom-headers\' set to {"Authorization":"Bearer token","X-Custom":"value"}',
      });
    });
  });

  describe('error handling behavioral tests', () => {
    it('should handle invalid JSON gracefully', async () => {
      // When value looks like JSON but isn't valid, it's treated as a string
      const result = await setCommand.action!(
        context,
        'modelparam response_format {invalid json}',
      );

      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        response_format: '{invalid json}',
      });
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'Model parameter \'response_format\' set to "{invalid json}"',
      });
    });

    it('should handle provider errors gracefully', async () => {
      mockProvider.setModelParams = vi.fn().mockImplementation(() => {
        throw new Error('Provider error');
      });

      const result = await setCommand.action!(
        context,
        'modelparam temperature 0.7',
      );

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Failed to set model parameter: Provider error',
      });
    });

    it('should handle missing config gracefully', async () => {
      context.services.config = null;

      const result = await setCommand.action!(
        context,
        'modelparam temperature 0.7',
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
      await setCommand.action!(context, 'modelparam stream true');

      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        stream: true,
      });
      expect(typeof mockProvider.setModelParams.mock.calls[0][0].stream).toBe(
        'boolean',
      );

      // Test false as well
      await setCommand.action!(context, 'modelparam stream false');
      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        stream: false,
      });
    });

    it('should handle null values', async () => {
      await setCommand.action!(context, 'modelparam stop null');

      expect(mockProvider.setModelParams).toHaveBeenCalledWith({ stop: null });
    });

    it('should preserve string values that look like numbers', async () => {
      // Quoted values are parsed as JSON, which preserves them as strings
      await setCommand.action!(context, 'modelparam api_version "2023-05-15"');

      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        api_version: '2023-05-15',
      });
      expect(
        typeof mockProvider.setModelParams.mock.calls[0][0].api_version,
      ).toBe('string');
    });

    it('should handle array values', async () => {
      await setCommand.action!(context, 'modelparam stop ["\\n","END"]');

      expect(mockProvider.setModelParams).toHaveBeenCalledWith({
        stop: ['\n', 'END'],
      });
    });
  });
});
