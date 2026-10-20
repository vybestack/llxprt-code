import {
  createCapturedSessionOwner,
  capturedSessionClient,
} from './helpers/session-client-capture.js';
import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService, Storage } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm, mkdir, readFile } from 'node:fs/promises';
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
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { beforeAll, afterAll, describe, expect, it, spyOn } from 'bun:test';
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

import fs from 'node:fs/promises';

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
describe('MCP saved approval lifetime', () => {
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
  useOwnedCredentials();

  it('joins an admitted saved approval at owner disposal without restoring session approval', async () => {
    await mkdir(evidence, { recursive: true });
    const directory = await mkdtemp(join(evidence, 'save-runtime-'));
    const server = `save_${randomUUID().replaceAll('-', '')}`;

    const builtCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    const builtCallerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-caller-')),
    );
    const builtCallerOverrides: Readonly<Partial<AgentConfig>> = {
      workingDir: directory,
      folderTrust: true,
      coreTools: [],
      policy: { defaultDecision: PolicyDecision.ASK_USER },
      telemetry: { enabled: false },
      recording: { enabled: false },
      mcpServers: {
        [server]: {
          command: process.execPath,
          args: [fixture, join(directory, 'server.pid')],
          trust: false,
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
    const builtCallerTokenizer = configureProviderTokenizer(builtCallerManager);
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
    const builtCallerOwner = await createCapturedSessionOwner(
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
      await capturedSessionClient(builtCallerOwner).startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, builtCallerClose);
    }

    const policies = join(directory, 'policies');
    const storage = spyOn(Storage, 'getUserPoliciesDir').mockReturnValue(
      policies,
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const admitted = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const rename = fs.rename;
    const saving = spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === join(policies, 'auto-saved.toml')) {
        entered();
        await gate;
      }
      await rename(from, to);
    });
    let agent: Agent | undefined;
    let approval: Promise<void> | undefined;
    let disposal: Promise<void> | undefined;
    try {
      expect(Array.from(await builtCallerMcp.awaitDiscovery())).toStrictEqual(
        [],
      );
      builtCallerMcp.policyOwner.session.confirmation.removeRulesBySource(
        CONFIRMATION_FORCING_SOURCE,
      );
      agent = await fromConfig(
        builtCallerConfig,
        builtCallerSettings,
        { mcpOwnership: 'caller' },
        builtCallerSettingsOwner,
        builtCallerManager,
        undefined,
        builtCallerPolicy.session.messageBus,
        builtCallerMcp,
        undefined,
        capturedSessionClient(builtCallerOwner),
        undefined,
        undefined,
        undefined,
        builtCallerFactories,
      );
      const details = await tool(agent, server, 'increment')
        .build({})
        .shouldConfirmExecute(new AbortController().signal);
      approval = confirm(details, ToolConfirmationOutcome.ProceedAlwaysAndSave);
      await admitted;
      expect(
        builtCallerMcp.policyOwner.session.decisions.evaluate(
          `${server}__increment`,
          {},
          server,
        ),
      ).toBe(PolicyDecision.ALLOW);
      let disposed = false;
      disposal = builtCallerMcp.dispose().then(() => {
        disposed = true;
      });
      expect(() =>
        builtCallerMcp.policyOwner.session.decisions.evaluate(
          `${server}__increment`,
          {},
          server,
        ),
      ).toThrow('Session policy is disposed');
      await expect(
        confirm(details, ToolConfirmationOutcome.ProceedAlwaysAndSave),
      ).rejects.toThrow(/Tool dispatch admission is closed/);
      expect(disposed).toBe(false);
      release();
      await approval;
      await disposal;
      expect(disposed).toBe(true);
      expect(
        await readFile(join(policies, 'auto-saved.toml'), 'utf8'),
      ).toContain('toolName = "increment"');
      expect(() =>
        builtCallerMcp.policyOwner.session.decisions.evaluate(
          `${server}__increment`,
          {},
          server,
        ),
      ).toThrow('Session policy is disposed');
    } finally {
      release();
      await Promise.allSettled([approval, disposal]);
      saving.mockRestore();
      storage.mockRestore();
      await agent?.dispose();
      await builtCallerMcp.dispose();
      await builtCallerConfig.dispose();
      await builtCallerClose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
