/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromConfig } from '../index.js';
import {
  buildCliStyleConfig,
  buildFactoryLessConfig,
  fixturesDir,
} from './helpers/buildCliStyleConfig.js';
import {
  FakeProvider,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import { assembleAgentActivationBootstrap } from '../providerSwitchAssembly.js';

describe('public Agent workspace definition lifetime', () => {
  let root: string;
  const directories: string[] = [];
  let previousHome: string | undefined;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'llxprt-public-definitions-'));
    directories.push(root);
    previousHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = join(root, 'config');
  });
  afterEach(async () => {
    if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousHome;
  });
  afterAll(async () => {
    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it.each([0, 1])(
    'retains physical definitions when borrowed facade %s closes first',
    async (closingIndex) => {
      const caller = await buildCliStyleConfig('multi-turn-text.jsonl', {
        workingDir: root,
        harness: { includeProcessCwd: false, forceConfirmations: false },
      });
      const options = {
        config: caller.config,
        settingsService: caller.settingsService,
        settingsOwner: caller.settingsOwner,
        providerManager: caller.providerManager,
        messageBus: caller.messageBus,
        mcpRuntime: caller.mcpRuntime,
      };
      const first = await fromConfig(options);
      const second = await fromConfig(options);
      const closing = closingIndex === 0 ? first : second;
      const peer = closingIndex === 0 ? second : first;
      try {
        await peer.saveProfileSnapshot('route');
        const definitions = caller.mcpRuntime.workspaceDefinitions;
        await definitions.subagentWrites.saveSubagent(
          'worker',
          'route',
          'Read the workspace',
        );
        const persisted = JSON.parse(
          await readFile(join(root, 'config/profiles/route.json'), 'utf8'),
        );
        expect(Object.keys(persisted.modelParams).sort()).toStrictEqual(
          Object.keys(peer.captureProfile().modelParams).sort(),
        );
        expect(await definitions.subagentReads.listSubagents()).toContain(
          'worker',
        );
        await closing.dispose();
        await expect(closing.saveProfileSnapshot('denied')).rejects.toThrow(
          'closed',
        );
        await peer.saveProfileSnapshot('peer');
        expect(
          (await definitions.profileReads.listProfiles()).sort(),
        ).toStrictEqual(['peer', 'route']);
        await peer.dispose();
        await definitions.subagentWrites.deleteSubagent('worker');
        await definitions.profileWrites.deleteProfile('peer');
        expect(await definitions.profileReads.listProfiles()).toStrictEqual([
          'route',
        ]);
        caller.settingsOwner.assertSettingsIdentity(caller.settingsService);
        expect(caller.agentClient.isInitialized()).toBe(true);
      } finally {
        await first.dispose();
        await second.dispose();
        await caller.cleanup();
      }
    },
    30000,
  );
  it('keeps explicitly borrowed definition directories independent for same-label facades sharing Config', async () => {
    const caller = await buildCliStyleConfig('multi-turn-text.jsonl', {
      workingDir: root,
    });
    const leftRoot = new WorkspaceDefinitionOwner(
      join(root, 'left/profiles'),
      join(root, 'left/subagents'),
    );
    const rightRoot = new WorkspaceDefinitionOwner(
      join(root, 'right/profiles'),
      join(root, 'right/subagents'),
    );
    const options = {
      config: caller.config,
      settingsService: caller.settingsService,
      settingsOwner: caller.settingsOwner,
      providerManager: caller.providerManager,
      messageBus: caller.messageBus,
      mcpRuntime: caller.mcpRuntime,
      sessionId: 'equal-definition-label',
    };
    const left = await fromConfig({
      ...options,
      definitionOwner: leftRoot,
      definitionOwnership: 'caller',
    });
    const right = await fromConfig({
      ...options,
      definitionOwner: rightRoot,
      definitionOwnership: 'caller',
    });
    try {
      await left.saveProfileSnapshot('route');
      await right.saveProfileSnapshot('route');
      await leftRoot.subagentWrites.saveSubagent(
        'left-worker',
        'route',
        'Inspect left',
      );
      await rightRoot.subagentWrites.saveSubagent(
        'right-worker',
        'route',
        'Inspect right',
      );
      expect(
        await left.workspace.subagentDefinitions.listSubagents(),
      ).toStrictEqual(['left-worker']);
      expect(
        await right.workspace.subagentDefinitions.listSubagents(),
      ).toStrictEqual(['right-worker']);
      await left.workspace.profileWrites.deleteProfile('route');
      expect(
        await right.workspace.profileDefinitions.listProfiles(),
      ).toStrictEqual(['route']);
      expect(
        await left.workspace.profileDefinitions.listProfiles(),
      ).toStrictEqual([]);
      await left.dispose();
      await leftRoot.profileWrites.saveProfile(
        'survivor',
        right.captureProfile(),
      );
      expect(await leftRoot.profileReads.listProfiles()).toStrictEqual([
        'survivor',
      ]);
      expect(
        JSON.parse(
          await readFile(join(root, 'right/profiles/route.json'), 'utf8'),
        ).version,
      ).toBe(1);
    } finally {
      await left.dispose();
      await right.dispose();
      await caller.cleanup();
      await leftRoot.dispose();
      await rightRoot.dispose();
    }
  }, 30000);
  it('closes and drains a transferred definition root without retiring the borrowed workspace', async () => {
    const caller = await buildCliStyleConfig('multi-turn-text.jsonl', {
      workingDir: root,
      harness: { includeProcessCwd: false, forceConfirmations: false },
    });
    const definitions = new WorkspaceDefinitionOwner(
      join(root, 'owned/profiles'),
      join(root, 'owned/subagents'),
    );
    const agent = await fromConfig({
      config: caller.config,
      settingsService: caller.settingsService,
      settingsOwner: caller.settingsOwner,
      providerManager: caller.providerManager,
      messageBus: caller.messageBus,
      mcpRuntime: caller.mcpRuntime,
      definitionOwner: definitions,
      definitionOwnership: 'agent',
    });
    await mkdir(join(root, 'owned/profiles'), { recursive: true });
    const fifo = join(root, 'owned/profiles/held.json');
    execFileSync('mkfifo', [fifo]);
    const accepted = agent.workspace.profileDefinitions.loadProfile('held');
    let finished = false;
    const closing = agent.dispose().then(() => {
      finished = true;
    });
    try {
      expect(() => definitions.profileReads.listProfiles()).toThrow('closed');
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(finished).toBe(false);
    } finally {
      await writeFile(fifo, JSON.stringify(agent.captureProfile()));
      await accepted;
      await closing;
    }
    try {
      expect(caller.mcpRuntime.isStopped()).toBe(false);
      await caller.mcpRuntime.profileWrites.saveProfile(
        'survivor',
        agent.captureProfile(),
      );
      expect(
        await caller.mcpRuntime.profileDefinitions.listProfiles(),
      ).toContain('survivor');
    } finally {
      await caller.cleanup();
      await definitions.dispose();
    }
  }, 30000);
  it('retires an explicitly transferred same definition root without stopping its borrowed MCP owner', async () => {
    const caller = await buildCliStyleConfig('multi-turn-text.jsonl', {
      workingDir: root,
    });
    const definitions = caller.mcpRuntime.workspaceDefinitions;
    const agent = await fromConfig({
      config: caller.config,
      settingsService: caller.settingsService,
      settingsOwner: caller.settingsOwner,
      providerManager: caller.providerManager,
      messageBus: caller.messageBus,
      mcpRuntime: caller.mcpRuntime,
      definitionOwner: definitions,
      definitionOwnership: 'agent',
    });
    try {
      await agent.saveProfileSnapshot('transferred');
      await agent.dispose();
      expect(() => definitions.profileReads.listProfiles()).toThrow('closed');
      expect(caller.mcpRuntime.isStopped()).toBe(false);
      expect(
        JSON.parse(
          await readFile(
            join(root, 'config/profiles/transferred.json'),
            'utf8',
          ),
        ).version,
      ).toBe(1);
      caller.settingsOwner.assertSettingsIdentity(caller.settingsService);
    } finally {
      await agent.dispose();
      await caller.cleanup();
    }
  }, 30000);

  it('cleans a transferred definition root when adoption fails before session preparation', async () => {
    const caller = await buildCliStyleConfig('multi-turn-text.jsonl', {
      workingDir: root,
    });
    const definitions = new WorkspaceDefinitionOwner(
      join(root, 'failure/profiles'),
      join(root, 'failure/subagents'),
    );
    try {
      await expect(
        fromConfig({
          config: caller.config,
          settingsService: caller.settingsService,
          settingsOwner: caller.settingsOwner,
          providerManager: caller.providerManager,
          messageBus: caller.messageBus,
          mcpRuntime: caller.mcpRuntime,
          definitionOwner: definitions,
          definitionOwnership: 'agent',
          sessionId: '',
        }),
      ).rejects.toThrow('non-empty');
      expect(() => definitions.profileReads.listProfiles()).toThrow('closed');
      expect(caller.mcpRuntime.isStopped()).toBe(false);
    } finally {
      await definitions.dispose();
      await caller.cleanup();
    }
  }, 30000);
  it('transfers the owned preflight disk root into adoption and retires only its repository lifetime', async () => {
    const caller = await buildFactoryLessConfig(
      'multi-turn-text.jsonl',
      {},
      {
        workingDir: root,
      },
    );
    const manager = new ProviderManager({
      config: caller.config,
      settingsService: caller.settingsService,
    });
    manager.registerProvider(
      new FakeProvider(join(fixturesDir, 'multi-turn-text.jsonl')),
    );
    const operation = assembleAgentActivationBootstrap(
      caller.config,
      caller.settingsService,
      manager,
      null,
      () => undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      caller.settingsOwner,
      'borrowed',
      caller.policyOwner.trust,
    );
    const intent: Parameters<typeof operation.preflight>[0] = {
      provider: 'fake',
      authMode: 'auto',
      cliOverrides: { key: 'preflight-fixture-key' },
    };
    let agent: Awaited<ReturnType<typeof fromConfig>> | undefined;
    try {
      await operation.workspaceDefinitions.profileWrites.saveProfile(
        'owned-preflight',
        {
          version: 1,
          provider: 'fake',
          model: 'owned-preflight-model',
          modelParams: {},
          ephemeralSettings: {},
        },
      );
      const result = await operation.preflight(intent);
      if (!result.token) throw new Error('Missing preflight receipt');
      agent = await fromConfig({
        config: caller.config,
        settingsService: caller.settingsService,
        settingsOwner: caller.settingsOwner,
        providerManager: manager,
        policyOwner: caller.policyOwner,
        messageBus: caller.messageBus,
        activation: intent,
        activationPreflight: { operation, token: result.token },
      });
      await agent.profiles.load('owned-preflight');
      expect(agent.captureProfile().model).toBe('owned-preflight-model');
      await agent.saveProfileSnapshot('owned-adopted');
      await operation.dispose();
      expect(await agent.workspace.profileDefinitions.listProfiles()).toContain(
        'owned-adopted',
      );
      await agent.dispose();
      expect(() =>
        operation.workspaceDefinitions.profileReads.listProfiles(),
      ).toThrow('closed');
      const persisted: unknown = JSON.parse(
        await readFile(
          join(root, 'config/profiles/owned-adopted.json'),
          'utf8',
        ),
      );
      expect(persisted).toMatchObject({
        version: 1,
        model: 'owned-preflight-model',
      });
      caller.settingsOwner.assertSettingsIdentity(caller.settingsService);
    } finally {
      await agent?.dispose();
      await operation.dispose();
      manager.dispose();
      await caller.cleanup();
    }
  }, 30000);

  it('retains the exact borrowed preflight definition root through adoption and Agent disposal', async () => {
    const callerDefinitions = new WorkspaceDefinitionOwner(
      join(root, 'caller/profiles'),
      join(root, 'caller/subagents'),
    );
    const caller = await buildCliStyleConfig('multi-turn-text.jsonl', {
      workingDir: root,
      definitionOwner: callerDefinitions,
      definitionOwnership: 'caller',
    });
    const manager = caller.providerManager;
    const operation = assembleAgentActivationBootstrap(
      caller.config,
      caller.settingsService,
      manager,
      null,
      () => undefined,
      caller.agentClient,
      caller.mcpRuntime,
      caller.mcpRuntime.workspaceFilesystem,
      caller.mcpRuntime.workspaceMemory,
      caller.settingsOwner,
    );
    let agent: Awaited<ReturnType<typeof fromConfig>> | undefined;
    try {
      await operation.workspaceDefinitions.profileWrites.saveProfile(
        'preflight',
        {
          version: 1,
          provider: 'fake',
          model: 'preflight-model',
          modelParams: {},
          ephemeralSettings: {},
        },
      );
      const intent: Parameters<typeof operation.preflight>[0] = {
        provider: 'fake',
        authMode: 'auto',
      };
      const receipt = await operation.preflight(intent);
      if (!receipt.token)
        throw receipt.authError ?? new Error('Missing preflight receipt');
      agent = await fromConfig({
        config: caller.config,
        settingsService: caller.settingsService,
        settingsOwner: caller.settingsOwner,
        providerManager: manager,
        mcpRuntime: caller.mcpRuntime,
        activation: intent,
        activationPreflight: { operation, token: receipt.token },
      });
      await agent.profiles.load('preflight');
      expect(agent.getModel()).toBe('preflight-model');
      await agent.saveProfileSnapshot('after-adoption');
      expect(
        await operation.workspaceDefinitions.profileReads.listProfiles(),
      ).toContain('after-adoption');
      await agent.dispose();
      await operation.workspaceDefinitions.profileWrites.saveProfile(
        'caller-survives',
        {
          version: 1,
          provider: 'fake',
          model: 'fake-model',
          modelParams: {},
          ephemeralSettings: {},
        },
      );
      expect(
        await operation.workspaceDefinitions.profileReads.listProfiles(),
      ).toContain('caller-survives');
    } finally {
      await agent?.dispose();
      await operation.dispose();
      await caller.cleanup();
      await callerDefinitions.dispose();
    }
  }, 30000);

  it('isolates extension catalogues on an explicitly shared disk root and withdraws only the closing workspace', async () => {
    await mkdir(join(root, 'first'), { recursive: true });
    await mkdir(join(root, 'second'), { recursive: true });
    const shared = new WorkspaceDefinitionOwner(
      join(root, 'shared/profiles'),
      join(root, 'shared/subagents'),
    );
    const first = await buildCliStyleConfig('multi-turn-text.jsonl', {
      workingDir: join(root, 'first'),
      definitionOwner: shared,
      definitionOwnership: 'caller',
      harness: { includeProcessCwd: false, forceConfirmations: false },
    });
    const second = await buildCliStyleConfig('multi-turn-text.jsonl', {
      workingDir: join(root, 'second'),
      definitionOwner: shared,
      definitionOwnership: 'caller',
      harness: { includeProcessCwd: false, forceConfirmations: false },
    });
    try {
      await shared.profileWrites.saveProfile('route', {
        version: 1,
        provider: 'fake',
        model: 'definition-model',
        modelParams: {},
        ephemeralSettings: {},
      });
      await shared.subagentWrites.saveSubagent(
        'durable',
        'route',
        'Read shared files',
      );
      await first.mcpRuntime.extensionOperations.load({
        name: 'first-extension',
        version: '1.0',
        path: root,
        isActive: true,
        contextFiles: [],
        subagents: [
          {
            name: 'first-worker',
            profile: 'route',
            systemPrompt: 'First workspace',
          },
        ],
      });
      await second.mcpRuntime.extensionOperations.load({
        name: 'second-extension',
        version: '1.0',
        path: root,
        isActive: true,
        contextFiles: [],
        subagents: [
          {
            name: 'second-worker',
            profile: 'route',
            systemPrompt: 'Second workspace',
          },
        ],
      });
      expect(
        await first.mcpRuntime.subagentDefinitions.listSubagents(),
      ).toStrictEqual(['durable', 'first-worker']);
      expect(
        await second.mcpRuntime.subagentDefinitions.listSubagents(),
      ).toStrictEqual(['durable', 'second-worker']);
      await first.mcpRuntime.trust.setTrustedFolderLive(false);
      expect(
        await first.mcpRuntime.subagentDefinitions.listSubagents(),
      ).toStrictEqual(['durable']);
      expect(
        await second.mcpRuntime.subagentDefinitions.listSubagents(),
      ).toContain('second-worker');
      await first.cleanup();
      expect(
        await second.mcpRuntime.subagentDefinitions.listSubagents(),
      ).toContain('second-worker');
      await second.mcpRuntime.extensionOperations.unload(
        second.mcpRuntime.extensionOperations.list()[0],
      );
      expect(
        await second.mcpRuntime.subagentDefinitions.listSubagents(),
      ).toStrictEqual(['durable']);
      await shared.profileWrites.saveProfile('retained', {
        version: 1,
        provider: 'fake',
        model: 'retained-model',
        modelParams: {},
        ephemeralSettings: {},
      });
      expect(await shared.profileReads.listProfiles()).toContain('retained');
    } finally {
      await first.cleanup();
      await second.cleanup();
      await shared.dispose();
    }
  }, 30000);
});
