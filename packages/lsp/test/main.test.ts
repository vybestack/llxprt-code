/**
 * @plan:PLAN-20250212-LSP.P26
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type BootstrapResult = {
  workspaceRoot: string;
  config: Record<string, unknown>;
};

describe('main bootstrap parsing', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    delete process.env.LSP_BOOTSTRAP;
  });

  const loadMain = async () => import('../src/main.js');

  it('missing LSP_BOOTSTRAP throws and writes stderr', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const mod = await loadMain();

    expect(() => mod.parseBootstrapFromEnv()).toThrowError(
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

    const mod = await loadMain();
    const result = mod.parseBootstrapFromEnv() as BootstrapResult;

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

    const mod = await loadMain();

    expect(() => mod.parseBootstrapFromEnv()).toThrowError(
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

    const mod = await loadMain();

    expect(() => mod.parseBootstrapFromEnv()).toThrowError(
      'LSP_BOOTSTRAP.workspaceRoot must be a non-empty string',
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      'LSP_BOOTSTRAP.workspaceRoot must be a non-empty string\n',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('default config is used when config is absent', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({ workspaceRoot: '/tmp/ws' });

    const mod = await loadMain();
    const result = mod.parseBootstrapFromEnv() as BootstrapResult;

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

    const mod = await loadMain();

    expect(() => mod.parseBootstrapFromEnv()).toThrowError(
      'LSP_BOOTSTRAP.config.diagnosticsTimeoutMs must be a number',
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      'LSP_BOOTSTRAP.config.diagnosticsTimeoutMs must be a number\n',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('main channel wiring', () => {
  let onSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    onSpy = vi.spyOn(process, 'on');
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    delete process.env.LSP_BOOTSTRAP;
  });

  it('uses shared orchestrator for rpc and mcp channels', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: {},
    });

    const orchestrator = { shutdown: vi.fn().mockResolvedValue(undefined) };
    const setupRpcChannel = vi.fn();
    const createMcpChannel = vi
      .fn()
      .mockResolvedValue({ close: vi.fn().mockResolvedValue(undefined) });

    vi.doMock('../src/service/orchestrator.js', () => ({
      createOrchestrator: vi.fn(() => orchestrator),
    }));
    vi.doMock('../src/channels/rpc-channel.js', () => ({ setupRpcChannel }));
    vi.doMock('../src/channels/mcp-channel.js', () => ({ createMcpChannel }));
    vi.doMock('vscode-jsonrpc/node.js', () => ({
      StreamMessageReader: vi.fn(),
      StreamMessageWriter: vi.fn(),
      createMessageConnection: vi.fn(() => ({
        listen: vi.fn(),
        dispose: vi.fn(),
        sendNotification: vi.fn(),
      })),
    }));

    const mod = await import('../src/main.js');
    await mod.main();

    expect(setupRpcChannel).toHaveBeenCalledTimes(1);
    expect(setupRpcChannel.mock.calls[0]?.[1]).toBe(orchestrator);
    expect(createMcpChannel).toHaveBeenCalledTimes(1);
    expect(createMcpChannel.mock.calls[0]?.[0]).toBe(orchestrator);
  });

  it('navigationTools false skips mcp', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { navigationTools: false },
    });

    const createMcpChannel = vi.fn();

    vi.doMock('../src/channels/mcp-channel.js', () => ({ createMcpChannel }));
    vi.doMock('vscode-jsonrpc/node.js', () => ({
      StreamMessageReader: vi.fn(),
      StreamMessageWriter: vi.fn(),
      createMessageConnection: vi.fn(() => ({
        listen: vi.fn(),
        dispose: vi.fn(),
        sendNotification: vi.fn(),
      })),
    }));

    const mod = await import('../src/main.js');
    await mod.main();

    expect(createMcpChannel).not.toHaveBeenCalled();
  });

  it('SIGTERM handler calls orchestrator.shutdown', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { navigationTools: false },
    });

    const orchestrator = { shutdown: vi.fn().mockResolvedValue(undefined) };

    vi.doMock('../src/service/orchestrator.js', () => ({
      createOrchestrator: vi.fn(() => orchestrator),
    }));
    vi.doMock('vscode-jsonrpc/node.js', () => ({
      StreamMessageReader: vi.fn(),
      StreamMessageWriter: vi.fn(),
      createMessageConnection: vi.fn(() => ({
        listen: vi.fn(),
        dispose: vi.fn(),
        sendNotification: vi.fn(),
      })),
    }));

    const mod = await import('../src/main.js');
    await mod.main();

    const sigterm = onSpy.mock.calls.find(
      (call) => call[0] === 'SIGTERM',
    )?.[1] as (() => void) | undefined;
    expect(sigterm).toBeTypeOf('function');

    sigterm?.();
    await Promise.resolve();

    expect(orchestrator.shutdown).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('sends lsp/ready notification', async () => {
    process.env.LSP_BOOTSTRAP = JSON.stringify({
      workspaceRoot: '/tmp/ws',
      config: { navigationTools: false },
    });

    const sendNotification = vi.fn();

    vi.doMock('vscode-jsonrpc/node.js', () => ({
      StreamMessageReader: vi.fn(),
      StreamMessageWriter: vi.fn(),
      createMessageConnection: vi.fn(() => ({
        listen: vi.fn(),
        dispose: vi.fn(),
        sendNotification,
      })),
    }));

    const mod = await import('../src/main.js');
    await mod.main();

    expect(sendNotification).toHaveBeenCalledWith('lsp/ready');
  });
});
