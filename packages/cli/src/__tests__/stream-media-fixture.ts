import { adoptFixture as fromConfig } from '../../../agents/src/api/__tests__/helpers/adoption-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, afterEach, beforeAll } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Agent } from '@vybestack/llxprt-code-agents';
import { createAgentRuntimeFactoryBindings } from '../../../agents/src/api/runtimeFactories.js';
import { createTestMcpRuntime } from '../../../agents/src/api/__tests__/helpers/create-mcp-runtime.js';
import {
  KeychainTokenStorage,
  MCPOAuthTokenStorage,
} from '@vybestack/llxprt-code-mcp';
import { openBrowserSecurely } from '@vybestack/llxprt-code-core';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { FakeProvider } from '../../../providers/src/fake/FakeProvider.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { StreamRuntime } from '../ui/cliUiRuntime.js';
import { createStreamRuntimeForTest } from '../ui/hooks/agentStream/__tests__/streamRuntimeTestHelper.js';

type Release = () => Promise<void> | void;
type Retain = (release: Release) => void;

export interface StreamMediaFixture {
  readonly runtime: StreamRuntime;
  readonly agent: Agent;
  readonly media: LocalMediaStore;
  readonly historyReceiver: AgentClientContract;
  borrow(): Promise<Agent>;
  dispose(): Promise<void>;
}

export function useStreamMediaFixtures(): (
  sessionId?: string,
) => Promise<StreamMediaFixture> {
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  let directory: string;
  let releases: Release[] = [];
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'stream-media-fixture-'));
    process.env.LLXPRT_PROMPTS_DIR = join(directory, 'prompts');
    await initializePromptSystem();
  });
  afterEach(async () => {
    const pending = releases;
    releases = [];
    for (const release of pending.reverse()) await release();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(directory, { recursive: true, force: true });
  });
  return (sessionId = 'same-stream-session') =>
    createStreamMediaFixture(directory, sessionId, (release) => {
      releases.push(release);
    });
}

async function createInfrastructure(
  directory: string,
  sessionId: string,
  retain: Retain,
) {
  const config = new Config({
    sessionId,
    targetDir: directory,
    cwd: directory,
    debugMode: false,
    provider: 'fake',
    model: 'fake-model',
  });
  retain(() => config.dispose());
  const settings = new SettingsService();
  const settingsOwner = new SessionSettingsOwner(settings);
  settingsOwner.bindTelemetry(config);
  retain(() => settingsOwner.dispose());
  const policy = new RuntimePolicyOwner(config);
  retain(() => policy.dispose());
  const credentials = new CredentialAuthority();
  const manager = new ProviderManager(
    undefined,
    undefined,
    undefined,
    undefined,
    settings,
    config,
    undefined,
    credentials,
    settingsOwner,
  );
  retain(() => manager.dispose());
  manager.registerProvider(
    new FakeProvider(
      fileURLToPath(
        new URL(
          '../../../agents/src/api/__tests__/fixtures/plain-text.jsonl',
          import.meta.url,
        ),
      ),
    ),
  );
  manager.setActiveProvider('fake');
  const mcp = await createTestMcpRuntime(
    {
      oauth: {
        tokenStorage: new MCPOAuthTokenStorage(
          new KeychainTokenStorage('stream-media-fixture'),
        ),
        openBrowser: openBrowserSecurely,
      },
      config,
      policy: { owner: policy, ownership: 'caller' },
    },
    {},
  );
  retain(() => mcp.dispose());
  return { config, settings, settingsOwner, policy, credentials, manager, mcp };
}

function adoptStreamAgent(
  infrastructure: Awaited<ReturnType<typeof createInfrastructure>>,
  bindings: ReturnType<typeof createAgentRuntimeFactoryBindings>,
  borrowed?: AgentClientContract,
): Promise<Agent> {
  const { config, settings, settingsOwner, manager, policy, mcp, credentials } =
    infrastructure;
  return fromConfig(
    config,
    settings,
    {
      sessionId: config.getSessionId(),
      activation: { provider: 'fake', model: 'fake-model' },
    },
    settingsOwner,
    manager,
    undefined,
    policy.session.messageBus,
    mcp,
    undefined,
    borrowed,
    undefined,
    undefined,
    undefined,
    bindings,
    undefined,
    credentials,
    policy,
  );
}

async function createStreamMediaFixture(
  directory: string,
  sessionId: string,
  retain: Retain,
): Promise<StreamMediaFixture> {
  const infrastructure = await createInfrastructure(
    directory,
    sessionId,
    retain,
  );
  const factories = createAgentRuntimeFactoryBindings();
  let acquiredClient: AgentClientContract | undefined;
  let acquiredMedia: LocalMediaStore | undefined;
  let receiver: AgentClientContract | undefined;
  const observeHistory = (client: AgentClientContract): void => {
    receiver = client;
  };
  const bindings = {
    ...factories,
    agentClientFactory: (
      ...args: Parameters<typeof factories.agentClientFactory>
    ): AgentClientContract => {
      const client = factories.agentClientFactory(...args);
      acquiredClient = client;
      acquiredMedia = args[3];
      const readHistory = client.getHistory;
      client.getHistory = function (
        this: AgentClientContract,
      ): ReturnType<AgentClientContract['getHistory']> {
        observeHistory(this);
        return readHistory.call(this);
      };
      return client;
    },
  };
  const agent = await adoptStreamAgent(infrastructure, bindings);
  retain(() => agent.dispose());
  if (acquiredClient === undefined || acquiredMedia === undefined)
    throw new Error('Missing construction-captured stream resources');
  const client = acquiredClient;
  await client.startChat();
  return {
    runtime: createStreamRuntimeForTest(infrastructure.config, {
      projectTempDir: infrastructure.config.projectTempDir,
    }),
    agent,
    media: acquiredMedia,
    get historyReceiver(): AgentClientContract {
      if (receiver === undefined)
        throw new Error('No real client received a history read');
      return receiver;
    },
    borrow: async (): Promise<Agent> => {
      const peer = await adoptStreamAgent(infrastructure, bindings, client);
      retain(() => peer.dispose());
      return peer;
    },
    dispose: () => agent.dispose(),
  };
}
