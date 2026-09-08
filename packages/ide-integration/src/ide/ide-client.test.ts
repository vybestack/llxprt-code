/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { automock } from '../../../test-utils/src/automock.js';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import { IdeClient, IDEConnectionStatus } from './ide-client.js';
import { IdeContextNotificationSchema } from './ideContext.js';
import * as fs from 'node:fs';
import { getIdeProcessInfo } from './process-utils.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { detectIde, IDE_DEFINITIONS } from './detect-ide.js';
import * as os from 'node:os';
import * as path from 'node:path';

const realProcessUtilsModule = { ...(await import('./process-utils.js')) };
const realIndexModule = {
  ...(await import('@modelcontextprotocol/sdk/client/index.js')),
};
const realStreamableHttpModule = {
  ...(await import('@modelcontextprotocol/sdk/client/streamableHttp.js')),
};
const realDetectIdeModule = { ...(await import('./detect-ide.js')) };
const realNodeOsModule = { ...(await import('node:os')) };

const actual = { ...(await import('node:fs')) };
const readdirMock = vi.fn();
void vi.mock('node:fs', () => ({
  ...(actual as object),
  promises: {
    readFile: vi.fn(),
    readdir: readdirMock,
  },
  realpathSync: (p: string) => p,
  existsSync: () => false,
}));
void vi.mock('./process-utils.js', () => automock(realProcessUtilsModule));
void vi.mock('@modelcontextprotocol/sdk/client/index.js', () =>
  automock(realIndexModule),
);
void vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () =>
  automock(realStreamableHttpModule),
);
void vi.mock('./detect-ide.js', () => automock(realDetectIdeModule));
void vi.mock('node:os', () => automock(realNodeOsModule));

describe('IdeClient', () => {
  let mockClient: Client;
  let mockHttpTransport: StreamableHTTPClientTransport;

  beforeEach(async () => {
    // Reset singleton instance for test isolation
    (IdeClient as unknown as { instance: IdeClient | undefined }).instance =
      undefined;

    // Mock environment variables
    process.env['LLXPRT_CODE_IDE_WORKSPACE_PATH'] = '/test/workspace';
    delete process.env['LLXPRT_CODE_IDE_SERVER_PORT'];
    delete process.env['LLXPRT_CODE_IDE_SERVER_STDIO_COMMAND'];
    delete process.env['LLXPRT_CODE_IDE_SERVER_STDIO_ARGS'];
    delete process.env['LLXPRT_CODE_IDE_AUTH_TOKEN'];

    // Mock dependencies
    vi.spyOn(process, 'cwd').mockReturnValue('/test/workspace/sub-dir');
    (detectIde as Mock<typeof detectIde>).mockReturnValue(
      IDE_DEFINITIONS.vscode,
    );
    (getIdeProcessInfo as Mock<typeof getIdeProcessInfo>).mockResolvedValue({
      pid: 12345,
      command: 'test-ide',
    });
    (os.tmpdir as Mock<typeof os.tmpdir>).mockReturnValue('/tmp');

    // Mock MCP client and transports. The context notification handler is
    // captured and invoked asynchronously (via microtask) so the client's
    // context-receipt deferred resolves and connect succeeds.
    let contextHandler:
      | ((notification: { params: Record<string, unknown> }) => void)
      | undefined = undefined;
    mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      ping: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      setNotificationHandler: vi.fn((schema, handler) => {
        if (schema === IdeContextNotificationSchema) {
          contextHandler = handler as typeof contextHandler;
          // Simulate the server delivering initial context on the next
          // microtask, so the context-receipt deferred resolves.
          void Promise.resolve().then(() => {
            contextHandler?.({
              params: { workspaceState: { isTrusted: true } },
            });
          });
        }
      }),
      callTool: vi.fn(),
    } as unknown as Client;
    mockHttpTransport = {
      close: vi.fn(),
    } as unknown as StreamableHTTPClientTransport;

    (Client as unknown as Mock<(...args: never[]) => unknown>).mockReturnValue(
      mockClient,
    );
    (
      StreamableHTTPClientTransport as unknown as Mock<
        (...args: never[]) => unknown
      >
    ).mockReturnValue(mockHttpTransport);

    await IdeClient.getInstance();
  });

  afterEach(() => {
    // Bun's restoreAllMocks restores implementations but leaves the call
    // history of module mocks in place, so clear it explicitly.
    vi.clearAllMocks();
    vi.restoreAllMocks();
    delete process.env['LLXPRT_CODE_IDE_SERVER_PORT'];
  });

  it('returns one singleton instance until reset', async () => {
    const a = await IdeClient.getInstance();
    const b = await IdeClient.getInstance();

    expect(b).toBe(a);

    IdeClient.resetInstance();
    const c = await IdeClient.getInstance();

    expect(c).not.toBe(a);
  });

  describe('connect', () => {
    it('should connect using HTTP when port is provided in config file', async () => {
      const config = { port: '8080' };
      (
        fs.promises.readFile as Mock<typeof fs.promises.readFile>
      ).mockResolvedValue(JSON.stringify(config));

      IdeClient.resetInstance();
      const ideClient = await IdeClient.getInstance();
      await ideClient.connect();

      expect(fs.promises.readFile).toHaveBeenCalledWith(
        path.join('/tmp', 'llxprt-ide-server-12345.json'),
        'utf8',
      );
      expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
        new URL('http://127.0.0.1:8080/mcp'),
        expect.any(Object),
      );
      expect(mockClient.connect).toHaveBeenCalledWith(mockHttpTransport);
      expect(ideClient.getConnectionStatus().status).toBe(
        IDEConnectionStatus.Connected,
      );
    });

    it('should connect using HTTP when port is provided in environment variables', async () => {
      (
        fs.promises.readFile as Mock<typeof fs.promises.readFile>
      ).mockRejectedValue(new Error('File not found'));
      process.env['LLXPRT_CODE_IDE_SERVER_PORT'] = '9090';

      const ideClient = await IdeClient.getInstance();
      await ideClient.connect();

      expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
        new URL('http://127.0.0.1:9090/mcp'),
        expect.any(Object),
      );
      expect(mockClient.connect).toHaveBeenCalledWith(mockHttpTransport);
      expect(ideClient.getConnectionStatus().status).toBe(
        IDEConnectionStatus.Connected,
      );
    });

    it('should prioritize file config over environment variables', async () => {
      const config = { port: '8080' };
      (
        fs.promises.readFile as Mock<typeof fs.promises.readFile>
      ).mockResolvedValue(JSON.stringify(config));
      process.env['LLXPRT_CODE_IDE_SERVER_PORT'] = '9090';

      IdeClient.resetInstance();
      const ideClient = await IdeClient.getInstance();
      await ideClient.connect();

      expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
        new URL('http://127.0.0.1:8080/mcp'),
        expect.any(Object),
      );
      expect(ideClient.getConnectionStatus().status).toBe(
        IDEConnectionStatus.Connected,
      );
    });

    it('should be disconnected if no config is found', async () => {
      (
        fs.promises.readFile as Mock<typeof fs.promises.readFile>
      ).mockRejectedValue(new Error('File not found'));

      const ideClient = await IdeClient.getInstance();
      await ideClient.connect();

      expect(StreamableHTTPClientTransport).not.toHaveBeenCalled();
      expect(ideClient.getConnectionStatus().status).toBe(
        IDEConnectionStatus.Disconnected,
      );
      expect(ideClient.getConnectionStatus().details).toContain(
        'Failed to connect',
      );
    });

    it('should discover port file using readdir in new location', async () => {
      const portFileContent = { port: '7070', authToken: 'test-token' };
      readdirMock.mockResolvedValue(['llxprt-ide-server-12345-7070.json']);
      (
        fs.promises.readFile as Mock<typeof fs.promises.readFile>
      ).mockResolvedValue(JSON.stringify(portFileContent));

      IdeClient.resetInstance();
      const ideClient = await IdeClient.getInstance();
      await ideClient.connect();

      expect(fs.promises.readdir).toHaveBeenCalledWith(
        path.join('/tmp', 'llxprt', 'ide'),
      );
      expect(fs.promises.readFile).toHaveBeenCalledWith(
        path.join('/tmp', 'llxprt', 'ide', 'llxprt-ide-server-12345-7070.json'),
        'utf8',
      );
      expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
        new URL('http://127.0.0.1:7070/mcp'),
        expect.any(Object),
      );
      expect(ideClient.getConnectionStatus().status).toBe(
        IDEConnectionStatus.Connected,
      );
    });

    it('should handle empty directory when discovering port files', async () => {
      readdirMock.mockResolvedValue([]);
      (
        fs.promises.readFile as Mock<typeof fs.promises.readFile>
      ).mockRejectedValue(new Error('File not found'));

      IdeClient.resetInstance();
      const ideClient = await IdeClient.getInstance();
      await ideClient.connect();

      expect(fs.promises.readdir).toHaveBeenCalledWith(
        path.join('/tmp', 'llxprt', 'ide'),
      );
      expect(ideClient.getConnectionStatus().status).toBe(
        IDEConnectionStatus.Disconnected,
      );
    });

    it('should fall back to old location when readdir fails', async () => {
      readdirMock.mockRejectedValue(new Error('Directory not found'));

      const oldLocationConfig = { port: '6060' };
      (
        fs.promises.readFile as Mock<typeof fs.promises.readFile>
      ).mockResolvedValue(JSON.stringify(oldLocationConfig));

      IdeClient.resetInstance();
      const ideClient = await IdeClient.getInstance();
      await ideClient.connect();

      expect(fs.promises.readdir).toHaveBeenCalled();
      expect(fs.promises.readFile).toHaveBeenCalledWith(
        path.join('/tmp', 'llxprt-ide-server-12345.json'),
        'utf8',
      );
      expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
        new URL('http://127.0.0.1:6060/mcp'),
        expect.any(Object),
      );
      expect(ideClient.getConnectionStatus().status).toBe(
        IDEConnectionStatus.Connected,
      );
    });

    it('should ignore non-matching files in port directory', async () => {
      readdirMock.mockResolvedValue([
        'other-file.json',
        'llxprt-ide-server-99999-8080.json', // Wrong PID
        'llxprt-ide-server-12345-9090.txt', // Wrong extension
      ]);
      (
        fs.promises.readFile as Mock<typeof fs.promises.readFile>
      ).mockRejectedValue(new Error('File not found'));

      IdeClient.resetInstance();
      const ideClient = await IdeClient.getInstance();
      await ideClient.connect();

      expect(fs.promises.readdir).toHaveBeenCalledWith(
        path.join('/tmp', 'llxprt', 'ide'),
      );
      expect(ideClient.getConnectionStatus().status).toBe(
        IDEConnectionStatus.Disconnected,
      );
    });
  });

  describe('authentication', () => {
    it('passes through auth token from config file when connecting', async () => {
      const authToken = 'test-auth-token';
      const config = { port: '8080', authToken };
      (
        fs.promises.readFile as Mock<typeof fs.promises.readFile>
      ).mockResolvedValue(JSON.stringify(config));
      readdirMock.mockResolvedValue([]);

      IdeClient.resetInstance();
      const ideClient = await IdeClient.getInstance();
      await ideClient.connect();

      expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
        new URL('http://127.0.0.1:8080/mcp'),
        expect.objectContaining({
          requestInit: {
            headers: {
              Authorization: `Bearer ${authToken}`,
            },
          },
        }),
      );
      expect(ideClient.getConnectionStatus().status).toBe(
        IDEConnectionStatus.Connected,
      );
    });

    it('should connect with an auth token from environment variable if config file is missing', async () => {
      (
        fs.promises.readFile as Mock<typeof fs.promises.readFile>
      ).mockRejectedValue(new Error('File not found'));
      readdirMock.mockResolvedValue([]);
      process.env['LLXPRT_CODE_IDE_SERVER_PORT'] = '9090';
      process.env['LLXPRT_CODE_IDE_AUTH_TOKEN'] = 'env-auth-token';

      const ideClient = await IdeClient.getInstance();
      await ideClient.connect();

      expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
        new URL('http://127.0.0.1:9090/mcp'),
        expect.objectContaining({
          requestInit: {
            headers: {
              Authorization: 'Bearer env-auth-token',
            },
          },
        }),
      );
      expect(ideClient.getConnectionStatus().status).toBe(
        IDEConnectionStatus.Connected,
      );
    });
  });

  describe('issue #2656 — Windows stale-env + live-port-file recovery', () => {
    // This composed behavioral test proves the end-to-end recovery path:
    // the real IDE PID (29396, Code.exe main) is identified, the live port
    // file keyed to that PID is found in the temp dir, and its metadata
    // (port 64365 + auth token + workspace) is used INSTEAD of the stale
    // LLXPRT_CODE_IDE_SERVER_PORT env value (49975, a dead port).
    //
    // The client test harness mocks `getIdeProcessInfo` directly (the
    // established pattern in this file), so we inject {pid: 29396} here.
    // process-utils.test.ts already proves the REAL getIdeProcessInfo walks
    // the issue's exact process tree and returns 29396; this test focuses on
    // the downstream PID→port-file resolution and stale-env bypass.
    it('uses the live port file keyed to the Code main PID instead of the stale env port', async () => {
      (getIdeProcessInfo as Mock<typeof getIdeProcessInfo>).mockResolvedValue({
        pid: 29396,
        command: 'C:\\Program Files\\Microsoft VS Code\\Code.exe',
      });
      process.env['LLXPRT_CODE_IDE_SERVER_PORT'] = '49975';

      const liveFile = {
        port: 64365,
        workspacePath: '/test/workspace',
        authToken: 'token-xyz',
        ideInfo: { name: 'vscode', displayName: 'VS Code' },
      };
      readdirMock.mockResolvedValue(['llxprt-ide-server-29396-64365.json']);
      (
        fs.promises.readFile as Mock<typeof fs.promises.readFile>
      ).mockResolvedValue(JSON.stringify(liveFile));

      IdeClient.resetInstance();
      const ideClient = await IdeClient.getInstance();
      await ideClient.connect();

      // The live file (port 64365) must be selected; the stale env port
      // (49975) must NOT be used.
      expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
        new URL('http://127.0.0.1:64365/mcp'),
        expect.objectContaining({
          requestInit: {
            headers: {
              Authorization: 'Bearer token-xyz',
            },
          },
        }),
      );
      expect(StreamableHTTPClientTransport).not.toHaveBeenCalledWith(
        new URL('http://127.0.0.1:49975/mcp'),
        expect.anything(),
      );
      expect(ideClient.getConnectionStatus().status).toBe(
        IDEConnectionStatus.Connected,
      );
    });
  });
});
