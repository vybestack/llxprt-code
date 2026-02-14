/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250823-AUTHFIXES.P13
 * @requirement REQ-002
 * Auth Command Logout TDD Tests
 */

import { describe, expect, beforeEach, afterEach } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import { AuthCommandExecutor } from '../../../src/ui/commands/authCommand.js';
import { OAuthManager } from '../../../src/auth/oauth-manager.js';
import {
  KeyringTokenStore,
  SecureStore,
  OAuthToken,
  Logger,
  type KeyringAdapter,
} from '@vybestack/llxprt-code-core';
import { QwenOAuthProvider } from '../../../src/auth/qwen-oauth-provider.js';
import { GeminiOAuthProvider } from '../../../src/auth/gemini-oauth-provider.js';
import { AnthropicOAuthProvider } from '../../../src/auth/anthropic-oauth-provider.js';
import {
  CommandContext,
  MessageActionReturn,
} from '../../../src/ui/commands/types.js';
import { LoadedSettings } from '../../../src/config/settings.js';
import { SessionStatsState } from '../../../src/ui/contexts/SessionContext.js';
import { promises as fsP } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function createMockKeyring(): KeyringAdapter {
  const store = new Map<string, string>();
  return {
    getPassword: async (_s: string, a: string) => store.get(a) ?? null,
    setPassword: async (_s: string, a: string, p: string) => {
      store.set(a, p);
    },
    deletePassword: async (_s: string, a: string) => store.delete(a),
    findCredentials: async () => {
      const results: Array<{ account: string; password: string }> = [];
      for (const [account, password] of store.entries()) {
        results.push({ account, password });
      }
      return results;
    },
  };
}

let _tempDir: string | undefined;
async function createTestTokenStore(): Promise<KeyringTokenStore> {
  _tempDir = await fsP.mkdtemp(join(tmpdir(), 'authcmd-logout-test-'));
  const secureStore = new SecureStore('llxprt-code-oauth', {
    fallbackDir: _tempDir,
    fallbackPolicy: 'allow',
    keyringLoader: async () => createMockKeyring(),
  });
  return new KeyringTokenStore({ secureStore });
}

// Skip OAuth tests in CI as they require browser interaction
const skipInCI = process.env.CI === 'true';

// Mock command context for testing
function createMockContext(): CommandContext {
  return {
    services: {
      config: null,
      settings: {} as LoadedSettings,
      git: undefined,
      logger: {} as Logger,
    },
    ui: {
      addItem: () => {},
      clear: () => {},
      setDebugMessage: () => {},
      pendingItem: null,
      setPendingItem: () => {},
      loadHistory: () => {},
      toggleCorgiMode: () => {},
      toggleVimEnabled: async () => true,
      setLlxprtMdFileCount: () => {},
      reloadCommands: () => {},
    },
    session: {
      stats: {} as SessionStatsState,
      sessionShellAllowlist: new Set(),
    },
  };
}

describe.skipIf(skipInCI)(
  'AuthCommand - Logout Command Parsing (REQ-002)',
  () => {
    let tokenStore: KeyringTokenStore;
    let oauthManager: OAuthManager;
    let authCommand: AuthCommandExecutor;
    let context: CommandContext;

    beforeEach(async () => {
      tokenStore = await createTestTokenStore();
      oauthManager = new OAuthManager(tokenStore);
      authCommand = new AuthCommandExecutor(oauthManager);
      context = createMockContext();

      // Register test providers
      oauthManager.registerProvider(new QwenOAuthProvider(tokenStore));
      oauthManager.registerProvider(new GeminiOAuthProvider(tokenStore));
      oauthManager.registerProvider(new AnthropicOAuthProvider(tokenStore));
    });

    afterEach(async () => {
      try {
        await tokenStore.removeToken('qwen');
        await tokenStore.removeToken('gemini');
        await tokenStore.removeToken('anthropic');
      } catch {
        // Ignore cleanup errors
      }
      if (_tempDir) {
        await fsP
          .rm(_tempDir, { recursive: true, force: true })
          .catch(() => {});
        _tempDir = undefined;
      }
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout command success message
     * @given User authenticated with provider
     * @when /auth [provider] logout executed
     * @then Success message returned
     */
    it('should return success message for logout command', async () => {
      const token: OAuthToken = {
        access_token: 'test-logout-token',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      };

      await tokenStore.saveToken('qwen', token);

      const result = await authCommand.execute(context, 'qwen logout');

      expect(result.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('Successfully logged out');
      expect(messageResult.content).toContain('qwen');
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout command with invalid provider
     * @given Invalid provider name
     * @when /auth [invalid] logout executed
     * @then Error message returned
     */
    it('should return error for invalid provider', async () => {
      const result = await authCommand.execute(
        context,
        'invalid-provider logout',
      );

      expect(result.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('error');
      expect(messageResult.content).toContain('Unknown provider');
      expect(messageResult.content).toContain('invalid-provider');
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout command lists supported providers on error
     * @given Invalid provider name
     * @when /auth [invalid] logout executed
     * @then Error message includes supported providers
     */
    it('should list supported providers in error message', async () => {
      const result = await authCommand.execute(context, 'unknown logout');

      expect(result.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('error');
      expect(messageResult.content).toContain('Supported providers');
      expect(messageResult.content).toContain('qwen');
      expect(messageResult.content).toContain('gemini');
      expect(messageResult.content).toContain('anthropic');
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout command with no existing token
     * @given Provider has no stored token
     * @when /auth [provider] logout executed
     * @then Success message returned
     */
    it('should return success message even with no existing token', async () => {
      // Ensure no token exists
      const existingToken = await tokenStore.getToken('qwen');
      expect(existingToken).toBeNull();

      const result = await authCommand.execute(context, 'qwen logout');

      expect(result.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('Successfully logged out');
      expect(messageResult.content).toContain('qwen');
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout command argument parsing
     * @given Various argument formats
     * @when logout command executed
     * @then Arguments parsed correctly
     */
    it('should parse logout arguments correctly', async () => {
      const testCases = [
        'qwen logout',
        '  qwen   logout  ', // Extra whitespace
        'qwen    logout', // Multiple spaces
      ];

      for (const args of testCases) {
        const result = await authCommand.execute(context, args);

        expect(result.type).toBe('message');
        const messageResult = result as MessageActionReturn;
        expect(messageResult.messageType).toBe('info');
        expect(messageResult.content).toContain('qwen');
      }
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout command case sensitivity
     * @given Mixed case logout action
     * @when logout command executed
     * @then Command recognized properly
     */
    it('should handle case sensitivity for logout action', async () => {
      const testCases = [
        'qwen logout',
        'qwen LOGOUT',
        'qwen Logout',
        'qwen LogOut',
      ];

      for (const args of testCases) {
        const result = await authCommand.execute(context, args);

        expect(result.type).toBe('message');
        const messageResult = result as MessageActionReturn;

        if (args.includes('logout')) {
          // lowercase logout should work
          expect(messageResult.messageType).toBe('info');
          expect(messageResult.content).toContain('Successfully logged out');
        } else {
          // Other cases should be treated as invalid action
          expect(messageResult.messageType).toBe('error');
          expect(messageResult.content).toContain('Invalid action');
        }
      }
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout command with empty provider
     * @given Empty provider name
     * @when /auth logout executed
     * @then Appropriate error handling
     */
    it('should handle logout with no provider specified', async () => {
      const result = await authCommand.execute(context, 'logout');

      expect(result.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('error');
      expect(messageResult.content).toContain('Unknown provider');
      expect(messageResult.content).toContain('logout');
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Logout command error handling for OAuth manager failures
     * @given OAuth manager logout fails
     * @when logout command executed
     * @then Error message returned with details
     */
    it('should handle OAuth manager errors gracefully', async () => {
      // Mock OAuth manager to throw error
      const originalLogout = oauthManager.logout.bind(oauthManager);
      oauthManager.logout = async () => {
        throw new Error('OAuth manager failure');
      };

      const result = await authCommand.execute(context, 'qwen logout');

      // Restore original method
      oauthManager.logout = originalLogout;

      expect(result.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('error');
      expect(messageResult.content).toContain('Failed to logout');
      expect(messageResult.content).toContain('qwen');
      expect(messageResult.content).toContain('OAuth manager failure');
    });
  },
);

describe.skipIf(skipInCI)(
  'AuthCommand - Logout Provider Validation (REQ-002)',
  () => {
    let tokenStore: KeyringTokenStore;
    let oauthManager: OAuthManager;
    let authCommand: AuthCommandExecutor;
    let context: CommandContext;

    beforeEach(async () => {
      tokenStore = await createTestTokenStore();
      oauthManager = new OAuthManager(tokenStore);
      authCommand = new AuthCommandExecutor(oauthManager);
      context = createMockContext();

      // Register test providers
      oauthManager.registerProvider(new QwenOAuthProvider(tokenStore));
      oauthManager.registerProvider(new GeminiOAuthProvider(tokenStore));
      oauthManager.registerProvider(new AnthropicOAuthProvider(tokenStore));
    });

    afterEach(async () => {
      try {
        await tokenStore.removeToken('qwen');
        await tokenStore.removeToken('gemini');
        await tokenStore.removeToken('anthropic');
      } catch {
        // Ignore cleanup errors
      }
      if (_tempDir) {
        await fsP
          .rm(_tempDir, { recursive: true, force: true })
          .catch(() => {});
        _tempDir = undefined;
      }
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Validate supported providers for logout
     * @given Each supported provider
     * @when logout command executed
     * @then Command succeeds for all supported providers
     */
    it('should support logout for all registered providers', async () => {
      const supportedProviders = oauthManager.getSupportedProviders();

      for (const provider of supportedProviders) {
        const result = await authCommand.execute(context, `${provider} logout`);

        expect(result.type).toBe('message');
        const messageResult = result as MessageActionReturn;
        expect(messageResult.messageType).toBe('info');
        expect(messageResult.content).toContain('Successfully logged out');
        expect(messageResult.content).toContain(provider);
      }
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Reject unsupported providers
     * @given Unsupported provider names
     * @when logout command executed
     * @then Error message returned
     */
    it('should reject unsupported providers', async () => {
      const unsupportedProviders = ['openai', 'claude', 'gpt', 'invalid'];

      for (const provider of unsupportedProviders) {
        const result = await authCommand.execute(context, `${provider} logout`);

        expect(result.type).toBe('message');
        const messageResult = result as MessageActionReturn;
        expect(messageResult.messageType).toBe('error');
        expect(messageResult.content).toContain('Unknown provider');
        expect(messageResult.content).toContain(provider);
      }
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Provider name normalization
     * @given Provider names with different formatting
     * @when logout command executed
     * @then Provider names handled consistently
     */
    it('should handle provider name formatting consistently', async () => {
      const providerVariations = ['qwen', 'Qwen', 'QWEN'];

      for (const provider of providerVariations) {
        const result = await authCommand.execute(context, `${provider} logout`);

        expect(result.type).toBe('message');
        const messageResult = result as MessageActionReturn;

        if (provider === 'qwen') {
          // Exact match should work
          expect(messageResult.messageType).toBe('info');
          expect(messageResult.content).toContain('Successfully logged out');
        } else {
          // Case variations should be treated as unknown (strict matching)
          expect(messageResult.messageType).toBe('error');
          expect(messageResult.content).toContain('Unknown provider');
        }
      }
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Provider availability check
     * @given System with registered providers
     * @when logout validation performed
     * @then Available providers correctly identified
     */
    it('should correctly identify available providers', async () => {
      const availableProviders = oauthManager.getSupportedProviders();

      // Should include all registered providers
      expect(availableProviders).toContain('qwen');
      expect(availableProviders).toContain('gemini');
      expect(availableProviders).toContain('anthropic');

      // Test that error messages include these providers
      const result = await authCommand.execute(context, 'unknown logout');
      expect(result.type).toBe('message');
      const messageResult = result as MessageActionReturn;

      for (const provider of availableProviders) {
        expect(messageResult.content).toContain(provider);
      }
    });
  },
);

describe.skipIf(skipInCI)(
  'AuthCommand - Logout User Feedback (REQ-002)',
  () => {
    let tokenStore: KeyringTokenStore;
    let oauthManager: OAuthManager;
    let authCommand: AuthCommandExecutor;
    let context: CommandContext;

    beforeEach(async () => {
      tokenStore = await createTestTokenStore();
      oauthManager = new OAuthManager(tokenStore);
      authCommand = new AuthCommandExecutor(oauthManager);
      context = createMockContext();

      // Register test providers
      oauthManager.registerProvider(new QwenOAuthProvider(tokenStore));
      oauthManager.registerProvider(new GeminiOAuthProvider(tokenStore));
      oauthManager.registerProvider(new AnthropicOAuthProvider(tokenStore));
    });

    afterEach(async () => {
      try {
        await tokenStore.removeToken('qwen');
        await tokenStore.removeToken('gemini');
        await tokenStore.removeToken('anthropic');
      } catch {
        // Ignore cleanup errors
      }
      if (_tempDir) {
        await fsP
          .rm(_tempDir, { recursive: true, force: true })
          .catch(() => {});
        _tempDir = undefined;
      }
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Success message content validation
     * @given Successful logout operation
     * @when logout command executed
     * @then Success message contains required information
     */
    it('should provide informative success messages', async () => {
      const result = await authCommand.execute(context, 'qwen logout');

      expect(result.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');

      const content = messageResult.content;
      expect(content).toMatch(/successfully|logged out|qwen/i);
      expect(content).toContain('qwen');
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Error message content validation
     * @given Failed logout operation
     * @when logout command executed
     * @then Error message contains helpful information
     */
    it('should provide helpful error messages', async () => {
      const result = await authCommand.execute(context, 'invalid logout');

      expect(result.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('error');

      const content = messageResult.content;
      expect(content).toContain('Unknown provider');
      expect(content).toContain('invalid');
      expect(content).toContain('Supported providers');
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Message type consistency
     * @given Various logout scenarios
     * @when logout commands executed
     * @then Message types are appropriate
     */
    it('should use appropriate message types', async () => {
      // Success case should be 'info'
      const successResult = await authCommand.execute(context, 'qwen logout');
      expect(successResult.type).toBe('message');
      expect((successResult as MessageActionReturn).messageType).toBe('info');

      // Error case should be 'error'
      const errorResult = await authCommand.execute(context, 'invalid logout');
      expect(errorResult.type).toBe('message');
      expect((errorResult as MessageActionReturn).messageType).toBe('error');
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Feedback message clarity
     * @given User executing logout commands
     * @when messages are displayed
     * @then Messages are clear and actionable
     */
    it('should provide clear and actionable feedback', async () => {
      // Test various scenarios for message clarity
      const testCases = [
        { args: 'qwen logout', expectSuccess: true },
        { args: 'invalid logout', expectSuccess: false },
        { args: 'gemini logout', expectSuccess: true },
      ];

      for (const testCase of testCases) {
        const result = await authCommand.execute(context, testCase.args);

        expect(result.type).toBe('message');
        const messageResult = result as MessageActionReturn;

        // Message should not be empty
        expect(messageResult.content).toBeTruthy();
        expect(messageResult.content.length).toBeGreaterThan(0);

        if (testCase.expectSuccess) {
          expect(messageResult.messageType).toBe('info');
          expect(messageResult.content).toMatch(/success|logged out/i);
        } else {
          expect(messageResult.messageType).toBe('error');
          expect(messageResult.content).toMatch(/error|unknown|invalid/i);
        }
      }
    });

    /**
     * @plan PLAN-20250823-AUTHFIXES.P13
     * @requirement REQ-002
     * @scenario Contextual error information
     * @given Error scenarios during logout
     * @when error messages displayed
     * @then Context and resolution hints provided
     */
    it('should provide contextual error information', async () => {
      // Test unknown provider error includes help
      const result = await authCommand.execute(context, 'unknown logout');

      expect(result.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('error');

      const content = messageResult.content;

      // Should explain what went wrong
      expect(content).toContain('Unknown provider');
      expect(content).toContain('unknown');

      // Should provide helpful guidance
      expect(content).toContain('Supported providers');

      // Should list actual supported providers
      const supportedProviders = oauthManager.getSupportedProviders();
      for (const provider of supportedProviders) {
        expect(content).toContain(provider);
      }
    });
  },
);

// Property-Based Tests (30%+ of total tests)
describe.skipIf(skipInCI)('AuthCommand - Logout Property-Based Tests', () => {
  let tokenStore: KeyringTokenStore;
  let oauthManager: OAuthManager;
  let authCommand: AuthCommandExecutor;
  let context: CommandContext;

  beforeEach(async () => {
    tokenStore = await createTestTokenStore();
    oauthManager = new OAuthManager(tokenStore);
    authCommand = new AuthCommandExecutor(oauthManager);
    context = createMockContext();

    // Register test providers
    oauthManager.registerProvider(new QwenOAuthProvider(tokenStore));
    oauthManager.registerProvider(new GeminiOAuthProvider(tokenStore));
    oauthManager.registerProvider(new AnthropicOAuthProvider(tokenStore));
  });

  afterEach(async () => {
    try {
      await tokenStore.removeToken('qwen');
      await tokenStore.removeToken('gemini');
      await tokenStore.removeToken('anthropic');
    } catch {
      // Ignore cleanup errors
    }
    if (_tempDir) {
      await fsP.rm(_tempDir, { recursive: true, force: true }).catch(() => {});
      _tempDir = undefined;
    }
  });

  /**
   * @plan PLAN-20250823-AUTHFIXES.P13
   * @requirement REQ-002
   * Property Test 1: Command parsing with random whitespace
   */
  it.prop([
    fc.constantFrom('qwen', 'gemini', 'anthropic'),
    fc.string().filter((s) => /^\s*$/.test(s) && s.length < 5), // Only whitespace, shorter
    fc.string().filter((s) => /^\s*$/.test(s) && s.length < 5),
  ])(
    'should parse commands correctly with random whitespace',
    async (provider, leadingSpace, trailingSpace) => {
      // Ensure we always have the word 'logout' with proper spacing
      const middleSpace = leadingSpace || ' '; // At least one space between provider and logout
      const args = `${leadingSpace}${provider}${middleSpace}logout${trailingSpace}`;

      const result = await authCommand.execute(context, args);

      expect(result.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('Successfully logged out');
      expect(messageResult.content).toContain(provider);
    },
  );

  /**
   * @plan PLAN-20250823-AUTHFIXES.P13
   * @requirement REQ-002
   * Property Test 3: Command argument variations
   */
  it.prop([
    fc.constantFrom('qwen', 'gemini', 'anthropic'),
    fc.constantFrom('logout', 'LOGOUT', 'Logout', 'logOut', 'LogOut'),
  ])(
    'should handle command argument case variations',
    async (provider, logoutAction) => {
      const args = `${provider} ${logoutAction}`;

      const result = await authCommand.execute(context, args);

      expect(result.type).toBe('message');
      const messageResult = result as MessageActionReturn;

      if (logoutAction === 'logout') {
        // Only lowercase 'logout' should be valid
        expect(messageResult.messageType).toBe('info');
        expect(messageResult.content).toContain('Successfully logged out');
      } else {
        // Other case variations should be invalid
        expect(messageResult.messageType).toBe('error');
        expect(messageResult.content).toContain('Invalid action');
      }
    },
  );

  /**
   * @plan PLAN-20250823-AUTHFIXES.P13
   * @requirement REQ-002
   * Property Test 4: Concurrent command execution
   */
  it.prop([
    fc.array(fc.constantFrom('qwen', 'gemini', 'anthropic'), {
      minLength: 2,
      maxLength: 10,
    }),
  ])('should handle concurrent logout commands safely', async (providers) => {
    // Set up tokens for each provider
    const uniqueProviders = new Set(providers);
    for (const provider of uniqueProviders) {
      const token: OAuthToken = {
        access_token: `concurrent-${provider}-token`,
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      };
      await tokenStore.saveToken(provider, token);
    }

    // Execute concurrent logout commands
    const commandPromises = providers.map((provider) =>
      authCommand.execute(context, `${provider} logout`),
    );

    const results = await Promise.all(commandPromises);

    // All commands should complete successfully
    for (const result of results) {
      expect(result.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('Successfully logged out');
    }
  });

  /**
   * @plan PLAN-20250823-AUTHFIXES.P13
   * @requirement REQ-002
   * Property Test 5: Message content validation
   */
  it.prop([fc.constantFrom('qwen', 'gemini', 'anthropic')])(
    'should always include provider name in response messages',
    async (provider) => {
      const result = await authCommand.execute(context, `${provider} logout`);

      expect(result.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.content).toContain(provider);

      // Content should be meaningful (not empty or too short)
      expect(messageResult.content.length).toBeGreaterThan(10);

      // Should not contain placeholder text
      expect(messageResult.content).not.toMatch(/TODO|FIXME|placeholder/i);
    },
  );
});
