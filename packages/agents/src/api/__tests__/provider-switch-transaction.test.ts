/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  Config,
  type RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { AgentEventType } from '@vybestack/llxprt-code-core/core/turn.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import {
  FakeProvider,
  ProviderFileLifecycle,
} from '@vybestack/llxprt-code-providers';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../core/subagent-cleanup.js';
import type { SessionClientOwner } from '../../session/session-client-owner.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { buildAgentClientFactory } from '../agentBootstrap.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { assembleModelSelection } from '../model-selection.js';
import { preparePreferredProviderCompletion } from '../preferred-provider-acquisition.js';
import {
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
} from './helpers/provider-acquisition.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  createCapturedSessionOwner,
  ownerClients,
} from './helpers/session-client-capture.js';

function replacement(workingDir: string): FakeProvider {
  const provider = new FakeProvider(
    fileURLToPath(new URL('./fixtures/multi-turn-text.jsonl', import.meta.url)),
    workingDir,
  );
  provider.name = 'replacement';
  return provider;
}

/**
 * Holds the tokenizer preparation the session client owner awaits while it
 * replaces its client for the `replacement` provider, then fails it. The owner
 * takes the tokenizer factory as a parameter production also fills.
 */
class ReplacementHold {
  private notifyEntered: () => void = () => {};
  private openGate: () => void = () => {};
  private readonly gate = new Promise<void>((resolve) => {
    this.openGate = resolve;
  });
  readonly entered = new Promise<void>((resolve) => {
    this.notifyEntered = resolve;
  });

  constructor(private readonly failure: Error) {}

  release(): void {
    this.openGate();
  }

  wrap(inner: RuntimeTokenizerFactory): RuntimeTokenizerFactory {
    return {
      getTokenizer: (provider, model) => inner.getTokenizer(provider, model),
      estimatePrompt: (request) => inner.estimatePrompt(request),
      claimsModel: (model) => inner.claimsModel?.(model) ?? false,
      getEstimatorFamily: (model) => inner.getEstimatorFamily?.(model),
      prepareTokenizer: async (provider, model) => {
        if (provider === 'replacement') {
          this.notifyEntered();
          await this.gate;
          throw this.failure;
        }
        await inner.prepareTokenizer?.(provider, model);
      },
    };
  }
}

interface Root {
  readonly config: Config;
  readonly settings: SettingsService;
  readonly settingsOwner: SessionSettingsOwner;
  readonly manager: ReturnType<typeof acquirePreferredProviderManager>;
  readonly oauth: ReturnType<typeof acquirePreferredOAuth>;
  readonly owner: SessionClientOwner;
  readonly close: () => Promise<void>;
}

/** The client the owner currently serves: the last one its factory returned. */
function currentClient(root: Root): AgentClientContract {
  const clients = ownerClients(root.owner);
  return clients[clients.length - 1];
}

async function openRoot(
  authority: CredentialAuthority,
  hold?: ReplacementHold,
): Promise<Root> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'switch-transaction-')),
  );
  const selection = toConfigParameters({
    provider: 'fake',
    model: 'fake-model',
    sessionId: randomUUID(),
    workingDir: directory,
  });
  const config = new Config({
    ...selection,
    interactive: true,
    includeDirectories: [
      ...(selection.includeDirectories ?? []),
      process.cwd(),
    ],
  });
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  const policy = new RuntimePolicyOwner(config);
  injectConfirmationForcingPolicy(policy.session.confirmation);
  const mcp = await buildTestMcpRuntime(
    config,
    policy.session.messageBus,
    {},
    undefined,
    policy,
  );
  const runtimeId = 'switch-transaction-' + randomUUID();
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
  const tokenizer = configureProviderTokenizer(manager);
  const media = new SessionMediaOwner(
    config.projectTempDir,
    1024 * 1024 * 1024,
  );
  const owner = await createCapturedSessionOwner(
    config,
    assembleTaskSchemaPolicy(settings),
    manager,
    buildAgentClientFactory(),
    media.store,
    mcp.readInstructions,
    mcp.workspacePaths,
    settingsOwner,
    createRuntimeContentGeneratorFactory(),
    hold === undefined ? tokenizer : hold.wrap(tokenizer),
  );
  owner.bindMcpRuntime(mcp);
  owner.clients.bindProviderFiles(files, (provider) =>
    oauth.composeRetryOperations(provider),
  );
  owner.bindHooks();
  const root: Root = {
    config,
    settings,
    settingsOwner,
    manager,
    oauth,
    owner,
    close: () =>
      runCleanupSteps([
        () => owner.dispose(),
        () => release.close(),
        () => media.dispose(),
        () => mcp.dispose(),
        () => config.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]),
  };
  try {
    await preparePreferredProviderCompletion(
      config,
      settings,
      settingsOwner,
      manager,
      oauth,
      runtimeId,
      tokenizer,
      undefined,
      process.env.LLXPRT_FAKE_RESPONSES,
    );
    await mcp.initialize();
    const activation = await executeProviderActivation(
      config,
      { provider: config.getProvider(), model: config.getModel() },
      assembleProviderSwitch(
        config,
        settings,
        manager,
        oauth,
        () => 'agent',
        () => owner.clients.refreshAuth(),
        settingsOwner,
      ),
      settings,
      manager,
      (method) => owner.clients.refreshAuth(method),
      assembleModelSelection(settingsOwner),
    );
    if (activation.authFailed) throw activation.authError;
    await owner.initializeTools();
    await currentClient(root).startChat();
  } catch (primary) {
    return cleanupAfterFailure(primary, root.close);
  }
  return root;
}

async function continueTurn(
  client: AgentClientContract,
  message: string,
): Promise<void> {
  const stream = client.sendMessageStream(
    message,
    new AbortController().signal,
    'switch-transaction-' + randomUUID(),
  );
  for await (const event of stream) {
    if (event.type === AgentEventType.Error)
      throw new Error(event.value.error.message);
  }
}

describe('provider switch transaction ownership', () => {
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

  useFakeResponsesReplay('multi-turn-text.jsonl');
  const firstCredentials = useOwnedCredentials();
  const secondCredentials = useOwnedCredentials();

  it('rejects replacement failure and restores the switching owner without disturbing a successful same-label sibling', async () => {
    const failure = new Error('owner client replacement rejected');
    const hold = new ReplacementHold(failure);
    const a = await openRoot(firstCredentials().authority, hold);
    const b = await openRoot(secondCredentials().authority).catch(
      async (error: unknown) => {
        await a.close();
        throw error;
      },
    );
    try {
      a.config.adoptSessionId('same-label');
      b.config.adoptSessionId('same-label');
      a.manager.registerProvider(replacement(a.config.getTargetDir()));
      b.manager.registerProvider(replacement(b.config.getTargetDir()));
      a.settingsOwner.writeUserParameter('auth-key', 'first-owner-key');
      a.settingsOwner.writeUserParameter('reasoning.enabled', false);
      const originalProvider = a.manager.getProviderByName('fake');
      if (!originalProvider)
        throw new Error('Missing original fixture provider');
      const before = {
        settings: structuredClone(a.settings.exportForStateSnapshot()),
        provider: originalProvider,
        client: currentClient(a),
      };
      const ephemerals = structuredClone(
        a.settingsOwner.captureNamedParameters(),
      );
      const switchA = assembleProviderSwitch(
        a.config,
        a.settings,
        a.manager,
        a.oauth,
        () => 'agent',
        () => a.owner.clients.refreshAuth(),
        a.settingsOwner,
      );
      const switchB = assembleProviderSwitch(
        b.config,
        b.settings,
        b.manager,
        b.oauth,
        () => 'subagent',
        () => b.owner.clients.refreshAuth(),
        b.settingsOwner,
      );
      const pending = switchA('replacement');
      const observed = pending.then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
      await hold.entered;
      const sibling = await switchB('replacement');
      expect(sibling.changed).toBe(true);
      const siblingState = {
        global: {
          activeProvider: 'replacement',
          'base-url': 'http://fake-provider.local',
        },
        providers: {
          fake: { model: undefined },
          replacement: {
            'base-url': 'http://fake-provider.local',
            model: 'fake-model',
          },
        },
      };
      hold.release();
      expect(await observed).toStrictEqual({ error: failure });
      expect(a.settings.exportForStateSnapshot()).toStrictEqual(
        before.settings,
      );
      expect(a.settingsOwner.captureNamedParameters()).toStrictEqual(
        ephemerals,
      );
      expect(a.manager.getActiveProvider()).toBe(before.provider);
      expect(currentClient(a)).toBe(before.client);
      const siblingSnapshot = b.settings.exportForStateSnapshot();
      expect({
        global: siblingSnapshot.global,
        providers: Object.fromEntries(
          Object.entries(siblingSnapshot.providers).map(([name, values]) => [
            name,
            { ...values },
          ]),
        ),
        ...('tools' in siblingSnapshot ? { tools: siblingSnapshot.tools } : {}),
      }).toStrictEqual(siblingState);
      await continueTurn(currentClient(a), 'Continue on the restored owner');
      await continueTurn(currentClient(b), 'Continue on the committed sibling');
      expect(JSON.stringify(await currentClient(a).getHistory())).toContain(
        'restored owner',
      );
      expect(JSON.stringify(await currentClient(b).getHistory())).toContain(
        'committed sibling',
      );
    } finally {
      hold.release();
      await runCleanupSteps([() => a.close(), () => b.close()]);
    }
  }, 30000);
});
