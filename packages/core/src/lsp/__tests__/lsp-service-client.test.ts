/**
 * @plan:PLAN-20250212-LSP.P29
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Diagnostic, LspConfig } from '../types.js';

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

const createConnection = () => ({
  listen: vi.fn(),
  onNotification: vi.fn((method: string, cb: () => void) => {
    if (method === 'lsp/ready') {
      setImmediate(() => cb());
    }
    return { dispose: vi.fn() };
  }),
  sendRequest: sendRequestMock,
  dispose: vi.fn(),
});

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('vscode-jsonrpc/node.js', () => ({
  createMessageConnection: createMessageConnectionMock,
  StreamMessageReader: streamMessageReaderMock,
  StreamMessageWriter: streamMessageWriterMock,
}));

import { LspServiceClient } from '../lsp-service-client.js';

type CheckFileWithSignal = (
  filePath: string,
  signal?: AbortSignal,
) => Promise<Diagnostic[]>;

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const workspaceRoot = repoRoot;

const deadConfig: LspConfig = {
  servers: [{ id: 'ts', command: '/definitely/missing/binary' }],
};

const liveConfig: LspConfig = {
  servers: [{ id: 'ts', command: 'typescript-language-server' }],
};

const makeClient = (config: LspConfig): LspServiceClient =>
  new LspServiceClient(config, workspaceRoot);

describe('LspServiceClient unit contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnMock.mockImplementation((command: string) => {
      if (command === 'which') {
        return createWhichProcess();
      }
      return createLspProcess();
    });
    createMessageConnectionMock.mockImplementation(() => createConnection());
    sendRequestMock.mockResolvedValue([]);
  });

  it('constructs in dead state by default', () => {
    const client = makeClient(deadConfig);
    expect(client.isAlive()).toBe(false);
  });

  it('start with missing binary keeps service dead', async () => {
    const client = makeClient(deadConfig);
    await client.start();
    expect(client.isAlive()).toBe(false);
  });

  it('startup failure reason mentions executable failure', async () => {
    const client = makeClient(deadConfig);
    await client.start();
    expect(client.getUnavailableReason()).toBe(
      'Server command not executable: /definitely/missing/binary',
    );
  });

  it('dead guard checkFile returns []', async () => {
    const client = makeClient(deadConfig);
    await expect(client.checkFile('/tmp/workspace/a.ts')).resolves.toEqual([]);
  });

  it('dead guard getAllDiagnostics returns {}', async () => {
    const client = makeClient(deadConfig);
    await expect(client.getAllDiagnostics()).resolves.toEqual({});
  });

  it('dead guard status returns one unhealthy entry', async () => {
    const client = makeClient(deadConfig);
    await client.start();
    const status = await client.status();
    expect(status).toEqual([
      {
        serverId: 'ts',
        healthy: false,
        detail: 'Server command not executable: /definitely/missing/binary',
      },
    ]);
  });

  it('dead guard getMcpTransportStreams returns null', () => {
    const client = makeClient(deadConfig);
    expect(client.getMcpTransportStreams()).toBeNull();
  });

  it('start should spawn subprocess for live config', async () => {
    const client = makeClient(liveConfig);
    await client.start();
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('start should build jsonrpc connection via createMessageConnection', async () => {
    const client = makeClient(liveConfig);
    await client.start();
    expect(createMessageConnectionMock).toHaveBeenCalledTimes(1);
  });

  it('start should build StreamMessageReader for child stdout', async () => {
    const client = makeClient(liveConfig);
    await client.start();
    expect(streamMessageReaderMock).toHaveBeenCalledTimes(1);
  });

  it('start should build StreamMessageWriter for child stdin', async () => {
    const client = makeClient(liveConfig);
    await client.start();
    expect(streamMessageWriterMock).toHaveBeenCalledTimes(1);
  });

  it('start should transition alive after lsp/ready', async () => {
    const client = makeClient(liveConfig);
    await client.start();
    expect(client.isAlive()).toBe(true);
  });

  it("checkFile alive should call sendRequest('lsp/checkFile')", async () => {
    const client = makeClient(liveConfig);
    await client.start();
    await client.checkFile('/tmp/workspace/a.ts');
    expect(
      sendRequestMock.mock.calls.some((call) => call[0] === 'lsp/checkFile'),
    ).toBe(true);
  });

  it("getAllDiagnostics alive should call sendRequest('lsp/diagnostics')", async () => {
    const client = makeClient(liveConfig);
    await client.start();
    await client.getAllDiagnostics();
    expect(
      sendRequestMock.mock.calls.some((call) => call[0] === 'lsp/diagnostics'),
    ).toBe(true);
  });

  it("status alive should call sendRequest('lsp/status')", async () => {
    const client = makeClient(liveConfig);
    await client.start();
    await client.status();
    expect(
      sendRequestMock.mock.calls.some((call) => call[0] === 'lsp/status'),
    ).toBe(true);
  });

  it("shutdown should call sendRequest('lsp/shutdown') and terminate process", async () => {
    const client = makeClient(liveConfig);
    await client.start();
    await client.shutdown();
    expect(
      sendRequestMock.mock.calls.some((call) => call[0] === 'lsp/shutdown'),
    ).toBe(true);
    expect(client.isAlive()).toBe(false);
  });

  it('supports cancellation path via AbortController with aborted => []', async () => {
    const client = makeClient(liveConfig);
    const controller = new AbortController();

    await client.start();
    controller.abort();

    await expect(
      (client.checkFile as unknown as CheckFileWithSignal)(
        '/tmp/workspace/cancel.ts',
        controller.signal,
      ),
    ).resolves.toEqual([]);
  });
});
