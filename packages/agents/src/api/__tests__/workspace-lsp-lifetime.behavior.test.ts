/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { LspServiceClient } from '@vybestack/llxprt-code-ide-integration';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { fromConfig, type Agent } from '../index.js';
import { buildFactoryLessConfig } from './helpers/buildCliStyleConfig.js';
import { buildAgent } from './helpers/agentHarness.js';
import { WorkspaceLspLifetime } from '../workspace-lsp-lifetime.js';

function workspace() {
  const registry = new ToolRegistry(
    {},
    { requestConfirmation: async () => true },
    { get: () => undefined, getAllGlobalSettings: () => ({}) },
  );
  return {
    registry,
    host: {
      getTargetDir: () => process.cwd(),
      getToolRegistry: () => registry,
      isTrustedFolder: () => true,
    },
  };
}

describe('workspace LSP lifetime', () => {
  afterEach(() => vi.restoreAllMocks());

  it('publishes navigation before the first tool snapshot', async () => {
    const { host, registry } = workspace();
    vi.spyOn(LspServiceClient.prototype, 'start').mockResolvedValue(undefined);
    vi.spyOn(LspServiceClient.prototype, 'isAlive').mockReturnValue(true);
    vi.spyOn(
      LspServiceClient.prototype,
      'getMcpTransportStreams',
    ).mockReturnValue({
      readable: new PassThrough(),
      writable: new PassThrough(),
    });
    vi.spyOn(LspServiceClient.prototype, 'shutdown').mockResolvedValue(
      undefined,
    );
    vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
    vi.spyOn(Client.prototype, 'getServerCapabilities').mockReturnValue({
      tools: {},
    });
    vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
      tools: [{ name: 'lsp_goto_definition', inputSchema: { type: 'object' } }],
    });
    vi.spyOn(Client.prototype, 'close').mockResolvedValue(undefined);
    const lifetime = new WorkspaceLspLifetime({ servers: [] }, host);
    try {
      await lifetime.start();
      expect(
        registry.getFunctionDeclarations().map((tool) => tool.name),
      ).toContain('mcp__lsp-navigation__lsp_goto_definition');
    } finally {
      await lifetime.dispose();
    }
    expect(
      registry.getFunctionDeclarations().map((tool) => tool.name),
    ).not.toContain('mcp__lsp-navigation__lsp_goto_definition');
  });

  it('rolls back partial navigation discovery without publishing a tool', async () => {
    const { host, registry } = workspace();
    vi.spyOn(LspServiceClient.prototype, 'start').mockResolvedValue(undefined);
    vi.spyOn(LspServiceClient.prototype, 'isAlive').mockReturnValue(true);
    vi.spyOn(
      LspServiceClient.prototype,
      'getMcpTransportStreams',
    ).mockReturnValue({
      readable: new PassThrough(),
      writable: new PassThrough(),
    });
    vi.spyOn(LspServiceClient.prototype, 'shutdown').mockResolvedValue(
      undefined,
    );
    vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
    vi.spyOn(Client.prototype, 'getServerCapabilities').mockReturnValue({
      tools: {},
    });
    vi.spyOn(Client.prototype, 'listTools').mockRejectedValue(
      new Error('discovery failed'),
    );
    const close = vi
      .spyOn(Client.prototype, 'close')
      .mockResolvedValue(undefined);
    const lifetime = new WorkspaceLspLifetime({ servers: [] }, host);
    await lifetime.start();
    expect(
      registry
        .getFunctionDeclarations()
        .some((tool) => tool.name?.includes('lsp-navigation') === true),
    ).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
    await lifetime.dispose();
  });

  it('does not construct a client for disabled LSP', async () => {
    const { host } = workspace();
    const start = vi.spyOn(LspServiceClient.prototype, 'start');
    const lifetime = new WorkspaceLspLifetime(undefined, host);
    await lifetime.start();
    expect(lifetime.client()).toBeUndefined();
    expect(start).not.toHaveBeenCalled();
    await lifetime.dispose();
  });

  it('disposes a configured but never-started lifetime before its registry is bound', async () => {
    const lifetime = new WorkspaceLspLifetime(
      { servers: [] },
      {
        getTargetDir: () => process.cwd(),
        getToolRegistry: () => {
          throw new Error('Session registry is not bound');
        },
        isTrustedFolder: () => true,
      },
    );
    await expect(lifetime.dispose()).resolves.toBeUndefined();
  });

  it('releases a client when startup fails instead of losing its handle', async () => {
    const { host } = workspace();
    vi.spyOn(LspServiceClient.prototype, 'start').mockRejectedValue(
      new Error('failed to start'),
    );
    const shutdown = vi
      .spyOn(LspServiceClient.prototype, 'shutdown')
      .mockResolvedValue(undefined);
    const lifetime = new WorkspaceLspLifetime({ servers: [] }, host);
    await lifetime.start();
    expect(lifetime.client()).toBeUndefined();
    expect(shutdown).toHaveBeenCalledTimes(1);
    await lifetime.dispose();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('does not leave a client running when disposal races startup', async () => {
    const { host } = workspace();
    let finishStartup: (() => void) | undefined;
    vi.spyOn(LspServiceClient.prototype, 'start').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishStartup = resolve;
        }),
    );
    vi.spyOn(LspServiceClient.prototype, 'isAlive').mockReturnValue(false);
    const shutdown = vi
      .spyOn(LspServiceClient.prototype, 'shutdown')
      .mockResolvedValue(undefined);
    const lifetime = new WorkspaceLspLifetime({ servers: [] }, host);
    const startup = lifetime.start();
    while (finishStartup === undefined)
      await new Promise((resolve) => setTimeout(resolve, 1));
    const disposal = lifetime.dispose();
    await Promise.resolve();
    expect(shutdown).not.toHaveBeenCalled();
    finishStartup();
    await Promise.all([startup, disposal]);
    expect(lifetime.client()).toBeUndefined();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('closes once when disposal races another disposal', async () => {
    const { host } = workspace();
    vi.spyOn(LspServiceClient.prototype, 'start').mockResolvedValue(undefined);
    vi.spyOn(LspServiceClient.prototype, 'isAlive').mockReturnValue(false);
    let release: (() => void) | undefined;
    const shutdown = vi
      .spyOn(LspServiceClient.prototype, 'shutdown')
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
    const lifetime = new WorkspaceLspLifetime({ servers: [] }, host);
    await lifetime.start();
    const first = lifetime.dispose();
    const second = lifetime.dispose();
    expect(first).toBe(second);
    while (release === undefined)
      await new Promise((resolve) => setTimeout(resolve, 1));
    release();
    await Promise.all([first, second]);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(lifetime.client()).toBeUndefined();
  });

  it('keeps the other session usable when both borrow the same workspace host', async () => {
    const { host } = workspace();
    vi.spyOn(LspServiceClient.prototype, 'start').mockResolvedValue(undefined);
    vi.spyOn(LspServiceClient.prototype, 'isAlive').mockReturnValue(false);
    const shutdown = vi
      .spyOn(LspServiceClient.prototype, 'shutdown')
      .mockResolvedValue(undefined);
    const first = new WorkspaceLspLifetime({ servers: [] }, host);
    const second = new WorkspaceLspLifetime({ servers: [] }, host);
    await first.start();
    await second.start();
    const secondClient = second.client();
    expect(secondClient).toBeDefined();
    expect(first.client()).not.toBe(secondClient);
    await first.dispose();
    expect(second.client()).toBe(secondClient);
    expect(shutdown).toHaveBeenCalledTimes(1);
    await second.dispose();
    expect(shutdown).toHaveBeenCalledTimes(2);
  });
});

describe('agent-owned LSP publication', () => {
  afterEach(() => vi.restoreAllMocks());

  function stubNavigation(): {
    starts: { count: number };
    stops: { count: number };
  } {
    const starts = { count: 0 };
    const stops = { count: 0 };
    vi.spyOn(LspServiceClient.prototype, 'start').mockImplementation(
      async () => {
        starts.count++;
      },
    );
    vi.spyOn(LspServiceClient.prototype, 'isAlive').mockReturnValue(true);
    vi.spyOn(LspServiceClient.prototype, 'status').mockResolvedValue([]);
    vi.spyOn(
      LspServiceClient.prototype,
      'getMcpTransportStreams',
    ).mockReturnValue({
      readable: new PassThrough(),
      writable: new PassThrough(),
    });
    vi.spyOn(LspServiceClient.prototype, 'shutdown').mockImplementation(
      async () => {
        stops.count++;
      },
    );
    vi.spyOn(Client.prototype, 'connect').mockResolvedValue(undefined);
    vi.spyOn(Client.prototype, 'getServerCapabilities').mockReturnValue({
      tools: {},
    });
    vi.spyOn(Client.prototype, 'listTools').mockResolvedValue({
      tools: [{ name: 'lsp_goto_definition', inputSchema: { type: 'object' } }],
    });
    vi.spyOn(Client.prototype, 'close').mockResolvedValue(undefined);
    return { starts, stops };
  }

  it('publishes one client and navigation in the first createAgent view, then releases both', async () => {
    const { starts, stops } = stubNavigation();
    const built = await buildAgent('plain-text.jsonl', { lsp: true });
    try {
      expect(starts.count).toBe(1);
      expect(
        built.agent
          .getToolRegistry()
          .getFunctionDeclarations()
          .map((tool) => tool.name),
      ).toContain('mcp__lsp-navigation__lsp_goto_definition');
      const navigation = built.agent
        .getToolRegistry()
        .getTool('mcp__lsp-navigation__lsp_goto_definition');
      expect(navigation).toBeDefined();
      expect(
        await navigation
          ?.build({})
          .shouldConfirmExecute(new AbortController().signal),
      ).toBe(false);
      expect((await built.agent.lsp.status()).disabled).toBe(false);
    } finally {
      await built.cleanup();
    }
    expect(stops.count).toBe(1);
  }, 30000);

  it('keeps the second borrowed session alive after the first disposes', async () => {
    const { starts, stops } = stubNavigation();
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      {},
      { lsp: true },
    );
    let first: Agent | undefined;
    let second: Agent | undefined;
    try {
      first = await fromConfig({ config: built.config });
      second = await fromConfig({ config: built.config });
      expect(first.getToolRegistry()).not.toBe(second.getToolRegistry());
      expect(starts.count).toBe(2);
      expect(
        second
          .getToolRegistry()
          .getFunctionDeclarations()
          .map((tool) => tool.name),
      ).toContain('mcp__lsp-navigation__lsp_goto_definition');
      await first.dispose();
      expect(stops.count).toBe(1);
      expect((await second.lsp.status()).disabled).toBe(false);
      expect(
        second
          .getToolRegistry()
          .getFunctionDeclarations()
          .map((tool) => tool.name),
      ).toContain('mcp__lsp-navigation__lsp_goto_definition');
      expect(built.config.getToolRegistry()).toBeDefined();
    } finally {
      await first?.dispose();
      await second?.dispose();
      await built.cleanup();
    }
    expect(stops.count).toBe(2);
  }, 30000);

  it('releases the session LSP on partial fromConfig bootstrap without disposing the caller Config', async () => {
    const { starts, stops } = stubNavigation();
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      {},
      { lsp: true },
    );
    try {
      await expect(
        fromConfig({
          config: built.config,
          activation: {
            provider: 'definitely-not-a-registered-provider',
            providerSwitchPolicy: 'strict',
          },
        }),
      ).rejects.toThrow(/fromConfig activation failed/);
      expect(starts.count).toBe(1);
      expect(stops.count).toBe(1);
      expect(built.config.getToolRegistry()).toBeDefined();
    } finally {
      await built.cleanup();
    }
  }, 30000);

  it('does not start a client when the adopted Config has LSP disabled', async () => {
    const { starts } = stubNavigation();
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      {},
      { lsp: false },
    );
    let agent: Agent | undefined;
    try {
      agent = await fromConfig({ config: built.config });
      expect(starts.count).toBe(0);
      expect((await agent.lsp.status()).disabled).toBe(true);
    } finally {
      await agent?.dispose();
      await built.cleanup();
    }
  }, 30000);
});
