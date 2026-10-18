import {
  RuntimePolicyOwner,
  SessionPolicyOwner,
} from '@vybestack/llxprt-code-core/policy/policy-owner.js';
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
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
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
import {
  injectConfirmationForcingPolicy,
  CONFIRMATION_FORCING_SOURCE,
} from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { AgentConfig } from '../config-types.js';
import { PolicyDecision } from '@vybestack/llxprt-code-policy';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { Agent, AgentToolHandle } from '../agent.js';
import { fromConfig } from '../fromConfig.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const evidence = join(tmpdir(), 'llxprt-mcp-approval-isolation-repro');

const fixture = fileURLToPath(
  new URL('./helpers/mcp-approval-stdio-fixture.ts', import.meta.url),
);

function tool(agent: Agent, server: string, name: string): AgentToolHandle {
  const info = agent.tools
    .list()
    .find((entry) => entry.server === server && entry.serverToolName === name);
  expect(info).toBeDefined();
  if (!info) throw new Error('Discovered tool missing');
  const handle = agent.tools.get(info.name);
  expect(handle?.source).toBe('mcp');
  if (!handle) throw new Error('Public tool handle missing');
  return handle;
}

async function confirm(
  details: unknown,
  outcome: ToolConfirmationOutcome,
): Promise<void> {
  if (
    typeof details !== 'object' ||
    details === null ||
    !('onConfirm' in details) ||
    typeof details.onConfirm !== 'function'
  )
    throw new Error('Public confirmation result has no onConfirm callback');
  await details.onConfirm(outcome);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
      return false;
    throw error;
  }
}

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
describe('MCP public tool approval owner isolation', () => {
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
  const ownerCCredentials = useOwnedCredentials();

  for (const outcome of [
    ToolConfirmationOutcome.ProceedAlwaysTool,
    ToolConfirmationOutcome.ProceedAlwaysServer,
  ]) {
    it(`keeps B confirmation required after A chooses ${outcome}`, async () => {
      await mkdir(evidence, { recursive: true });
      const directory = await mkdtemp(join(evidence, 'runtime-'));
      const server = `approval_${randomUUID().replaceAll('-', '')}`;
      const ownerCloses: Array<() => Promise<void>> = [];
      const workspaceOwners: McpRuntimeOwner[] = [];
      const callerConfigs: Config[] = [];
      const callerPolicies: RuntimePolicyOwner[] = [];
      const agents: Agent[] = [];
      const pids: number[] = [];
      const signal = new AbortController().signal;
      async function openCaller(name: string): Promise<void> {
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
          policy: { defaultDecision: PolicyDecision.ASK_USER },
          telemetry: { enabled: false },
          recording: { enabled: false },
          mcpServers: {
            [server]: {
              command: process.execPath,
              args: [fixture, join(cwd, 'server.pid')],
              trust: false,
            },
          },
        };
        const builtCallerSelection: AgentConfig = {
          provider: 'fake',
          model: 'fake-model',
          sessionId: randomUUID(),
          ...builtCallerOverrides,
          workingDir: await callerWorkingDirectory(
            builtCallerOverrides.workingDir,
            builtCallerDirectory,
          ),
        };
        const builtCallerParameters = {
          ...toConfigParameters(builtCallerSelection),
          ...{},
        };
        builtCallerParameters.interactive = true;

        builtCallerParameters.includeDirectories = includeCallerCwd(
          builtCallerParameters.includeDirectories,
        );
        const builtCallerConfig = new Config(builtCallerParameters);
        const builtCallerFactories = {
          ...createAgentRuntimeFactoryBindings(),
          ...{},
        };
        const builtCallerSettings = new SettingsService();
        seedCallerSettings(builtCallerConfig, builtCallerSettings);
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
        acquireCallerFileScopes(
          builtCallerRelease,
          builtCallerFiles,
          builtCallerRuntimeId,
          builtCallerConfig.getSessionId(),
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
        const builtCallerTokenizer =
          configureProviderTokenizer(builtCallerManager);
        const builtCallerContent = createRuntimeContentGeneratorFactory();
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
          undefined,
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
        builtCallerOwner.bindProviderFiles(
          builtCallerFiles,
          builtCallerOAuth.composeRetryOperations.bind(builtCallerOAuth),
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
        const initializeBuiltCaller = async (): Promise<void> => {
          try {
            await preparePreferredProviderCompletion(
              builtCallerConfig,
              builtCallerSettings,
              builtCallerSettingsOwner,
              builtCallerManager,
              builtCallerOAuth,
              builtCallerRuntimeId,
              builtCallerTokenizer,
              undefined,
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
        };
        await initializeBuiltCaller();

        ownerCloses.push(builtCallerClose);
        workspaceOwners.push(builtCallerMcp);
        callerConfigs.push(builtCallerConfig);
        callerPolicies.push(builtCallerPolicy);
        expect(Array.from(await builtCallerMcp.awaitDiscovery())).toStrictEqual(
          [],
        );
        pids.push(Number(await readFile(join(cwd, 'server.pid'), 'utf8')));
        builtCallerMcp.policyOwner.session.confirmation.removeRulesBySource(
          CONFIRMATION_FORCING_SOURCE,
        );
        const agent = await fromConfig(
          builtCallerConfig,
          builtCallerSettings,
          { mcpOwnership: 'caller' },
          builtCallerSettingsOwner,
          builtCallerManager,
          undefined,
          builtCallerPolicy.session.messageBus,
          builtCallerMcp,
          undefined,
          builtCallerOwner.getAgentClient(),
          undefined,
          undefined,
          undefined,
          builtCallerFactories,
        );

        agents.push(agent);
        expect(agent.policy.getDefaultDecision()).toBe(PolicyDecision.ASK_USER);
        const discovered = agent.tools
          .list()
          .filter((entry) => entry.server === server);
        expect(
          discovered.map((entry) => entry.serverToolName).sort(),
        ).toStrictEqual(['increment', 'other']);
        const decisions = discovered.map((entry) => {
          const qualifiedName = `${entry.server}__${entry.serverToolName}`;
          const decision =
            builtCallerMcp.policyOwner.session.decisions.evaluate(
              qualifiedName,
              {},
              entry.server,
            );
          expect(decision).toBe(PolicyDecision.ASK_USER);
          return { qualifiedName, decision };
        });
        await writeFile(
          join(evidence, `${outcome}-${name}-policy-baseline.json`),
          JSON.stringify(decisions, null, 2),
        );
      }
      try {
        for (const name of ['A', 'B']) await openCaller(name);
        const [agentA, agentB] = agents;
        const a = tool(agentA, server, 'increment');
        const b = tool(agentB, server, 'increment');
        const baselineA = await a.build({}).shouldConfirmExecute(signal);
        const baselineB = await b.build({}).shouldConfirmExecute(signal);
        const expected = {
          type: 'mcp',
          serverName: server,
          toolName: 'increment',
        };
        expect(baselineA).toMatchObject(expected);
        expect(baselineB).toMatchObject(expected);
        await writeFile(
          join(evidence, `${outcome}-baseline.json`),
          JSON.stringify({ a: baselineA, b: baselineB }, null, 2),
        );
        await confirm(baselineA, outcome);
        expect(await a.build({}).shouldConfirmExecute(signal)).toBe(false);
        expect(await a.build({}).execute(signal)).toMatchObject({
          llmContent: [{ text: '1' }],
          returnDisplay: '1',
        });
        const sameOwnerOther = await tool(agentA, server, 'other')
          .build({})
          .shouldConfirmExecute(signal);
        const otherConfirmation = expect.objectContaining({
          type: 'mcp',
          toolName: 'other',
        });
        expect(sameOwnerOther).toStrictEqual(
          outcome === ToolConfirmationOutcome.ProceedAlwaysServer
            ? false
            : otherConfirmation,
        );
        const afterB = await b.build({}).shouldConfirmExecute(signal);
        await writeFile(
          join(evidence, `${outcome}-after.json`),
          JSON.stringify({ b: afterB, sameOwnerOther }, null, 2),
        );
        expect(afterB).toMatchObject(expected);
        const ownerA = workspaceOwners[0];
        expect(
          ownerA.policyOwner.session.decisions.evaluate(
            `${server}__increment`,
            {},
            server,
          ),
        ).toBe(PolicyDecision.ALLOW);
        await ownerA.refresh(server);
        await ownerA.awaitDiscovery();
        pids.push(
          Number(await readFile(join(directory, 'A', 'server.pid'), 'utf8')),
        );
        expect(
          await tool(agentA, server, 'increment')
            .build({})
            .shouldConfirmExecute(signal),
        ).toBe(false);
        expect(
          await tool(agentA, server, 'other')
            .build({})
            .shouldConfirmExecute(signal),
        ).toStrictEqual(
          outcome === ToolConfirmationOutcome.ProceedAlwaysServer
            ? false
            : otherConfirmation,
        );
        expect(await b.build({}).shouldConfirmExecute(signal)).toMatchObject(
          expected,
        );
        await agentA.dispose();
        expect(
          await tool(agentB, server, 'increment')
            .build({})
            .shouldConfirmExecute(signal),
        ).toMatchObject(expected);
        expect(
          ownerA.policyOwner.session.decisions.evaluate(
            `${server}__increment`,
            {},
            server,
          ),
        ).toBe(PolicyDecision.ALLOW);
        await ownerA.dispose();
        const fresh = new SessionPolicyOwner(
          callerPolicies[1].workspace,
          callerConfigs[0],
        );
        try {
          expect(
            fresh.decisions.evaluate(`${server}__increment`, {}, server),
          ).toBe(PolicyDecision.ASK_USER);
        } finally {
          await fresh.dispose();
        }
        expect(() =>
          ownerA.policyOwner.session.decisions.evaluate(
            `${server}__increment`,
            {},
            server,
          ),
        ).toThrow('Session policy is disposed');
        await expect(confirm(baselineA, outcome)).rejects.toThrow(
          /Tool dispatch admission is closed/,
        );
        expect(() =>
          ownerA.policyOwner.session.decisions.evaluate(
            `${server}__increment`,
            {},
            server,
          ),
        ).toThrow('Session policy is disposed');
        const cwd = join(directory, 'C');
        await mkdir(cwd);

        const ownerCCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
        process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
          new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
        );
        const ownerCCallerDirectory = await realpath(
          await mkdtemp(join(tmpdir(), 'explicit-caller-')),
        );
        const ownerCCallerOverrides: Readonly<Partial<AgentConfig>> = {
          workingDir: cwd,
          folderTrust: true,
          coreTools: [],
          policy: { defaultDecision: PolicyDecision.ASK_USER },
          telemetry: { enabled: false },
          recording: { enabled: false },
          mcpServers: {
            [server]: {
              command: process.execPath,
              args: [fixture, join(cwd, 'server.pid')],
              trust: false,
            },
          },
        };
        const ownerCCallerSelection: AgentConfig = {
          provider: 'fake',
          model: 'fake-model',
          sessionId: randomUUID(),
          ...ownerCCallerOverrides,
          workingDir: await callerWorkingDirectory(
            ownerCCallerOverrides.workingDir,
            ownerCCallerDirectory,
          ),
        };
        const ownerCCallerParameters = {
          ...toConfigParameters(ownerCCallerSelection),
          ...{},
        };
        ownerCCallerParameters.interactive = true;

        ownerCCallerParameters.includeDirectories = includeCallerCwd(
          ownerCCallerParameters.includeDirectories,
        );
        const ownerCCallerConfig = new Config(ownerCCallerParameters);
        const ownerCCallerFactories = {
          ...createAgentRuntimeFactoryBindings(),
          ...{},
        };
        const ownerCCallerSettings = new SettingsService();
        seedCallerSettings(ownerCCallerConfig, ownerCCallerSettings);
        const ownerCCallerPolicy = new RuntimePolicyOwner(ownerCCallerConfig);
        injectConfirmationForcingPolicy(
          ownerCCallerPolicy.session.confirmation,
        );
        const ownerCCallerMcp = await buildTestMcpRuntime(
          ownerCCallerConfig,
          ownerCCallerPolicy.session.messageBus,
          ownerCCallerOverrides,
          undefined,
          ownerCCallerPolicy,
          undefined,
        );
        const ownerCCallerRuntimeId = 'caller-' + randomUUID();
        const ownerCCallerRelease = new AcquisitionRelease();
        const ownerCCallerSettingsOwner = new SessionSettingsOwner(
          ownerCCallerSettings,
        );
        ownerCCallerRelease.acquire('settings', () =>
          ownerCCallerSettingsOwner.dispose(),
        );
        ownerCCallerSettingsOwner.initializeProviderSelection(
          ownerCCallerConfig.getProvider(),
          ownerCCallerConfig.getModel(),
        );
        ownerCCallerSettingsOwner.bindTelemetry(ownerCCallerConfig);
        const ownerCCallerFiles = new ProviderFileLifecycle({
          maxFiles: 100,
          maxBytes: 512 * 1024 * 1024,
        });
        acquireCallerFileScopes(
          ownerCCallerRelease,
          ownerCCallerFiles,
          ownerCCallerRuntimeId,
          ownerCCallerConfig.getSessionId(),
        );
        const ownerCCallerManager = acquirePreferredProviderManager(
          ownerCCallerConfig,
          ownerCCallerSettings,
          ownerCCallerSettingsOwner,
          ownerCCallerFiles,
          ownerCCallerRuntimeId,
          ownerCCredentials().authority,
          ownerCCallerRelease,
        );
        const ownerCCallerTokenizer =
          configureProviderTokenizer(ownerCCallerManager);
        const ownerCCallerContent = createRuntimeContentGeneratorFactory();
        const ownerCCallerOAuth = acquirePreferredOAuth(
          undefined,
          ownerCCallerPolicy.session.messageBus,
          ownerCCallerConfig,
          ownerCCallerSettings,
          ownerCCallerManager,
          ownerCCallerRuntimeId,
          ownerCCallerMcp.profileDefinitions,
          ownerCCredentials().authority,
          ownerCCallerRelease,
          undefined,
        );
        const ownerCCallerMedia = new SessionMediaOwner(
          ownerCCallerConfig.projectTempDir,
          1024 * 1024 * 1024,
        );
        const ownerCCallerOwner = await SessionClientOwner.create(
          ownerCCallerConfig,
          assembleTaskSchemaPolicy(ownerCCallerSettings),
          ownerCCallerManager,
          ownerCCallerFactories.agentClientFactory,
          ownerCCallerMedia.store,
          ownerCCallerMcp.readInstructions,
          ownerCCallerMcp.workspacePaths,
          ownerCCallerSettingsOwner,
          ownerCCallerContent,
          ownerCCallerTokenizer,
        );
        ownerCCallerOwner.bindMcpRuntime(ownerCCallerMcp);
        ownerCCallerOwner.bindProviderFiles(
          ownerCCallerFiles,
          ownerCCallerOAuth.composeRetryOperations.bind(ownerCCallerOAuth),
        );
        ownerCCallerOwner.bindHooks();
        const ownerCCallerClose = settleEngineRelease.bind(
          undefined,
          [
            () => ownerCCallerOwner.dispose(),
            () => ownerCCallerRelease.close(),
            () => ownerCCallerMedia.dispose(),
            () => ownerCCallerMcp.dispose(),
            () => ownerCCallerConfig.dispose(),
            () => rm(ownerCCallerDirectory, { recursive: true, force: true }),
          ],
          ownerCCallerPreviousReplay,
        );
        async function initializeOwnerCCaller(): Promise<void> {
          try {
            await preparePreferredProviderCompletion(
              ownerCCallerConfig,
              ownerCCallerSettings,
              ownerCCallerSettingsOwner,
              ownerCCallerManager,
              ownerCCallerOAuth,
              ownerCCallerRuntimeId,
              ownerCCallerTokenizer,
              undefined,
            );
            await ownerCCallerMcp.initialize();
            const activation = await executeProviderActivation(
              ownerCCallerConfig,
              ownerCCallerSelection.activation ?? {
                provider: ownerCCallerConfig.getProvider(),
                model: ownerCCallerConfig.getModel(),
              },
              assembleProviderSwitch(
                ownerCCallerConfig,
                ownerCCallerSettings,
                ownerCCallerManager,
                ownerCCallerOAuth,
                () => 'agent',
                () => ownerCCallerOwner.refreshAuth(),
                ownerCCallerSettingsOwner,
              ),
              ownerCCallerSettings,
              ownerCCallerManager,
              (method) => ownerCCallerOwner.refreshAuth(method),
              assembleModelSelection(ownerCCallerSettingsOwner),
            );
            requireCallerActivation(activation);
            await ownerCCallerOwner.initializeTools();
            await ownerCCallerOwner.getAgentClient().startChat();
          } catch (primary) {
            await cleanupAfterFailure(primary, ownerCCallerClose);
          }
        }
        await initializeOwnerCCaller();

        ownerCloses.push(ownerCCallerClose);
        expect(
          Array.from(await ownerCCallerMcp.awaitDiscovery()),
        ).toStrictEqual([]);
        pids.push(Number(await readFile(join(cwd, 'server.pid'), 'utf8')));
        ownerCCallerMcp.policyOwner.session.confirmation.removeRulesBySource(
          CONFIRMATION_FORCING_SOURCE,
        );
        const agentC = await fromConfig(
          ownerCCallerConfig,
          ownerCCallerSettings,
          { mcpOwnership: 'caller' },
          ownerCCallerSettingsOwner,
          ownerCCallerManager,
          undefined,
          ownerCCallerPolicy.session.messageBus,
          ownerCCallerMcp,
        );
        try {
          agents.push(agentC);
          expect(
            await tool(agentC, server, 'increment')
              .build({})
              .shouldConfirmExecute(signal),
          ).toMatchObject(expected);
        } finally {
          await agentC.dispose();
        }
      } finally {
        const results = await Promise.allSettled(
          agents.map((a) => a.dispose()),
        );
        results.push(
          ...(await Promise.allSettled(
            [...ownerCloses].reverse().map((close) => close()),
          )),
        );
        const alive = pids.filter(isAlive);
        await writeFile(
          join(evidence, `${outcome}-cleanup.json`),
          JSON.stringify(
            { pids, alive, results },
            (_key, value: unknown) => {
              if (value instanceof AggregateError)
                return { message: value.message, errors: value.errors };
              if (value instanceof Error)
                return { message: value.message, stack: value.stack };
              return value;
            },
            2,
          ),
        );
        await rm(directory, { recursive: true, force: true });
        expect(
          results.filter((result) => result.status === 'rejected'),
        ).toStrictEqual([]);
        expect(alive).toStrictEqual([]);
      }
    });
  }
});

function seedCallerSettings(config: Config, settings: SettingsService): void {
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
}

function acquireCallerFileScopes(
  release: AcquisitionRelease,
  files: ProviderFileLifecycle,
  runtimeId: string,
  sessionId: string,
): void {
  for (const scope of [runtimeId, sessionId])
    release.acquire('files', () => releaseAdoptedFileScope(files, scope));
}

async function callerWorkingDirectory(
  directory: string | undefined,
  fallback: string,
): Promise<string> {
  return directory === undefined ? fallback : realpath(directory);
}

function includeCallerCwd(
  directories: readonly string[] | undefined,
): string[] {
  return [...(directories ?? []), process.cwd()];
}
