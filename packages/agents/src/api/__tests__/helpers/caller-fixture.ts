/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, beforeEach } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import type { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../../agentConfig.adapter.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../../preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../adoption-release.js';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../core/subagent-cleanup.js';
import type { SessionClientOwner } from '../../../session/session-client-owner.js';
import type { createAgentRuntimeFactoryBindings } from '../../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../../confirmationForcing.js';
import { executeProviderActivation } from '../../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../providerSwitchAssembly.js';
import { assembleModelSelection } from '../../model-selection.js';
import {
  createCapturedSessionOwner,
  capturedSessionClient,
} from './session-client-capture.js';
import { buildTestMcpRuntime } from './mcp-owner-fixture.js';

/**
 * Points the FakeProvider replay seam (LLXPRT_FAKE_RESPONSES) at a fixture for
 * the whole suite. Property cases open a caller per generated value, and a
 * timed-out property keeps running after its test ends, so per-case set and
 * restore calls would overwrite the value the next test depends on. The
 * returned function switches the fixture for one test; every test starts from
 * the default again.
 */
export function useFakeResponsesReplay(
  defaultFixture: string,
): (fixture: string) => void {
  const fixturePath = (fixture: string): string =>
    fileURLToPath(new URL('../fixtures/' + fixture, import.meta.url));
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env.LLXPRT_FAKE_RESPONSES;
  });
  beforeEach(() => {
    process.env.LLXPRT_FAKE_RESPONSES = fixturePath(defaultFixture);
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previous;
  });
  return (fixture) => {
    process.env.LLXPRT_FAKE_RESPONSES = fixturePath(fixture);
  };
}

/**
 * Everything one generated case owns. It is created and closed by that case
 * alone: cleanup closes over these bindings, never over suite-level variables,
 * so cleanup that runs after its test timed out cannot dispose the owners of
 * the test that follows.
 */
export interface Caller {
  readonly config: Config;
  readonly settings: SettingsService;
  readonly settingsOwner: SessionSettingsOwner;
  readonly policy: RuntimePolicyOwner;
  readonly mcp: McpRuntimeOwner;
  readonly manager: ReturnType<typeof acquirePreferredProviderManager>;
  readonly owner: SessionClientOwner;
  readonly close: () => Promise<void>;
}

interface CallerProviders {
  readonly runtimeId: string;
  readonly release: AcquisitionRelease;
  readonly settingsOwner: SessionSettingsOwner;
  readonly files: ProviderFileLifecycle;
  readonly manager: Caller['manager'];
  readonly tokenizer: ReturnType<typeof configureProviderTokenizer>;
  readonly oauth: ReturnType<typeof acquirePreferredOAuth>;
}

function acquireCallerProviders(
  config: Config,
  settings: SettingsService,
  policy: RuntimePolicyOwner,
  mcp: McpRuntimeOwner,
  authority: CredentialAuthority,
): CallerProviders {
  const runtimeId = 'caller-' + randomUUID();
  const release = new AcquisitionRelease();
  const settingsOwner = new SessionSettingsOwner(settings);
  release.acquire('settings', () => settingsOwner.dispose());
  settingsOwner.initializeProviderSelection(
    config.getProvider(),
    config.getModel(),
  );
  settingsOwner.bindTelemetry(config);
  const files = new ProviderFileLifecycle({
    maxFiles: 100,
    maxBytes: 512 * 1024 * 1024,
  });
  for (const scope of [runtimeId, config.getSessionId()])
    release.acquire('files', () => releaseAdoptedFileScope(files, scope));
  const manager = acquirePreferredProviderManager(
    config,
    settings,
    settingsOwner,
    files,
    runtimeId,
    authority,
    release,
  );
  const tokenizer = configureProviderTokenizer(manager);
  const oauth = acquirePreferredOAuth(
    undefined,
    policy.session.messageBus,
    config,
    settings,
    manager,
    runtimeId,
    mcp.profileDefinitions,
    authority,
    release,
    undefined,
  );
  return {
    runtimeId,
    release,
    settingsOwner,
    files,
    manager,
    tokenizer,
    oauth,
  };
}

async function activateCaller(
  caller: Caller,
  providers: CallerProviders,
): Promise<void> {
  const { config, settings, owner } = caller;
  const { settingsOwner, manager, oauth } = providers;
  await preparePreferredProviderCompletion(
    config,
    settings,
    settingsOwner,
    manager,
    oauth,
    providers.runtimeId,
    providers.tokenizer,
    undefined,
  );
  await caller.mcp.initialize();
  const activation = await executeProviderActivation(
    config,
    { provider: config.getProvider(), model: config.getModel() },
    assembleProviderSwitch(
      config,
      settings,
      manager,
      oauth,
      () => 'agent',
      () => owner.refreshAuth(),
      settingsOwner,
    ),
    settings,
    manager,
    (method) => owner.refreshAuth(method),
    assembleModelSelection(settingsOwner),
  );
  requireCallerActivation(activation);
  await owner.initializeTools();
  await capturedSessionClient(owner).startChat();
}

export async function openCaller(
  authority: CredentialAuthority,
  factories: ReturnType<typeof createAgentRuntimeFactoryBindings>,
): Promise<Caller> {
  // Small dedicated workspace: the caller only needs an empty directory, so no
  // other tree is added to the workspace for the agent to scan.
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'caller-adoption-')),
  );
  const config = new Config({
    ...toConfigParameters({
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      workingDir: directory,
    }),
    interactive: true,
  });
  const settings = new SettingsService();
  const policy = new RuntimePolicyOwner(config);
  injectConfirmationForcingPolicy(policy.session.confirmation);
  const mcp = await buildTestMcpRuntime(
    config,
    policy.session.messageBus,
    {},
    undefined,
    policy,
  );
  const providers = acquireCallerProviders(
    config,
    settings,
    policy,
    mcp,
    authority,
  );
  const media = new SessionMediaOwner(
    config.projectTempDir,
    1024 * 1024 * 1024,
  );
  const owner = await createCapturedSessionOwner(
    config,
    assembleTaskSchemaPolicy(settings),
    providers.manager,
    factories.agentClientFactory,
    media.store,
    mcp.readInstructions,
    mcp.workspacePaths,
    providers.settingsOwner,
    createRuntimeContentGeneratorFactory(),
    providers.tokenizer,
  );
  owner.bindMcpRuntime(mcp);
  owner.bindProviderFiles(providers.files, (provider) =>
    providers.oauth.composeRetryOperations(provider),
  );
  owner.bindHooks();
  const close = (): Promise<void> =>
    runCleanupSteps([
      () => owner.dispose(),
      () => providers.release.close(),
      () => media.dispose(),
      () => mcp.dispose(),
      () => config.dispose(),
      () => rm(directory, { recursive: true, force: true }),
    ]);
  const caller: Caller = {
    config,
    settings,
    settingsOwner: providers.settingsOwner,
    policy,
    mcp,
    manager: providers.manager,
    owner,
    close,
  };
  try {
    await activateCaller(caller, providers);
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
  return caller;
}

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
