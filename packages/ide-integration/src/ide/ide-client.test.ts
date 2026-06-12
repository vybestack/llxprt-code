/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mocked,
  type Mock,
} from 'vitest';
import { IdeClient, IDEConnectionStatus } from './ide-client.js';
import * as fs from 'node:fs';
import { getIdeProcessInfo } from './process-utils.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { detectIde, IDE_DEFINITIONS } from './detect-ide.js';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    promises: {
      readFile: vi.fn(),
      readdir: vi.fn(),
    },
    realpathSync: (p: string) => p,
    existsSync: () => false,
  };
});
vi.mock('./process-utils.js');
vi.mock('@modelcontextprotocol/sdk/client/index.js');
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js');
vi.mock('./detect-ide.js');
vi.mock('node:os');

describe('IdeClient', () => {
  let mockClient: Mocked<Client>;
  let mockHttpTransport: Mocked<StreamableHTTPClientTransport>;

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
    vi.mocked(detectIde).mockReturnValue(IDE_DEFINITIONS.vscode);
    vi.mocked(getIdeProcessInfo).mockResolvedValue({
      pid: 12345,
      command: 'test-ide',
    });
    vi.mocked(os.tmpdir).mockReturnValue('/tmp');

    // Mock MCP client and transports
    mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      setNotificationHandler: vi.fn(),
      callTool: vi.fn(),
    } as unknown as Mocked<Client>;
    mockHttpTransport = {
      close: vi.fn(),
    } as unknown as Mocked<StreamableHTTPClientTransport>;

    vi.mocked(Client).mockReturnValue(mockClient);
    vi.mocked(StreamableHTTPClientTransport).mockReturnValue(mockHttpTransport);

    await IdeClient.getInstance();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('connect', () => {
    it('should connect using HTTP when port is provided in config file', async () => {
      const config = { port: '8080' };
      vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(config));

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
      vi.mocked(fs.promises.readFile).mockRejectedValue(
        new Error('File not found'),
      );
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
      vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(config));
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
      vi.mocked(fs.promises.readFile).mockRejectedValue(
        new Error('File not found'),
      );

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
      (
        vi.mocked(fs.promises.readdir) as Mock<
          (path: fs.PathLike) => Promise<string[]>
        >
      ).mockResolvedValue(['llxprt-ide-server-12345-7070.json']);
      vi.mocked(fs.promises.readFile).mockResolvedValue(
        JSON.stringify(portFileContent),
      );

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
      (
        vi.mocked(fs.promises.readdir) as Mock<
          (path: fs.PathLike) => Promise<string[]>
        >
      ).mockResolvedValue([]);
      vi.mocked(fs.promises.readFile).mockRejectedValue(
        new Error('File not found'),
      );

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
      (
        vi.mocked(fs.promises.readdir) as Mock<
          (path: fs.PathLike) => Promise<string[]>
        >
      ).mockRejectedValue(new Error('Directory not found'));

      const oldLocationConfig = { port: '6060' };
      vi.mocked(fs.promises.readFile).mockResolvedValue(
        JSON.stringify(oldLocationConfig),
      );

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
      (
        vi.mocked(fs.promises.readdir) as Mock<
          (path: fs.PathLike) => Promise<string[]>
        >
      ).mockResolvedValue([
        'other-file.json',
        'llxprt-ide-server-99999-8080.json', // Wrong PID
        'llxprt-ide-server-12345-9090.txt', // Wrong extension
      ]);
      vi.mocked(fs.promises.readFile).mockRejectedValue(
        new Error('File not found'),
      );

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
      vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(config));
      (
        vi.mocked(fs.promises.readdir) as Mock<
          (path: fs.PathLike) => Promise<string[]>
        >
      ).mockResolvedValue([]);

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
      vi.mocked(fs.promises.readFile).mockRejectedValue(
        new Error('File not found'),
      );
      (
        vi.mocked(fs.promises.readdir) as Mock<
          (path: fs.PathLike) => Promise<string[]>
        >
      ).mockResolvedValue([]);
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
});
