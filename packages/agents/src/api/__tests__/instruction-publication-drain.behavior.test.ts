import { describe, expect, it, vi, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromConfig } from '../fromConfig.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
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
import { buildAgentClientFactory } from '../agentBootstrap.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../core/subagent-cleanup.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
function gate(): { readonly promise: Promise<void>; release(): void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
describe('admitted instruction publication disposal', () => {
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
  const credentials = useOwnedCredentials();

  it.each([false, true])(
    'joins asynchronous assembly and retains the borrowed caller reader (peer closes first: %s)',
    async (peerFirst) => {
      const directory = await mkdtemp(join(tmpdir(), 'instruction-drain-'));
      await writeFile(
        join(directory, 'LLXPRT.md'),
        'Physical admitted instructions.',
      );
      const callerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
      process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
        new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
      );
      const callerDirectory = await realpath(directory);
      const callerConfig = new Config(
        toConfigParameters({
          provider: 'fake',
          model: 'fake-model',
          sessionId: randomUUID(),
          workingDir: callerDirectory,
        }),
      );
      const callerSettings = new SettingsService();
      const callerPolicy = new RuntimePolicyOwner(callerConfig);
      const callerMessageBus = callerPolicy.session.messageBus;
      const callerMcp = await McpRuntimeOwner.create(
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
        callerConfig,
        callerMessageBus,
        undefined,
        undefined,
        undefined,
        callerPolicy,
        'runtime',
      );

      const callerRuntimeId = 'engine-' + randomUUID();
      const callerRelease = new AcquisitionRelease();
      const callerSettingsOwner = new SessionSettingsOwner(callerSettings);
      callerRelease.acquire('settings', () => callerSettingsOwner.dispose());
      callerSettingsOwner.initializeProviderSelection(
        callerConfig.getProvider(),
        callerConfig.getModel(),
      );
      callerSettingsOwner.bindTelemetry(callerConfig);
      const callerFiles = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      for (const scope of [callerRuntimeId, callerConfig.getSessionId()])
        callerRelease.acquire('files', () =>
          releaseAdoptedFileScope(callerFiles, scope),
        );
      const callerManager = acquirePreferredProviderManager(
        callerConfig,
        callerSettings,
        callerSettingsOwner,
        callerFiles,
        callerRuntimeId,
        credentials().authority,
        callerRelease,
      );
      const {
        tokenizerFactory: callerTokenizer,
        contentGeneratorFactory: callerContent,
      } = configureProviderRuntimeFactories(callerConfig, callerManager);
      const callerOAuth = acquirePreferredOAuth(
        undefined,
        callerMessageBus,
        callerConfig,
        callerSettings,
        callerManager,
        callerRuntimeId,
        callerMcp.profileDefinitions,
        credentials().authority,
        callerRelease,
        undefined,
      );
      const callerMedia = new SessionMediaOwner(
        callerConfig.projectTempDir,
        1024 * 1024,
      );
      const callerOwner = await SessionClientOwner.create(
        callerConfig,
        assembleTaskSchemaPolicy(callerSettings),
        callerManager,
        buildAgentClientFactory(),
        callerMedia.store,
        callerMcp.readInstructions,
        callerMcp.workspacePaths,
        callerSettingsOwner,
        callerContent,
        callerTokenizer,
      );
      callerOwner.bindMcpRuntime(callerMcp);
      callerOwner.bindHooks();
      const callerClose = settleEngineRelease.bind(
        undefined,
        [
          () => callerOwner.dispose(),
          () => callerRelease.close(),
          () => callerMedia.dispose(),
          () => callerMcp.dispose(),
          () => callerConfig.dispose(),
          () => rm(callerDirectory, { recursive: true, force: true }),
        ],
        callerPreviousReplay,
      );
      try {
        await preparePreferredProviderCompletion(
          callerConfig,
          callerSettings,
          callerSettingsOwner,
          callerManager,
          callerOAuth,
          callerRuntimeId,
          callerTokenizer,
          undefined,
        );
        await callerMcp.initialize();
        await callerOwner.initializeTools();
        await callerOwner.refreshAuth();
        await callerOwner.getAgentClient().startChat();
      } catch (primary) {
        await cleanupAfterFailure(primary, callerClose);
      }

      const agent = await fromConfig({
        config: callerConfig,
        settingsOwner: callerSettingsOwner,
        settingsService: callerSettings,
        agentClient: callerOwner.getAgentClient(),
        providerManager: callerManager,
        mcpRuntime: callerMcp,
        messageBus: callerMessageBus,
      });
      const peer = await fromConfig({
        config: callerConfig,
        settingsOwner: callerSettingsOwner,
        settingsService: callerSettings,
        providerManager: callerManager,
        mcpRuntime: callerMcp,
        messageBus: callerMessageBus,
      });
      const entered = gate();
      const release = gate();
      const client = callerOwner.getAgentClient();
      const assemble = client.updateSystemInstruction.bind(client);
      let publishedCharacters = 0;
      const observer = vi
        .spyOn(client, 'updateSystemInstruction')
        .mockImplementation(
          async (
            instructions = callerOwner.instructionReads,
          ): Promise<void> => {
            entered.release();
            await release.promise;
            await assemble(instructions);
            publishedCharacters = instructions.snapshot().memoryContent.length;
          },
        );
      let closed = false;
      let publication: Promise<unknown> | undefined;
      let closing: Promise<void> | undefined;
      try {
        agent.memory.setMemory('Admitted facade instructions.');
        publication = callerMcp.refreshContext();
        await entered.promise;
        if (peerFirst) await peer.dispose();
        closing = agent.dispose().then(() => {
          closed = true;
        });
        await Promise.resolve();
        expect(closed).toBe(false);
        release.release();
        await publication;
        await closing;
        expect(publishedCharacters).toBeGreaterThan(0);
        callerSettingsOwner.writeUserParameter('maxOutputTokens', 79);
        expect(callerSettings.get('maxOutputTokens')).toBe(79);
        await client.updateSystemInstruction();
        expect(client.isInitialized()).toBe(true);
        const result = peerFirst
          ? undefined
          : await peer.chat('peer after admitted disposal');
        expect(result?.error).toBeUndefined();
      } finally {
        release.release();
        await Promise.allSettled([publication, closing]);
        observer.mockRestore();
        await agent.dispose();
        await peer.dispose();
        await callerClose();
        await rm(directory, { recursive: true, force: true });
      }
    },
    30000,
  );
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
