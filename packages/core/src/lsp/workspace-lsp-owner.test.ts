/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Config } from '../config/config.js';
import { WorkspaceToolCatalogOwner } from '../services/workspace-tool-catalog-owner.js';
import { RuntimePolicyOwner } from '../policy/policy-owner.js';
import { initializeParser } from '../utils/shell-parser.js';

import { createMcpApprovalPolicy } from '../policy/mcp-approval.js';
import { LspServiceClient } from '@vybestack/llxprt-code-ide-integration';
import { WorkspaceLspOwner } from './workspace-lsp-owner.js';

const fixture = fileURLToPath(
  new URL('../../../lsp/test/fixtures/fake-lsp-server.ts', import.meta.url),
);

function settings(): {
  servers: Array<{ id: string; command: string; args?: string[] }>;
  navigationTools: boolean;
} {
  return {
    servers: [
      { id: 'ts', command: process.execPath, args: [fixture] },
      { id: 'eslint', command: process.execPath, args: [fixture] },
    ],
    navigationTools: true,
  };
}

describe('WorkspaceLspOwner real process lifetime', () => {
  const roots: WorkspaceLspOwner[] = [];

  const directories: string[] = [];

  const closes: Array<() => void | Promise<void>> = [];

  async function workspace(): Promise<{ directory: string; file: string }> {
    const directory = await mkdtemp(join(tmpdir(), 'workspace-lsp-owner-'));
    directories.push(directory);
    const file = join(directory, 'input.ts');
    await writeFile(file, 'const value = TYPE_ERROR;\n');
    return { directory, file };
  }

  async function activate(
    root: WorkspaceLspOwner,
    directory: string,
  ): Promise<WorkspaceToolCatalogOwner> {
    roots.push(root);
    const config = new Config({
      sessionId: 'same-label',
      targetDir: directory,
      cwd: directory,
      model: 'test',
      debugMode: false,
    });
    closes.push(() => config.dispose());
    const policy = new RuntimePolicyOwner(config);
    closes.push(() => policy.dispose());
    const catalog = new WorkspaceToolCatalogOwner(
      config,
      policy.session.messageBus,
      policy.trust,
    );
    closes.push(() => catalog.dispose());
    await initializeParser();
    await catalog.initialize();
    const approval = createMcpApprovalPolicy(
      {
        ...policy.session.decisions,
        ...policy.session.confirmation,
      },
      async () => {},
      () => {},
    );
    await root.initialize(catalog.publication, approval);
    const health = await root.inspection.read();
    expect(health.reason).toBeUndefined();
    return catalog;
  }

  afterEach(async () => {
    const failures: unknown[] = [];
    const cleanup = [
      ...roots.splice(0).map((root) => () => root.dispose()),
      ...closes.splice(0).reverse(),
      ...directories
        .splice(0)
        .map(
          (directory) => () => rm(directory, { recursive: true, force: true }),
        ),
    ];
    for (const close of cleanup) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'LSP process fixture cleanup failed');
  });
  it('retains the exact LSP startup promise and original publication on repeated initialization', async () => {
    const { directory, file } = await workspace();
    const root = new WorkspaceLspOwner(settings(), directory, () => true);
    roots.push(root);
    const config = new Config({
      sessionId: 'same-label',
      targetDir: directory,
      cwd: directory,
      model: 'test',
      debugMode: false,
    });
    closes.push(() => config.dispose());
    const policy = new RuntimePolicyOwner(config);
    closes.push(() => policy.dispose());
    const catalog = new WorkspaceToolCatalogOwner(
      config,
      policy.session.messageBus,
      policy.trust,
    );
    closes.push(() => catalog.dispose());
    await initializeParser();
    await catalog.initialize();
    const approval = createMcpApprovalPolicy(
      { ...policy.session.decisions, ...policy.session.confirmation },
      async () => {},
      () => {},
    );
    const first = root.initialize(catalog.publication, approval);
    const repeated = root.initialize(catalog.publication, approval);
    expect(repeated).toBe(first);
    await first;
    const published = catalog.selection
      .getAllTools()
      .filter((tool) => tool.name.includes('lsp-navigation'));
    expect(published.length).toBeGreaterThan(0);
    const peerPolicy = new RuntimePolicyOwner(config);
    closes.push(() => peerPolicy.dispose());
    const peerCatalog = new WorkspaceToolCatalogOwner(
      config,
      peerPolicy.session.messageBus,
      peerPolicy.trust,
    );
    closes.push(() => peerCatalog.dispose());
    await peerCatalog.initialize();
    expect(() => root.initialize(peerCatalog.publication, approval)).toThrow(
      'LSP owner requires its original tool registration port',
    );
    expect(
      peerCatalog.selection
        .getAllTools()
        .filter((tool) => published.includes(tool)),
    ).toStrictEqual([]);
    expect(
      catalog.selection
        .getAllTools()
        .filter((tool) => tool.name.includes('lsp-navigation'))
        .map((tool) => tool.name),
    ).toStrictEqual(published.map((tool) => tool.name));
    expect((await root.inspection.read()).alive).toBe(true);
    expect(
      (await root.diagnostics.waitForDiagnostics(file, 5000)).length,
    ).toBeGreaterThan(0);
  });

  it('checks real changed files and isolates independent roots with identical labels', async () => {
    const { directory, file } = await workspace();
    const first = new WorkspaceLspOwner(settings(), directory, () => true);
    const second = new WorkspaceLspOwner(settings(), directory, () => true);
    await activate(first, directory);
    await activate(second, directory);
    const diagnostics = await first.diagnostics.waitForDiagnostics(file, 5000);
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.severity === 'error' && diagnostic.line === 1,
      ),
    ).toBe(true);
    await first.dispose();
    await expect(
      first.diagnostics.waitForDiagnostics(file, 5000),
    ).rejects.toThrow('stopped');
    expect(
      (await second.diagnostics.waitForDiagnostics(file, 5000)).length,
    ).toBeGreaterThan(0);
    await writeFile(file, 'const value = 1;\n');
    expect(
      await second.diagnostics.waitForDiagnostics(file, 5000),
    ).toStrictEqual([]);
  });

  it('withdraws navigation tools and denies retained operations before joining shutdown', async () => {
    const { directory, file } = await workspace();
    const root = new WorkspaceLspOwner(settings(), directory, () => true);
    const config = await activate(root, directory);
    const navigation = config.selection
      .getAllTools()
      .filter(
        (tool) =>
          tool.name.startsWith('lsp_') || tool.name.includes('lsp-navigation'),
      );
    expect(navigation.length).toBeGreaterThan(0);
    const accepted = root.diagnostics.waitForDiagnostics(file, 5000);
    const invocation = navigation[0].build({
      filePath: file,
      line: 1,
      character: 1,
    });
    const closed = root.dispose();
    expect(new Set([root.dispose(), closed]).size).toBe(1);
    expect(
      config.selection.getAllTools().some((tool) => navigation.includes(tool)),
    ).toBe(false);
    await expect(
      invocation.execute(new AbortController().signal),
    ).rejects.toThrow('unavailable');
    await accepted;
    await closed;
  });

  it('does not stop a caller-owned live process when a borrowing root closes', async () => {
    const { directory, file } = await workspace();
    const service = new LspServiceClient(settings(), directory);
    await service.start();
    try {
      const root = new WorkspaceLspOwner(
        settings(),
        directory,
        () => true,
        service,
        'caller',
      );
      await activate(root, directory);
      expect(
        (await root.diagnostics.waitForDiagnostics(file, 5000)).length,
      ).toBeGreaterThan(0);
      await root.dispose();
      expect(service.isAlive()).toBe(true);
      expect((await service.checkFile(file)).length).toBeGreaterThan(0);
    } finally {
      await service.shutdown();
    }
  });

  it('retains the latest diagnostics without returning mutable cache ownership', async () => {
    const { directory, file } = await workspace();
    const root = new WorkspaceLspOwner(settings(), directory, () => true);
    await activate(root, directory);
    await root.diagnostics.waitForDiagnostics(file, 5000);
    const cached = root.diagnostics.getDiagnostics(file);
    expect(cached.length).toBeGreaterThan(0);
    cached.length = 0;
    expect(root.diagnostics.getDiagnostics(file).length).toBeGreaterThan(0);
    await writeFile(file, 'const value = 1;\n');
    await root.diagnostics.waitForDiagnostics(file, 5000);
    expect(root.diagnostics.getDiagnostics(file)).toStrictEqual([]);
  });

  it('closes the owned process after failed navigation publication and preserves its primary failure', async () => {
    const { directory } = await workspace();
    const service = new LspServiceClient(settings(), directory);
    const root = new WorkspaceLspOwner(
      settings(),
      directory,
      () => true,
      service,
      'runtime',
    );
    const config = new Config({
      sessionId: 'same-label',
      targetDir: directory,
      cwd: directory,
      model: 'test',
      debugMode: false,
    });
    closes.push(() => config.dispose());
    const policy = new RuntimePolicyOwner(config);
    closes.push(() => policy.dispose());
    const catalog = new WorkspaceToolCatalogOwner(
      config,
      policy.session.messageBus,
      policy.trust,
    );
    closes.push(() => catalog.dispose());
    await initializeParser();
    await catalog.initialize();
    const registry = catalog.publication;
    const primary = new Error('navigation publication failed');
    const publication = {
      registerTool: registry.registerTool.bind(registry),
      sortTools: () => {
        throw primary;
      },
      removeMcpToolsByServer: registry.removeMcpToolsByServer.bind(registry),
    };
    const approval = createMcpApprovalPolicy(
      {
        ...policy.session.decisions,
        ...policy.session.confirmation,
      },
      async () => {},
      () => {},
    );
    await expect(root.initialize(publication, approval)).rejects.toBe(primary);
    expect(service.isAlive()).toBe(false);
    expect(
      catalog.selection
        .getAllTools()
        .some((tool) => tool.name.includes('lsp-navigation')),
    ).toBe(false);
    await expect(root.dispose()).rejects.toThrow(
      'Workspace LSP disposal failed',
    );
  });

  it('clears cached diagnostics and withdraws retained navigation on actual process loss', async () => {
    const { directory, file } = await workspace();
    const service = new LspServiceClient(settings(), directory);
    const root = new WorkspaceLspOwner(
      settings(),
      directory,
      () => true,
      service,
      'runtime',
    );
    const config = await activate(root, directory);
    await root.diagnostics.waitForDiagnostics(file, 5000);
    const navigation = config.selection
      .getAllTools()
      .filter((tool) => tool.name.includes('lsp-navigation'));
    expect(navigation.length).toBeGreaterThan(0);
    await service.shutdown();
    expect(root.diagnostics.getDiagnostics(file)).toStrictEqual([]);
    expect(
      config.selection.getAllTools().some((tool) => navigation.includes(tool)),
    ).toBe(false);
    expect(() =>
      navigation[0].build({ filePath: file, line: 1, character: 1 }),
    ).toThrow('unavailable');
  });

  it('applies live trust to retained navigation without changing diagnostics admission', async () => {
    const { directory, file } = await workspace();
    let trusted = true;
    const root = new WorkspaceLspOwner(settings(), directory, () => trusted);
    const config = await activate(root, directory);
    const navigation = config.selection
      .getAllTools()
      .filter((tool) => tool.name.includes('lsp-navigation'));
    trusted = false;
    await expect(
      navigation[0]
        .build({ filePath: file, line: 1, character: 1 })
        .execute(new AbortController().signal),
    ).rejects.toThrow('trust');
    expect(
      (await root.diagnostics.waitForDiagnostics(file, 5000)).length,
    ).toBeGreaterThan(0);
    trusted = true;
    expect((await root.inspection.read()).alive).toBe(true);
  });

  it('joins real startup before closing a root disposed during activation', async () => {
    const { directory } = await workspace();
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    class HeldStartClient extends LspServiceClient {
      override async start(): Promise<void> {
        await super.start();
        ready();
        await gate;
      }
    }
    const service = new HeldStartClient(settings(), directory);
    const root = new WorkspaceLspOwner(
      settings(),
      directory,
      () => true,
      service,
      'runtime',
    );
    const activation = activate(root, directory);
    void activation.catch(() => undefined);
    await started;
    expect(service.isAlive()).toBe(true);
    const closing = root.dispose();
    void closing.catch(() => undefined);
    expect(new Set([root.dispose(), closing]).size).toBe(1);
    release();
    await expect(activation).rejects.toThrow('stopped');
    await expect(closing).rejects.toThrow('Workspace LSP disposal failed');
    expect(service.isAlive()).toBe(false);
    roots.splice(roots.indexOf(root), 1);
  });

  it('keeps Config free of LSP service ownership members', async () => {
    const { directory } = await workspace();
    const config = new Config({
      sessionId: 'same-label',
      targetDir: directory,
      cwd: directory,
      model: 'test',
      debugMode: false,
      lsp: settings(),
    });
    expect(
      ['_lspState', 'getLspServiceClient', 'shutdownLspService'].filter(
        (member) => member in config,
      ),
    ).toStrictEqual([]);
  });
});
