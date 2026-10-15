import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import {
  mkdtemp,
  realpath,
  rm,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../core/subagent-cleanup.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { AgentConfig } from '../config-types.js';
import { Agent } from '../agent.js';
import { fromConfig } from '../fromConfig.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const evidence = join(
  tmpdir(),
  'llxprt-mcp-status-owner-implementation-retained',
);
const fixture = fileURLToPath(
  new URL('./helpers/mcp-owner-status-stdio-fixture.ts', import.meta.url),
);

describe('MCP public owner status isolation', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });
  const builtCredentials = useOwnedCredentials();

  it('keeps B connected and usable after stopping A with the same server label', async () => {
    await mkdir(evidence, { recursive: true });
    const directory = await mkdtemp(join(evidence, 'runtime-'));
    const workspaceOwners: McpRuntimeOwner[] = [];
    const ownerCloses: Array<() => Promise<void>> = [];
    const agents: Agent[] = [];
    const pids: number[] = [];
    try {
      for (const name of ['A', 'B']) {
        const cwd = join(directory, name);
        await mkdir(cwd);

        const builtCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
        process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
          new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
        );
        const builtCallerDirectory = await realpath(
          await mkdtemp(join(tmpdir(), 'explicit-caller-')),
        );
        const builtCallerOverrides: Readonly<Partial<AgentConfig>> = {
          workingDir: cwd,
          folderTrust: true,
          coreTools: [],
          telemetry: { enabled: false },
          recording: { enabled: false },
          mcpServers: {
            same: {
              command: process.execPath,
              args: [fixture, join(cwd, 'server.pid')],
            },
          },
        };
        const builtCallerSelection: AgentConfig = {
          provider: 'fake',
          model: 'fake-model',
          sessionId: randomUUID(),
          ...builtCallerOverrides,
          workingDir:
            builtCallerOverrides.workingDir === undefined
              ? builtCallerDirectory
              : await realpath(builtCallerOverrides.workingDir),
        };
        const builtCallerParameters = {
          ...toConfigParameters(builtCallerSelection),
          ...{},
        };
        builtCallerParameters.interactive = true;

        builtCallerParameters.includeDirectories = [
          ...(builtCallerParameters.includeDirectories ?? []),
          process.cwd(),
        ];
        const builtCallerConfig = new Config(builtCallerParameters);
        const builtCallerFactories = {
          ...createAgentRuntimeFactoryBindings(),
          ...{},
        };
        const builtCallerSettings = new SettingsService();
        for (const [key, value] of Object.entries(
          builtCallerConfig.getInitialSettings(),
        ))
          builtCallerSettings.set(key, value);
        const builtCallerPolicy = new RuntimePolicyOwner(builtCallerConfig);
        injectConfirmationForcingPolicy(builtCallerPolicy.session.confirmation);
        const builtCallerMcp = await buildTestMcpRuntime(
          builtCallerConfig,
          builtCallerPolicy.session.messageBus,
          builtCallerOverrides,
          undefined,
          builtCallerPolicy,
          undefined,
        );
        const builtCallerRuntimeId = 'caller-' + randomUUID();
        const builtCallerRelease = new AcquisitionRelease();
        const builtCallerSettingsOwner = new SessionSettingsOwner(
          builtCallerSettings,
        );
        builtCallerRelease.acquire('settings', () =>
          builtCallerSettingsOwner.dispose(),
        );
        builtCallerSettingsOwner.initializeProviderSelection(
          builtCallerConfig.getProvider(),
          builtCallerConfig.getModel(),
        );
        builtCallerSettingsOwner.bindTelemetry(builtCallerConfig);
        const builtCallerFiles = new ProviderFileLifecycle({
          maxFiles: 100,
          maxBytes: 512 * 1024 * 1024,
        });
        for (const scope of [
          builtCallerRuntimeId,
          builtCallerConfig.getSessionId(),
        ])
          builtCallerRelease.acquire('files', () =>
            releaseAdoptedFileScope(builtCallerFiles, scope),
          );
        const builtCallerManager = acquirePreferredProviderManager(
          builtCallerConfig,
          builtCallerSettings,
          builtCallerSettingsOwner,
          builtCallerFiles,
          builtCallerRuntimeId,
          builtCredentials().authority,
          builtCallerRelease,
        );
        const {
          tokenizerFactory: builtCallerTokenizer,
          contentGeneratorFactory: builtCallerContent,
        } = configureProviderRuntimeFactories(
          builtCallerConfig,
          builtCallerManager,
        );
        const builtCallerOAuth = acquirePreferredOAuth(
          undefined,
          builtCallerPolicy.session.messageBus,
          builtCallerConfig,
          builtCallerSettings,
          builtCallerManager,
          builtCallerRuntimeId,
          builtCallerMcp.profileDefinitions,
          builtCredentials().authority,
          builtCallerRelease,
        );
        const builtCallerMedia = new SessionMediaOwner(
          builtCallerConfig.projectTempDir,
          1024 * 1024 * 1024,
        );
        const builtCallerOwner = await SessionClientOwner.create(
          builtCallerConfig,
          assembleTaskSchemaPolicy(builtCallerSettings),
          builtCallerManager,
          builtCallerFactories.agentClientFactory,
          builtCallerMedia.store,
          builtCallerMcp.readInstructions,
          builtCallerMcp.workspacePaths,
          builtCallerSettingsOwner,
          builtCallerContent,
          builtCallerTokenizer,
        );
        builtCallerOwner.bindMcpRuntime(builtCallerMcp);
        builtCallerOwner.bindProviderFiles(builtCallerFiles, (provider) =>
          builtCallerOAuth.composeRetryOperations(provider),
        );
        builtCallerOwner.bindHooks();
        const builtCallerClose = settleEngineRelease.bind(
          undefined,
          [
            () => builtCallerOwner.dispose(),
            () => builtCallerRelease.close(),
            () => builtCallerMedia.dispose(),
            () => builtCallerMcp.dispose(),
            () => builtCallerConfig.dispose(),
            () => rm(builtCallerDirectory, { recursive: true, force: true }),
          ],
          builtCallerPreviousReplay,
        );
        try {
          await preparePreferredProviderCompletion(
            builtCallerConfig,
            builtCallerSettings,
            builtCallerSettingsOwner,
            builtCallerManager,
            builtCallerOAuth,
            builtCallerRuntimeId,
            builtCallerTokenizer,
          );
          await builtCallerMcp.initialize();
          const activation = await executeProviderActivation(
            builtCallerConfig,
            builtCallerSelection.activation ?? {
              provider: builtCallerConfig.getProvider(),
              model: builtCallerConfig.getModel(),
            },
            assembleProviderSwitch(
              builtCallerConfig,
              builtCallerSettings,
              builtCallerManager,
              builtCallerOAuth,
              () => 'agent',
              () => builtCallerOwner.refreshAuth(),
              builtCallerSettingsOwner,
            ),
            builtCallerSettings,
            builtCallerManager,
            (method) => builtCallerOwner.refreshAuth(method),
            assembleModelSelection(builtCallerSettingsOwner),
          );
          requireCallerActivation(activation);
          await builtCallerOwner.initializeTools();
          await builtCallerOwner.getAgentClient().startChat();
        } catch (primary) {
          await cleanupAfterFailure(primary, builtCallerClose);
        }

        workspaceOwners.push(builtCallerMcp);
        ownerCloses.push(builtCallerClose);
        expect(Array.from(await builtCallerMcp.awaitDiscovery())).toStrictEqual(
          [],
        );
        pids.push(Number(await readFile(join(cwd, 'server.pid'), 'utf8')));
        const tools = builtCallerMcp.toolSelection;
        const resources = builtCallerMcp.findResource(
          'same:fixture:///counter',
        );
        const agent = await fromConfig({
          settingsOwner: builtCallerSettingsOwner,
          settingsService: builtCallerSettings,
          agentClient: builtCallerOwner.getAgentClient(),
          providerManager: builtCallerManager,
          runtimeFactoryBindings: builtCallerFactories,
          config: builtCallerConfig,
          mcpRuntime: builtCallerMcp,
          mcpOwnership: 'caller',
          messageBus: builtCallerPolicy.session.messageBus,
        });

        agents.push(agent);
        expect(agent.getMessageBus()).toBe(
          builtCallerPolicy.session.messageBus,
        );
        expect(new Set([builtCallerMcp.toolSelection, tools]).size).toBe(1);
        expect(builtCallerMcp.findResource('same:fixture:///counter')).toBe(
          resources,
        );
      }
      const [a, b] = workspaceOwners;
      const [agentA, agentB] = agents;
      const baseline = {
        a: agentA.mcp.status(),
        b: agentB.mcp.status(),
        resource: await agentB.mcp.readResource('same', 'fixture:///counter'),
      };
      await writeFile(
        join(evidence, 'baseline.json'),
        JSON.stringify(baseline, null, 2),
      );
      expect(baseline.a.servers).toMatchObject([
        { name: 'same', status: 'connected' },
      ]);
      expect(baseline.b.servers).toMatchObject([
        { name: 'same', status: 'connected' },
      ]);
      expect(baseline.resource).toMatchObject({ contents: [{ text: '1' }] });
      const tools = b.toolSelection;
      const resources = b
        .listResources()
        .find(
          (resource) =>
            resource.serverName === 'same' &&
            resource.uri === 'fixture:///counter',
        );
      expect(resources).toMatchObject({
        serverName: 'same',
        uri: 'fixture:///counter',
      });
      const aEvents: unknown[] = [];
      const bEvents: unknown[] = [];
      agentA.mcp.subscribeStatus(() => {
        aEvents.push(agentA.mcp.status());
      });
      const releaseB = agentB.mcp.subscribeStatus(() => {
        bEvents.push(agentB.mcp.status());
      });
      await agentA.dispose();
      expect(a.isStopped()).toBe(false);
      await a.dispose();
      expect(aEvents).toStrictEqual([]);
      expect(bEvents).toStrictEqual([]);
      releaseB();
      const after = {
        list: agentB.mcp.listServers(),
        status: agentB.mcp.status(),
        resource: await agentB.mcp.readResource('same', 'fixture:///counter'),
      };
      await writeFile(
        join(evidence, 'after-stop.json'),
        JSON.stringify(after, null, 2),
      );
      expect(after.resource).toMatchObject({ contents: [{ text: '2' }] });
      expect(new Set([b.toolSelection, tools]).size).toBe(1);
      expect(b.findResource('same:fixture:///counter')).toBe(resources);
      expect(agentB.getMessageBus()).toBe(b.policyOwner.session.messageBus);
      expect(b.isStopped()).toBe(false);
      expect({ list: after.list, status: after.status }).toMatchObject({
        list: [{ name: 'same', status: 'connected' }],
        status: {
          discoveryState: 'ready',
          servers: [{ name: 'same', status: 'connected' }],
        },
      });
      const disconnected = new Promise<void>((resolveDisconnected) => {
        agentB.mcp.subscribeStatus(() => {
          if (
            agentB.mcp
              .listServers()
              .every((server) => server.status === 'disconnected')
          )
            resolveDisconnected();
        });
      });
      process.kill(pids[1], 'SIGTERM');
      await disconnected;
      expect(agentB.mcp.listServers()).toMatchObject([
        { name: 'same', status: 'disconnected' },
      ]);
      expect(bEvents).toStrictEqual([]);
    } finally {
      const results = await Promise.allSettled(
        agents.map((agent) => agent.dispose()),
      );
      results.push(
        ...(await Promise.allSettled(
          [...ownerCloses].reverse().map((close) => close()),
        )),
      );
      const alive = pids.filter((pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'ESRCH'
          )
            return false;
          throw error;
        }
      });
      await writeFile(
        join(evidence, 'cleanup.json'),
        JSON.stringify({ pids, alive, results }, null, 2),
      );
      await rm(directory, { recursive: true, force: true });
      const failures = results.filter((result) => result.status === 'rejected');
      expect(failures).toStrictEqual([]);
      expect(alive).toStrictEqual([]);
    }
  });
});

async function settleEngineRelease(
  steps: ReadonlyArray<() => void | Promise<void>>,
  previousReplay: string | undefined,
): Promise<void> {
  try {
    await runCleanupSteps(steps);
  } finally {
    if (previousReplay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
  }
}

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
