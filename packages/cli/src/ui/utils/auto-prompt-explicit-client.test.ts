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
import { afterEach, describe, expect, it } from 'bun:test';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { TestRuntimeProviderManager } from '../../../../agents/src/test-utils/runtimeProviderManager.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  coreEvents,
  CoreEvent,
} from '@vybestack/llxprt-code-core/utils/events.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { beginCliRuntimeRegistration } from '@vybestack/llxprt-code-providers/runtime/cliForegroundRuntime.js';
import {
  generateAutoPrompt,
  type AutoPromptRuntime,
} from './autoPromptGenerator.js';

const cleanups: Array<() => Promise<void>> = [];

async function owner(
  name: string,
  failure?: Error,
): Promise<{
  client: AgentClientContract;
  config: Config;
  settings: SettingsService;
  requests: unknown[];
  sessionClient: SessionClientOwner;
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
    name,
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
      settingsService: settings,
      config,
      runtimeId: name,
    }),
  );
  manager.registerProvider(provider);
  const factories = configureProviderRuntimeFactories(config, manager);
  const media = new SessionMediaOwner(config.projectTempDir, 1024 * 1024);
  const settingsOwner = new SessionSettingsOwner(settings);
  settingsOwner.bindTelemetry(config);
  settingsOwner.initializeProviderSelection(name, 'test-model');
  const sessionClient = await SessionClientOwner.create(
    config,
    assembleTaskSchemaPolicy(settings),
    manager,
    buildAgentClientFactory(),
    media.store,
    () => undefined,
    fixturePaths(),
    settingsOwner,
    factories.contentGeneratorFactory,
    factories.tokenizerFactory,
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
    await memory.dispose();
    await tools.dispose();
    await media.dispose();
    await config.dispose();
  });
  await sessionClient.refreshAuth();
  const client = sessionClient.getAgentClient();
  return { client, config, settings, requests, sessionClient };
}

function liveRuntime(source: {
  sessionClient: SessionClientOwner;
}): AutoPromptRuntime {
  return {
    getProvider: () => 'anthropic',
    get agentClient() {
      return source.sessionClient.getAgentClient();
    },
    sessionClient: source.sessionClient,
  };
}

describe('auto prompt explicit client ownership', () => {
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
    const unrelated = beginCliRuntimeRegistration(b.settings, b.config, {
      runtimeId: 'failure-scope',
    });
    const result = await generateAutoPrompt(
      liveRuntime(a),
      'Review code',
      a.config.getContentGeneratorConfig(),
    ).catch((error: unknown) => error);
    unrelated.dispose();
    expect(a.requests).toHaveLength(1);
    expect(result).toBeInstanceOf(Error);
    expect(result instanceof Error && result.message).toContain(
      'provider denied generation',
    );
  });

  it('uses owner A while an unrelated B runtime scope exists and preserves response whitespace', async () => {
    const a = await owner('owner-a');
    const b = await owner('owner-b');
    const unrelated = beginCliRuntimeRegistration(b.settings, b.config, {
      runtimeId: 'owner-b',
    });
    const result = await generateAutoPrompt(
      liveRuntime(a),
      'Review code',
      a.config.getContentGeneratorConfig(),
    );
    unrelated.dispose();
    expect(result).toBe('  owner-a: expanded prompt\n');
    expect(a.requests).toHaveLength(1);
    expect(b.requests).toHaveLength(0);
  });

  for (const failure of [undefined, new Error('detached generation denied')]) {
    it(`releases detached client event subscriptions after ${failure ? 'failure' : 'success'}`, async () => {
      const before = coreEvents.listenerCount(CoreEvent.ModelChanged);
      const detached = await owner('detached-owner', failure);
      expect(coreEvents.listenerCount(CoreEvent.ModelChanged)).toBe(before + 1);
      const runtime: AutoPromptRuntime = {
        getProvider: () => 'gemini',
        get agentClient() {
          return detached.sessionClient.getAgentClient();
        },
        sessionClient: detached.sessionClient,
      };
      const result = await generateAutoPrompt(
        runtime,
        'Review code',
        detached.client.getContentGeneratorConfig(),
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
      expect(coreEvents.listenerCount(CoreEvent.ModelChanged)).toBe(before + 1);
    });
  }
});
