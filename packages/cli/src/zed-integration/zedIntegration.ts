/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { WritableStream, ReadableStream } from 'node:stream/web';

import {
  AuthType,
  Config,
  ContentGeneratorConfig,
  GeminiChat,
  logToolCall,
  ToolResult,
  convertToFunctionResponse,
  ToolCallConfirmationDetails,
  ToolConfirmationOutcome,
  ContextAwareTool,
  clearCachedCredentialFile,
  isNodeError,
  getErrorMessage,
  isWithinRoot,
  getErrorStatus,
  DiscoveredMCPTool,
  DebugLogger,
  getFunctionCalls,
  getResponseTextFromParts,
  EmojiFilter,
  FilterConfiguration,
  StreamEventType,
  todoEvents,
  type TodoUpdateEvent,
  type Todo,
  DEFAULT_AGENT_ID,
} from '@vybestack/llxprt-code-core';
import * as acp from './acp.js';
import { AcpFileSystemService } from './fileSystemService.js';
import { Readable, Writable } from 'node:stream';
import { Content, Part, FunctionCall, PartListUnion } from '@google/genai';
import { LoadedSettings, SettingScope } from '../config/settings.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import os from 'os';

import { randomUUID } from 'crypto';
import {
  setProviderApiKey,
  setProviderBaseUrl,
} from '../providers/providerConfigUtils.js';
import {
  setCliRuntimeContext,
  switchActiveProvider,
  setActiveModelParam,
  clearActiveModelParam,
  getActiveModelParams,
} from '../runtime/runtimeSettings.js';

type ToolRunResult = {
  parts: Part[];
  message?: string | null;
};

export async function runZedIntegration(
  config: Config,
  settings: LoadedSettings,
): Promise<never> {
  const logger = new DebugLogger('llxprt:zed-integration');
  logger.debug(() => 'Starting Zed integration');

  const stdout = Writable.toWeb(process.stdout) as WritableStream;

  const stdin = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;

  logger.debug(() => 'Streams created');

  /**
   * @plan:PLAN-20250218-STATELESSPROVIDER.P07
   * @requirement:REQ-SP-005
   * Align Zed integration with cli-runtime pseudocode by registering the
   * current Config/SettingsService pair before spawning session handlers.
   * @pseudocode:cli-runtime.md lines 2-11
   */
  setCliRuntimeContext(config.getSettingsService(), config, {
    metadata: { source: 'zed-integration', stage: 'bootstrap' },
  });

  try {
    new acp.AgentSideConnection(
      (client: acp.Client) => {
        logger.debug(() => 'Creating GeminiAgent');
        return new GeminiAgent(config, settings, client);
      },
      stdout,
      stdin,
    );
    logger.debug(() => 'AgentSideConnection created successfully');
  } catch (e) {
    logger.debug(() => `ERROR: Failed to create AgentSideConnection: ${e}`);
    throw e;
  }

  logger.debug(() => 'Zed integration ready, waiting for messages');

  // Keep the process alive - the Connection's #receive method will handle messages
  return await new Promise<never>(() => {
    // This promise never resolves, keeping the process alive
  });
}

class GeminiAgent {
  private sessions: Map<string, Session> = new Map();
  private clientCapabilities: acp.ClientCapabilities | undefined;
  private logger: DebugLogger;

  constructor(
    private config: Config,
    private settings: LoadedSettings,
    private client: acp.Client,
  ) {
    this.logger = new DebugLogger('llxprt:zed-integration');
  }

  /**
   * @plan:PLAN-20250218-STATELESSPROVIDER.P07
   * @requirement:REQ-SP-005
   * Reapply profile-derived credentials and base URLs through runtime helpers
   * to keep provider state in sync with the CLI context.
   * @pseudocode:cli-runtime.md lines 9-15
   */
  private async applyRuntimeProviderOverrides(): Promise<void> {
    const authKey = this.config.getEphemeralSetting('auth-key') as
      | string
      | undefined;
    const authKeyfile = this.config.getEphemeralSetting('auth-keyfile') as
      | string
      | undefined;
    const baseUrl = this.config.getEphemeralSetting('base-url') as
      | string
      | undefined;

    if (authKey && authKey.trim() !== '') {
      const result = await setProviderApiKey(authKey);
      this.logger.debug(() => `[zed-integration] ${result.message}`);
    } else if (authKeyfile) {
      try {
        const resolvedPath = authKeyfile.replace(/^~/, os.homedir());
        const keyFromFile = (await fs.readFile(resolvedPath, 'utf-8')).trim();
        if (keyFromFile) {
          const result = await setProviderApiKey(keyFromFile);
          this.config.setEphemeralSetting('auth-keyfile', resolvedPath);
          this.logger.debug(() => `[zed-integration] ${result.message}`);
        }
      } catch (error) {
        this.logger.debug(
          () =>
            `ERROR: Failed to load keyfile ${authKeyfile}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (baseUrl !== undefined) {
      const result = await setProviderBaseUrl(baseUrl);
      this.logger.debug(() => `[zed-integration] ${result.message}`);
    }
  }

  async initialize(
    args: acp.InitializeRequest,
  ): Promise<acp.InitializeResponse> {
    this.clientCapabilities = args.clientCapabilities;
    const authMethods = [
      {
        id: AuthType.LOGIN_WITH_GOOGLE,
        name: 'Log in with Google',
        description: null,
      },
      {
        id: AuthType.USE_GEMINI,
        name: 'Use Gemini API key',
        description:
          'Requires setting the `GEMINI_API_KEY` environment variable',
      },
      {
        id: AuthType.USE_VERTEX_AI,
        name: 'Vertex AI',
        description: null,
      },
    ];

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

  async authenticate({ methodId }: acp.AuthenticateRequest): Promise<void> {
    const method = z.nativeEnum(AuthType).parse(methodId);

    await clearCachedCredentialFile();
    await this.config.refreshAuth(method);
    this.settings.setValue(SettingScope.User, 'selectedAuthType', method);
  }

  async newSession({
    cwd: _cwd,
    mcpServers: _mcpServers,
  }: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    try {
      const sessionId = randomUUID();

      // Use the existing config that was passed to runZedIntegration
      const sessionConfig = this.config;

      this.logger.debug(() => `newSession - creating session ${sessionId}`);

      if (this.clientCapabilities?.fs) {
        const acpFileSystemService = new AcpFileSystemService(
          this.client,
          sessionId,
          this.clientCapabilities.fs,
          sessionConfig.getFileSystemService(),
        );
        sessionConfig.setFileSystemService(acpFileSystemService);
      }

      // Try to get the client and check if it's properly initialized
      let geminiClient = sessionConfig.getGeminiClient();
      const hasContentGeneratorConfig =
        sessionConfig.getContentGeneratorConfig() !== undefined;

      this.logger.debug(
        () =>
          `GeminiClient exists: ${!!geminiClient}, ContentGeneratorConfig exists: ${hasContentGeneratorConfig}`,
      );

      if (!geminiClient || !hasContentGeneratorConfig) {
        this.logger.debug(
          () => 'GeminiClient not available - attempting auto-authentication',
        );

        // Auto-authenticate based on available configuration
        let providerManager = sessionConfig.getProviderManager();

        // Debug provider state
        if (providerManager) {
          this.logger.debug(
            () =>
              `ProviderManager exists: ${providerManager?.hasActiveProvider?.() ? 'has active provider' : 'no active provider'}`,
          );
          this.logger.debug(
            () =>
              `Active provider name: ${providerManager?.getActiveProviderName?.() || 'none'}`,
          );
        } else {
          this.logger.debug(() => 'No ProviderManager available');
        }

        // Check for provider from config (loaded from profile or CLI)
        const configProvider = sessionConfig.getProvider();
        let hasActiveProvider = providerManager?.hasActiveProvider?.() ?? false;

        if (configProvider) {
          this.logger.debug(() => `Config has provider: ${configProvider}`);
          try {
            /**
             * @plan:PLAN-20250218-STATELESSPROVIDER.P07
             * @requirement:REQ-SP-005
             * Switch active provider via runtime helper to keep Config and
             * SettingsService aligned with stateless semantics.
             * @pseudocode:cli-runtime.md lines 9-12
             */
            const result = await switchActiveProvider(configProvider);
            providerManager = sessionConfig.getProviderManager();
            hasActiveProvider =
              providerManager?.hasActiveProvider?.() ?? result.changed;
            if (result.infoMessages.length > 0) {
              for (const info of result.infoMessages) {
                this.logger.debug(() => `[zed-integration] ${info}`);
              }
            }
          } catch (error) {
            this.logger.debug(
              () =>
                `ERROR: Failed to activate provider ${configProvider}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        if (!hasActiveProvider && providerManager?.hasActiveProvider?.()) {
          hasActiveProvider = true;
        }

        if (hasActiveProvider) {
          try {
            await this.applyRuntimeProviderOverrides();
          } catch (error) {
            this.logger.debug(
              () =>
                `ERROR: Failed to apply runtime provider overrides: ${error instanceof Error ? error.message : String(error)}`,
            );
          }

          const activeProvider = providerManager?.getActiveProvider();
          if (activeProvider) {
            const configWithProfile = sessionConfig as Config & {
              _profileModelParams?: Record<string, unknown>;
              _cliModelParams?: Record<string, unknown>;
            };
            if (
              configWithProfile._profileModelParams &&
              Object.keys(configWithProfile._profileModelParams).length > 0
            ) {
              this.logger.debug(() => 'Setting model params from profile');
              // Apply base URL from ephemeral settings if available
              const ephemeralBaseUrl = this.config.getEphemeralSetting(
                'base-url',
              ) as string | undefined;
              if (
                ephemeralBaseUrl &&
                ephemeralBaseUrl !== 'none' &&
                'setBaseUrl' in activeProvider &&
                typeof (
                  activeProvider as { setBaseUrl?: (url: string) => void }
                ).setBaseUrl === 'function'
              ) {
                this.logger.debug(
                  () => `Setting base URL: ${ephemeralBaseUrl}`,
                );
                (
                  activeProvider as { setBaseUrl: (url: string) => void }
                ).setBaseUrl(ephemeralBaseUrl);
              }

              const mergedModelParams = {
                ...(configWithProfile._profileModelParams || {}),
                ...(configWithProfile._cliModelParams || {}),
              };
              const existingParams = getActiveModelParams();

              for (const [key, value] of Object.entries(mergedModelParams)) {
                setActiveModelParam(key, value);
              }

              for (const key of Object.keys(existingParams)) {
                if (!(key in mergedModelParams)) {
                  clearActiveModelParam(key);
                }
              }
            }
          }
        }

        if (providerManager && providerManager.hasActiveProvider()) {
          // Use provider-based auth if a provider is configured
          this.logger.debug(
            () =>
              `Auto-authenticating with provider: ${providerManager.getActiveProviderName()}`,
          );

          // Ensure provider manager is set on config before refreshAuth
          // This is crucial for createContentGeneratorConfig to include the provider manager
          if (!sessionConfig.getProviderManager()) {
            this.logger.debug(() => 'Setting provider manager on config');
            (
              sessionConfig as unknown as Record<string, unknown>
            ).providerManager = providerManager;

            // Ensure serverToolsProvider (Gemini) has config set BEFORE refreshAuth
            // This is critical for web search to work properly
            const serverToolsProvider =
              providerManager.getServerToolsProvider();
            if (
              serverToolsProvider &&
              serverToolsProvider.name === 'gemini' &&
              'setConfig' in serverToolsProvider &&
              typeof serverToolsProvider.setConfig === 'function'
            ) {
              this.logger.debug(
                () =>
                  'Setting config on serverToolsProvider for web search (before auth)',
              );
              serverToolsProvider.setConfig(sessionConfig);
            }
          }

          await sessionConfig.refreshAuth(AuthType.USE_PROVIDER);

          // After refreshAuth, verify ContentGeneratorConfig was created with provider manager
          const contentGenConfig = sessionConfig.getContentGeneratorConfig();
          if (contentGenConfig && !contentGenConfig.providerManager) {
            this.logger.debug(
              () => 'Adding provider manager to ContentGeneratorConfig',
            );
            contentGenConfig.providerManager = providerManager;
          }
        } else if (process.env.GEMINI_API_KEY) {
          // Use API key if available
          this.logger.debug(() => 'Auto-authenticating with GEMINI_API_KEY');
          await sessionConfig.refreshAuth(AuthType.USE_GEMINI);
        } else {
          // Try OAuth as last resort (this might open a browser)
          this.logger.debug(() => 'Auto-authenticating with OAuth');
          await sessionConfig.refreshAuth(AuthType.LOGIN_WITH_GOOGLE);
        }

        geminiClient = sessionConfig.getGeminiClient();
        if (!geminiClient) {
          throw new Error(
            'Failed to authenticate. Please ensure valid credentials are available.',
          );
        }
      }

      this.logger.debug(() => 'Successfully obtained GeminiClient');

      // Verify ContentGeneratorConfig was created properly
      let contentGenConfig: ContentGeneratorConfig | undefined;
      try {
        contentGenConfig = sessionConfig.getContentGeneratorConfig();
        this.logger.debug(
          () => `ContentGeneratorConfig exists: ${!!contentGenConfig}`,
        );
        if (contentGenConfig) {
          this.logger.debug(
            () =>
              `ContentGeneratorConfig has providerManager: ${!!(contentGenConfig as Record<string, unknown>).providerManager}`,
          );
          this.logger.debug(
            () =>
              `ContentGeneratorConfig authType: ${(contentGenConfig as Record<string, unknown>).authType}`,
          );
        }
      } catch (error) {
        this.logger.debug(
          () => `Failed to get ContentGeneratorConfig: ${error}`,
        );
        throw new Error(
          'Content generator config not created after authentication. Please check your credentials.',
        );
      }

      if (!contentGenConfig) {
        throw new Error(
          'Content generator config not created after authentication.',
        );
      }

      let chat;
      try {
        chat = await geminiClient.startChat();
      } catch (error) {
        this.logger.debug(() => `Error starting chat: ${error}`);

        // If startChat fails due to missing config, try to authenticate now
        if (
          error instanceof Error &&
          error.message.includes('Content generator config')
        ) {
          this.logger.debug(
            () => 'Attempting late authentication due to missing config',
          );

          const providerManager = sessionConfig.getProviderManager();
          if (providerManager && providerManager.hasActiveProvider()) {
            await sessionConfig.refreshAuth(AuthType.USE_PROVIDER);
          } else if (process.env.GEMINI_API_KEY) {
            await sessionConfig.refreshAuth(AuthType.USE_GEMINI);
          } else {
            await sessionConfig.refreshAuth(AuthType.LOGIN_WITH_GOOGLE);
          }

          // Try again after auth
          chat = await geminiClient.startChat();
        } else {
          throw error;
        }
      }
      const session = new Session(sessionId, chat, sessionConfig, this.client);
      this.sessions.set(sessionId, session);

      return {
        sessionId,
      };
    } catch (error) {
      this.logger.debug(() => `ERROR in newSession: ${error}`);
      throw error;
    }
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

class Session {
  private pendingPrompt: AbortController | null = null;
  private emojiFilter: EmojiFilter;

  constructor(
    private readonly id: string,
    private readonly chat: GeminiChat,
    private readonly config: Config,
    private readonly client: acp.Client,
  ) {
    // Initialize emoji filter from settings
    const emojiFilterMode =
      (this.config.getEphemeralSetting('emojifilter') as
        | 'allowed'
        | 'auto'
        | 'warn'
        | 'error') || 'auto';
    const filterConfig: FilterConfiguration = { mode: emojiFilterMode };
    this.emojiFilter = new EmojiFilter(filterConfig);

    // Subscribe to todo events for this session
    todoEvents.onTodoUpdated((event: TodoUpdateEvent) => {
      // Only handle events for this session
      const eventAgentId = event.agentId ?? DEFAULT_AGENT_ID;
      if (event.sessionId === this.id && eventAgentId === DEFAULT_AGENT_ID) {
        this.sendPlanUpdate(event.todos).catch((error) => {
          console.error('Failed to send plan update to Zed:', error);
        });
      }
    });
  }

  async cancelPendingPrompt(): Promise<void> {
    if (!this.pendingPrompt) {
      throw new Error('Not currently generating');
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

    const parts = await this.#resolvePrompt(params.prompt, pendingSend.signal);

    let nextMessage: Content | null = { role: 'user', parts };
    let hasStreamedAgentContent = false;
    const fallbackMessages: string[] = [];

    while (nextMessage !== null) {
      const functionCalls: FunctionCall[] = [];

      try {
        const responseStream = await chat.sendMessageStream(
          {
            message: nextMessage?.parts ?? [],
            config: {
              abortSignal: pendingSend.signal,
            },
          },
          promptId,
        );
        nextMessage = null;

        for await (const resp of responseStream) {
          if (pendingSend.signal.aborted) {
            // Let the stream processing complete naturally to handle cancellation properly
            // Don't return early here - let the tool pipeline handle cleanup
            break;
          }

          if (
            resp.type === StreamEventType.CHUNK &&
            resp.value.candidates &&
            resp.value.candidates.length > 0
          ) {
            const candidate = resp.value.candidates[0];
            for (const part of candidate.content?.parts ?? []) {
              if (!part.text) {
                continue;
              }

              // Filter the content through emoji filter
              const filterResult = this.emojiFilter.filterStreamChunk(
                part.text,
              );

              if (filterResult.blocked) {
                // In error mode: inject error feedback to model for retry
                hasStreamedAgentContent = true;
                this.sendUpdate({
                  sessionUpdate: 'agent_message_chunk',
                  content: {
                    type: 'text',
                    text: '[Error: Response blocked due to emoji detection]',
                  },
                });

                // Add system feedback to be sent with next tool response
                // This could be done by queueing feedback similar to TUI implementation
                continue;
              }

              const filteredText =
                typeof filterResult.filtered === 'string'
                  ? filterResult.filtered
                  : '';

              const trimmedText = filteredText.trim();
              if (trimmedText.length > 0) {
                hasStreamedAgentContent = true;
              }

              const content: acp.ContentBlock = {
                type: 'text',
                text: filteredText,
              };

              this.sendUpdate({
                sessionUpdate: part.thought
                  ? 'agent_thought_chunk'
                  : 'agent_message_chunk',
                content,
              });
            }
          }

          // Extract function calls from the response, checking for chunk type
          if (resp.type === StreamEventType.CHUNK) {
            const respFunctionCalls = getFunctionCalls(resp.value);
            if (respFunctionCalls && respFunctionCalls.length > 0) {
              functionCalls.push(...respFunctionCalls);
            }
          }
        }
      } catch (error) {
        if (getErrorStatus(error) === 429) {
          throw new acp.RequestError(
            429,
            'Rate limit exceeded. Try again later.',
          );
        }

        // If this is an abort error due to cancellation, handle it gracefully
        if (
          pendingSend.signal.aborted &&
          isNodeError(error) &&
          error.name === 'AbortError'
        ) {
          // Don't throw - let the cancellation be handled below
        } else {
          throw error;
        }
      }

      // Check for cancellation after stream processing but before tool execution
      if (pendingSend.signal.aborted) {
        // Return cancellation without adding to conversation history
        // The conversation state should remain clean for proper context handling
        return { stopReason: 'cancelled' };
      }

      if (functionCalls.length > 0) {
        const toolResponseParts: Part[] = [];

        for (const fc of functionCalls) {
          // Check for cancellation before each tool execution
          if (pendingSend.signal.aborted) {
            // Return cancellation without polluting conversation history
            // Tool execution cancellation should be handled by the tool execution system
            return { stopReason: 'cancelled' };
          }

          const response = await this.runTool(pendingSend.signal, promptId, fc);
          toolResponseParts.push(...response.parts);
          if (response.message) {
            fallbackMessages.push(response.message);
          }
        }

        // For multiple tool responses, send them all together as the TUI does
        // This ensures proper conversation history structure for providers like Anthropic
        if (toolResponseParts.length > 0) {
          nextMessage = { role: 'user', parts: toolResponseParts };
        } else {
          nextMessage = null;
        }
      }
    }

    if (!hasStreamedAgentContent && fallbackMessages.length > 0) {
      const combinedMessage = fallbackMessages
        .map((message) => message.trim())
        .filter((message) => message.length > 0)
        .join('\n\n');

      if (combinedMessage.length > 0) {
        await this.sendUpdate({
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text: combinedMessage,
          },
        });
        hasStreamedAgentContent = true;
      }
    }

    return { stopReason: 'end_turn' };
  }

  private async sendUpdate(update: acp.SessionUpdate): Promise<void> {
    const params: acp.SessionNotification = {
      sessionId: this.id,
      update,
    };

    await this.client.sessionUpdate(params);
  }

  private async runTool(
    abortSignal: AbortSignal,
    promptId: string,
    fc: FunctionCall,
  ): Promise<ToolRunResult> {
    const callId = fc.id ?? `${fc.name}-${Date.now()}`;
    const args = (fc.args ?? {}) as Record<string, unknown>;

    const startTime = Date.now();

    const errorResponse = (error: Error): ToolRunResult => {
      const durationMs = Date.now() - startTime;
      logToolCall(this.config, {
        'event.name': 'tool_call',
        'event.timestamp': new Date().toISOString(),
        prompt_id: promptId,
        function_name: fc.name ?? '',
        function_args: args,
        duration_ms: durationMs,
        success: false,
        error: error.message,
        tool_type:
          typeof tool !== 'undefined' && tool instanceof DiscoveredMCPTool
            ? 'mcp'
            : 'native',
        agent_id: DEFAULT_AGENT_ID,
      });

      return {
        parts: [
          {
            functionCall: {
              id: callId,
              name: fc.name ?? '',
              args,
            },
          },
          {
            functionResponse: {
              id: callId,
              name: fc.name ?? '',
              response: { error: error.message },
            },
          },
        ],
        message: error.message,
      };
    };

    if (!fc.name) {
      return errorResponse(new Error('Missing function name'));
    }

    const toolRegistry = this.config.getToolRegistry();
    const tool = toolRegistry.getTool(fc.name as string);

    if (!tool) {
      return errorResponse(
        new Error(`Tool "${fc.name}" not found in registry.`),
      );
    }

    try {
      if ('context' in tool) {
        (tool as ContextAwareTool).context = {
          sessionId: this.id,
          interactiveMode: true,
        };
      }

      const invocation = tool.build(args);

      const confirmationDetails =
        await invocation.shouldConfirmExecute(abortSignal);

      if (confirmationDetails) {
        const content: acp.ToolCallContent[] = [];

        if (confirmationDetails.type === 'edit') {
          content.push({
            type: 'diff',
            path: confirmationDetails.fileName,
            oldText: confirmationDetails.originalContent,
            newText: confirmationDetails.newContent,
          });
        }

        const params: acp.RequestPermissionRequest = {
          sessionId: this.id,
          options: toPermissionOptions(confirmationDetails),
          toolCall: {
            toolCallId: callId,
            status: 'pending',
            title: invocation.getDescription(),
            content,
            locations: invocation.toolLocations(),
            kind: tool.kind,
          },
        };

        const output = await this.client.requestPermission(params);
        const outcome =
          output.outcome.outcome === 'cancelled'
            ? ToolConfirmationOutcome.Cancel
            : z
                .nativeEnum(ToolConfirmationOutcome)
                .parse(output.outcome.optionId);

        await confirmationDetails.onConfirm(outcome);

        switch (outcome) {
          case ToolConfirmationOutcome.Cancel:
            return errorResponse(
              new Error(`Tool "${fc.name}" was canceled by the user.`),
            );
          case ToolConfirmationOutcome.ProceedOnce:
          case ToolConfirmationOutcome.ProceedAlways:
          case ToolConfirmationOutcome.ProceedAlwaysServer:
          case ToolConfirmationOutcome.ProceedAlwaysTool:
          case ToolConfirmationOutcome.ModifyWithEditor:
            break;
          default: {
            const resultOutcome: never = outcome;
            throw new Error(`Unexpected: ${resultOutcome}`);
          }
        }
      } else {
        await this.sendUpdate({
          sessionUpdate: 'tool_call',
          toolCallId: callId,
          status: 'in_progress',
          title: invocation.getDescription(),
          content: [],
          locations: invocation.toolLocations(),
          kind: tool.kind,
        });
      }

      const toolResult: ToolResult = await invocation.execute(abortSignal);
      const content = toToolCallContent(toolResult);

      await this.sendUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: callId,
        status: 'completed',
        content: content ? [content] : [],
      });

      const durationMs = Date.now() - startTime;
      logToolCall(this.config, {
        'event.name': 'tool_call',
        'event.timestamp': new Date().toISOString(),
        function_name: fc.name,
        function_args: args,
        duration_ms: durationMs,
        success: true,
        prompt_id: promptId,
        tool_type:
          typeof tool !== 'undefined' && tool instanceof DiscoveredMCPTool
            ? 'mcp'
            : 'native',
        agent_id: DEFAULT_AGENT_ID,
      });

      const functionResponseParts = convertToFunctionResponse(
        fc.name,
        callId,
        toolResult.llmContent,
      );
      const message = this.extractToolResultText(toolResult);

      return {
        parts: [
          {
            functionCall: {
              id: callId,
              name: fc.name,
              args,
            },
          },
          ...functionResponseParts,
        ],
        message,
      };
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));

      await this.sendUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: callId,
        status: 'failed',
        content: [
          { type: 'content', content: { type: 'text', text: error.message } },
        ],
      });

      return errorResponse(error);
    }
  }

  private extractToolResultText(toolResult: ToolResult): string | null {
    const textFromLlmContent = this.extractTextFromPartList(
      toolResult.llmContent,
    );
    if (textFromLlmContent) {
      return textFromLlmContent;
    }

    if (typeof toolResult.returnDisplay === 'string') {
      const trimmed = toolResult.returnDisplay.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }

    return null;
  }

  private extractTextFromPartList(
    llmContent: PartListUnion | undefined,
  ): string | null {
    if (!llmContent) {
      return null;
    }

    if (typeof llmContent === 'string') {
      const trimmed = llmContent.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    const parts = this.normalizeToParts(llmContent);
    const text = getResponseTextFromParts(parts);
    if (text) {
      const trimmed = text.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }

    for (const part of parts) {
      const response = part.functionResponse?.response;
      const extracted = this.extractOutputString(response);
      if (extracted) {
        return extracted;
      }
    }

    return null;
  }

  private normalizeToParts(input: PartListUnion): Part[] {
    if (typeof input === 'string') {
      return [{ text: input }];
    }

    if (Array.isArray(input)) {
      return input.flatMap((item) =>
        this.normalizeToParts(item as PartListUnion),
      );
    }

    if (this.isContent(input)) {
      return input.parts ?? [];
    }

    return [input as Part];
  }

  private extractOutputString(response: unknown): string | null {
    if (!response) {
      return null;
    }

    if (typeof response === 'string') {
      const trimmed = response.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    if (typeof response !== 'object') {
      return null;
    }

    const responseRecord = response as Record<string, unknown>;

    const output = responseRecord.output;
    if (typeof output === 'string') {
      const trimmed = output.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }

    if (responseRecord.content) {
      const contentParts = this.normalizeToParts(
        responseRecord.content as PartListUnion,
      );
      const text = getResponseTextFromParts(contentParts);
      if (text) {
        const trimmed = text.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }

    return null;
  }

  private isContent(value: unknown): value is Content {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as Partial<Content>;
    return Array.isArray(candidate.parts);
  }

  async #resolvePrompt(
    message: acp.ContentBlock[],
    abortSignal: AbortSignal,
  ): Promise<Part[]> {
    const FILE_URI_SCHEME = 'file://';

    const embeddedContext: acp.EmbeddedResourceResource[] = [];

    const parts = message.map((part) => {
      switch (part.type) {
        case 'text':
          return { text: part.text };
        case 'image':
        case 'audio':
          return {
            inlineData: {
              mimeType: part.mimeType,
              data: part.data,
            },
          };
        case 'resource_link': {
          if (part.uri.startsWith(FILE_URI_SCHEME)) {
            return {
              fileData: {
                mimeData: part.mimeType,
                name: part.name,
                fileUri: part.uri.slice(FILE_URI_SCHEME.length),
              },
            };
          } else {
            return { text: `@${part.uri}` };
          }
        }
        case 'resource': {
          embeddedContext.push(part.resource);
          return { text: `@${part.resource.uri}` };
        }
        default: {
          const unreachable: never = part;
          throw new Error(`Unexpected chunk type: '${unreachable}'`);
        }
      }
    });

    const atPathCommandParts = parts.filter((part) => 'fileData' in part);

    if (atPathCommandParts.length === 0 && embeddedContext.length === 0) {
      return parts;
    }

    const atPathToResolvedSpecMap = new Map<string, string>();

    // Get centralized file discovery service
    const fileDiscovery = this.config.getFileService();
    const respectGitIgnore = this.config.getFileFilteringRespectGitIgnore();

    const pathSpecsToRead: string[] = [];
    const contentLabelsForDisplay: string[] = [];
    const ignoredPaths: string[] = [];

    const toolRegistry = this.config.getToolRegistry();
    const readManyFilesTool = toolRegistry.getTool('read_many_files');
    const globTool = toolRegistry.getTool('glob');

    if (!readManyFilesTool) {
      throw new Error('Error: read_many_files tool not found.');
    }

    for (const atPathPart of atPathCommandParts) {
      const pathName = atPathPart.fileData!.fileUri;
      // Check if path should be ignored by git
      if (fileDiscovery.shouldGitIgnoreFile(pathName)) {
        ignoredPaths.push(pathName);
        const reason = respectGitIgnore
          ? 'git-ignored and will be skipped'
          : 'ignored by custom patterns';
        console.warn(`Path ${pathName} is ${reason}.`);
        continue;
      }
      let currentPathSpec = pathName;
      let resolvedSuccessfully = false;
      try {
        const absolutePath = path.resolve(this.config.getTargetDir(), pathName);
        if (isWithinRoot(absolutePath, this.config.getTargetDir())) {
          const stats = await fs.stat(absolutePath);
          if (stats.isDirectory()) {
            currentPathSpec = pathName.endsWith('/')
              ? `${pathName}**`
              : `${pathName}/**`;
            this.debug(
              `Path ${pathName} resolved to directory, using glob: ${currentPathSpec}`,
            );
          } else {
            this.debug(`Path ${pathName} resolved to file: ${currentPathSpec}`);
          }
          resolvedSuccessfully = true;
        } else {
          this.debug(
            `Path ${pathName} is outside the project directory. Skipping.`,
          );
        }
      } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
          if (this.config.getEnableRecursiveFileSearch() && globTool) {
            this.debug(
              `Path ${pathName} not found directly, attempting glob search.`,
            );
            try {
              const globResult = await globTool.buildAndExecute(
                {
                  pattern: `**/*${pathName}*`,
                  path: this.config.getTargetDir(),
                },
                abortSignal,
              );
              if (
                globResult.llmContent &&
                typeof globResult.llmContent === 'string' &&
                !globResult.llmContent.startsWith('No files found') &&
                !globResult.llmContent.startsWith('Error:')
              ) {
                const lines = globResult.llmContent.split('\n');
                if (lines.length > 1 && lines[1]) {
                  const firstMatchAbsolute = lines[1].trim();
                  currentPathSpec = path.relative(
                    this.config.getTargetDir(),
                    firstMatchAbsolute,
                  );
                  this.debug(
                    `Glob search for ${pathName} found ${firstMatchAbsolute}, using relative path: ${currentPathSpec}`,
                  );
                  resolvedSuccessfully = true;
                } else {
                  this.debug(
                    `Glob search for '**/*${pathName}*' did not return a usable path. Path ${pathName} will be skipped.`,
                  );
                }
              } else {
                this.debug(
                  `Glob search for '**/*${pathName}*' found no files or an error. Path ${pathName} will be skipped.`,
                );
              }
            } catch (globError) {
              console.error(
                `Error during glob search for ${pathName}: ${getErrorMessage(globError)}`,
              );
            }
          } else {
            this.debug(
              `Glob tool not found. Path ${pathName} will be skipped.`,
            );
          }
        } else {
          console.error(
            `Error stating path ${pathName}. Path ${pathName} will be skipped.`,
          );
        }
      }
      if (resolvedSuccessfully) {
        pathSpecsToRead.push(currentPathSpec);
        atPathToResolvedSpecMap.set(pathName, currentPathSpec);
        contentLabelsForDisplay.push(pathName);
      }
    }

    // Construct the initial part of the query for the LLM
    let initialQueryText = '';
    for (let i = 0; i < parts.length; i++) {
      const chunk = parts[i];
      if ('text' in chunk) {
        initialQueryText += chunk.text;
      } else {
        // type === 'atPath'
        const resolvedSpec =
          chunk.fileData && atPathToResolvedSpecMap.get(chunk.fileData.fileUri);
        if (
          i > 0 &&
          initialQueryText.length > 0 &&
          !initialQueryText.endsWith(' ') &&
          resolvedSpec
        ) {
          // Add space if previous part was text and didn't end with space, or if previous was @path
          const prevPart = parts[i - 1];
          if (
            'text' in prevPart ||
            ('fileData' in prevPart &&
              atPathToResolvedSpecMap.has(prevPart.fileData!.fileUri))
          ) {
            initialQueryText += ' ';
          }
        }
        if (resolvedSpec) {
          initialQueryText += `@${resolvedSpec}`;
        } else {
          // If not resolved for reading (e.g. lone @ or invalid path that was skipped),
          // add the original @-string back, ensuring spacing if it's not the first element.
          if (
            i > 0 &&
            initialQueryText.length > 0 &&
            !initialQueryText.endsWith(' ') &&
            !chunk.fileData?.fileUri.startsWith(' ')
          ) {
            initialQueryText += ' ';
          }
          if (chunk.fileData?.fileUri) {
            initialQueryText += `@${chunk.fileData.fileUri}`;
          }
        }
      }
    }
    initialQueryText = initialQueryText.trim();
    // Inform user about ignored paths
    if (ignoredPaths.length > 0) {
      const ignoreType = respectGitIgnore ? 'git-ignored' : 'custom-ignored';
      this.debug(
        `Ignored ${ignoredPaths.length} ${ignoreType} files: ${ignoredPaths.join(', ')}`,
      );
    }

    const processedQueryParts: Part[] = [{ text: initialQueryText }];

    if (pathSpecsToRead.length === 0 && embeddedContext.length === 0) {
      // Fallback for lone "@" or completely invalid @-commands resulting in empty initialQueryText
      console.warn('No valid file paths found in @ commands to read.');
      return [{ text: initialQueryText }];
    }

    if (pathSpecsToRead.length > 0) {
      const toolArgs = {
        paths: pathSpecsToRead,
        respectGitIgnore, // Use configuration setting
      };

      const callId = `${readManyFilesTool.name}-${Date.now()}`;

      try {
        const invocation = readManyFilesTool.build(toolArgs);

        await this.sendUpdate({
          sessionUpdate: 'tool_call',
          toolCallId: callId,
          status: 'in_progress',
          title: invocation.getDescription(),
          content: [],
          locations: invocation.toolLocations(),
          kind: readManyFilesTool.kind,
        });

        const result = await invocation.execute(abortSignal);
        const content = toToolCallContent(result) || {
          type: 'content',
          content: {
            type: 'text',
            text: `Successfully read: ${contentLabelsForDisplay.join(', ')}`,
          },
        };
        await this.sendUpdate({
          sessionUpdate: 'tool_call_update',
          toolCallId: callId,
          status: 'completed',
          content: content ? [content] : [],
        });
        if (Array.isArray(result.llmContent)) {
          const fileContentRegex = /^--- (.*?) ---\n\n([\s\S]*?)\n\n$/;
          processedQueryParts.push({
            text: '\n--- Content from referenced files ---',
          });
          for (const part of result.llmContent) {
            if (typeof part === 'string') {
              const match = fileContentRegex.exec(part);
              if (match) {
                const filePathSpecInContent = match[1]; // This is a resolved pathSpec
                const fileActualContent = match[2].trim();
                processedQueryParts.push({
                  text: `\nContent from @${filePathSpecInContent}:\n`,
                });
                processedQueryParts.push({ text: fileActualContent });
              } else {
                processedQueryParts.push({ text: part });
              }
            } else {
              // part is a Part object.
              processedQueryParts.push(part);
            }
          }
        } else {
          console.warn(
            'read_many_files tool returned no content or empty content.',
          );
        }
      } catch (error: unknown) {
        await this.sendUpdate({
          sessionUpdate: 'tool_call_update',
          toolCallId: callId,
          status: 'failed',
          content: [
            {
              type: 'content',
              content: {
                type: 'text',
                text: `Error reading files (${contentLabelsForDisplay.join(', ')}): ${getErrorMessage(error)}`,
              },
            },
          ],
        });

        throw error;
      }
    }

    if (embeddedContext.length > 0) {
      processedQueryParts.push({
        text: '\n--- Content from referenced context ---',
      });

      for (const contextPart of embeddedContext) {
        processedQueryParts.push({
          text: `\nContent from @${contextPart.uri}:\n`,
        });
        if ('text' in contextPart) {
          processedQueryParts.push({
            text: contextPart.text,
          });
        } else {
          processedQueryParts.push({
            inlineData: {
              mimeType: contextPart.mimeType ?? 'application/octet-stream',
              data: contextPart.blob,
            },
          });
        }
      }
    }

    return processedQueryParts;
  }

  debug(msg: string) {
    if (this.config.getDebugMode()) {
      console.warn(msg);
    }
  }

  private async sendPlanUpdate(todos: Todo[]): Promise<void> {
    // Convert llxprt-code Todo format to ACP PlanEntry format
    const entries: acp.PlanEntry[] = todos.map((todo) => ({
      content: todo.content,
      status: todo.status,
      priority: todo.priority,
    }));

    // Send plan update to Zed via ACP protocol
    await this.sendUpdate({
      sessionUpdate: 'plan',
      entries,
    });
  }
}

function toToolCallContent(toolResult: ToolResult): acp.ToolCallContent | null {
  if (toolResult.error?.message) {
    throw new Error(toolResult.error.message);
  }

  if (toolResult.returnDisplay) {
    if (typeof toolResult.returnDisplay === 'string') {
      return {
        type: 'content',
        content: { type: 'text', text: toolResult.returnDisplay },
      };
    } else {
      return {
        type: 'diff',
        path: toolResult.returnDisplay.fileName,
        oldText: toolResult.returnDisplay.originalContent,
        newText: toolResult.returnDisplay.newContent,
      };
    }
  } else {
    return null;
  }
}

const basicPermissionOptions = [
  {
    optionId: ToolConfirmationOutcome.ProceedOnce,
    name: 'Allow',
    kind: 'allow_once',
  },
  {
    optionId: ToolConfirmationOutcome.Cancel,
    name: 'Reject',
    kind: 'reject_once',
  },
] as const;

function toPermissionOptions(
  confirmation: ToolCallConfirmationDetails,
): acp.PermissionOption[] {
  switch (confirmation.type) {
    case 'edit':
      return [
        {
          optionId: ToolConfirmationOutcome.ProceedAlways,
          name: 'Allow All Edits',
          kind: 'allow_always',
        },
        ...basicPermissionOptions,
      ];
    case 'exec':
      return [
        {
          optionId: ToolConfirmationOutcome.ProceedAlways,
          name: `Always Allow ${confirmation.rootCommand}`,
          kind: 'allow_always',
        },
        ...basicPermissionOptions,
      ];
    case 'mcp':
      return [
        {
          optionId: ToolConfirmationOutcome.ProceedAlwaysServer,
          name: `Always Allow ${confirmation.serverName}`,
          kind: 'allow_always',
        },
        {
          optionId: ToolConfirmationOutcome.ProceedAlwaysTool,
          name: `Always Allow ${confirmation.toolName}`,
          kind: 'allow_always',
        },
        ...basicPermissionOptions,
      ];
    case 'info':
      return [
        {
          optionId: ToolConfirmationOutcome.ProceedAlways,
          name: `Always Allow`,
          kind: 'allow_always',
        },
        ...basicPermissionOptions,
      ];
    default: {
      const unreachable: never = confirmation;
      throw new Error(`Unexpected: ${unreachable}`);
    }
  }
}
