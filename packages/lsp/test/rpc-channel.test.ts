/**
 * @plan:PLAN-20250212-LSP.P21
 * @requirement REQ-ARCH-020
 * @requirement REQ-ARCH-070
 * @pseudocode rpc-channel.md lines 01-42
 */

import { describe, expect, it } from 'vitest';
import {
  createMessageConnection,
  NullLogger,
  RequestType,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc';
import { PassThrough } from 'node:stream';

import { setupRpcChannel } from '../src/channels/rpc-channel.js';

type Diagnostic = {
  source: string;
  code: string;
  message: string;
  severity: number;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

type ServerStatus = {
  serverId: string;
  state: 'ok' | 'broken' | 'starting';
};

type TestOrchestrator = {
  checkFile: (filePath: string, text?: string) => Promise<Diagnostic[]>;
  getAllDiagnostics: () => Promise<Record<string, Diagnostic[]>>;
  status: () => Promise<ServerStatus[]>;
  shutdown: () => Promise<void>;
};

function createConnectionPair() {
  const serverToClient = new PassThrough();
  const clientToServer = new PassThrough();

  const client = createMessageConnection(
    new StreamMessageReader(serverToClient),
    new StreamMessageWriter(clientToServer),
    NullLogger,
  );

  const server = createMessageConnection(
    new StreamMessageReader(clientToServer),
    new StreamMessageWriter(serverToClient),
    NullLogger,
  );

  return { client, server };
}

function sampleDiagnostic(message: string): Diagnostic {
  return {
    source: 'typescript',
    code: 'TS1001',
    message,
    severity: 1,
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 5 },
    },
  };
}

describe('RPC channel JSON-RPC behavior', () => {
  it('lsp/checkFile returns diagnostics for request file path and text payload', async () => {
    const expected = [sampleDiagnostic('Type mismatch in foo.ts')];
    const orchestrator: TestOrchestrator = {
      checkFile: async (filePath, text) => {
        if (
          filePath === '/workspace/src/foo.ts' &&
          text === 'const a: number = "x";'
        ) {
          return expected;
        }
        return [];
      },
      getAllDiagnostics: async () => ({}),
      status: async () => [],
      shutdown: async () => {},
    };

    const { client, server } = createConnectionPair();
    setupRpcChannel(server, orchestrator as never);
    server.listen();
    client.listen();

    const result = await client.sendRequest('lsp/checkFile', {
      filePath: '/workspace/src/foo.ts',
      text: 'const a: number = "x";',
    });

    expect(result).toEqual(expected);

    client.dispose();
    server.dispose();
  });

  it('lsp/checkFile returns empty diagnostics for unknown file input', async () => {
    const orchestrator: TestOrchestrator = {
      checkFile: async (filePath) =>
        filePath.endsWith('.ts') ? [sampleDiagnostic('known')] : [],
      getAllDiagnostics: async () => ({}),
      status: async () => [],
      shutdown: async () => {},
    };

    const { client, server } = createConnectionPair();
    setupRpcChannel(server, orchestrator as never);
    server.listen();
    client.listen();

    const result = await client.sendRequest('lsp/checkFile', {
      filePath: '/workspace/src/unknown.md',
    });

    expect(result).toEqual([]);

    client.dispose();
    server.dispose();
  });

  it('lsp/checkFile falls back to [] when orchestrator throws', async () => {
    const orchestrator: TestOrchestrator = {
      checkFile: async () => {
        throw new Error('check failed');
      },
      getAllDiagnostics: async () => ({}),
      status: async () => [],
      shutdown: async () => {},
    };

    const { client, server } = createConnectionPair();
    setupRpcChannel(server, orchestrator as never);
    server.listen();
    client.listen();

    const result = await client.sendRequest('lsp/checkFile', {
      filePath: '/workspace/src/failing.ts',
    });

    expect(result).toEqual([]);

    client.dispose();
    server.dispose();
  });

  it('lsp/diagnostics returns record snapshot with alphabetically sorted file keys', async () => {
    const orchestrator: TestOrchestrator = {
      checkFile: async () => [],
      getAllDiagnostics: async () => ({
        '/workspace/src/z.ts': [sampleDiagnostic('Z')],
        '/workspace/src/a.ts': [sampleDiagnostic('A')],
        '/workspace/src/m.ts': [sampleDiagnostic('M')],
      }),
      status: async () => [],
      shutdown: async () => {},
    };

    const { client, server } = createConnectionPair();
    setupRpcChannel(server, orchestrator as never);
    server.listen();
    client.listen();

    const result = (await client.sendRequest('lsp/diagnostics')) as Record<
      string,
      Diagnostic[]
    >;

    expect(Object.keys(result)).toEqual([
      '/workspace/src/a.ts',
      '/workspace/src/m.ts',
      '/workspace/src/z.ts',
    ]);
    expect(result['/workspace/src/a.ts'][0]?.message).toBe('A');
    expect(result['/workspace/src/m.ts'][0]?.message).toBe('M');
    expect(result['/workspace/src/z.ts'][0]?.message).toBe('Z');

    client.dispose();
    server.dispose();
  });

  it('lsp/diagnostics returns empty object when no files have diagnostics', async () => {
    const orchestrator: TestOrchestrator = {
      checkFile: async () => [],
      getAllDiagnostics: async () => ({}),
      status: async () => [],
      shutdown: async () => {},
    };

    const { client, server } = createConnectionPair();
    setupRpcChannel(server, orchestrator as never);
    server.listen();
    client.listen();

    const result = await client.sendRequest('lsp/diagnostics');

    expect(result).toEqual({});

    client.dispose();
    server.dispose();
  });

  it('lsp/diagnostics falls back to {} when orchestrator throws', async () => {
    const orchestrator: TestOrchestrator = {
      checkFile: async () => [],
      getAllDiagnostics: async () => {
        throw new Error('diagnostics failure');
      },
      status: async () => [],
      shutdown: async () => {},
    };

    const { client, server } = createConnectionPair();
    setupRpcChannel(server, orchestrator as never);
    server.listen();
    client.listen();

    const result = await client.sendRequest('lsp/diagnostics');

    expect(result).toEqual({});

    client.dispose();
    server.dispose();
  });

  it('lsp/status returns a typed server status list', async () => {
    const expected: ServerStatus[] = [
      { serverId: 'tsserver', state: 'ok' },
      { serverId: 'pyright', state: 'starting' },
      { serverId: 'eslint', state: 'broken' },
    ];

    const orchestrator: TestOrchestrator = {
      checkFile: async () => [],
      getAllDiagnostics: async () => ({}),
      status: async () => expected,
      shutdown: async () => {},
    };

    const { client, server } = createConnectionPair();
    setupRpcChannel(server, orchestrator as never);
    server.listen();
    client.listen();

    const result = await client.sendRequest('lsp/status');

    expect(result).toEqual(expected);

    client.dispose();
    server.dispose();
  });

  it('lsp/status falls back to [] when orchestrator throws', async () => {
    const orchestrator: TestOrchestrator = {
      checkFile: async () => [],
      getAllDiagnostics: async () => ({}),
      status: async () => {
        throw new Error('status failure');
      },
      shutdown: async () => {},
    };

    const { client, server } = createConnectionPair();
    setupRpcChannel(server, orchestrator as never);
    server.listen();
    client.listen();

    const result = await client.sendRequest('lsp/status');

    expect(result).toEqual([]);

    client.dispose();
    server.dispose();
  });

  it('lsp/shutdown resolves with null payload', async () => {
    let shutdownCompleted = false;
    const orchestrator: TestOrchestrator = {
      checkFile: async () => [],
      getAllDiagnostics: async () => ({}),
      status: async () => [],
      shutdown: async () => {
        shutdownCompleted = true;
      },
    };

    const { client, server } = createConnectionPair();
    setupRpcChannel(server, orchestrator as never);
    server.listen();
    client.listen();

    const result = await client.sendRequest('lsp/shutdown');

    expect(result).toBeNull();
    expect(shutdownCompleted).toBe(true);

    client.dispose();
    server.dispose();
  });

  it('lsp/shutdown swallows orchestrator errors and still resolves null', async () => {
    const orchestrator: TestOrchestrator = {
      checkFile: async () => [],
      getAllDiagnostics: async () => ({}),
      status: async () => [],
      shutdown: async () => {
        throw new Error('shutdown failure');
      },
    };

    const { client, server } = createConnectionPair();
    setupRpcChannel(server, orchestrator as never);
    server.listen();
    client.listen();

    const result = await client.sendRequest('lsp/shutdown');

    expect(result).toBeNull();

    client.dispose();
    server.dispose();
  });

  it('unknown method returns JSON-RPC method not found error', async () => {
    const orchestrator: TestOrchestrator = {
      checkFile: async () => [],
      getAllDiagnostics: async () => ({}),
      status: async () => [],
      shutdown: async () => {},
    };

    const { client, server } = createConnectionPair();
    setupRpcChannel(server, orchestrator as never);
    server.listen();
    client.listen();

    const unknownRequest = new RequestType<void, unknown, void>('lsp/not-real');

    await expect(
      client.sendRequest(unknownRequest, undefined),
    ).rejects.toMatchObject({
      code: -32601,
    });

    client.dispose();
    server.dispose();
  });
});
