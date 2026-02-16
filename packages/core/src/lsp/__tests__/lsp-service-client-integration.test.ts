/**
 * @plan:PLAN-20250212-LSP.P28
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  spawnMock,
  createMessageConnectionMock,
  streamMessageReaderMock,
  streamMessageWriterMock,
  sendRequestMock,
} = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  createMessageConnectionMock: vi.fn(),
  streamMessageReaderMock: vi.fn(),
  streamMessageWriterMock: vi.fn(),
  sendRequestMock: vi.fn(),
}));

const createWhichProcess = () => {
  const proc = new EventEmitter() as EventEmitter & { stdout: PassThrough };
  proc.stdout = new PassThrough();
  setImmediate(() => {
    proc.stdout.write('/usr/bin/bun\n');
    proc.emit('exit', 0, null);
  });
  return proc;
};

const createLspProcess = () => {
  class MockChild extends EventEmitter {
    stdout = new PassThrough();
    stdin = new PassThrough();
    stderr = new PassThrough();
    stdio = [
      this.stdin,
      this.stdout,
      this.stderr,
      new PassThrough(),
      new PassThrough(),
    ] as const;
    killed = false;

    kill = vi.fn((_signal?: NodeJS.Signals | number) => {
      this.killed = true;
      this.emit('exit', 0, null);
      return true;
    });
  }

  return new MockChild();
};

const createConnection = () => {
  const listeners = new Map<string, () => void>();

  return {
    listen: vi.fn(),
    onNotification: vi.fn((method: string, cb: () => void) => {
      listeners.set(method, cb);
      if (method === 'lsp/ready') {
        setImmediate(() => cb());
      }
      return {
        dispose: vi.fn(() => {
          listeners.delete(method);
        }),
      };
    }),
    sendRequest: sendRequestMock,
    dispose: vi.fn(),
  };
};

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('vscode-jsonrpc/node.js', () => ({
  createMessageConnection: createMessageConnectionMock,
  StreamMessageReader: streamMessageReaderMock,
  StreamMessageWriter: streamMessageWriterMock,
}));

import { LspServiceClient } from '../lsp-service-client.js';

type ClientConfig = ConstructorParameters<typeof LspServiceClient>[0];

const createConfig = (command: string): ClientConfig => ({
  servers: [
    {
      id: 'ts',
      command,
      args: [],
      filetypes: ['typescript'],
    },
  ],
});

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));

const createClient = (command: string, workspaceRoot = repoRoot) =>
  new LspServiceClient(createConfig(command), workspaceRoot);

describe('LspServiceClient integration contract', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    createMessageConnectionMock.mockReset();
    streamMessageReaderMock.mockReset();
    streamMessageWriterMock.mockReset();
    sendRequestMock.mockReset();

    spawnMock.mockImplementation((command: string) => {
      if (command === 'which') {
        return createWhichProcess();
      }
      return createLspProcess();
    });

    createMessageConnectionMock.mockImplementation(() => createConnection());
  });

  afterEach(async () => {
    const client = createClient('/definitely/missing-bun');
    await client.shutdown();
  });

  it('start with absolute missing command keeps service dead', async () => {
    const client = createClient('/definitely/missing-bun');

    await client.start();

    expect(client.isAlive()).toBe(false);
  });

  it('start with absolute missing command reports exact unavailable reason', async () => {
    const client = createClient('/definitely/missing-bun');

    await client.start();

    expect(client.getUnavailableReason()).toBe(
      'Server command not executable: /definitely/missing-bun',
    );
  });

  it('absolute missing command does not attempt bun resolution or spawn lsp service', async () => {
    const client = createClient('/definitely/missing-bun');

    await client.start();

    expect(spawnMock).not.toHaveBeenCalled();
    expect(createMessageConnectionMock).not.toHaveBeenCalled();
  });

  it('checkFile on dead service returns empty diagnostics', async () => {
    const client = createClient('/definitely/missing-bun');

    await client.start();

    await expect(client.checkFile('/tmp/workspace/a.ts')).resolves.toEqual([]);
  });

  it('getAllDiagnostics on dead service returns empty object', async () => {
    const client = createClient('/definitely/missing-bun');

    await client.start();

    await expect(client.getAllDiagnostics()).resolves.toEqual({});
  });

  it('status on dead service returns unhealthy detail for configured server', async () => {
    const client = createClient('/definitely/missing-bun');

    await client.start();

    await expect(client.status()).resolves.toEqual([
      {
        serverId: 'ts',
        healthy: false,
        detail: 'Server command not executable: /definitely/missing-bun',
      },
    ]);
  });

  it('getMcpTransportStreams returns null when dead', async () => {
    const client = createClient('/definitely/missing-bun');

    await client.start();

    expect(client.getMcpTransportStreams()).toBeNull();
  });

  it('live start uses which bun and lsp spawn plus jsonrpc connection', async () => {
    const client = createClient('typescript-language-server');

    await client.start();

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls.some((call) => call[0] === 'which')).toBe(true);
    expect(createMessageConnectionMock).toHaveBeenCalledTimes(1);
    expect(client.isAlive()).toBe(true);
  });

  it('live checkFile sends lsp/checkFile request', async () => {
    const client = createClient('typescript-language-server');
    sendRequestMock.mockResolvedValue([]);

    await client.start();
    await client.checkFile('/tmp/workspace/a.ts');

    expect(
      sendRequestMock.mock.calls.some((call) => call[0] === 'lsp/checkFile'),
    ).toBe(true);
  });

  it('live getAllDiagnostics sends lsp/diagnostics request', async () => {
    const client = createClient('typescript-language-server');
    sendRequestMock.mockResolvedValue({});

    await client.start();
    await client.getAllDiagnostics();

    expect(
      sendRequestMock.mock.calls.some((call) => call[0] === 'lsp/diagnostics'),
    ).toBe(true);
  });

  it('live status sends lsp/status request', async () => {
    const client = createClient('typescript-language-server');
    sendRequestMock.mockResolvedValue([]);

    await client.start();
    await client.status();

    expect(
      sendRequestMock.mock.calls.some((call) => call[0] === 'lsp/status'),
    ).toBe(true);
  });

  it('shutdown sends lsp/shutdown and kills child', async () => {
    const client = createClient('typescript-language-server');
    sendRequestMock.mockResolvedValue([]);

    await client.start();
    await client.shutdown();

    expect(
      sendRequestMock.mock.calls.some((call) => call[0] === 'lsp/shutdown'),
    ).toBe(true);
    expect(client.isAlive()).toBe(false);
  });
});
