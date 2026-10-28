import { createCapturedSessionOwner } from '../../../../agents/src/api/__tests__/helpers/session-client-capture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
const makeFixtureFilesystem = installTestWorkspaceFilesystem();
let fixtureFilesystem: ReturnType<typeof makeFixtureFilesystem> | undefined;
function fixturePaths() {
  fixtureFilesystem ??= makeFixtureFilesystem({
    targetDir: process.cwd(),
    isTrusted: () => true,
  });
  return fixtureFilesystem.paths;
}

import {
  assembleWorkspaceMemory,
  WorkspaceToolCatalogOwner,
} from '@vybestack/llxprt-code-core';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { SessionClientOwner } from '../../../../agents/src/session/session-client-owner.js';
import { buildAgentClientFactory } from '../../../../agents/src/api/agentBootstrap.js';
import {
  afterEach,
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  spyOn,
} from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TestRuntimeProviderManager } from '../../../../agents/src/test-utils/runtimeProviderManager.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { prepareAgentPreflight } from '@vybestack/llxprt-code-agents';
import { useOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { generateAutoPrompt } from './autoPromptGenerator.js';
import { generationRecording } from '../../../../agents/src/api/__tests__/helpers/generation-client-owner.js';

const cleanups: Array<() => Promise<void>> = [];

async function owner(
  name: string,
  failure?: Error,
  providerName = name,
): Promise<{
  config: Config;
  settings: SettingsService;
  requests: unknown[];
  sessionClient: SessionClientOwner;
  readModelListenerCount: () => number;
}> {
  const settings = new SettingsService();
  const config = new Config({
    cwd: process.cwd(),
    targetDir: process.cwd(),
    debugMode: false,
    sessionId: name,
    model: 'test-model',
  });
  const requests: unknown[] = [];
  const provider: RuntimeProvider = {
    name: providerName,
    getModels: async () => [],
    getDefaultModel: () => 'test-model',
    async *generateChatCompletion(options): AsyncIterableIterator<IContent> {
      requests.push(options);
      if (failure) throw failure;
      yield { speaker: 'ai', blocks: [{ type: 'text', text: `  ${name}: ` }] };
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'expanded prompt\n' }],
      };
    },
  };
  const manager = new TestRuntimeProviderManager(
    createProviderRuntimeContext({
      runtimeId: name,
    }),
  );
  manager.registerProvider(provider);
  const factoriesTokenizer = configureProviderTokenizer(manager);
  const factoriesContent = createRuntimeContentGeneratorFactory();
  const media = new SessionMediaOwner(config.projectTempDir, 1024 * 1024);
  const settingsOwner = new SessionSettingsOwner(settings);
  settingsOwner.bindTelemetry(config);
  settingsOwner.initializeProviderSelection(providerName, 'test-model');
  const listeners = new Set<
    Parameters<SessionSettingsOwner['subscribeModelChanges']>[0]
  >();
  const subscribe = settingsOwner.subscribeModelChanges.bind(settingsOwner);
  const subscriptionSpy = spyOn(
    settingsOwner,
    'subscribeModelChanges',
  ).mockImplementation((listener) => {
    const unsubscribe = subscribe(listener);
    listeners.add(listener);
    return () => {
      unsubscribe();
      listeners.delete(listener);
    };
  });
  const sessionClient = await createCapturedSessionOwner(
    config,
    assembleTaskSchemaPolicy(settings),
    manager,
    buildAgentClientFactory(),
    media.store,
    () => undefined,
    fixturePaths(),
    settingsOwner,
    factoriesContent,
    factoriesTokenizer,
  );
  if (fixtureFilesystem === undefined)
    throw new Error('Missing fixture filesystem');
  const trust = new WorkspaceTrustLifecycle({
    localTrust: config.initialWorkspaceTrust,
  });
  const memory = assembleWorkspaceMemory(config, fixtureFilesystem, trust);
  await memory.operations.refresh();
  sessionClient.bindWorkspaceInstructions(memory);
  const tools = new WorkspaceToolCatalogOwner(
    config,
    new MessageBus(),
    new WorkspaceTrustLifecycle({ localTrust: config.initialWorkspaceTrust }),
  );
  const hookBus = new MessageBus();
  sessionClient.bindInheritedTools(tools.selection, hookBus);
  sessionClient.bindHooks(undefined, hookBus, trust);
  await sessionClient.initializeTools();
  cleanups.push(async () => {
    await sessionClient.dispose();
    await settingsOwner.dispose();
    subscriptionSpy.mockRestore();
    await memory.dispose();
    await tools.dispose();
    await media.dispose();
    await config.dispose();
  });
  await sessionClient.clients.refreshAuth();
  return {
    config,
    settings,
    requests,
    sessionClient,
    readModelListenerCount: () => listeners.size,
  };
}

describe('auto prompt explicit client ownership', () => {
  const credentials = useOwnedCredentials();
  let prompts: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    prompts = await mkdtemp(join(tmpdir(), 'auto-prompt-fixture-'));
    process.env.LLXPRT_PROMPTS_DIR = prompts;
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(prompts, { recursive: true, force: true });
  });
  afterEach(() => {
    fixtureFilesystem = undefined;
  });
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it('reports the first provider failure without sending another generation', async () => {
    const a = await owner(
      'failure-owner',
      new Error('provider denied generation'),
    );
    const b = await owner('failure-scope');
    const unrelated = await prepareAgentPreflight(
      { runtimeId: b.config.getSessionId() },
      credentials().authority,
    );
    cleanups.push(() => unrelated.dispose());
    const result = await generateAutoPrompt('Review code', (input, options) =>
      a.sessionClient.clients.generateText(input, options, generationRecording),
    ).catch((error: unknown) => error);
    await unrelated.dispose();
    expect(a.requests).toHaveLength(1);
    expect(result).toBeInstanceOf(Error);
    expect(result instanceof Error && result.message).toContain(
      'provider denied generation',
    );
  });

  it('uses owner A while an unrelated B runtime scope exists and preserves response whitespace', async () => {
    const a = await owner('owner-a');
    const b = await owner('owner-b');
    const unrelated = await prepareAgentPreflight(
      { runtimeId: b.config.getSessionId() },
      credentials().authority,
    );
    cleanups.push(() => unrelated.dispose());
    const result = await generateAutoPrompt('Review code', (input, options) =>
      a.sessionClient.clients.generateText(input, options, generationRecording),
    );
    await unrelated.dispose();
    expect(result).toBe('  owner-a: expanded prompt\n');
    expect(a.requests).toHaveLength(1);
    expect(b.requests).toHaveLength(0);
  });

  for (const failure of [undefined, new Error('detached generation denied')]) {
    it(`releases detached client event subscriptions after ${failure ? 'failure' : 'success'}`, async () => {
      const detached = await owner('detached-owner', failure, 'gemini');
      expect(detached.readModelListenerCount()).toBe(1);
      const result = await generateAutoPrompt('Review code', (input, options) =>
        detached.sessionClient.clients.generateText(
          input,
          options,
          generationRecording,
        ),
      ).then(
        (text) => ({ text }),
        (error: unknown) => ({ error }),
      );
      expect(result).toStrictEqual(
        failure
          ? { error: failure }
          : { text: '  detached-owner: expanded prompt\n' },
      );
      expect(detached.requests).toHaveLength(1);
      expect(detached.readModelListenerCount()).toBe(1);
      await detached.sessionClient.dispose();
      expect(detached.readModelListenerCount()).toBe(0);
    });
  }
});
