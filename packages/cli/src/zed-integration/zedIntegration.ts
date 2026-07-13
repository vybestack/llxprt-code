/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type Config,
  getErrorStatus,
  todoEvents,
  DEFAULT_AGENT_ID,
  debugLogger,
  createInkStdio,
  type ContractPart,
  DebugLogger,
  EmojiFilter,
  type FilterConfiguration,
  type IContent,
  type TodoUpdateEvent,
  type ApprovalMode,
} from '@vybestack/llxprt-code-core';
import * as acp from '@agentclientprotocol/sdk';
import {
  fromConfig,
  getTokenLimitForConfiguredContext,
  type Agent,
  type AgentEvent,
} from '@vybestack/llxprt-code-agents';
import { Readable, Writable } from 'node:stream';
import { type LoadedSettings } from '../config/settings.js';
import { randomUUID } from 'crypto';
import { setCliRuntimeContext } from '@vybestack/llxprt-code-providers/runtime.js';
import { runExitCleanup } from '../utils/cleanup.js';
import { AcpFileSystemService } from './fileSystemService.js';
import {
  buildAvailableModes,
  buildSessionModes,
  buildUsageUpdate,
  describeSessionUpdateForLog,
  mapDoneReasonToStopReason,
  extractThoughtText,
  translateErrorEvent,
  translateIdleTimeout,
} from './zed-helpers.js';
import { ZedPathResolver } from './zed-path-resolver.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  emitAgentToolEvent,
  requestToolConfirmation,
  type PermissionRoundTripResult,
} from './zed-tool-handler.js';
import { mapHistoryToSessionUpdates } from './zed-session-replay.js';
import { wrapReplayFailure } from './zed-session-errors.js';
import {
  resumeAgentHistory,
  toLoadRequestError,
  hasRecordedSessionFile,
  readAgentHistoryForReplay,
  nodeChatSessionFileLister,
  type ChatSessionFileLister,
} from './zed-session-loader.js';
import { StreamBatcher } from './zed-stream-batcher.js';
import { SessionLifecycle } from './zed-session-lifecycle.js';
import type { LifecycleSession } from './zed-session-pagination.js';
import { authenticateZedAgent, initializeZedAgent } from './zed-initialize.js';
import {
  createSessionScopedConfig,
  resolveSessionTargetDir,
} from './zed-session-config.js';
import { buildAvailableCommandsUpdate } from './zed-command-registry.js';
import { tryHandleZedCommand } from './zed-prompt-command.js';
import {
  buildZedConfigOptions,
  dispatchZedConfigOption,
  observeZedConfigOptions,
  setZedConfigOption,
  zedConfigOptionsForClient,
  zedSessionConfigOptions,
} from './zed-config-options.js';
import {
  buildZedSession,
  enableZedSessionRecording,
} from './zed-agent-setup.js';
import { buildZedPlanUpdate } from './zed-plan-update.js';
export { parseZedAuthMethodId } from './zed-helpers.js';
export { createSessionScopedConfig } from './zed-session-config.js';
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
    runtimeId: 'cli.runtime.zed',
    metadata: { source: 'zed-integration', stage: 'bootstrap' },
    allowDefaultHandoff: true,
  });
  let zedAgent: ZedAgent | undefined;
  try {
    const stream = acp.ndJsonStream(stdout, stdin);
    const connection = new acp.AgentSideConnection((conn) => {
      logger.debug(() => 'Creating ZedAgent');
      zedAgent = new ZedAgent(config, settings, conn);
      return zedAgent;
    }, stream);
    logger.debug(() => 'AgentSideConnection created successfully');
    try {
      await connection.closed;
    } finally {
      await zedAgent?.disposeAll();
      await runExitCleanup();
    }
  } catch (e) {
    logger.debug(() => `ERROR: Failed to create AgentSideConnection: ${e}`);
    throw e;
  }
}
export class ZedAgent {
  private sessions: Map<string, Session> = new Map();
  private clientCapabilities: acp.ClientCapabilities | undefined;
  private readonly logger = new DebugLogger('llxprt:zed-integration');
  private readonly lifecycle: SessionLifecycle;
  constructor(
    private config: Config,
    _settings: LoadedSettings,
    private connection: acp.AgentSideConnection,
    private readonly sessionFileLister: ChatSessionFileLister = nodeChatSessionFileLister,
  ) {
    this.lifecycle = new SessionLifecycle(
      config,
      this.sessions,
      (sessionId, cwd) => this.buildAndResumeSession(sessionId, cwd),
      (session) => zedSessionConfigOptions(this.clientCapabilities, session),
    );
  }
  async initialize(
    args: acp.InitializeRequest,
  ): Promise<acp.InitializeResponse> {
    this.clientCapabilities = args.clientCapabilities;
    return initializeZedAgent(this.config);
  }
  listSessions(
    params: acp.ListSessionsRequest,
  ): Promise<acp.ListSessionsResponse> {
    return this.lifecycle.list(params);
  }
  authenticate({ methodId }: acp.AuthenticateRequest): Promise<void> {
    return authenticateZedAgent(this.config, methodId);
  }
  async newSession({
    cwd,
    mcpServers: _mcpServers,
  }: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    try {
      const sessionId = randomUUID();
      const { agent, config: sessionConfig } = await this.buildSessionAgent(
        sessionId,
        cwd,
      );
      await enableZedSessionRecording(agent, (error) =>
        this.logger.debug(() => `Recording failed for ${sessionId}: ${error}`),
      );
      const session = await this.createSession(sessionId, agent, sessionConfig);
      await session.sendAvailableCommands();
      this.sessions.set(sessionId, session);
      return {
        sessionId,
        modes: buildSessionModes(agent.getApprovalMode()),
        ...(await zedConfigOptionsForClient(
          this.clientCapabilities,
          agent,
          sessionConfig,
        )),
      };
    } catch (error) {
      this.logger.debug(() => `ERROR in newSession: ${error}`);
      throw error;
    }
  }
  resumeSession(params: acp.ResumeSessionRequest) {
    return this.lifecycle.resume(params);
  }
  private supportsConfigOptions = () =>
    this.clientCapabilities?.session?.configOptions != null;
  private createSession(id: string, agent: Agent, config: Config) {
    return buildZedSession(
      agent,
      () =>
        new Session(
          id,
          agent,
          config,
          this.connection,
          this.supportsConfigOptions(),
        ),
      (error) => this.logger.debug(() => `Session cleanup failed: ${error}`),
    );
  }
  async loadSession(params: acp.LoadSessionRequest) {
    return this.lifecycle.runSerialized(params.sessionId, () =>
      this.performLoadSession(params),
    );
  }
  private async performLoadSession(
    params: acp.LoadSessionRequest,
  ): Promise<acp.LoadSessionResponse> {
    const { sessionId } = params;
    this.logger.debug(() => `loadSession - loading session ${sessionId}`);
    const reattached = await this.tryReattachLiveSession(sessionId);
    if (reattached !== null) {
      await reattached.sendAvailableCommands();
      return {
        modes: buildSessionModes(reattached.getApprovalMode()),
        ...(await zedSessionConfigOptions(this.clientCapabilities, reattached)),
      };
    }
    await this.disposePriorSession(sessionId);
    const session = await this.installResumedSession(sessionId, params.cwd);
    await session.sendAvailableCommands();
    return {
      modes: buildSessionModes(session.getApprovalMode()),
      ...(await zedSessionConfigOptions(this.clientCapabilities, session)),
    };
  }
  private async tryReattachLiveSession(
    sessionId: string,
  ): Promise<Session | null> {
    const existing = this.sessions.get(sessionId);
    if (existing === undefined) {
      return null;
    }
    const recordingExists = await hasRecordedSessionFile(
      this.config,
      sessionId,
      this.sessionFileLister,
    );
    if (recordingExists) {
      return null;
    }
    this.logger.debug(
      () =>
        `loadSession - re-attaching live session ${sessionId} (no on-disk ` +
        `recording; replaying in-memory history)`,
    );
    await existing.replayLiveHistory();
    return existing;
  }
  private async disposePriorSession(sessionId: string): Promise<void> {
    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) {
      this.sessions.delete(sessionId);
      await existing.dispose();
    }
  }
  private async installResumedSession(
    sessionId: string,
    cwd: string | undefined,
  ): Promise<Session> {
    const { session, history } = await this.buildAndResumeSession(
      sessionId,
      cwd,
    );
    this.sessions.set(sessionId, session);
    try {
      await session.streamHistory(history);
    } catch (error) {
      this.sessions.delete(sessionId);
      try {
        await session.dispose();
      } catch (disposeError) {
        this.logger.debug(
          () =>
            `loadSession - dispose after replay failure also failed (original error rethrown): ${disposeError}`,
        );
      }
      this.logger.debug(() => `loadSession - replay failed: ${error}`);
      throw error;
    }
    return session;
  }
  private async buildAndResumeSession(
    sessionId: string,
    cwd: string | undefined,
  ): Promise<{ session: Session; history: readonly IContent[] }> {
    const { agent, config: sessionConfig } = await this.buildSessionAgent(
      sessionId,
      cwd,
    );
    try {
      const history = await resumeAgentHistory(
        agent,
        sessionId,
        sessionConfig,
        this.sessionFileLister,
      );
      const session = new Session(
        sessionId,
        agent,
        sessionConfig,
        this.connection,
        this.supportsConfigOptions(),
      );
      return { session, history };
    } catch (error) {
      await agent.dispose().catch(() => undefined);
      this.logger.debug(() => `loadSession - build/resume failed: ${error}`);
      throw toLoadRequestError(sessionId, error);
    }
  }
  private async buildSessionAgent(
    sessionId: string,
    cwd: string | undefined,
  ): Promise<{ agent: Agent; config: Config }> {
    const baseFileSystemService = this.config.getFileSystemService();
    const sessionFileSystemService = this.clientCapabilities?.fs
      ? new AcpFileSystemService(
          this.connection,
          sessionId,
          this.clientCapabilities.fs,
          baseFileSystemService,
        )
      : baseFileSystemService;
    const sessionConfig = createSessionScopedConfig(
      this.config,
      sessionFileSystemService,
      resolveSessionTargetDir(this.config, cwd),
    );
    this.logger.debug(() => `buildSessionAgent - session ${sessionId}`);
    const agent = await fromConfig({
      config: sessionConfig,
      sessionId,
    });
    return { agent, config: sessionConfig };
  }
  deleteSession(params: acp.DeleteSessionRequest) {
    return this.lifecycle.delete(params);
  }
  closeSession(params: acp.CloseSessionRequest) {
    return this.lifecycle.close(params);
  }
  setSessionMode(params: acp.SetSessionModeRequest) {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }
    return session.setMode(params.modeId);
  }
  setSessionConfigOption(params: acp.SetSessionConfigOptionRequest) {
    return this.lifecycle.runSerialized(params.sessionId, () =>
      dispatchZedConfigOption(this.clientCapabilities, this.sessions, params),
    );
  }
  async cancel({ sessionId }: acp.CancelNotification) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    await session.cancelPendingPrompt();
  }
  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }
    return session.prompt(params);
  }
  async disposeAll() {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.map((session) => session.dispose()));
  }
}
export class Session {
  private pendingPrompt: AbortController | null = null;
  private readonly logger = new DebugLogger('llxprt:zed-integration');
  private pathResolver: ZedPathResolver;
  private activeConfirmations = new Map<
    string,
    {
      readonly cancelWaiter: () => void;
      readonly promptGeneration: number;
      settled: boolean;
    }
  >();
  private promptGeneration = 0;
  private readonly todoListener: (event: TodoUpdateEvent) => void;
  private readonly stopConfigUpdates: () => void;
  private updatedAt = new Date().toISOString();
  constructor(
    private readonly id: string,
    private readonly agent: Agent,
    private readonly config: Config,
    private readonly connection: acp.AgentSideConnection,
    configOptionsEnabled = false,
  ) {
    this.pathResolver = new ZedPathResolver(this.config, (msg) =>
      this.debug(msg),
    );
    this.todoListener = (event: TodoUpdateEvent) => {
      const eventAgentId = event.agentId ?? DEFAULT_AGENT_ID;
      if (event.sessionId === this.id && eventAgentId === DEFAULT_AGENT_ID) {
        this.sendPlanUpdate(event.todos).catch((error) => {
          debugLogger.error('Failed to send plan update to Zed:', error);
        });
      }
    };
    todoEvents.onTodoUpdated(this.todoListener);
    this.stopConfigUpdates = configOptionsEnabled
      ? observeZedConfigOptions(
          this.agent,
          this.config,
          (update) => this.sendUpdateStrict(update),
          (error) => this.logger.debug(() => `Config update failed: ${error}`),
        )
      : () => undefined;
  }
  setMode(modeId: acp.SessionModeId): acp.SetSessionModeResponse {
    const availableModes = buildAvailableModes();
    const mode = availableModes.find((m) => m.id === modeId);
    if (!mode) {
      throw new Error(`Invalid or unavailable mode: ${modeId}`);
    }
    this.agent.setApprovalMode(mode.id as ApprovalMode);
    return {};
  }
  getApprovalMode(): ApprovalMode {
    return this.agent.getApprovalMode();
  }
  setConfigOption(configId: string, value: string | boolean) {
    return setZedConfigOption(this.agent, this.config, configId, value);
  }
  getConfigOptions = () => buildZedConfigOptions(this.agent, this.config);
  getLifecycleInfo(): LifecycleSession {
    return {
      sessionId: this.id,
      cwd: this.config.getProjectRoot(),
      updatedAt: this.updatedAt,
    };
  }
  async cancelPendingPrompt(): Promise<void> {
    this.settleActiveConfirmation();
    if (!this.pendingPrompt) {
      return;
    }
    this.pendingPrompt.abort();
    this.pendingPrompt = null;
  }
  private settleActiveConfirmation(): void {
    const confirmations = [...this.activeConfirmations.entries()];
    this.activeConfirmations.clear();
    for (const [confirmationId, state] of confirmations) {
      if (state.settled) continue;
      state.settled = true;
      try {
        this.agent.tools.respondToConfirmation(
          confirmationId,
          ToolConfirmationOutcome.Cancel,
        );
      } catch (error) {
        debugLogger.error('Failed to cancel active tool confirmation:', error);
      } finally {
        state.cancelWaiter();
      }
    }
  }
  private settleConfirmation(confirmationId: string): void {
    const state = this.activeConfirmations.get(confirmationId);
    if (state === undefined) return;
    this.activeConfirmations.delete(confirmationId);
    if (state.settled) return;
    state.settled = true;
    try {
      this.agent.tools.respondToConfirmation(
        confirmationId,
        ToolConfirmationOutcome.Cancel,
      );
    } catch (error) {
      debugLogger.error('Failed to cancel active tool confirmation:', error);
    } finally {
      state.cancelWaiter();
    }
  }
  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    this.updatedAt = new Date().toISOString();
    await this.cancelPendingPrompt();
    const commandResult = await tryHandleZedCommand(
      params.prompt,
      this.agent,
      (update) => this.sendUpdateStrict(update),
    );
    if (commandResult !== null) return commandResult.response;
    const pendingSend = new AbortController();
    this.pendingPrompt = pendingSend;
    this.promptGeneration += 1;
    const promptGeneration = this.promptGeneration;
    const promptId = Math.random().toString(16).slice(2);
    try {
      let parts: ContractPart[];
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
      const emojiMode = (this.config.getEphemeralSetting('emojifilter') ??
        'auto') as FilterConfiguration['mode'];
      const batcher = new StreamBatcher(
        new EmojiFilter({ mode: emojiMode }),
        (u) => this.sendUpdate(u),
      );
      let terminalStopReason: acp.StopReason | null = null;
      try {
        terminalStopReason = await this.consumeAgentStream(
          parts,
          pendingSend,
          promptId,
          promptGeneration,
          batcher,
        );
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
      } finally {
        try {
          await batcher.flush();
        } finally {
          batcher.dispose();
        }
      }
      if (pendingSend.signal.aborted && terminalStopReason !== 'cancelled') {
        return { stopReason: 'cancelled' };
      }
      if (terminalStopReason !== null) {
        return { stopReason: terminalStopReason };
      }
      return { stopReason: 'end_turn' };
    } finally {
      if (this.pendingPrompt === pendingSend) {
        this.pendingPrompt = null;
      }
    }
  }
  private async consumeAgentStream(
    parts: ContractPart[],
    pendingSend: AbortController,
    promptId: string,
    promptGeneration: number,
    batcher: StreamBatcher,
  ): Promise<acp.StopReason | null> {
    const eventStream = this.agent.stream(parts, {
      signal: pendingSend.signal,
      promptId,
      maxTurns: this.config.getMaxSessionTurns(),
    });
    let terminalStopReason: acp.StopReason | null = null;
    for await (const event of eventStream) {
      if (this.isPromptStale(promptGeneration, pendingSend)) {
        if (event.type === 'done') {
          return 'cancelled';
        }
        continue;
      }
      const stopReason = await this.handleAgentEvent(
        event,
        batcher,
        promptGeneration,
        pendingSend,
      );
      if (stopReason !== null) {
        terminalStopReason = stopReason;
      }
    }
    return terminalStopReason;
  }
  private async handleAgentEvent(
    event: AgentEvent,
    batcher: StreamBatcher,
    promptGeneration: number,
    pendingSend: AbortController,
  ): Promise<acp.StopReason | null> {
    switch (event.type) {
      case 'text':
        batcher.append(event.text, false);
        return null;
      case 'thinking': {
        const thoughtText = extractThoughtText(event.thought);
        if (thoughtText.length > 0) {
          batcher.append(thoughtText, true);
        }
        return null;
      }
      case 'tool-call':
      case 'tool-status':
      case 'tool-result':
        await batcher.flush();
        await emitAgentToolEvent(
          event,
          (update) => this.sendUpdate(update),
          this.agent.tools,
        );
        return null;
      case 'tool-confirmation':
        await batcher.flush();
        await this.handleToolConfirmation(event, promptGeneration, pendingSend);
        return null;
      case 'done':
        await batcher.flush();
        return mapDoneReasonToStopReason(event.reason);
      case 'error':
        await batcher.flush();
        throw translateErrorEvent(event);
      case 'idle-timeout':
        await batcher.flush();
        throw translateIdleTimeout(event);
      case 'invalid-stream':
        await batcher.flush();
        throw new Error(
          'Agent produced an invalid stream that could not be recovered.',
        );
      case 'hook-blocked':
        await batcher.flush();
        throw new Error(
          event.info.systemMessage ?? 'Agent stopped by a hook blocker.',
        );
      case 'loop-detected':
        await batcher.flush();
        return 'end_turn';
      case 'notice':
        await batcher.flush();
        await this.sendUpdate({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: event.message },
        });
        return null;
      case 'usage': {
        await batcher.flush();
        await this.sendUsageUpdate(event.usage);
        return null;
      }
      case 'context-warning':
      case 'compression':
      case 'model-info':
      case 'retry':
      case 'citation':
        return null;
      default: {
        const exhaustive: never = event;
        throw new Error(`Unhandled agent event: ${String(exhaustive)}`);
      }
    }
  }
  private async sendUsageUpdate(
    usage: Extract<AgentEvent, { type: 'usage' }>['usage'],
  ): Promise<void> {
    const update = buildUsageUpdate(
      usage,
      getTokenLimitForConfiguredContext(this.config.getModel(), this.config),
    );
    if (update !== null) {
      await this.sendUpdate(update);
    }
  }
  private isPromptStale(
    promptGeneration: number,
    pendingSend: AbortController,
  ): boolean {
    return (
      this.pendingPrompt !== pendingSend ||
      this.promptGeneration !== promptGeneration ||
      pendingSend.signal.aborted
    );
  }
  private async handleToolConfirmation(
    event: Extract<AgentEvent, { type: 'tool-confirmation' }>,
    promptGeneration: number,
    pendingSend: AbortController,
  ): Promise<void> {
    const confirmationId = event.confirmation.confirmationId;
    const cancelled = new Promise<null>((resolve) => {
      this.activeConfirmations.set(confirmationId, {
        cancelWaiter: () => resolve(null),
        promptGeneration,
        settled: false,
      });
    });
    if (this.isPromptStale(promptGeneration, pendingSend)) {
      this.settleConfirmation(confirmationId);
      return;
    }
    let result: PermissionRoundTripResult | null;
    try {
      result = await Promise.race([
        requestToolConfirmation(
          this.id,
          event.confirmation.toolCallId,
          event.confirmation.name,
          event.confirmation.details,
          this.connection,
          this.agent.tools.get(event.confirmation.name)?.kind,
        ),
        cancelled,
      ] as const);
    } catch (error) {
      this.settleConfirmation(confirmationId);
      throw error;
    }
    const state = this.activeConfirmations.get(confirmationId);
    if (
      result === null ||
      state === undefined ||
      state.settled ||
      state.promptGeneration !== promptGeneration
    ) {
      return;
    }
    state.settled = true;
    this.activeConfirmations.delete(confirmationId);
    try {
      this.agent.tools.respondToConfirmation(
        confirmationId,
        result.decision,
        result.payload,
        result.requiresUserConfirmation,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to respond to tool confirmation ${confirmationId}: ${message}`,
      );
    }
  }
  private async sendUpdateStrict(update: acp.SessionUpdate): Promise<void> {
    this.logger.debug(() => describeSessionUpdateForLog(update));
    await this.connection.sessionUpdate({ sessionId: this.id, update });
  }
  sendAvailableCommands(): Promise<void> {
    return this.sendUpdateStrict(buildAvailableCommandsUpdate());
  }
  private async sendUpdate(update: acp.SessionUpdate): Promise<void> {
    try {
      await this.sendUpdateStrict(update);
    } catch (error) {
      this.logger.debug(
        () =>
          `sendUpdate ERROR: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  debug(msg: string) {
    if (this.config.getDebugMode()) debugLogger.warn(msg);
  }
  private sendPlanUpdate(todos: TodoUpdateEvent['todos']): Promise<void> {
    return this.sendUpdate(buildZedPlanUpdate(todos));
  }
  async streamHistory(items: readonly IContent[]): Promise<void> {
    const updates = mapHistoryToSessionUpdates(items);
    for (const update of updates) {
      try {
        await this.sendUpdateStrict(update);
      } catch (error) {
        throw wrapReplayFailure(this.id, error);
      }
    }
  }
  async replayLiveHistory() {
    await this.streamHistory(
      await readAgentHistoryForReplay(this.agent, this.id),
    );
  }
  async dispose() {
    try {
      todoEvents.offTodoUpdated(this.todoListener);
      this.stopConfigUpdates();
      this.settleActiveConfirmation();
      this.pendingPrompt?.abort();
      this.pendingPrompt = null;
    } finally {
      await this.agent.dispose();
    }
  }
}
