/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { diagnosticsCommand } from './diagnosticsCommand.js';
import type { MessageActionReturn } from './types.js';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-core';
import {
  createTestToken,
  createMockTokenStore,
  setupDiagnosticsTest,
  teardownDiagnosticsTest,
  type DiagnosticsTestSetup,
} from './diagnosticsCommand-test-helpers.js';

// Hoisted mocks for RuntimeContext
const runtimeMocks = vi.hoisted(() => ({
  getRuntimeApiMock: vi.fn(),
}));

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: runtimeMocks.getRuntimeApiMock,
}));

describe('diagnosticsCommand OAuth token display (edges)', () => {
  let setup: DiagnosticsTestSetup;
  let mockContext: ReturnType<typeof setupDiagnosticsTest>['mockContext'];

  beforeEach(() => {
    setup = setupDiagnosticsTest();
    mockContext = setup.mockContext;
  });

  afterEach(() => {
    teardownDiagnosticsTest(setup);
  });

  describe('Time Calculation Edge Cases', () => {
    it('correctly calculates time for token expiring in exactly 1 hour', async () => {
      const mockToken = createTestToken(3600); // Exactly 1 hour

      const tokenStore = createMockTokenStore({ github: mockToken });

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => ['github']),
        isAuthenticated: vi.fn(async () => true),
        peekStoredToken: vi.fn(async () => mockToken),
        getTokenStore: vi.fn(() => tokenStore),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toMatch(/Time Remaining: [01]h [0-5]?\d?m/);
    });

    it('correctly handles token expiring in less than 1 minute', async () => {
      const mockToken = createTestToken(30); // 30 seconds

      const tokenStore = createMockTokenStore({ github: mockToken });

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => ['github']),
        isAuthenticated: vi.fn(async () => true),
        peekStoredToken: vi.fn(async () => mockToken),
        getTokenStore: vi.fn(() => tokenStore),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('0h 0m');
    });

    it('prevents negative time display for expired tokens', async () => {
      const mockToken = createTestToken(-3600); // Expired 1 hour ago

      const tokenStore = createMockTokenStore({ github: mockToken });

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => ['github']),
        isAuthenticated: vi.fn(async () => true),
        peekStoredToken: vi.fn(async () => mockToken),
        getTokenStore: vi.fn(() => tokenStore),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('0h 0m');
    });

    it('correctly floors fractional minutes', async () => {
      const mockToken = createTestToken(2730); // 45.5 minutes

      const tokenStore = createMockTokenStore({ github: mockToken });

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => ['github']),
        isAuthenticated: vi.fn(async () => true),
        peekStoredToken: vi.fn(async () => mockToken),
        getTokenStore: vi.fn(() => tokenStore),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('0h 45m');
    });
  });

  describe('Error Handling', () => {
    it('gracefully handles when OAuthManager is null', async () => {
      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => null),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('No OAuth tokens configured');
    });

    it('gracefully handles when peekStoredToken throws', async () => {
      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => ['github']),
        isAuthenticated: vi.fn(async () => true),
        peekStoredToken: vi.fn(async () => {
          throw new Error('Token store error');
        }),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('OAuth Tokens');
    });

    it('gracefully handles when MCP getAllCredentials throws', async () => {
      // Create a mock storage that throws an error
      const errorStorage = {
        async getAllCredentials() {
          throw new Error('MCP storage error');
        },
        async getCredentials() {
          throw new Error('MCP storage error');
        },
        async setCredentials() {
          throw new Error('MCP storage error');
        },
        async deleteCredentials() {
          throw new Error('MCP storage error');
        },
        async listServers() {
          throw new Error('MCP storage error');
        },
        async clearAll() {
          throw new Error('MCP storage error');
        },
      };

      MCPOAuthTokenStorage.setTokenStore(errorStorage);

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => []),
        isAuthenticated: vi.fn(async () => false),
        peekStoredToken: vi.fn(async () => null),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('OAuth Tokens');
    });

    it('OAuth section failure does not break rest of diagnostics', async () => {
      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => {
          throw new Error('OAuth manager error');
        }),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('Provider Information');
      expect(messageResult.content).toContain('System Information');
      expect(messageResult.content).toContain(
        'Unable to retrieve OAuth token information',
      );
    });
  });

  describe('auth setting masking', () => {
    function setupRuntimeMockWithEphemeral(
      ephemeralSettings: Record<string, unknown>,
    ) {
      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings,
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => null),
      });
    }

    it('does not mask auth-key-name value', async () => {
      setupRuntimeMockWithEphemeral({
        'auth-key-name': 'my-production-key',
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');
      const content = (result as MessageActionReturn).content;

      expect(content).toContain('auth-key-name: my-production-key');
      expect(content).not.toContain('****');
    });

    it('masks auth-key value', async () => {
      setupRuntimeMockWithEphemeral({
        'auth-key': 'sk-abcdefghijklmnop',
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');
      const content = (result as MessageActionReturn).content;

      expect(content).toContain('auth-key:');
      expect(content).not.toContain('sk-abcdefghijklmnop');
      // Should show first 4 + masked middle + last 4
      expect(content).toContain('sk-a***********mnop');
    });

    it('does not mask auth-keyfile value (just a file path)', async () => {
      setupRuntimeMockWithEphemeral({
        'auth-keyfile': '/home/user/.secrets/api-key.txt',
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');
      const content = (result as MessageActionReturn).content;

      expect(content).toContain(
        'auth-keyfile: /home/user/.secrets/api-key.txt',
      );
    });

    it('masks auth-key but not auth-key-name when both are present', async () => {
      setupRuntimeMockWithEphemeral({
        'auth-key': 'supersecretapikey123',
        'auth-key-name': 'work-anthropic',
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');
      const content = (result as MessageActionReturn).content;

      expect(content).toContain('auth-key-name: work-anthropic');
      expect(content).not.toContain('supersecretapikey123');
    });

    it('masks apiKey values and groups them under Authentication', async () => {
      setupRuntimeMockWithEphemeral({
        apiKey: 'sk-secretapikeyvalue1234',
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');
      const content = (result as MessageActionReturn).content;

      expect(content).toContain('Authentication:');
      expect(content).toContain('apiKey:');
      expect(content).not.toContain('sk-secretapikeyvalue1234');
    });
  });
});
