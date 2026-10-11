import { Storage } from '@vybestack/llxprt-code-settings';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import type { Agent } from '../agent.js';
import type { FromConfigOptions } from '../config-types.js';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { fromConfig } from '../fromConfig.js';
import {
  ProviderManager,
  FakeProvider,
} from '@vybestack/llxprt-code-providers';
import { buildAgent } from './helpers/agentHarness.js';
import { assembleAgentActivationBootstrap } from '../providerSwitchAssembly.js';
import { buildFactoryLessConfig } from './helpers/buildCliStyleConfig.js';

const cleanups: Array<() => Promise<void>> = [];

async function physicalMemory(): Promise<{
  directory: string;
  file: string;
  memory: WorkspaceMemoryOwner;
}> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'borrowed-memory-')),
  );
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, '.git'));
  const file = join(directory, 'LLXPRT.md');
  await writeFile(file, 'Initial caller instructions.');
  const filesystem = new WorkspaceFilesystemOwner({
    targetDir: directory,
    isTrusted: () => true,
  });
  cleanups.push(() => filesystem.dispose());
  const memory = new WorkspaceMemoryOwner({
    globalMemoryDir: Storage.getGlobalMemoryDir(),
    workingDirectory: directory,
    jitEnabled: false,
    debugMode: false,
    loadIncludes: false,
    filtering: { respectGitIgnore: true, respectLlxprtIgnore: true },
    maxDirectories: 100,
    filenames: ['LLXPRT.md'],
    importFormat: 'tree',
    paths: filesystem.paths,
    ignore: filesystem.ignore,
    scans: filesystem.scans,
    isTrusted: () => true,
    extensions: () => [],
  });
  cleanups.push(() => memory.dispose());
  expect((await memory.operations.refresh()).memoryContent).toContain(
    'Initial caller instructions.',
  );
  return { directory, file, memory };
}

async function factoryless(
  directory: string,
): Promise<Awaited<ReturnType<typeof buildFactoryLessConfig>>> {
  const built = await buildFactoryLessConfig(
    'plain-text.jsonl',
    {},
    {
      workingDir: directory,
      sessionId: 'same-memory-label',
      folderTrust: true,
      mcpEnabled: false,
      skillsSupport: false,
      recording: { enabled: false },
      telemetry: { enabled: false },
      settings: { jitContextEnabled: false },
    },
  );
  cleanups.push(built.cleanup);
  return built;
}

async function preflightWithSuppliedMemory(
  built: Awaited<ReturnType<typeof factoryless>>,
  memory: WorkspaceMemoryOwner,
  memoryOwnership?: 'borrowed' | 'transferred',
) {
  const manager = new ProviderManager({
    settingsService: built.settingsService,
  });
  manager.registerProvider(
    new FakeProvider(join(import.meta.dir, 'fixtures/plain-text.jsonl')),
  );
  const operation = assembleAgentActivationBootstrap(
    built.config,
    built.settingsService,
    manager,
    null,
    () => undefined,
    undefined,
    undefined,
    undefined,
    memory,
    built.settingsOwner,
    'borrowed',
    built.policyOwner.trust,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    memoryOwnership,
  );
  cleanups.push(async () => {
    await operation.dispose();
  });
  const intent = { provider: 'fake', model: 'fake-model' };
  const result = await operation.preflight(intent);
  if (!result.token) throw new Error('Missing actual preflight token');
  return { operation, manager, intent, token: result.token };
}

describe('supplied workspace memory lifetime through public adoption', () => {
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  for (const reverse of [false, true]) {
    it(`keeps the caller and peer refreshing physical memory after facade disposal order ${reverse}`, async () => {
      const { directory, file, memory } = await physicalMemory();
      const facades: Agent[] = [];
      for (const index of [0, 1]) {
        const built = await factoryless(directory);
        const mcp = await McpRuntimeOwner.create(
          createTestOAuthBinding(),
          built.config,
          built.messageBus,
          undefined,
          undefined,
          undefined,
          built.policyOwner,
          'caller',
          undefined,
          undefined,
          undefined,
          undefined,
          { owner: memory },
        );
        cleanups.push(() => mcp.dispose());
        const facade = await fromConfig({
          ...built,
          mcpRuntime: mcp,
          mcpOwnership: 'agent',
        });
        cleanups.push(() => facade.dispose());
        facade.memory.setMemory(`Private facade ${index}`);
        facades.push(facade);
      }
      const first = facades[reverse ? 1 : 0];
      const second = facades[reverse ? 0 : 1];
      expect(facades[1]?.memory.getMemory()).not.toContain('Private facade 0');
      await first.dispose();
      await writeFile(file, 'Caller file after first facade.');
      await memory.operations.refresh();
      expect(memory.operations.snapshot().filePaths).toContain(file);
      await second.memory.refresh();
      expect(second.memory.getMemory()).toContain(
        'Caller file after first facade.',
      );
      await second.dispose();
      await writeFile(file, 'Caller file after both facades.');
      expect((await memory.operations.refresh()).memoryContent).toContain(
        'Caller file after both facades.',
      );
    });
  }

  it('borrows an explicitly supplied public root by default during agent creation', async () => {
    const { directory, file, memory } = await physicalMemory();
    const built = await buildAgent('plain-text.jsonl', {
      workingDir: directory,
      memoryOwner: { owner: memory },
      folderTrust: true,
      skillsSupport: false,
      mcpEnabled: false,
      recording: { enabled: false },
      telemetry: { enabled: false },
      settings: { jitContextEnabled: false },
      harness: { includeProcessCwd: false },
    });
    cleanups.push(built.cleanup);
    await built.agent.dispose();
    await writeFile(file, 'Borrowed after public creation disposal.');
    expect((await memory.operations.refresh()).memoryContent).toContain(
      'Borrowed after public creation disposal.',
    );
  });

  it('transfers supplied memory, closes admission synchronously and joins accepted physical publication', async () => {
    const { directory, file, memory } = await physicalMemory();
    const built = await factoryless(directory);
    const options: FromConfigOptions = {
      ...built,
      memoryOwner: { owner: memory, ownership: 'agent' },
    };
    const facade = await fromConfig(options);
    cleanups.push(() => facade.dispose());
    let enter: () => void = () => {
      throw new Error('Missing publication entry');
    };
    let release: () => void = () => {
      throw new Error('Missing publication release');
    };
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const unsubscribe = memory.operations.subscribe(async (reads) => {
      if (!reads.snapshot().memoryContent.includes('Accepted physical change.'))
        return;
      enter();
      await held;
    });
    await writeFile(file, 'Accepted physical change.');
    const refresh = memory.operations.refresh();
    await entered;
    let closed = false;
    const closing = facade.dispose().then(() => {
      closed = true;
    });
    try {
      expect(() => memory.operations.refresh()).toThrow('disposed');
      await Promise.resolve();
      expect(closed).toBe(false);
    } finally {
      release();
      unsubscribe();
      expect((await refresh).memoryContent).toContain(
        'Accepted physical change.',
      );
      await closing;
    }
    expect(() => memory.operations.snapshot()).toThrow('disposed');
  });

  it('retains the explicit preflight memory transfer through physical refresh and facade retirement', async () => {
    const { directory, file } = await physicalMemory();
    const built = await factoryless(directory);
    const manager = new ProviderManager({
      settingsService: built.settingsService,
    });
    manager.registerProvider(
      new FakeProvider(join(import.meta.dir, 'fixtures/plain-text.jsonl')),
    );
    const operation = assembleAgentActivationBootstrap(
      built.config,
      built.settingsService,
      manager,
      null,
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      built.settingsOwner,
      'borrowed',
      built.policyOwner.trust,
    );
    cleanups.push(async () => {
      await operation.dispose();
    });
    const intent = { provider: 'fake', model: 'fake-model' };
    const result = await operation.preflight(intent);
    expect(result.authFailed).toBe(false);
    if (!result.token) throw new Error('Missing actual preflight token');
    const facade = await fromConfig({
      ...built,
      providerManager: manager,
      activation: intent,
      activationPreflight: { operation, token: result.token },
    });
    cleanups.push(() => facade.dispose());
    await writeFile(file, 'Transferred preflight instructions.');
    await facade.memory.refresh();
    expect(facade.memory.getMemory()).toContain(
      'Transferred preflight instructions.',
    );
    await facade.dispose();
    expect(() => operation.workspaceMemory.operations.refresh()).toThrow(
      'disposed',
    );
    expect(() => operation.workspaceMemory.operations.snapshot()).toThrow(
      'disposed',
    );
  });

  it('rejects replacing preflight memory while preserving the supplied caller root', async () => {
    const { directory, file, memory } = await physicalMemory();
    const built = await factoryless(directory);
    const manager = new ProviderManager({
      settingsService: built.settingsService,
    });
    manager.registerProvider(
      new FakeProvider(join(import.meta.dir, 'fixtures/plain-text.jsonl')),
    );
    const operation = assembleAgentActivationBootstrap(
      built.config,
      built.settingsService,
      manager,
      null,
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      built.settingsOwner,
      'borrowed',
      built.policyOwner.trust,
    );
    cleanups.push(async () => {
      await operation.dispose();
    });
    const intent = { provider: 'fake', model: 'fake-model' };
    const result = await operation.preflight(intent);
    if (!result.token) throw new Error('Missing actual preflight token');
    const adopting = fromConfig({
      ...built,
      providerManager: manager,
      activation: intent,
      activationPreflight: { operation, token: result.token },
      memoryOwner: { owner: memory },
    });
    const outcome = await adopting.then(
      async (facade) => {
        await facade.dispose();
        return undefined;
      },
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome instanceof Error ? outcome.message : '').toContain(
      'Preflight memory ownership cannot be replaced',
    );
    await writeFile(file, 'Caller file after rejected replacement.');
    expect((await memory.operations.refresh()).memoryContent).toContain(
      'Caller file after rejected replacement.',
    );
  });

  it('leaves borrowed memory usable after failed public adoption', async () => {
    const { directory, file, memory } = await physicalMemory();
    const built = await factoryless(directory);
    await expect(
      fromConfig({ ...built, sessionId: '', memoryOwner: { owner: memory } }),
    ).rejects.toThrow('runtimeId');
    expect(built.config.hasInitializationStarted()).toBe(false);
    await writeFile(file, 'Caller file after failed adoption.');
    expect((await memory.operations.refresh()).memoryContent).toContain(
      'Caller file after failed adoption.',
    );
  });

  it('disposes transferred memory after failed public adoption', async () => {
    const { directory, memory } = await physicalMemory();
    const built = await factoryless(directory);
    await expect(
      fromConfig({
        ...built,
        sessionId: '',
        memoryOwner: { owner: memory, ownership: 'agent' },
      }),
    ).rejects.toThrow('runtimeId');
    expect(built.config.hasInitializationStarted()).toBe(false);
    expect(() => memory.operations.refresh()).toThrow('disposed');
    expect(() => memory.operations.snapshot()).toThrow('disposed');
  });
  for (const operationFirst of [false, true]) {
    it(`keeps borrowed memory supplied to activation preflight usable after adopted agent and operation disposal (operation first ${operationFirst})`, async () => {
      const { directory, file, memory } = await physicalMemory();
      const built = await factoryless(directory);
      const { operation, manager, intent, token } =
        await preflightWithSuppliedMemory(built, memory);
      const facade = await fromConfig({
        ...built,
        providerManager: manager,
        activation: intent,
        activationPreflight: { operation, token },
      });
      cleanups.push(() => facade.dispose());
      await writeFile(file, 'Borrowed during adopted preflight.');
      await facade.memory.refresh();
      expect(facade.memory.getMemory()).toContain(
        'Borrowed during adopted preflight.',
      );
      if (operationFirst) {
        await operation.dispose();
        await facade.dispose();
      } else {
        await facade.dispose();
        await operation.dispose();
      }
      await writeFile(file, 'Borrowed after adopted preflight disposal.');
      expect((await memory.operations.refresh()).memoryContent).toContain(
        'Borrowed after adopted preflight disposal.',
      );
    });
  }

  it('keeps borrowed memory supplied to an abandoned activation preflight usable', async () => {
    const { directory, file, memory } = await physicalMemory();
    const built = await factoryless(directory);
    const { operation } = await preflightWithSuppliedMemory(built, memory);
    await operation.dispose();
    await writeFile(file, 'Borrowed after abandoned preflight.');
    expect((await memory.operations.refresh()).memoryContent).toContain(
      'Borrowed after abandoned preflight.',
    );
  });

  it('disposes explicitly transferred preflight memory exactly once across adoption and facade retirement', async () => {
    const { directory, memory } = await physicalMemory();
    const dispose = vi.spyOn(memory, 'dispose');
    const built = await factoryless(directory);
    const { operation, manager, intent, token } =
      await preflightWithSuppliedMemory(built, memory, 'transferred');
    const facade = await fromConfig({
      ...built,
      providerManager: manager,
      activation: intent,
      activationPreflight: { operation, token },
    });
    cleanups.push(() => facade.dispose());
    await facade.dispose();
    await operation.dispose();
    expect(() => memory.operations.refresh()).toThrow('disposed');
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes explicitly transferred preflight memory exactly once when the operation is abandoned', async () => {
    const { directory, memory } = await physicalMemory();
    const dispose = vi.spyOn(memory, 'dispose');
    const built = await factoryless(directory);
    const { operation } = await preflightWithSuppliedMemory(
      built,
      memory,
      'transferred',
    );
    await operation.dispose();
    expect(() => memory.operations.refresh()).toThrow('disposed');
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
