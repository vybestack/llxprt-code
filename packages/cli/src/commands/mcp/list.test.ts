/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
  type MockInstance,
} from 'vitest';
import { DebugLogger, createTransport } from '@vybestack/llxprt-code-core';
import { listMcpServers } from './list.js';
import { loadSettings } from '../../config/settings.js';
import { ExtensionStorage, loadExtensions } from '../../config/extension.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

vi.mock('../../config/settings.js', () => ({
  loadSettings: vi.fn(),
}));
vi.mock('../../config/extension.js', () => ({
  loadExtensions: vi.fn(),
  ExtensionStorage: {
    getUserExtensionsDir: vi.fn(),
  },
}));
vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    createTransport: vi.fn(),
    Storage: {
      getGlobalSettingsPath: vi
        .fn()
        .mockReturnValue('/mock/home/.llxprt/settings.json'),
      getGlobalLlxprtDir: vi.fn().mockReturnValue('/mock/home/.llxprt'),
    },
    MCPServerStatus: {
      CONNECTED: 'CONNECTED',
      DISCONNECTED: 'DISCONNECTED',
    },
  };
});
vi.mock('@modelcontextprotocol/sdk/client/index.js');

const mockedExtensionStorage = ExtensionStorage as unknown as {
  getUserExtensionsDir: ReturnType<typeof vi.fn>;
};
const mockedLoadSettings = loadSettings as Mock;
const mockedLoadExtensions = loadExtensions as Mock;
const mockedCreateTransport = createTransport as Mock;
const MockedClient = Client as Mock;

interface MockClient {
  connect: Mock;
  ping: Mock;
  close: Mock;
}

interface MockTransport {
  close: Mock;
}

describe('mcp list command', () => {
  let consoleSpy: MockInstance;
  let mockClient: MockClient;
  let mockTransport: MockTransport;

  beforeEach(() => {
    vi.resetAllMocks();

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
});
