/**
 * @plan:PLAN-20250212-LSP.P26
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { PassThrough } from 'node:stream';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from 'vscode-jsonrpc/node.js';
import { main, parseBootstrapFromEnv } from '../src/main.js';
import { createMcpChannel as createRealMcpChannel } from '../src/channels/mcp-channel.js';
import type { Orchestrator } from '../src/service/orchestrator.js';
import { createOrchestrator as createRealOrchestrator } from '../src/service/orchestrator.js';

type OrchestratorConfig = NonNullable<
  Parameters<typeof createRealOrchestrator>[0]
>;

function createOrchestratorDouble(
  shutdown: () => Promise<void> = vi.fn().mockResolvedValue(undefined),
): Orchestrator {
  const orchestrator = createRealOrchestrator({}, '/tmp/ws');
  vi.spyOn(orchestrator, 'shutdown').mockImplementation(shutdown);
  return orchestrator;
}

function createRpcConnectionDouble(
  dispose: () => void = vi.fn(),
): MessageConnection {
  const input = new PassThrough();
  const output = new PassThrough();
  const connection = createMessageConnection(
    new StreamMessageReader(input),
    new StreamMessageWriter(output),
  );
  vi.spyOn(connection, 'listen').mockImplementation(() => {});
  vi.spyOn(connection, 'dispose').mockImplementation(dispose);
  vi.spyOn(connection, 'sendNotification').mockResolvedValue(undefined);
  return connection;
}

function createMcpChannelDouble(
  close: () => Promise<void> = vi.fn().mockResolvedValue(undefined),
) {
  return vi.fn(async (..._args: Parameters<typeof createRealMcpChannel>) => {
    const server = new McpServer({ name: 'test-lsp', version: '1.0.0' });
    vi.spyOn(server, 'close').mockImplementation(close);
    return server;
  });
}

function createSetupRpcChannelDouble() {
  return vi.fn(
    (_connection: MessageConnection, _orchestrator: Orchestrator) => {},
  );
}

type BootstrapResult = {
  workspaceRoot: string;
  config: Record<string, unknown>;
};

describe('main bootstrap parsing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.LSP_BOOTSTRAP;
  });

  it('missing LSP_BOOTSTRAP throws and writes stderr', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(() => parseBootstrapFromEnv()).toThrowError(
      'LSP_BOOTSTRAP environment variable is required',
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      'LSP_BOOTSTRAP environment variable is required\n',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('valid parse returns workspaceRoot and config', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { navigationTools: true, diagnosticsTimeoutMs: 1000 },
    });

    const result = parseBootstrapFromEnv() as BootstrapResult;

    expect(result.workspaceRoot).toBe('/tmp/ws');
    expect(result.config).toMatchObject({
      navigationTools: true,
      diagnosticsTimeoutMs: 1000,
    });
  });

  it('invalid JSON throws and writes stderr', async () => {
    process.env.LSP_BOOTSTRAP = '{bad-json';
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(() => parseBootstrapFromEnv()).toThrowError(
      'LSP_BOOTSTRAP must be valid JSON',
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      'LSP_BOOTSTRAP must be valid JSON\n',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('missing workspaceRoot throws and writes stderr', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({ config: {} });
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(() => parseBootstrapFromEnv()).toThrowError(
      'LSP_BOOTSTRAP.workspaceRoot must be a non-empty string',
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      'LSP_BOOTSTRAP.workspaceRoot must be a non-empty string\n',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('default config is used when config is absent', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({ workspaceRoot: '/tmp/ws' });

    const result = parseBootstrapFromEnv() as BootstrapResult;

    expect(result.workspaceRoot).toBe('/tmp/ws');
    expect(result.config).toEqual({});
  });

  it('invalid field type throws and writes stderr', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { diagnosticsTimeoutMs: 'fast' },
    });
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(() => parseBootstrapFromEnv()).toThrowError(
      'LSP_BOOTSTRAP.config.diagnosticsTimeoutMs must be a number',
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      'LSP_BOOTSTRAP.config.diagnosticsTimeoutMs must be a number\n',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('requestTimeoutMs validation rejects non-number', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { requestTimeoutMs: 'slow' },
    });
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(() => parseBootstrapFromEnv()).toThrowError(
      'LSP_BOOTSTRAP.config.requestTimeoutMs must be a number',
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      'LSP_BOOTSTRAP.config.requestTimeoutMs must be a number\n',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('requestTimeoutMs validation accepts number', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { requestTimeoutMs: 5000 },
    });

    const result = parseBootstrapFromEnv() as BootstrapResult;

    expect(result.config.requestTimeoutMs).toBe(5000);
  });

  it('requestTimeoutMs validation rejects zero', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { requestTimeoutMs: 0 },
    });
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(() => parseBootstrapFromEnv()).toThrowError(
      'LSP_BOOTSTRAP.config.requestTimeoutMs must be a finite positive number',
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      'LSP_BOOTSTRAP.config.requestTimeoutMs must be a finite positive number\n',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('requestTimeoutMs validation rejects negative', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { requestTimeoutMs: -100 },
    });
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(() => parseBootstrapFromEnv()).toThrowError(
      'LSP_BOOTSTRAP.config.requestTimeoutMs must be a finite positive number',
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      'LSP_BOOTSTRAP.config.requestTimeoutMs must be a finite positive number\n',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('requestTimeoutMs validation rejects NaN', async () => {
    // JSON.stringify turns NaN into null, and JSON.parse turns it back to null
    // in the env var. We need to set the raw env with a non-standard NaN value
    // that JSON.parse will parse as a non-number.
    process.env.LSP_BOOTSTRAP =
      '{"workspaceRoot":"/tmp/ws","config":{"requestTimeoutMs":"NaN"}}';
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(() => parseBootstrapFromEnv()).toThrowError(
      'LSP_BOOTSTRAP.config.requestTimeoutMs must be a number',
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      'LSP_BOOTSTRAP.config.requestTimeoutMs must be a number\n',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('requestTimeoutMs validation rejects Infinity', async () => {
    // JSON.stringify turns Infinity into null, so test with a string value
    // that will be parsed as a non-number type.
    process.env.LSP_BOOTSTRAP =
      '{"workspaceRoot":"/tmp/ws","config":{"requestTimeoutMs":"Infinity"}}';
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(() => parseBootstrapFromEnv()).toThrowError(
      'LSP_BOOTSTRAP.config.requestTimeoutMs must be a number',
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      'LSP_BOOTSTRAP.config.requestTimeoutMs must be a number\n',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('firstTouchTimeoutMs validation rejects non-number', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { firstTouchTimeoutMs: 'fast' },
    });
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(() => parseBootstrapFromEnv()).toThrowError(
      'LSP_BOOTSTRAP.config.firstTouchTimeoutMs must be a number',
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      'LSP_BOOTSTRAP.config.firstTouchTimeoutMs must be a number\n',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('firstTouchTimeoutMs validation accepts number', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { firstTouchTimeoutMs: 15000 },
    });

    const result = parseBootstrapFromEnv() as BootstrapResult;

    expect(result.config.firstTouchTimeoutMs).toBe(15000);
  });

  it('omits firstTouchTimeoutMs from config when not provided', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { diagnosticsTimeoutMs: 1000 },
    });

    const result = parseBootstrapFromEnv() as BootstrapResult;

    expect(result.config.firstTouchTimeoutMs).toBeUndefined();
    expect(result.config.diagnosticsTimeoutMs).toBe(1000);
  });
});

describe('main channel wiring', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const lifecycles: Array<{ dispose(): Promise<void> }> = [];

  const runMain: typeof main = async (dependencies) => {
    const lifecycle = await main(dependencies);
    lifecycles.push(lifecycle);
    return lifecycle;
  };

  const createRpcConnection = (): MessageConnection =>
    createRpcConnectionDouble();

  const createOrchestratorFactory = (orchestrator: Orchestrator) =>
    vi.fn(
      (_config?: OrchestratorConfig, _workspaceRoot?: string) => orchestrator,
    );

  type MainEvent =
    | 'SIGTERM'
    | 'SIGINT'
    | 'uncaughtException'
    | 'unhandledRejection';

  const listenersFor = (event: MainEvent) => {
    switch (event) {
      case 'SIGTERM':
        return process.listeners('SIGTERM');
      case 'SIGINT':
        return process.listeners('SIGINT');
      case 'uncaughtException':
        return process.listeners('uncaughtException');
      case 'unhandledRejection':
        return process.listeners('unhandledRejection');
    }
  };

  const invokeLatestListener = (
    event: MainEvent,
    args: readonly unknown[],
  ): unknown => {
    const listener = listenersFor(event).at(-1);
    if (listener === undefined) {
      throw new Error(`Missing ${event} listener`);
    }
    return Reflect.apply(listener, process, args);
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
  });

  afterEach(async () => {
    for (const lifecycle of lifecycles.splice(0)) {
      await lifecycle.dispose();
    }
    delete process.env.LSP_BOOTSTRAP;
  });

  it('uses shared orchestrator for rpc and mcp channels', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: {},
    });

    const orchestrator = createOrchestratorDouble();
    const setupRpcChannel = createSetupRpcChannelDouble();
    const createMcpChannel = createMcpChannelDouble();
    const createOrchestrator = createOrchestratorFactory(orchestrator);

    await runMain({
      createOrchestrator,
      setupRpcChannel,
      createMcpChannel,
      createRpcConnection,
    });

    expect(createOrchestrator.mock.calls[0]?.[0]).toMatchObject({
      servers: expect.arrayContaining([expect.objectContaining({ id: 'ts' })]),
    });
    expect(setupRpcChannel).toHaveBeenCalledTimes(1);
    expect(setupRpcChannel.mock.calls[0]?.[1]).toBe(orchestrator);
    expect(createMcpChannel).toHaveBeenCalledTimes(1);
    expect(createMcpChannel.mock.calls[0]?.[0]).toBe(orchestrator);
  });

  it('passes explicit bootstrap servers to the orchestrator without adding builtins', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: {
        navigationTools: false,
        servers: [{ id: 'tsserver', command: 'typescript-language-server' }],
      },
    });

    const orchestrator = createOrchestratorDouble();
    const createOrchestrator = createOrchestratorFactory(orchestrator);

    await runMain({
      createOrchestrator,
      setupRpcChannel: createSetupRpcChannelDouble(),
      createMcpChannel: createMcpChannelDouble(),
      createRpcConnection,
    });

    expect(createOrchestrator).toHaveBeenCalledTimes(1);
    const config = createOrchestrator.mock.calls[0]?.[0];
    expect(config?.servers).toEqual([
      {
        id: 'tsserver',
        command: 'typescript-language-server',
        extensions: [],
      },
    ]);
  });

  it('navigationTools false skips mcp', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { navigationTools: false },
    });

    const createMcpChannel = vi.fn();

    await runMain({
      createOrchestrator: createOrchestratorFactory(createOrchestratorDouble()),
      setupRpcChannel: createSetupRpcChannelDouble(),
      createMcpChannel,
      createRpcConnection,
    });

    expect(createMcpChannel).not.toHaveBeenCalled();
  });

  it('SIGTERM handler calls orchestrator.shutdown and exits 0', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { navigationTools: false },
    });

    const orchestrator = createOrchestratorDouble();

    await runMain({
      createOrchestrator: createOrchestratorFactory(orchestrator),
      setupRpcChannel: createSetupRpcChannelDouble(),
      createMcpChannel: createMcpChannelDouble(),
      createRpcConnection,
    });

    const cleanupPromise = invokeLatestListener('SIGTERM', []);
    expect(cleanupPromise).toBeInstanceOf(Promise);
    await Promise.resolve(cleanupPromise);

    expect(orchestrator.shutdown).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('sends lsp/ready notification', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { navigationTools: false },
    });

    const connection = createRpcConnectionDouble();

    await runMain({
      createOrchestrator: createOrchestratorFactory(createOrchestratorDouble()),
      setupRpcChannel: createSetupRpcChannelDouble(),
      createMcpChannel: createMcpChannelDouble(),
      createRpcConnection: () => connection,
    });

    expect(connection.sendNotification).toHaveBeenCalledWith('lsp/ready');
  });

  it('disposal restores process listener counts', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { navigationTools: false },
    });
    const events: readonly MainEvent[] = [
      'SIGTERM',
      'SIGINT',
      'uncaughtException',
      'unhandledRejection',
    ];
    const baseline = events.map((event) => process.listenerCount(event));

    const lifecycle = await runMain({
      createOrchestrator: createOrchestratorFactory(createOrchestratorDouble()),
      setupRpcChannel: createSetupRpcChannelDouble(),
      createMcpChannel: createMcpChannelDouble(),
      createRpcConnection,
    });
    await lifecycle.dispose();

    expect(events.map((event) => process.listenerCount(event))).toEqual(
      baseline,
    );
  });

  it('dispose awaits orchestrator.shutdown, mcpServer.close, and rpcConnection.dispose', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: {},
    });

    const orchestratorShutdown = vi.fn().mockResolvedValue(undefined);
    const mcpClose = vi.fn().mockResolvedValue(undefined);
    const rpcDispose = vi.fn();

    const lifecycle = await runMain({
      createOrchestrator: createOrchestratorFactory(
        createOrchestratorDouble(orchestratorShutdown),
      ),
      setupRpcChannel: createSetupRpcChannelDouble(),
      createMcpChannel: createMcpChannelDouble(mcpClose),
      createRpcConnection: () => createRpcConnectionDouble(rpcDispose),
    });
    await lifecycle.dispose();

    expect(orchestratorShutdown).toHaveBeenCalledTimes(1);
    expect(mcpClose).toHaveBeenCalledTimes(1);
    expect(rpcDispose).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('dispose is idempotent — repeated calls execute resource disposal exactly once', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: {},
    });

    const orchestratorShutdown = vi.fn().mockResolvedValue(undefined);
    const mcpClose = vi.fn().mockResolvedValue(undefined);
    const rpcDispose = vi.fn();

    const lifecycle = await runMain({
      createOrchestrator: createOrchestratorFactory(
        createOrchestratorDouble(orchestratorShutdown),
      ),
      setupRpcChannel: createSetupRpcChannelDouble(),
      createMcpChannel: createMcpChannelDouble(mcpClose),
      createRpcConnection: () => createRpcConnectionDouble(rpcDispose),
    });

    await Promise.all([lifecycle.dispose(), lifecycle.dispose()]);
    await lifecycle.dispose();

    expect(orchestratorShutdown).toHaveBeenCalledTimes(1);
    expect(mcpClose).toHaveBeenCalledTimes(1);
    expect(rpcDispose).toHaveBeenCalledTimes(1);
  });

  it('dispose does not call process.exit', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { navigationTools: false },
    });

    const lifecycle = await runMain({
      createOrchestrator: createOrchestratorFactory(createOrchestratorDouble()),
      setupRpcChannel: createSetupRpcChannelDouble(),
      createMcpChannel: createMcpChannelDouble(),
      createRpcConnection,
    });
    await lifecycle.dispose();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('SIGINT handler cleans up and exits 0', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { navigationTools: false },
    });

    const orchestrator = createOrchestratorDouble();

    await runMain({
      createOrchestrator: createOrchestratorFactory(orchestrator),
      setupRpcChannel: createSetupRpcChannelDouble(),
      createMcpChannel: createMcpChannelDouble(),
      createRpcConnection,
    });

    const cleanupPromise = invokeLatestListener('SIGINT', []);
    expect(cleanupPromise).toBeInstanceOf(Promise);
    await Promise.resolve(cleanupPromise);

    expect(orchestrator.shutdown).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('uncaughtException handler logs, cleans up, and exits 1', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { navigationTools: false },
    });

    const orchestrator = createOrchestratorDouble();
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    await runMain({
      createOrchestrator: createOrchestratorFactory(orchestrator),
      setupRpcChannel: createSetupRpcChannelDouble(),
      createMcpChannel: createMcpChannelDouble(),
      createRpcConnection,
    });

    const cleanupPromise = invokeLatestListener('uncaughtException', [
      new Error('boom'),
    ]);
    expect(cleanupPromise).toBeInstanceOf(Promise);
    await Promise.resolve(cleanupPromise);

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Uncaught exception in LSP service'),
    );
    expect(orchestrator.shutdown).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('unhandledRejection handler logs, cleans up, and exits 1', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { navigationTools: false },
    });

    const orchestrator = createOrchestratorDouble();
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    await runMain({
      createOrchestrator: createOrchestratorFactory(orchestrator),
      setupRpcChannel: createSetupRpcChannelDouble(),
      createMcpChannel: createMcpChannelDouble(),
      createRpcConnection,
    });

    const cleanupPromise = invokeLatestListener('unhandledRejection', [
      'rejected',
    ]);
    expect(cleanupPromise).toBeInstanceOf(Promise);
    await Promise.resolve(cleanupPromise);

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled rejection in LSP service'),
    );
    expect(orchestrator.shutdown).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('signal handler cleanup promise resolves before exit is called', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { navigationTools: false },
    });

    let resolveShutdown: () => void = () => {};
    const orchestrator = createOrchestratorDouble(
      () =>
        new Promise<void>((resolve) => {
          resolveShutdown = resolve;
        }),
    );

    await runMain({
      createOrchestrator: createOrchestratorFactory(orchestrator),
      setupRpcChannel: createSetupRpcChannelDouble(),
      createMcpChannel: createMcpChannelDouble(),
      createRpcConnection,
    });

    const cleanupPromise = invokeLatestListener('SIGTERM', []);
    expect(exitSpy).not.toHaveBeenCalled();

    resolveShutdown();
    await Promise.resolve(cleanupPromise);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('sendNotification failure cleans up resources and rethrows the same error', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: {},
    });

    const orchestratorShutdown = vi.fn().mockResolvedValue(undefined);
    const mcpClose = vi.fn().mockResolvedValue(undefined);
    const rpcDispose = vi.fn();
    const startupError = new Error('sendNotification failed');

    const events: readonly MainEvent[] = [
      'SIGTERM',
      'SIGINT',
      'uncaughtException',
      'unhandledRejection',
    ];
    const baseline = events.map((event) => process.listenerCount(event));
    const connection = createRpcConnectionDouble(rpcDispose);
    vi.spyOn(connection, 'sendNotification').mockImplementation(() => {
      throw startupError;
    });

    await expect(
      main({
        createOrchestrator: createOrchestratorFactory(
          createOrchestratorDouble(orchestratorShutdown),
        ),
        setupRpcChannel: createSetupRpcChannelDouble(),
        createMcpChannel: createMcpChannelDouble(mcpClose),
        createRpcConnection: () => connection,
      }),
    ).rejects.toBe(startupError);

    expect(orchestratorShutdown).toHaveBeenCalledTimes(1);
    expect(mcpClose).toHaveBeenCalledTimes(1);
    expect(rpcDispose).toHaveBeenCalledTimes(1);
    expect(events.map((event) => process.listenerCount(event))).toEqual(
      baseline,
    );
  });
});

describe('toServerRegistryEntries conversion', () => {
  const loadMain = async () => import('../src/main.js');

  it('converts a validated user server config into a ServerRegistryEntry with displayName', async () => {
    const mod = await loadMain();
    const entries = mod.toServerRegistryEntries([
      {
        id: 'custom-ts',
        command: 'typescript-language-server',
        extensions: ['.ts'],
      },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe('custom-ts');
    expect(entries[0]?.displayName).toBe('custom-ts');
    expect(entries[0]?.command).toBe('typescript-language-server');
    expect(entries[0]?.extensions).toEqual(['.ts']);
  });

  it('produces entries that mergeUserConfig accepts without casts', async () => {
    const { mergeUserConfig, getBuiltinServers } = await import(
      '../src/service/server-registry.js'
    );
    const mod = await loadMain();
    const builtins = getBuiltinServers();
    const entries = mod.toServerRegistryEntries(
      [
        {
          id: 'ts',
          command: 'override-ts',
          args: ['--stdio'],
          extensions: ['.ts'],
        },
      ],
      builtins,
    );

    const merged = mergeUserConfig(builtins, entries);
    const tsEntry = merged.find((e) => e.id === 'ts');
    expect(tsEntry?.command).toBe('override-ts');
    expect(tsEntry?.args).toEqual(['--stdio']);
  });

  it('carries args through conversion as a readonly array', async () => {
    const mod = await loadMain();
    const entries = mod.toServerRegistryEntries([
      {
        id: 'with-args',
        command: 'langserver',
        args: ['--stdio', '--verbose'],
        extensions: ['.js'],
      },
    ]);

    expect(entries[0]?.args).toEqual(['--stdio', '--verbose']);
  });

  it('inherits builtin displayName and extensions for partial builtin overrides', async () => {
    const { getBuiltinServers } = await import(
      '../src/service/server-registry.js'
    );
    const mod = await loadMain();
    const entries = mod.toServerRegistryEntries(
      [{ id: 'ts', command: 'custom-typescript-language-server' }],
      getBuiltinServers(),
    );

    expect(entries[0]?.displayName).toBe('TypeScript Language Server');
    expect(entries[0]?.extensions).toEqual(['.ts', '.tsx', '.js', '.jsx']);
  });

  it('returns an empty array for undefined input', async () => {
    const mod = await loadMain();
    expect(mod.toServerRegistryEntries(undefined)).toEqual([]);
  });
});
