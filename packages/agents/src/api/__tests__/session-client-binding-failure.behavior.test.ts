import {
  createCapturedSessionOwner,
  capturedSessionClient,
} from './helpers/session-client-capture.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { fileURLToPath } from 'node:url';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
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
import { buildAgentClientFactory } from '../agentBootstrap.js';
import { randomUUID } from 'node:crypto';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { cleanupAfterFailure } from '../../core/subagent-cleanup.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { AgentClient } from '../../core/client.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';

interface Gate {
  readonly opened: Promise<void>;
  open(): void;
}

function createGate(): Gate {
  let open: () => void = () => {
    throw new Error('Gate was not initialised');
  };
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

function createOwnerWithClient(
  builtConfig: Parameters<typeof SessionClientOwner.create>[0],
  builtSettings: SettingsService,
  builtManager: Parameters<typeof SessionClientOwner.create>[2],
  builtMedia: SessionMediaOwner,
  builtMcp: McpRuntimeOwner,
  builtSettingsOwner: SessionSettingsOwner,
  builtContent: NonNullable<Parameters<typeof SessionClientOwner.create>[8]>,
  builtTokenizer: NonNullable<Parameters<typeof SessionClientOwner.create>[9]>,
  createClient: (
    ...args: ConstructorParameters<typeof AgentClient>
  ) => AgentClient,
): Promise<SessionClientOwner> {
  return createCapturedSessionOwner(
    builtConfig,
    assembleTaskSchemaPolicy(builtSettings),
    builtManager,
    (config, state, instructions, store) => {
      if (store === undefined) throw new Error('Missing factory store');
      return createClient(
        config,
        state,
        instructions ?? (() => undefined),
        store,
        builtMcp.workspacePaths,
      );
    },
    builtMedia.store,
    builtMcp.readInstructions,
    builtMcp.workspacePaths,
    builtSettingsOwner,
    builtContent,
    builtTokenizer,
  );
}

describe('Factory-created session client acquisition', () => {
  const credentials = useOwnedCredentials();
  it('rejects with the binding error only after the abandoned client is disposed', async () => {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
    );
    const builtDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-engine-owner-')),
    );
    const builtConfig = new Config(
      toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: builtDirectory,
      }),
    );
    const builtSettings = new SettingsService();
    const builtPolicy = new RuntimePolicyOwner(builtConfig);
    const builtMessageBus = builtPolicy.session.messageBus;
    const builtMcp = await McpRuntimeOwner.create(
      {
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
      builtConfig,
      builtMessageBus,
      undefined,
      undefined,
      undefined,
      builtPolicy,
      'runtime',
    );

    const builtRuntimeId = 'engine-' + randomUUID();
    const builtRelease = new AcquisitionRelease();
    const builtSettingsOwner = new SessionSettingsOwner(builtSettings);
    builtRelease.acquire('settings', () => builtSettingsOwner.dispose());
    builtSettingsOwner.initializeProviderSelection(
      builtConfig.getProvider(),
      builtConfig.getModel(),
    );
    builtSettingsOwner.bindTelemetry(builtConfig);
    const builtFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [builtRuntimeId, builtConfig.getSessionId()])
      builtRelease.acquire('files', () =>
        releaseAdoptedFileScope(builtFiles, scope),
      );
    const builtManager = acquirePreferredProviderManager(
      builtConfig,
      builtSettings,
      builtSettingsOwner,
      builtFiles,
      builtRuntimeId,
      credentials().authority,
      builtRelease,
    );
    const builtTokenizer = configureProviderTokenizer(builtManager);
    const builtContent = createRuntimeContentGeneratorFactory();
    const builtOAuth = acquirePreferredOAuth(
      undefined,
      builtMessageBus,
      builtConfig,
      builtSettings,
      builtManager,
      builtRuntimeId,
      builtMcp.profileDefinitions,
      credentials().authority,
      builtRelease,
      undefined,
    );
    const builtMedia = new SessionMediaOwner(
      builtConfig.projectTempDir,
      1024 * 1024,
    );
    const builtOwner = await createCapturedSessionOwner(
      builtConfig,
      assembleTaskSchemaPolicy(builtSettings),
      builtManager,
      buildAgentClientFactory(),
      builtMedia.store,
      builtMcp.readInstructions,
      builtMcp.workspacePaths,
      builtSettingsOwner,
      builtContent,
      builtTokenizer,
    );
    builtOwner.bindMcpRuntime(builtMcp);
    builtOwner.bindHooks();
    const closeEngine = settleEngineRelease.bind(
      undefined,
      [
        () => builtOwner.dispose(),
        () => builtRelease.close(),
        () => builtMedia.dispose(),
        () => builtMcp.dispose(),
        () => builtConfig.dispose(),
        () => rm(builtDirectory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        builtConfig,
        builtSettings,
        builtSettingsOwner,
        builtManager,
        builtOAuth,
        builtRuntimeId,
        builtTokenizer,
        undefined,
      );
      await builtMcp.initialize();
      await builtOwner.initializeTools();
      await builtOwner.refreshAuth();
      await capturedSessionClient(builtOwner).startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, closeEngine);
    }

    const releaseDisposal = createGate();
    const disposalStarted = createGate();
    const events: string[] = [];
    const bindingError = new Error('binding boom');
    class BindingFailureClient extends AgentClient {
      override bindProviderInvocation(): void {
        throw bindingError;
      }
      override async dispose(): Promise<void> {
        events.push('dispose-started');
        disposalStarted.open();
        await releaseDisposal.opened;
        await super.dispose();
        events.push('dispose-finished');
      }
    }
    try {
      const construction = createOwnerWithClient(
        builtConfig,
        builtSettings,
        builtManager,
        builtMedia,
        builtMcp,
        builtSettingsOwner,
        builtContent,
        builtTokenizer,
        (...args) => new BindingFailureClient(...args),
      ).then(
        () => events.push('constructed'),
        (error: unknown) => {
          events.push('rejected');
          return error;
        },
      );
      await disposalStarted.opened;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(events).toStrictEqual(['dispose-started']);

      releaseDisposal.open();
      const error = await construction;

      expect(events).toStrictEqual([
        'dispose-started',
        'dispose-finished',
        'rejected',
      ]);
      expect(error).toBe(bindingError);
    } finally {
      await closeEngine();
    }
  }, 30000);

  it('rejects with the binding and disposal failures after disposal settles', async () => {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
    );
    const builtDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-engine-owner-')),
    );
    const builtConfig = new Config(
      toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: builtDirectory,
      }),
    );
    const builtSettings = new SettingsService();
    const builtPolicy = new RuntimePolicyOwner(builtConfig);
    const builtMessageBus = builtPolicy.session.messageBus;
    const builtMcp = await McpRuntimeOwner.create(
      {
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
      builtConfig,
      builtMessageBus,
      undefined,
      undefined,
      undefined,
      builtPolicy,
      'runtime',
    );

    const builtRuntimeId = 'engine-' + randomUUID();
    const builtRelease = new AcquisitionRelease();
    const builtSettingsOwner = new SessionSettingsOwner(builtSettings);
    builtRelease.acquire('settings', () => builtSettingsOwner.dispose());
    builtSettingsOwner.initializeProviderSelection(
      builtConfig.getProvider(),
      builtConfig.getModel(),
    );
    builtSettingsOwner.bindTelemetry(builtConfig);
    const builtFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [builtRuntimeId, builtConfig.getSessionId()])
      builtRelease.acquire('files', () =>
        releaseAdoptedFileScope(builtFiles, scope),
      );
    const builtManager = acquirePreferredProviderManager(
      builtConfig,
      builtSettings,
      builtSettingsOwner,
      builtFiles,
      builtRuntimeId,
      credentials().authority,
      builtRelease,
    );
    const builtTokenizer = configureProviderTokenizer(builtManager);
    const builtContent = createRuntimeContentGeneratorFactory();
    const builtOAuth = acquirePreferredOAuth(
      undefined,
      builtMessageBus,
      builtConfig,
      builtSettings,
      builtManager,
      builtRuntimeId,
      builtMcp.profileDefinitions,
      credentials().authority,
      builtRelease,
      undefined,
    );
    const builtMedia = new SessionMediaOwner(
      builtConfig.projectTempDir,
      1024 * 1024,
    );
    const builtOwner = await createCapturedSessionOwner(
      builtConfig,
      assembleTaskSchemaPolicy(builtSettings),
      builtManager,
      buildAgentClientFactory(),
      builtMedia.store,
      builtMcp.readInstructions,
      builtMcp.workspacePaths,
      builtSettingsOwner,
      builtContent,
      builtTokenizer,
    );
    builtOwner.bindMcpRuntime(builtMcp);
    builtOwner.bindHooks();
    const closeEngine = settleEngineRelease.bind(
      undefined,
      [
        () => builtOwner.dispose(),
        () => builtRelease.close(),
        () => builtMedia.dispose(),
        () => builtMcp.dispose(),
        () => builtConfig.dispose(),
        () => rm(builtDirectory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        builtConfig,
        builtSettings,
        builtSettingsOwner,
        builtManager,
        builtOAuth,
        builtRuntimeId,
        builtTokenizer,
        undefined,
      );
      await builtMcp.initialize();
      await builtOwner.initializeTools();
      await builtOwner.refreshAuth();
      await capturedSessionClient(builtOwner).startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, closeEngine);
    }

    const releaseDisposal = createGate();
    const disposalStarted = createGate();
    const events: string[] = [];
    const bindingError = new Error('binding boom');
    const disposalError = new Error('dispose boom');
    class BindingFailureClient extends AgentClient {
      override bindProviderInvocation(): void {
        throw bindingError;
      }
      override async dispose(): Promise<void> {
        events.push('dispose-started');
        disposalStarted.open();
        await releaseDisposal.opened;
        await super.dispose();
        events.push('dispose-finished');
        throw disposalError;
      }
    }
    try {
      const construction = createOwnerWithClient(
        builtConfig,
        builtSettings,
        builtManager,
        builtMedia,
        builtMcp,
        builtSettingsOwner,
        builtContent,
        builtTokenizer,
        (...args) => new BindingFailureClient(...args),
      ).then(
        () => events.push('constructed'),
        (error: unknown) => {
          events.push('rejected');
          return error;
        },
      );
      await disposalStarted.opened;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(events).toStrictEqual(['dispose-started']);

      releaseDisposal.open();
      const error = await construction;

      expect(events).toStrictEqual([
        'dispose-started',
        'dispose-finished',
        'rejected',
      ]);
      if (!(error instanceof AggregateError))
        throw new Error(
          'Expected construction to reject with an AggregateError',
        );
      expect(error.errors).toStrictEqual([bindingError, disposalError]);
    } finally {
      await closeEngine();
    }
  }, 30000);
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
