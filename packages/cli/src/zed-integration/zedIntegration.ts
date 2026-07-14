/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type Config,
  todoEvents,
  DEFAULT_AGENT_ID,
  createInkStdio,
  type FilterConfiguration,
  type IContent,
  type TodoUpdateEvent,
  type ApprovalMode,
} from '@vybestack/llxprt-code-core';
import { debugLogger, DebugLogger } from '@vybestack/llxprt-code-telemetry';
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
} from './zed-helpers.js';
import { ZedPathResolver } from './zed-path-resolver.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  requestToolConfirmation,
  type PermissionRoundTripResult,
} from './zed-tool-handler.js';
import type { TerminalManager } from './zed-terminal-manager.js';
import { buildZedTerminalSetup } from './zed-terminal-setup.js';
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
import {
  runPromptTurn as executePromptTurn,
  type SessionStreamDeps,
} from './zed-session-events.js';
import { buildZedPlanUpdate } from './zed-plan-update.js';
import {
  SessionTitleTracker,
  buildSessionInfoUpdate,
} from './zed-session-info.js';
import type {
  CloseSessionRequest,
  CloseSessionResponse,
  DeleteSessionRequest,
  DeleteSessionResponse,
  ClientCapabilitiesWithSession,
} from './acp-types.js';
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
  setCliRuntimeContext(config.getSettingsService(), config, {
    runtimeId: 'cli.runtime.zed',
    metadata: { source: 'zed-integration', stage: 'bootstrap' },
    allowDefaultHandoff: true,
  });
  let zedAgent: ZedAgent | undefined;
  try {
    const stream = acp.ndJsonStream(stdout, stdin);
    const connection = new acp.AgentSideConnection((conn) => {
      zedAgent = new ZedAgent(config, settings, conn);
      return zedAgent;
    }, stream);
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
  private clientCapabilities: ClientCapabilitiesWithSession | undefined;
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
    this.clientCapabilities = args.clientCapabilities as
      | ClientCapabilitiesWithSession
      | undefined;
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
      const {
        agent,
        config: sessionConfig,
        terminals,
      } = await this.buildSessionAgent(sessionId, cwd);
      await enableZedSessionRecording(agent, (error) =>
        this.logger.debug(() => `Recording failed for ${sessionId}: ${error}`),
      );
      const session = await this.createSession(
        sessionId,
        agent,
        sessionConfig,
        terminals,
      );
      try {
        await session.sendAvailableCommands();
      } catch (error) {
        await session.dispose();
        throw error;
      }
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
  resumeSession(
    params: acp.ResumeSessionRequest,
  ): Promise<acp.ResumeSessionResponse> {
    return this.lifecycle.resume(params);
  }
  private supportsConfigOptions(): boolean {
    return this.clientCapabilities?.session?.configOptions === true;
  }
  private supportsTerminal(): boolean {
    return this.clientCapabilities?.terminal === true;
  }
  private createSession(
    id: string,
    agent: Agent,
    config: Config,
    terminals: TerminalManager | null,
  ) {
    return buildZedSession(
      agent,
      () =>
        new Session(
          id,
          agent,
          config,
          this.connection,
          this.supportsConfigOptions(),
          terminals,
        ),
      (error) => this.logger.debug(() => `Session cleanup failed: ${error}`),
    );
  }
  async loadSession(
    params: acp.LoadSessionRequest,
  ): Promise<acp.LoadSessionResponse> {
    return this.lifecycle.runSerialized(params.sessionId, () =>
      this.performLoadSession(params),
    );
  }
  private async performLoadSession(
    params: acp.LoadSessionRequest,
  ): Promise<acp.LoadSessionResponse> {
    const { sessionId } = params;
    const reattached = await this.tryReattachLiveSession(sessionId);
    if (reattached !== null) {
      try {
        await reattached.sendAvailableCommands();
      } catch (error) {
        await this.rollbackSession(sessionId, reattached);
        throw error;
      }
      return {
        modes: buildSessionModes(reattached.getApprovalMode()),
        ...(await zedSessionConfigOptions(this.clientCapabilities, reattached)),
      };
    }
    await this.disposePriorSession(sessionId);
    const session = await this.installResumedSession(sessionId, params.cwd);
    try {
      await session.sendAvailableCommands();
    } catch (error) {
      await this.rollbackSession(sessionId, session);
      throw error;
    }
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
      () => `loadSession - re-attaching live session ${sessionId}`,
    );
    await existing.replayLiveHistory();
    return existing;
  }
  private async rollbackSession(
    sessionId: string,
    session: Session,
  ): Promise<void> {
    this.sessions.delete(sessionId);
    await session.dispose().catch(() => undefined);
  }
  private async disposePriorSession(sessionId: string): Promise<void> {
    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) await this.rollbackSession(sessionId, existing);
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
      await this.rollbackSession(sessionId, session);
      this.logger.debug(() => `loadSession - replay failed: ${error}`);
      throw error;
    }
    return session;
  }
  private async buildAndResumeSession(
    sessionId: string,
    cwd: string | undefined,
  ): Promise<{ session: Session; history: readonly IContent[] }> {
    const {
      agent,
      config: sessionConfig,
      terminals,
    } = await this.buildSessionAgent(sessionId, cwd);
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
        terminals,
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
  ): Promise<{
    agent: Agent;
    config: Config;
    terminals: TerminalManager | null;
  }> {
    const baseFileSystemService = this.config.getFileSystemService();
    const sessionFileSystemService = this.clientCapabilities?.fs
      ? new AcpFileSystemService(
          this.connection,
          sessionId,
          this.clientCapabilities.fs,
          baseFileSystemService,
        )
      : baseFileSystemService;
    let terminalSetup: ReturnType<typeof buildZedTerminalSetup> | undefined;
    const sessionConfig = createSessionScopedConfig(
      this.config,
      sessionFileSystemService,
      resolveSessionTargetDir(this.config, cwd),
      () => terminalSetup?.registry,
    );
    if (this.supportsTerminal()) {
      terminalSetup = buildZedTerminalSetup(
        sessionId,
        sessionConfig,
        this.config.getToolRegistry(),
        this.connection,
        this.logger,
      );
    }
    const agent = await fromConfig({
      config: sessionConfig,
      sessionId,
      ...(terminalSetup === undefined
        ? {}
        : { messageBus: terminalSetup.messageBus }),
    });
    return {
      agent,
      config: sessionConfig,
      terminals: terminalSetup?.terminals ?? null,
    };
  }
  deleteSession(params: DeleteSessionRequest): Promise<DeleteSessionResponse> {
    return this.lifecycle.delete(params);
  }
  closeSession(params: CloseSessionRequest): Promise<CloseSessionResponse> {
    return this.lifecycle.close(params);
  }
  setSessionMode(
    params: acp.SetSessionModeRequest,
  ): Promise<acp.SetSessionModeResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }
    return Promise.resolve(session.setMode(params.modeId));
  }
  setSessionConfigOption(params: acp.SetSessionConfigOptionRequest) {
    return this.lifecycle.runSerialized(params.sessionId, () =>
      dispatchZedConfigOption(this.clientCapabilities, this.sessions, params),
    );
  }
  async cancel({ sessionId }: acp.CancelNotification): Promise<void> {
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
  async disposeAll(): Promise<void> {
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
  private readonly sessionInfo = new SessionTitleTracker();
  private readonly createdAt = new Date().toISOString();
  private readonly terminals: TerminalManager | null;

  constructor(
    private readonly id: string,
    private readonly agent: Agent,
    private readonly config: Config,
    private readonly connection: acp.AgentSideConnection,
    configOptionsEnabled = false,
    terminals: TerminalManager | null = null,
  ) {
    this.terminals = terminals;
    this.pathResolver = new ZedPathResolver(this.config, (msg) =>
      this.debug(msg),
    );
    const recordedTitle = config
      .getSessionRecordingService()
      ?.getSessionMetadataTitle();
    if (recordedTitle !== undefined) {
      this.sessionInfo.hydrateFromMetadata(recordedTitle);
    }
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
  setConfigOption(configId: string, value: string) {
    return setZedConfigOption(this.agent, this.config, configId, value);
  }
  getConfigOptions = () => buildZedConfigOptions(this.agent, this.config);
  getLifecycleInfo(): LifecycleSession {
    const title = this.sessionInfo.getTitle();
    return {
      sessionId: this.id,
      cwd: this.config.getProjectRoot(),
      updatedAt: this.sessionInfo.getUpdatedAt() ?? this.createdAt,
      createdAt: this.createdAt,
      ...(title === undefined ? {} : { title }),
    };
  }
  async cancelPendingPrompt(): Promise<void> {
    this.settleActiveConfirmation();
    await this.terminals
      ?.settleAll()
      .catch((e: unknown) =>
        this.logger.debug(() => `Terminal settleAll failed: ${e}`),
      );
    if (!this.pendingPrompt) return;
    this.pendingPrompt.abort();
    this.pendingPrompt = null;
  }
  private settleActiveConfirmation(): void {
    for (const confirmationId of [...this.activeConfirmations.keys()]) {
      this.settleConfirmation(confirmationId);
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
    await this.cancelPendingPrompt();
    const eligibility = this.sessionInfo.consumeTitleEligibility(params.prompt);
    this.recordMetadataTitle(eligibility.title);
    try {
      const commandResult = await tryHandleZedCommand(
        params.prompt,
        this.agent,
        (update) => this.sendUpdateStrict(update),
      );
      if (commandResult !== null) {
        return commandResult.response;
      }
      const pendingSend = new AbortController();
      this.pendingPrompt = pendingSend;
      this.promptGeneration += 1;
      const promptGeneration = this.promptGeneration;
      const promptId = Math.random().toString(16).slice(2);
      try {
        return await this.runPromptTurn(
          params,
          pendingSend,
          promptId,
          promptGeneration,
        );
      } finally {
        if (this.pendingPrompt === pendingSend) {
          this.pendingPrompt = null;
        }
      }
    } finally {
      try {
        await this.emitTurnMetadata(eligibility);
      } catch (error) {
        this.logger.debug(() => `emitTurnMetadata ERROR: ${String(error)}`);
      }
    }
  }

  private async runPromptTurn(
    params: acp.PromptRequest,
    pendingSend: AbortController,
    promptId: string,
    promptGeneration: number,
  ): Promise<acp.PromptResponse> {
    return executePromptTurn(
      {
        pathResolver: this.pathResolver,
        emojiFilterMode: (this.config.getEphemeralSetting('emojifilter') ??
          'auto') as FilterConfiguration['mode'],
        streamDeps: this.buildStreamDeps(promptGeneration, pendingSend),
      },
      params,
      pendingSend,
      promptId,
      promptGeneration,
    );
  }

  private buildStreamDeps(
    promptGeneration: number,
    pendingSend: AbortController,
  ): SessionStreamDeps {
    return {
      agent: this.agent,
      terminals: this.terminals,
      sendUpdate: (update) => this.sendUpdate(update),
      sendUsage: (usage) => this.sendUsageUpdate(usage),
      handleConfirmation: (confirmation) =>
        this.handleToolConfirmation(
          confirmation,
          promptGeneration,
          pendingSend,
        ),
      isPromptStale: (gen, send) => this.isPromptStale(gen, send),
      maxTurns: this.config.getMaxSessionTurns(),
      logger: this.logger,
    };
  }

  private async emitTurnMetadata(eligibility: {
    readonly wonTitle: boolean;
    readonly title: string | undefined;
  }): Promise<void> {
    const { updates } = this.sessionInfo.recordTurn(new Date().toISOString());
    const updatedAt = updates[0]?.updatedAt ?? undefined;
    if (eligibility.wonTitle && eligibility.title !== undefined) {
      await this.sendTitleUpdate(
        buildSessionInfoUpdate({ title: eligibility.title, updatedAt }),
        eligibility.title,
      );
      return;
    }
    for (const update of updates) {
      if (typeof update.title === 'string') {
        await this.sendTitleUpdate(update, update.title);
      } else {
        await this.sendUpdate(update);
      }
    }
  }

  private async sendTitleUpdate(
    update: acp.SessionInfoUpdate & { sessionUpdate: 'session_info_update' },
    title: string,
  ): Promise<void> {
    try {
      await this.sendUpdateStrict(update);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.debug(
        () => `sendTitleUpdate ERROR (will retry next turn): ${msg}`,
      );
      this.sessionInfo.markPendingTitle(title);
    }
  }

  private recordMetadataTitle(title: string | undefined): void {
    const recording = this.config.getSessionRecordingService();
    if (recording?.isActive() === true)
      recording.recordSessionMetadata(title ?? null);
  }
  private async sendUsageUpdate(
    usage: Extract<AgentEvent, { type: 'usage' }>['usage'],
  ): Promise<void> {
    const update = buildUsageUpdate(
      usage,
      getTokenLimitForConfiguredContext(this.config.getModel(), this.config),
    );
    if (update !== null) await this.sendUpdate(update);
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
    this.sessionInfo.hydrateFromHistory(items);
  }
  async replayLiveHistory(): Promise<void> {
    await this.streamHistory(
      await readAgentHistoryForReplay(this.agent, this.id),
    );
  }
  async dispose(): Promise<void> {
    try {
      todoEvents.offTodoUpdated(this.todoListener);
      this.stopConfigUpdates();
      this.settleActiveConfirmation();
      await this.terminals?.settleAll();
      this.pendingPrompt?.abort();
      this.pendingPrompt = null;
    } finally {
      await this.agent
        .dispose()
        .catch((e: unknown) =>
          this.logger.debug(() => `Failed to dispose Zed session agent: ${e}`),
        );
    }
  }
}
