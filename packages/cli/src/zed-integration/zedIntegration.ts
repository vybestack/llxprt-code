/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Config,
  type AgentChatContract,
  type AgentClientContract,
  clearCachedCredentialFile,
  getErrorStatus,
  DebugLogger,
  getFunctionCalls,
  EmojiFilter,
  type FilterConfiguration,
  todoEvents,
  type TodoUpdateEvent,
  type Todo,
  DEFAULT_AGENT_ID,
  type ApprovalMode,
  debugLogger,
  createInkStdio,
} from '@vybestack/llxprt-code-core';
import * as acp from '@agentclientprotocol/sdk';
import {
  StreamEventType,
  type StreamEvent,
} from '@vybestack/llxprt-code-agents';

import { Readable, Writable } from 'node:stream';
import { type Content, type Part, type FunctionCall } from '@google/genai';
import { type LoadedSettings } from '../config/settings.js';
import { randomUUID } from 'crypto';
import {
  getActiveProfileName,
  loadProfileByName,
  setCliRuntimeContext,
} from '@vybestack/llxprt-code-providers/runtime/runtimeSettings.js';
import { runExitCleanup } from '../utils/cleanup.js';
import { AcpFileSystemService } from './fileSystemService.js';
import { parseZedAuthMethodId, buildAvailableModes } from './zed-helpers.js';
import { ZedPathResolver } from './zed-path-resolver.js';
import { ZedToolHandler } from './zed-tool-handler.js';
import {
  applyRuntimeProviderOverrides,
  activateProviderFromConfig,
  applyProfileModelParams,
  authenticateWithProviderOrFallback,
  verifyContentGeneratorConfig,
  startChatWithRetry,
} from './zed-provider-auth.js';

export { parseZedAuthMethodId } from './zed-helpers.js';

function isAbortSignalAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function getRuntimeAgentClient(
  config: Config,
): AgentClientContract | undefined {
  return (
    config as { getAgentClient: () => AgentClientContract | undefined }
  ).getAgentClient();
}

export async function runZedIntegration(
  config: Config,
  settings: LoadedSettings,
): Promise<void> {
  const logger = new DebugLogger('llxprt:zed-integration');
  logger.debug(() => 'Starting Zed integration');

  const { stdout: workingStdout } = createInkStdio();
  const stdout = Writable.toWeb(workingStdout) as WritableStream;
  const stdin = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;

  logger.debug(() => 'Streams created');

  setCliRuntimeContext(config.getSettingsService(), config, {
    metadata: { source: 'zed-integration', stage: 'bootstrap' },
  });

  try {
    const stream = acp.ndJsonStream(stdout, stdin);
    const connection = new acp.AgentSideConnection((conn) => {
      logger.debug(() => 'Creating GeminiAgent');
      return new GeminiAgent(config, settings, conn);
    }, stream);
    logger.debug(() => 'AgentSideConnection created successfully');

    await connection.closed.finally(() => {
      void runExitCleanup();
    });
  } catch (e) {
    logger.debug(() => `ERROR: Failed to create AgentSideConnection: ${e}`);
    throw e;
  }
}

export class GeminiAgent {
  private sessions: Map<string, Session> = new Map();
  private clientCapabilities: acp.ClientCapabilities | undefined;
  private logger: DebugLogger;

  constructor(
    private config: Config,
    _settings: LoadedSettings,
    private connection: acp.AgentSideConnection,
  ) {
    this.logger = new DebugLogger('llxprt:zed-integration');
  }

  async initialize(
    args: acp.InitializeRequest,
  ): Promise<acp.InitializeResponse> {
    this.clientCapabilities = args.clientCapabilities;
    const profileManager = this.config.getProfileManager();
    const profileNames = profileManager
      ? await profileManager.listProfiles()
      : [];
    const authMethods = profileNames.map((name) => ({
      id: name,
      name,
      description: null,
    }));

    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      authMethods,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          image: true,
          audio: true,
          embeddedContext: true,
        },
      },
    };
  }

  async applyRuntimeProviderOverrides(): Promise<void> {
    await applyRuntimeProviderOverrides(this.config, this.logger);
  }

  async authenticate({ methodId }: acp.AuthenticateRequest): Promise<void> {
    const profileManager = this.config.getProfileManager();
    const availableProfiles = profileManager
      ? await profileManager.listProfiles()
      : [];
    const profileName = parseZedAuthMethodId(methodId, availableProfiles);

    const currentProfile = getActiveProfileName();
    if (!currentProfile || currentProfile !== profileName) {
      await clearCachedCredentialFile();
    }

    await loadProfileByName(profileName);
    await this.applyRuntimeProviderOverrides();
  }

  async newSession({
    cwd: _cwd,
    mcpServers: _mcpServers,
  }: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    try {
      const sessionId = randomUUID();
      const sessionConfig = this.config;

      this.logger.debug(() => `newSession - creating session ${sessionId}`);

      if (this.clientCapabilities?.fs) {
        const acpFileSystemService = new AcpFileSystemService(
          this.connection,
          sessionId,
          this.clientCapabilities.fs,
          sessionConfig.getFileSystemService(),
        );
        sessionConfig.setFileSystemService(acpFileSystemService);
      }

      let agentClient = getRuntimeAgentClient(sessionConfig);
      const hasContentGeneratorConfig =
        sessionConfig.getContentGeneratorConfig() !== undefined;

      this.logger.debug(
        () =>
          `AgentClient exists: ${!!agentClient}, ContentGeneratorConfig exists: ${hasContentGeneratorConfig}`,
      );

      if (!agentClient || !hasContentGeneratorConfig) {
        agentClient = await this.autoAuthenticate(sessionConfig);
      }

      this.logger.debug(() => 'Successfully obtained AgentClient');
      verifyContentGeneratorConfig(sessionConfig, this.logger);

      const chat = await startChatWithRetry(
        agentClient,
        sessionConfig,
        this.logger,
      );
      const session = new Session(
        sessionId,
        chat,
        sessionConfig,
        this.connection,
      );
      this.sessions.set(sessionId, session);

      return {
        sessionId,
        modes: {
          availableModes: buildAvailableModes(),
          currentModeId: sessionConfig.getApprovalMode(),
        },
      };
    } catch (error) {
      this.logger.debug(() => `ERROR in newSession: ${error}`);
      throw error;
    }
  }

  async autoAuthenticate(sessionConfig: Config): Promise<AgentClientContract> {
    this.logger.debug(
      () => 'AgentClient not available - attempting auto-authentication',
    );

    const { providerManager, hasActiveProvider } =
      await activateProviderFromConfig(sessionConfig, this.logger);

    if (hasActiveProvider) {
      try {
        await applyRuntimeProviderOverrides(sessionConfig, this.logger);
      } catch (error) {
        this.logger.debug(
          () =>
            `ERROR: Failed to apply runtime provider overrides: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      applyProfileModelParams(sessionConfig, providerManager, this.logger);
    }

    await authenticateWithProviderOrFallback(
      sessionConfig,
      providerManager,
      this.logger,
    );

    const agentClient = getRuntimeAgentClient(sessionConfig);
    if (!agentClient) {
      throw new Error(
        'Failed to authenticate. Please ensure valid credentials are available.',
      );
    }
    return agentClient;
  }

  async setSessionMode(
    params: acp.SetSessionModeRequest,
  ): Promise<acp.SetSessionModeResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }
    return session.setMode(params.modeId);
  }

  async cancel(params: acp.CancelNotification): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }
    await session.cancelPendingPrompt();
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }
    return session.prompt(params);
  }
}

export class Session {
  private pendingPrompt: AbortController | null = null;
  private emojiFilter: EmojiFilter;
  private logger: DebugLogger;
  private pathResolver: ZedPathResolver;
  private toolHandler: ZedToolHandler;

  constructor(
    private readonly id: string,
    private readonly chat: AgentChatContract,
    private readonly config: Config,
    private readonly connection: acp.AgentSideConnection,
  ) {
    this.logger = new DebugLogger('llxprt:zed-integration');
    const configuredEmojiFilterMode = this.config.getEphemeralSetting(
      'emojifilter',
    ) as 'allowed' | 'auto' | 'warn' | 'error' | undefined;
    const emojiFilterMode = configuredEmojiFilterMode ?? 'auto';
    const filterConfig: FilterConfiguration = { mode: emojiFilterMode };
    this.emojiFilter = new EmojiFilter(filterConfig);

    this.pathResolver = new ZedPathResolver(
      this.config,
      (update) => this.sendUpdate(update),
      (msg) => this.debug(msg),
    );
    this.toolHandler = new ZedToolHandler(
      this.id,
      this.config,
      this.connection,
      (update) => this.sendUpdate(update),
    );

    todoEvents.onTodoUpdated((event: TodoUpdateEvent) => {
      const eventAgentId = event.agentId ?? DEFAULT_AGENT_ID;
      if (event.sessionId === this.id && eventAgentId === DEFAULT_AGENT_ID) {
        this.sendPlanUpdate(event.todos).catch((error) => {
          debugLogger.error('Failed to send plan update to Zed:', error);
        });
      }
    });
  }

  setMode(modeId: acp.SessionModeId): acp.SetSessionModeResponse {
    const availableModes = buildAvailableModes();
    const mode = availableModes.find((m) => m.id === modeId);
    if (!mode) {
      throw new Error(`Invalid or unavailable mode: ${modeId}`);
    }
    this.config.setApprovalMode(mode.id as ApprovalMode);
    return {};
  }

  async cancelPendingPrompt(): Promise<void> {
    if (!this.pendingPrompt) {
      return;
    }
    this.pendingPrompt.abort();
    this.pendingPrompt = null;
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    this.pendingPrompt?.abort();
    const pendingSend = new AbortController();
    this.pendingPrompt = pendingSend;

    const promptId = Math.random().toString(16).slice(2);
    const chat = this.chat;

    let parts: Part[];
    try {
      parts = await this.pathResolver.resolvePrompt(
        params.prompt,
        pendingSend.signal,
      );
    } catch (error) {
      if (
        pendingSend.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        return { stopReason: 'cancelled' };
      }
      throw error;
    }

    let nextMessage: Content | null = { role: 'user', parts };
    let hasStreamedAgentContent = false;
    const fallbackMessages: string[] = [];

    while (nextMessage !== null) {
      const functionCalls: FunctionCall[] = [];

      try {
        const responseStream = await chat.sendMessageStream(
          {
            message: nextMessage.parts ?? [],
            config: { abortSignal: pendingSend.signal },
          },
          promptId,
        );
        nextMessage = null;

        const streamResult = await this.processStreamResponse(
          responseStream,
          pendingSend,
          functionCalls,
        );
        hasStreamedAgentContent =
          streamResult.hasStreamedAgentContent || hasStreamedAgentContent;

        if (pendingSend.signal.aborted) {
          return { stopReason: 'cancelled' };
        }
      } catch (error) {
        if (getErrorStatus(error) === 429) {
          throw new acp.RequestError(
            429,
            'Rate limit exceeded. Try again later.',
          );
        }
        if (
          pendingSend.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          return { stopReason: 'cancelled' };
        }
        throw error;
      }

      if (functionCalls.length > 0) {
        const toolResult = await this.executeToolCalls(
          functionCalls,
          pendingSend.signal,
          promptId,
          fallbackMessages,
        );
        if (toolResult.cancelled) {
          return { stopReason: 'cancelled' };
        }
        nextMessage = toolResult.nextMessage;
      }
    }

    await this.sendFallbackContent(hasStreamedAgentContent, fallbackMessages);
    return { stopReason: 'end_turn' };
  }

  private async processStreamResponse(
    responseStream: AsyncIterable<StreamEvent>,
    pendingSend: AbortController,
    functionCalls: FunctionCall[],
  ): Promise<{ hasStreamedAgentContent: boolean }> {
    const BATCH_INTERVAL_MS = 100;
    let pendingText = '';
    let pendingThought = '';
    let batchTimer: ReturnType<typeof setTimeout> | null = null;
    let hasStreamedAgentContent = false;

    const flushBatch = () => {
      if (batchTimer !== null) {
        clearTimeout(batchTimer);
        batchTimer = null;
      }
      if (pendingThought.length > 0) {
        hasStreamedAgentContent = true;
        void this.sendUpdate({
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: pendingThought },
        });
        pendingThought = '';
      }
      if (pendingText.length > 0) {
        hasStreamedAgentContent = true;
        void this.sendUpdate({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: pendingText },
        });
        pendingText = '';
      }
    };

    const scheduleBatchFlush = () => {
      batchTimer ??= setTimeout(flushBatch, BATCH_INTERVAL_MS);
    };

    for await (const resp of responseStream) {
      if (pendingSend.signal.aborted) {
        break;
      }
      if (
        resp.type === StreamEventType.CHUNK &&
        resp.value.candidates &&
        resp.value.candidates.length > 0
      ) {
        const chunkResult = this.processChunkCandidates(
          resp.value.candidates[0],
          flushBatch,
          hasStreamedAgentContent,
          pendingText,
          pendingThought,
          scheduleBatchFlush,
        );
        hasStreamedAgentContent = chunkResult.hasStreamedAgentContent;
        pendingText = chunkResult.pendingText;
        pendingThought = chunkResult.pendingThought;
      }
      if (resp.type === StreamEventType.CHUNK) {
        const respFunctionCalls = getFunctionCalls(resp.value);
        if (respFunctionCalls && respFunctionCalls.length > 0) {
          functionCalls.push(...respFunctionCalls);
        }
      }
    }

    flushBatch();
    return { hasStreamedAgentContent };
  }

  private processChunkCandidates(
    candidate: { content?: { parts?: Part[] } },
    flushBatch: () => void,
    hasStreamedAgentContent: boolean,
    pendingText: string,
    pendingThought: string,
    scheduleBatchFlush: () => void,
  ): {
    hasStreamedAgentContent: boolean;
    pendingText: string;
    pendingThought: string;
  } {
    for (const part of candidate.content?.parts ?? []) {
      const text = part.text;
      if (text === undefined || text.length === 0) {
        continue;
      }
      const filterResult = this.emojiFilter.filterText(text);
      if (filterResult.blocked) {
        flushBatch();
        hasStreamedAgentContent = true;
        void this.sendUpdate({
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text: '[Error: Response blocked due to emoji detection]',
          },
        });
      } else {
        const filteredText = this.extractFilteredText(filterResult);
        if (filteredText.length > 0) {
          const accumulated = this.accumulateFilteredText(
            part,
            filteredText,
            pendingThought,
            pendingText,
          );
          pendingThought = accumulated.pendingThought;
          pendingText = accumulated.pendingText;
          scheduleBatchFlush();
        }
      }
    }
    return { hasStreamedAgentContent, pendingText, pendingThought };
  }

  private extractFilteredText(filterResult: {
    filtered: string | unknown;
  }): string {
    return typeof filterResult.filtered === 'string'
      ? filterResult.filtered
      : '';
  }

  private accumulateFilteredText(
    part: Part,
    filteredText: string,
    pendingThought: string,
    pendingText: string,
  ): { pendingThought: string; pendingText: string } {
    if (part.thought === true) {
      return { pendingThought: pendingThought + filteredText, pendingText };
    }
    return { pendingThought, pendingText: pendingText + filteredText };
  }

  private async executeToolCalls(
    functionCalls: FunctionCall[],
    signal: AbortSignal,
    promptId: string,
    fallbackMessages: string[],
  ): Promise<
    { nextMessage: Content | null; cancelled: false } | { cancelled: true }
  > {
    const toolResponseParts: Part[] = [];
    for (const fc of functionCalls) {
      if (isAbortSignalAborted(signal)) {
        return { cancelled: true };
      }
      const response = await this.toolHandler.runTool(signal, promptId, fc);
      if (isAbortSignalAborted(signal)) {
        return { cancelled: true };
      }
      toolResponseParts.push(...response.parts);
      if (response.message) {
        fallbackMessages.push(response.message);
      }
    }
    if (toolResponseParts.length > 0) {
      return {
        nextMessage: { role: 'user', parts: toolResponseParts },
        cancelled: false,
      };
    }
    return { nextMessage: null, cancelled: false };
  }

  private async sendFallbackContent(
    hasStreamedAgentContent: boolean,
    fallbackMessages: string[],
  ): Promise<void> {
    if (hasStreamedAgentContent || fallbackMessages.length === 0) {
      return;
    }
    const combinedMessage = fallbackMessages
      .map((message) => message.trim())
      .filter((message) => message.length > 0)
      .join('\n\n');
    if (combinedMessage.length > 0) {
      await this.sendUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: combinedMessage },
      });
    }
  }

  private async sendUpdate(update: acp.SessionUpdate): Promise<void> {
    const params: acp.SessionNotification = { sessionId: this.id, update };
    this.logger.debug(
      () =>
        `sendUpdate: ${update.sessionUpdate} ${
          'content' in update && update.content && 'text' in update.content
            ? `(${(update.content as { text: string }).text.length} chars)`
            : ''
        }`,
    );
    try {
      await this.connection.sessionUpdate(params);
      this.logger.debug(() => 'sendUpdate: delivered');
    } catch (error) {
      this.logger.debug(
        () =>
          `sendUpdate ERROR: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  debug(msg: string) {
    if (this.config.getDebugMode()) {
      debugLogger.warn(msg);
    }
  }

  private async sendPlanUpdate(todos: Todo[]): Promise<void> {
    const entries: acp.PlanEntry[] = todos.map((todo) => ({
      content: todo.content,
      status: todo.status,
      priority: 'medium' as const,
    }));
    await this.sendUpdate({ sessionUpdate: 'plan', entries });
  }
}
