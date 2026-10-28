/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { runCleanupSteps } from '../../../core/subagent-cleanup.js';
import type { SessionClientOwner } from '../../../session/session-client-owner.js';
import { releaseAdoptedFileScope } from '../../adoption-release.js';
import { buildAgentClientFactory } from '../../agentBootstrap.js';
import { toConfigParameters } from '../../agentConfig.adapter.js';
import { preparePreferredProviderCompletion } from '../../preferred-provider-acquisition.js';
import {
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
} from './provider-acquisition.js';
import { createTestMcpRuntime } from './create-mcp-runtime.js';
import {
  createCapturedSessionOwner,
  ownerClients,
  type CapturedOwnerArgs,
} from './session-client-capture.js';

export type SessionClientFactory = CapturedOwnerArgs[3];

export interface StartedSessionOwner {
  readonly owner: SessionClientOwner;
  readonly client: AgentClientContract;
}

/**
 * The collaborators production hands a `SessionClientOwner`, each built
 * through its own production constructor. `close` runs once, runs every step
 * even when an earlier one rejects and reports the failures together; later
 * calls return the same outcome.
 */
export interface SessionClientEngine {
  readonly config: Config;
  readonly settings: SettingsService;
  readonly settingsOwner: SessionSettingsOwner;
  readonly media: SessionMediaOwner;
  readonly mcp: Awaited<ReturnType<typeof createTestMcpRuntime>>;
  readonly release: AcquisitionRelease;
  readonly directory: string;
  /** `SessionClientOwner.create` over the engine's collaborators. */
  readonly createOwner: (
    factory: SessionClientFactory,
  ) => Promise<SessionClientOwner>;
  /**
   * A caller engine owner with the production client factory: MCP and hooks
   * bound, provider preparation and MCP initialization done, tools
   * initialized, authentication refreshed and the chat started.
   */
  readonly openStartedOwner: () => Promise<StartedSessionOwner>;
  readonly close: () => Promise<void>;
}

interface ProviderStack {
  readonly directory: string;
  readonly config: Config;
  readonly settings: SettingsService;
  readonly settingsOwner: SessionSettingsOwner;
  readonly mcp: Awaited<ReturnType<typeof createTestMcpRuntime>>;
  readonly runtimeId: string;
  readonly release: AcquisitionRelease;
  readonly manager: ReturnType<typeof acquirePreferredProviderManager>;
  readonly oauth: ReturnType<typeof acquirePreferredOAuth>;
  readonly tokenizer: ReturnType<typeof configureProviderTokenizer>;
}

function acquireMcp(
  config: Config,
  policy: RuntimePolicyOwner,
): ReturnType<typeof createTestMcpRuntime> {
  return createTestMcpRuntime(
    {
      oauth: {
        openBrowser: async () => {
          throw new Error('Unexpected browser request');
        },
        tokenStorage: new MCPOAuthTokenStorage({
          getCredentials: async () => null,
          setCredentials: async () => {
            throw new Error('Unexpected token write');
          },
          deleteCredentials: async () => {},
          listServers: async () => [],
          getAllCredentials: async () => new Map(),
          clearAll: async () => {},
        }),
      },
      config,
      policy: { owner: policy, ownership: 'runtime' },
    },
    {},
  );
}

async function acquireProviderStack(
  authority: CredentialAuthority,
): Promise<ProviderStack> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'explicit-engine-owner-')),
  );
  const config = new Config(
    toConfigParameters({
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      workingDir: directory,
    }),
  );
  const settings = new SettingsService();
  const policy = new RuntimePolicyOwner(config);
  const mcp = await acquireMcp(config, policy);
  const runtimeId = 'engine-' + randomUUID();
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
    directory,
    config,
    settings,
    settingsOwner,
    mcp,
    runtimeId,
    release,
    manager,
    oauth,
    tokenizer: configureProviderTokenizer(manager),
  };
}

export async function openSessionClientEngine(
  authority: CredentialAuthority,
): Promise<SessionClientEngine> {
  const stack = await acquireProviderStack(authority);
  const { config, settings, settingsOwner, mcp, release, directory } = stack;
  const media = new SessionMediaOwner(config.projectTempDir, 1024 * 1024);
  const content = createRuntimeContentGeneratorFactory();
  const createOwner = (
    factory: SessionClientFactory,
  ): Promise<SessionClientOwner> =>
    createCapturedSessionOwner(
      config,
      assembleTaskSchemaPolicy(settings),
      stack.manager,
      factory,
      media.store,
      mcp.readInstructions,
      mcp.workspacePaths,
      settingsOwner,
      content,
      stack.tokenizer,
    );
  const started: SessionClientOwner[] = [];
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> =>
    (closing ??= runCleanupSteps([
      ...started.map((owner) => () => owner.dispose()),
      () => release.close(),
      () => media.dispose(),
      () => mcp.dispose(),
      () => config.dispose(),
      () => rm(directory, { recursive: true, force: true }),
    ]));
  const openStartedOwner = async (): Promise<StartedSessionOwner> => {
    const owner = await createOwner(buildAgentClientFactory());
    started.push(owner);
    owner.bindMcpRuntime(mcp);
    owner.bindHooks();
    await preparePreferredProviderCompletion(
      config,
      settings,
      settingsOwner,
      stack.manager,
      stack.oauth,
      stack.runtimeId,
      stack.tokenizer,
      undefined,
      process.env.LLXPRT_FAKE_RESPONSES,
    );
    await mcp.initialize();
    await owner.initializeTools();
    await owner.clients.refreshAuth();
    const clients = ownerClients(owner);
    const client = clients[clients.length - 1];
    await client.startChat();
    return { owner, client };
  };
  return {
    config,
    settings,
    settingsOwner,
    media,
    mcp,
    release,
    directory,
    createOwner,
    openStartedOwner,
    close,
  };
}
