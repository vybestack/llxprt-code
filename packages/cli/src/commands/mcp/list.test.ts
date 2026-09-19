/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import type { Mock } from 'bun:test';
import { vi, describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import type { MCPServerConfig } from '@vybestack/llxprt-code-core';
import type { McpAuthProvider } from '@vybestack/llxprt-code-mcp';
import type { OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { resetRegisteredMcpAuthFactories } from '@vybestack/llxprt-code-mcp/auth/mcp-auth-factory.js';
import {
  buildProviderContributionRegistry,
  loadInstalledRuntimePlugins,
} from '@vybestack/llxprt-code-providers/composition.js';
import type {
  LoadedRuntimePlugin,
  RuntimeMcpAuthFactoryContribution,
} from '@vybestack/llxprt-code-providers/composition.js';
import { createTransport } from '@vybestack/llxprt-code-mcp';
import { listMcpServers } from './list.js';
import { loadSettings } from '../../config/settings.js';
import { ExtensionStorage, loadExtensions } from '../../config/extension.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const realIndexModule = {
  ...(await import('@modelcontextprotocol/sdk/client/index.js')),
};

void vi.mock('../../config/settings.js', () => ({
  loadSettings: vi.fn(),
}));
void vi.mock('../../config/extension.js', () => ({
  loadExtensions: vi.fn(),
  ExtensionStorage: {
    getUserExtensionsDir: vi.fn(),
  },
}));
const actual = { ...(await import('@vybestack/llxprt-code-mcp')) };
void vi.mock('@vybestack/llxprt-code-mcp', () => ({
  ...actual,
  createTransport: vi.fn(),
  Storage: {
    getGlobalSettingsPath: vi
      .fn()
      .mockReturnValue('/mock/home/.llxprt/settings.json'),
    getGlobalLlxprtDir: vi.fn().mockReturnValue('/mock/home/.llxprt'),
    getGlobalConfigDir: vi.fn().mockReturnValue('/mock/home/.llxprt'),
    getGlobalDataDir: vi.fn().mockReturnValue('/mock/home/.llxprt'),
    getGlobalCacheDir: vi.fn().mockReturnValue('/mock/home/.llxprt'),
    getGlobalLogDir: vi.fn().mockReturnValue('/mock/home/.llxprt'),
  },
  MCPServerStatus: {
    CONNECTED: 'CONNECTED',
    DISCONNECTED: 'DISCONNECTED',
  },
}));
void vi.mock('@modelcontextprotocol/sdk/client/index.js', () =>
  automock(realIndexModule),
);
const actualComposition = {
  ...(await import('@vybestack/llxprt-code-providers/composition.js')),
};
void vi.mock('@vybestack/llxprt-code-providers/composition.js', () => ({
  ...actualComposition,
  loadInstalledRuntimePlugins: vi.fn(),
}));

const mockedLoadInstalledRuntimePlugins =
  loadInstalledRuntimePlugins as unknown as Mock<
    (...args: never[]) => Promise<unknown>
  >;

const mockedExtensionStorage = ExtensionStorage as unknown as {
  getUserExtensionsDir: ReturnType<typeof vi.fn>;
};
const mockedLoadSettings = loadSettings as unknown as Mock<
  (...args: never[]) => unknown
>;
const mockedLoadExtensions = loadExtensions as unknown as Mock<
  (...args: never[]) => unknown
>;
const mockedCreateTransport = createTransport as unknown as Mock<
  (...args: never[]) => Promise<MockTransport>
>;
const MockedClient = Client as unknown as Mock<
  (...args: never[]) => MockClient
>;

interface MockClient {
  connect: Mock<(transport: unknown) => Promise<void>>;
  ping: Mock<() => Promise<unknown>>;
  close: Mock<() => Promise<void>>;
}

interface MockTransport {
  close: Mock<() => Promise<void>>;
}

const FAKE_CLIENT_METADATA: OAuthClientMetadata = {
  client_name: 'test (fake)',
  redirect_uris: [],
  grant_types: [],
  response_types: [],
  token_endpoint_auth_method: 'none',
};

/** Records construction so tests can prove the plugin factory was invoked. */
let fakeAuthProviderConstructions = 0;

/** Auth provider double dispatched through the real factory registry seam. */
class FakeAuthProvider implements McpAuthProvider {
  readonly redirectUrl = '';
  readonly clientMetadata = FAKE_CLIENT_METADATA;
  constructor(_config?: MCPServerConfig) {
    fakeAuthProviderConstructions++;
  }
  clientInformation() {
    return undefined;
  }
  saveClientInformation() {}
  async tokens() {
    return undefined;
  }
  saveTokens() {}
  redirectToAuthorization() {}
  saveCodeVerifier() {}
  codeVerifier() {
    return '';
  }
  async getRequestHeaders() {
    return { 'X-Fake-Project': 'provider-project' };
  }
}

/** One installed plugin contributing a google_credentials auth factory. */
function googleAuthPlugin(
  ...mcpAuthFactories: RuntimeMcpAuthFactoryContribution[]
): LoadedRuntimePlugin {
  return {
    specifier: '@vybestack/llxprt-plugin-google-mcp-auth',
    manifest: {
      apiVersion: 1,
      id: '@vybestack/llxprt-plugin-google-mcp-auth',
      providers: [],
      mcpAuthFactories,
    },
  };
}

describe('mcp list command', () => {
  let consoleSpy: Mock<DebugLogger['log']>;
  let mockClient: MockClient;
  let mockTransport: MockTransport;

  beforeEach(() => {
    vi.resetAllMocks();
    // Each listMcpServers run registers MCP auth factories (startup-only
    // seam); reset between tests so every run starts unregistered.
    resetRegisteredMcpAuthFactories();
    fakeAuthProviderConstructions = 0;
    mockedLoadInstalledRuntimePlugins.mockResolvedValue(
      buildProviderContributionRegistry([]),
    );

    consoleSpy = vi
      .spyOn(DebugLogger.prototype, 'log')
      .mockImplementation(() => {});

    mockTransport = { close: vi.fn() };
    mockClient = {
      connect: vi.fn(),
      ping: vi.fn(),
      close: vi.fn(),
    };

    MockedClient.mockImplementation(() => mockClient);
    mockedCreateTransport.mockResolvedValue(mockTransport);
    mockedLoadExtensions.mockReturnValue([]);
    mockedExtensionStorage.getUserExtensionsDir.mockReturnValue(
      '/mocked/extensions/dir',
    );
  });

  afterEach(() => {
    resetRegisteredMcpAuthFactories();
    consoleSpy.mockRestore();
  });

  it('should display message when no servers configured', async () => {
    mockedLoadSettings.mockReturnValue({ merged: { mcpServers: {} } });

    await listMcpServers();

    expect(consoleSpy).toHaveBeenCalledWith('No MCP servers configured.');
  });

  it('should display different server types with connected status', async () => {
    mockedLoadSettings.mockReturnValue({
      merged: {
        mcpServers: {
          'stdio-server': { command: '/path/to/server', args: ['arg1'] },
          'sse-server': { url: 'https://example.com/sse', type: 'sse' },
          'http-server': { httpUrl: 'https://example.com/http' },
          'http-server-by-default': { url: 'https://example.com/http' },
          'http-server-with-type': {
            url: 'https://example.com/http',
            type: 'http',
          },
        },
      },
    });

    mockClient.connect.mockResolvedValue(undefined);
    mockClient.ping.mockResolvedValue(undefined);

    await listMcpServers();

    expect(consoleSpy).toHaveBeenCalledWith('Configured MCP servers:\n');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'stdio-server: /path/to/server arg1 (stdio) - Connected',
      ),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'sse-server: https://example.com/sse (sse) - Connected',
      ),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'http-server: https://example.com/http (http) - Connected',
      ),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'http-server-by-default: https://example.com/http (http) - Connected',
      ),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'http-server-with-type: https://example.com/http (http) - Connected',
      ),
    );
  });

  it('should display disconnected status when connection fails', async () => {
    mockedLoadSettings.mockReturnValue({
      merged: {
        mcpServers: {
          'test-server': { command: '/test/server' },
        },
      },
    });

    mockClient.connect.mockRejectedValue(new Error('Connection failed'));

    await listMcpServers();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'test-server: /test/server  (stdio) - Disconnected',
      ),
    );
  });

  it('should merge extension servers with config servers', async () => {
    mockedLoadSettings.mockReturnValue({
      merged: {
        mcpServers: { 'config-server': { command: '/config/server' } },
      },
    });

    mockedLoadExtensions.mockReturnValue([
      {
        name: 'test-extension',
        mcpServers: { 'extension-server': { command: '/ext/server' } },
      },
    ]);

    mockClient.connect.mockResolvedValue(undefined);
    mockClient.ping.mockResolvedValue(undefined);

    await listMcpServers();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'config-server: /config/server  (stdio) - Connected',
      ),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'extension-server: /ext/server  (stdio) - Connected',
      ),
    );
  });

  // Phase A: URL transport parity tests (RED phase)
  // EXPECTED TO FAIL: current code hardcodes (sse) for url
  it('should display (http) for url-only config (default transport)', async () => {
    mockedLoadSettings.mockReturnValue({
      merged: {
        mcpServers: {
          'url-server': { url: 'https://example.com/mcp' },
        },
      },
    });

    mockClient.connect.mockResolvedValue(undefined);
    mockClient.ping.mockResolvedValue(undefined);

    await listMcpServers();

    // WILL FAIL: current code shows (sse), should show (http)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'url-server: https://example.com/mcp (http) - Connected',
      ),
    );
  });

  // EXPECTED TO PASS: explicit type:sse should work
  it('should display (sse) for url + type:sse', async () => {
    mockedLoadSettings.mockReturnValue({
      merged: {
        mcpServers: {
          'sse-server': { url: 'https://example.com/sse', type: 'sse' },
        },
      },
    });

    mockClient.connect.mockResolvedValue(undefined);
    mockClient.ping.mockResolvedValue(undefined);

    await listMcpServers();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'sse-server: https://example.com/sse (sse) - Connected',
      ),
    );
  });

  // EXPECTED TO FAIL: type:http not currently handled
  it('should display (http) for url + type:http', async () => {
    mockedLoadSettings.mockReturnValue({
      merged: {
        mcpServers: {
          'http-server': { url: 'https://example.com/http', type: 'http' },
        },
      },
    });

    mockClient.connect.mockResolvedValue(undefined);
    mockClient.ping.mockResolvedValue(undefined);

    await listMcpServers();

    // WILL FAIL: current code ignores type:http
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'http-server: https://example.com/http (http) - Connected',
      ),
    );
  });

  // Note: httpUrl already tested in existing test 'should display different server types with connected status'
  // No need to duplicate

  // EXPECTED TO FAIL: no deprecation warning currently exists
  it('should show deprecation warning when both httpUrl and url are present', async () => {
    const warnSpy = vi
      .spyOn(DebugLogger.prototype, 'warn')
      .mockImplementation(() => {});

    mockedLoadSettings.mockReturnValue({
      merged: {
        mcpServers: {
          'dual-server': {
            url: 'https://example.com/sse',
            httpUrl: 'https://example.com/http',
          },
        },
      },
    });

    mockClient.connect.mockResolvedValue(undefined);
    mockClient.ping.mockResolvedValue(undefined);

    await listMcpServers();

    // WILL FAIL: no deprecation warning implemented yet
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('httpUrl'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('deprecated'));

    warnSpy.mockRestore();
  });

  it('should test plugin-backed authProviderType servers through the registered plugin factories', async () => {
    mockedLoadInstalledRuntimePlugins.mockResolvedValue(
      buildProviderContributionRegistry([
        googleAuthPlugin({
          authProviderType: 'google_credentials',
          createAuthProvider: (config: MCPServerConfig) =>
            new FakeAuthProvider(config),
        }),
      ]),
    );
    // Real transport creation: it dispatches authProviderType through the
    // registry the command wired from the loaded plugins.
    mockedCreateTransport.mockImplementation(
      actual.createTransport as unknown as (
        ...args: never[]
      ) => Promise<MockTransport>,
    );
    mockedLoadSettings.mockReturnValue({
      merged: {
        mcpServers: {
          'google-server': {
            url: 'https://example.com/mcp',
            type: 'http',
            authProviderType: 'google_credentials',
          },
        },
      },
    });

    mockClient.connect.mockResolvedValue(undefined);
    mockClient.ping.mockResolvedValue(undefined);

    await listMcpServers();

    expect(fakeAuthProviderConstructions).toBe(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'google-server: https://example.com/mcp (http) - Connected',
      ),
    );
  });

  it('should show disconnected when the plugin for a Google authProviderType is not installed', async () => {
    mockedCreateTransport.mockImplementation(
      actual.createTransport as unknown as (
        ...args: never[]
      ) => Promise<MockTransport>,
    );
    mockedLoadSettings.mockReturnValue({
      merged: {
        mcpServers: {
          'google-server': {
            url: 'https://example.com/mcp',
            type: 'http',
            authProviderType: 'google_credentials',
          },
        },
      },
    });

    await listMcpServers();

    expect(fakeAuthProviderConstructions).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'google-server: https://example.com/mcp (http) - Disconnected',
      ),
    );
  });
});
