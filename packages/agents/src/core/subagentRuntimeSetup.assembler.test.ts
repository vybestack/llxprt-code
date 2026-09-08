/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests that the subagent per-turn assembler (injected into ChatSession by
 * createChatObject) preserves `interactionMode: 'subagent'` and the persona
 * across turns (issue #3136, Step 1).
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { createChatObject } from './subagentRuntimeSetup.js';
import type { ChatSession } from './chatSession.js';
import type { RuntimeGenerateChatOptions as GenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import {
  AfterModelHookOutput,
  BeforeModelHookOutput,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { createConfigParams } from './chatSession-runtime-helpers.js';

// Capture getCoreSystemPromptAsync calls so we can assert interactionMode,
// provider, and model on both the creation-time call and the per-turn call.
// The mock echoes those values and every memory channel into the rendered
// prompt. That keeps the assertions on observable prompt content while the
// issue #3173 tests can also prove MCP instructions appear exactly once.
const mockGetCorePrompt = vi.fn(async (args: Record<string, unknown>) => {
  const mode =
    typeof args.interactionMode === 'string' ? args.interactionMode : 'unknown';
  const provider =
    typeof args.provider === 'string' ? args.provider : 'NO_PROVIDER';
  const model = typeof args.model === 'string' ? args.model : 'NO_MODEL';
  const sections: string[] = [
    `[CORE_PROMPT mode=${mode} provider=${provider} model=${model}]`,
  ];
  const userMemory = typeof args.userMemory === 'string' ? args.userMemory : '';
  const coreMemory = typeof args.coreMemory === 'string' ? args.coreMemory : '';
  const mcp =
    typeof args.mcpInstructions === 'string' ? args.mcpInstructions : '';
  if (userMemory.length > 0) sections.push(userMemory);
  if (coreMemory.length > 0) sections.push(coreMemory);
  if (mcp.length > 0) sections.push(mcp);
  return sections.join('\n\n');
});

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: mockGetCorePrompt,
  getCompressionPrompt: vi.fn(() => 'COMPRESS'),
}));

describe('Subagent per-turn assembler (issue #3136)', () => {
  let settingsService: SettingsService;
  let config: Config;
  let capturedCalls: GenerateChatOptions[];

  beforeEach(() => {
    vi.clearAllMocks();
    settingsService = new SettingsService();
    config = new Config(createConfigParams(settingsService));
    // Per-turn assembly resolves the model via config.getModel() (issue
    // #3138); drive it so a settings change simulates a real `/model`.
    Object.defineProperty(config, 'getModel', {
      value: () => settingsService.get('model') as string,
      configurable: true,
    });
    settingsService.set('providers.stub.base-url', 'https://stub.example.com');
    settingsService.set('providers.stub.auth-key', 'stub-api-key');
    settingsService.set('model', 'sub-model-v1');
    capturedCalls = [];
  });

  /**
   * Builds a subagent ChatSession wired to a stub provider whose
   * getCurrentModel() reads the ephemeral `model` setting, exactly as
   * BaseProvider.computeModel does — so setting `model` simulates `/model`.
   *
   * Shared by every case here so the two scenarios cannot drift apart when
   * createChatObject's parameters change.
   */
  async function buildSubagentFixture(opts: {
    persona: string;
    runtimeId: string;
    provider?: string;
    userMemory?: string;
    coreMemory?: string;
    jitContextEnabled?: boolean;
    globalMemory?: string;
    jitMemory?: string;
    mcpInstructions?: string;
    workingDir?: string;
  }): Promise<ChatSession> {
    const providerRuntime = createProviderRuntimeContext({
      settingsService,
      config,
      runtimeId: opts.runtimeId,
      metadata: { source: 'subagent-assembler.test' },
    });

    const providerName = opts.provider ?? 'stub';
    const provider: IProvider = {
      name: providerName,
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => 'sub-model-v1',
      getCurrentModel: () =>
        (settingsService.get('model') as string | undefined) ?? 'sub-model-v1',
      generateChatCompletion: vi.fn(async function* (
        opts2: GenerateChatOptions,
      ) {
        capturedCalls.push(opts2);
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'done' }] };
      }),
      getAuthToken: vi.fn(async () => 'token'),
    };

    const manager = new TestRuntimeProviderManager(providerRuntime);
    manager.setConfig(config);
    config.setProviderManager(manager);
    manager.registerProvider(provider);

    const memoryOverrides: PropertyDescriptorMap = {};
    if (opts.userMemory !== undefined) {
      memoryOverrides['getUserMemory'] = { value: () => opts.userMemory };
    }
    if (opts.coreMemory !== undefined) {
      memoryOverrides['getCoreMemory'] = { value: () => opts.coreMemory };
    }
    if (opts.jitContextEnabled !== undefined) {
      memoryOverrides['isJitContextEnabled'] = {
        value: () => opts.jitContextEnabled,
      };
    }
    if (opts.globalMemory !== undefined) {
      memoryOverrides['getGlobalMemory'] = { value: () => opts.globalMemory };
    }
    if (opts.jitMemory !== undefined) {
      memoryOverrides['getJitMemoryForPath'] = {
        value: async () => opts.jitMemory,
      };
    }
    if (opts.mcpInstructions !== undefined) {
      memoryOverrides['getMcpInstructions'] = {
        value: () => opts.mcpInstructions,
      };
    }
    if (opts.workingDir !== undefined) {
      memoryOverrides['getWorkingDir'] = { value: () => opts.workingDir };
    }

    Object.defineProperties(config, {
      getConversationLoggingEnabled: { value: () => false },
      getEnableHooks: { value: () => false },
      ...memoryOverrides,
      getHookSystem: {
        value: () => ({
          initialize: async () => undefined,
          isInitialized: () => true,
          fireBeforeModelEvent: async () => new BeforeModelHookOutput({}),
          fireAfterModelEvent: async () => new AfterModelHookOutput({}),
        }),
      },
    });

    const runtimeState = createAgentRuntimeState({
      runtimeId: opts.runtimeId,
      provider: providerName,
      model: 'sub-model-v1',
      sessionId: config.getSessionId(),
    });
    const view = createAgentRuntimeContext({
      state: runtimeState,
      history: new (
        await import(
          '@vybestack/llxprt-code-core/services/history/HistoryService.js'
        )
      ).HistoryService(),
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 128000,
        preserveThreshold: 0.2,
        telemetry: { enabled: false, target: null },
        'reasoning.includeInContext': true,
      },
      provider: createProviderAdapterFromManager(config.getProviderManager()),
      telemetry: createTelemetryAdapterFromConfig(config),
      tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
      providerRuntime,
    });

    const chat = await createChatObject({
      promptConfig: { systemPrompt: opts.persona },
      modelConfig: { model: 'sub-model-v1', temp: 0, top_p: 1 },
      outputConfig: undefined,
      toolConfig: undefined,
      runtimeContext: view,
      contentGenerator: {} as unknown as ContentGenerator,
      environmentContextLoader: async () => [],
      foregroundConfig: config,
      context: { get: () => undefined, get_keys: () => [], set: () => {} },
    });

    expect(chat).not.toBeNull();
    return chat as ChatSession;
  }

  it('renders interactionMode=subagent and persona on the per-turn call after /model change', async () => {
    const PERSONA = 'You are a TypeScript expert subagent.';
    const chat = await buildSubagentFixture({
      persona: PERSONA,
      runtimeId: 'test.subagent.assembly',
    });

    // Creation-time call: interactionMode must be 'subagent'
    expect(mockGetCorePrompt).toHaveBeenCalledTimes(1);
    expect(mockGetCorePrompt.mock.calls[0][0]).toMatchObject({
      interactionMode: 'subagent',
      includeSubagentDelegation: false,
    });

    // --- Simulate /model change ---
    settingsService.set('model', 'sub-model-v2');

    await chat.sendMessage({ message: 'do the task' }, 'p1');

    // The per-turn call must ALSO use interactionMode=subagent, with the
    // fresh model.
    expect(mockGetCorePrompt).toHaveBeenCalledTimes(2);
    expect(mockGetCorePrompt.mock.calls[1][0]).toMatchObject({
      interactionMode: 'subagent',
      includeSubagentDelegation: false,
      model: 'sub-model-v2',
    });

    // The system instruction must contain BOTH the core prompt and persona
    const sysInstr = capturedCalls[0].systemInstruction as string;
    expect(sysInstr).toContain('mode=subagent');
    expect(sysInstr).toContain(PERSONA);
  });

  /**
   * Issue #3136 acceptance criterion 10.
   *
   * A subagent's user memory and core memory currently reach the model ONLY
   * because the provider layer rebuilds its own core prompt. The subagent
   * assembler passes neither, so removing the provider-side build without
   * this fix would silently strip memory from every subagent.
   *
   * This asserts the subagent assembler itself supplies both, so the
   * collapse cannot regress subagent memory.
   */
  it('passes userMemory and coreMemory to the subagent core prompt', async () => {
    const USER_MEMORY = 'REMEMBER: the deploy key lives in ~/.keys/deploy';
    const CORE_MEMORY = 'CORE: never force-push to main';

    const chat = await buildSubagentFixture({
      persona: 'You are a subagent.',
      runtimeId: 'test.subagent.memory',
      jitContextEnabled: false,
      userMemory: USER_MEMORY,
      coreMemory: CORE_MEMORY,
    });

    // Creation-time assembly must already carry both memories.
    expect(mockGetCorePrompt.mock.calls[0][0]).toMatchObject({
      userMemory: USER_MEMORY,
      coreMemory: CORE_MEMORY,
    });

    // And the per-turn assembly must too, so memory survives every turn.
    await chat.sendMessage({ message: 'go' }, 'p1');
    expect(mockGetCorePrompt).toHaveBeenCalledTimes(2);
    expect(mockGetCorePrompt.mock.calls[1][0]).toMatchObject({
      userMemory: USER_MEMORY,
      coreMemory: CORE_MEMORY,
    });
  });

  describe('Subagent JIT memory sourcing (issue #3173)', () => {
    /**
     * Distinct markers used to trace which memory channel sourced each piece of
     * the prompt. ENV_WITH_MCP_MARKER deliberately embeds the MCP token so that
     * the pre-fix subagent path (which sources getUserMemory() under JIT and so
     * folds in environment memory that already carries MCP instructions) can be
     * shown to deliver the MCP block more than once.
     */
    const GLOBAL = 'GLOBAL_MARKER';
    const JIT = 'JIT_MARKER';
    const MCP = 'MCP_MARKER';
    const ENV_WITH_MCP = 'ENV_WITH_MCP_MARKER';
    const CORE = 'CORE_MARKER';
    const PERSONA = 'You are a focused subagent.';

    function countOccurrences(haystack: string, needle: string): number {
      if (!needle) return 0;
      return haystack.split(needle).length - 1;
    }

    it('sources global plus JIT user memory and delivers the MCP block exactly once when JIT is enabled', async () => {
      const chat = await buildSubagentFixture({
        persona: PERSONA,
        runtimeId: 'test.subagent.jit.enabled',
        jitContextEnabled: true,
        globalMemory: GLOBAL,
        // Under JIT, Config.getUserMemory() folds in environment memory (which
        // already carries MCP instructions). Simulate that contract so the test
        // proves the shared policy avoids that accessor under JIT.
        userMemory: `${GLOBAL}

${ENV_WITH_MCP}`,
        jitMemory: JIT,
        mcpInstructions: MCP,
        coreMemory: CORE,
        workingDir: '/sub/work',
      });

      // --- Creation-time assembly ---
      expect(mockGetCorePrompt).toHaveBeenCalledTimes(1);
      const creationArgs = mockGetCorePrompt.mock.calls[0][0];
      expect(creationArgs).toMatchObject({
        interactionMode: 'subagent',
        includeSubagentDelegation: false,
        coreMemory: CORE,
        mcpInstructions: MCP,
      });
      // User memory must carry global + JIT subdirectory memory and must NOT
      // carry the environment-memory channel (which would double MCP).
      expect(creationArgs.userMemory).toBe(`${GLOBAL}

${JIT}`);
      expect(creationArgs.userMemory).not.toContain(ENV_WITH_MCP);
      expect(creationArgs.userMemory).not.toContain(MCP);

      // --- Per-turn assembly ---
      await chat.sendMessage({ message: 'do it' }, 'p1');
      expect(mockGetCorePrompt).toHaveBeenCalledTimes(2);
      const turnArgs = mockGetCorePrompt.mock.calls[1][0];
      expect(turnArgs).toMatchObject({
        interactionMode: 'subagent',
        coreMemory: CORE,
        mcpInstructions: MCP,
      });
      expect(turnArgs.userMemory).toBe(`${GLOBAL}

${JIT}`);
      expect(turnArgs.userMemory).not.toContain(MCP);

      // The rendered prompt the provider receives must contain the JIT
      // subdirectory marker and the MCP marker exactly once.
      const rendered = capturedCalls[0].systemInstruction as string;
      expect(rendered).toContain(JIT);
      expect(countOccurrences(rendered, MCP)).toBe(1);
      expect(rendered).toContain(PERSONA);
    });

    it('preserves the getUserMemory path and a single MCP block when JIT is disabled', async () => {
      const USER = 'USER_MEMORY_MARKER';
      const chat = await buildSubagentFixture({
        persona: PERSONA,
        runtimeId: 'test.subagent.jit.disabled',
        jitContextEnabled: false,
        userMemory: USER,
        // Production returns '' when JIT is disabled.
        jitMemory: '',
        mcpInstructions: MCP,
        coreMemory: CORE,
      });

      // Creation-time assembly: unchanged user-memory path, no JIT memory.
      const creationArgs = mockGetCorePrompt.mock.calls[0][0];
      expect(creationArgs).toMatchObject({
        interactionMode: 'subagent',
        coreMemory: CORE,
        mcpInstructions: MCP,
      });
      expect(creationArgs.userMemory).toBe(USER);

      // Per-turn assembly: identical policy behavior.
      await chat.sendMessage({ message: 'go' }, 'p1');
      const turnArgs = mockGetCorePrompt.mock.calls[1][0];
      expect(turnArgs.userMemory).toBe(USER);
      expect(turnArgs).toMatchObject({
        coreMemory: CORE,
        mcpInstructions: MCP,
      });

      // Exactly one MCP marker reaches the provider.
      const rendered = capturedCalls[0].systemInstruction as string;
      expect(countOccurrences(rendered, MCP)).toBe(1);
    });
  });

  describe('Subagent system-prompt provider (issue #3176, D5)', () => {
    it('sends a prompt rendered for the executing provider, not ambient settings', async () => {
      settingsService.set('activeProvider', 'foreground-provider-alpha');
      const chat = await buildSubagentFixture({
        persona: 'You are a subagent.',
        runtimeId: 'test.subagent.provider',
        provider: 'subagent-provider-beta',
      });

      await chat.sendMessage({ message: 'do the task' }, 'p1');

      const sentPrompt = capturedCalls[0].systemInstruction as string;
      expect(sentPrompt).toContain('provider=subagent-provider-beta');
      expect(sentPrompt).not.toContain('provider=foreground-provider-alpha');
    });

    it('keeps the runtime provider while resolving the current request model', async () => {
      settingsService.set('activeProvider', 'foreground-provider-alpha');
      const chat = await buildSubagentFixture({
        persona: 'You are a subagent.',
        runtimeId: 'test.subagent.coherence',
        provider: 'subagent-provider-beta',
      });

      settingsService.set('activeProvider', 'unrelated-provider-switch');
      settingsService.set('model', 'sub-model-v2');
      await chat.sendMessage({ message: 'go' }, 'p1');

      const sentPrompt = capturedCalls[0].systemInstruction as string;
      expect(sentPrompt).toContain('provider=subagent-provider-beta');
      expect(sentPrompt).toContain('model=sub-model-v2');
      expect(sentPrompt).not.toContain('provider=unrelated-provider-switch');
    });
  });
});
