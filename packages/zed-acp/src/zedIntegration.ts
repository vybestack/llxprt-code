/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import type { WorkspaceTrustControlPort } from '@vybestack/llxprt-code-core';
import { authenticateZedAgent, initializeZedAgent } from './zed-initialize.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

import type { WorkspaceTextOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';

import {
  type RuntimeProviderManager,
  type Config,
  type FilterConfiguration,
  type IContent,
  type ApprovalMode,
  type ProfileDefinitionListing,
} from '@vybestack/llxprt-code-core';

import type {
  AgentProfileApplication,
  Agent,
  AgentEvent,
} from '@vybestack/llxprt-code-agents';

import { debugLogger, DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type * as acp from '@agentclientprotocol/sdk';

import { randomUUID } from 'crypto';
import {
  resolveZedMode,
  subscribeSessionTodos,
  buildSessionModes,
  buildUsageUpdate,
  sendZedSessionUpdate,
  resolveZedContextWindowSize,
} from './zed-helpers.js';
import { ZedPathResolver } from './zed-path-resolver.js';
import {
  projectZedSessionAgent,
  projectZedSessionSettings,
  type ZedSessionAgentPort,
  type ZedSessionSettings,
} from './zed-session-ports.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  requestToolConfirmation,
  type PermissionRoundTripResult,
} from './zed-tool-handler.js';
import type { TerminalManager } from './zed-terminal-manager.js';
import {
  buildZedSessionAgent,
  captureZedHostInputs,
  resolveZedHostTrust,
  type ZedSessionProviderInputs,
  type ZedSessionAgent,
  type ZedHostInputs,
  disposeZedSession,
} from './zed-session-agent.js';
import { streamZedHistory } from './zed-session-loader.js';
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

import {
  buildAvailableCommandsUpdate,
  projectZedCommandAgent,
} from './zed-command-registry.js';
import { tryHandleZedCommand } from './zed-prompt-command.js';
import {
  buildZedConfigOptions,
  projectZedModelReads,
  projectZedModelSelection,
  projectZedOptionSettings,
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
  presentLifecycleSession,
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
export { runZedIntegration } from './runZedIntegration.js';

export class ZedAgent {
  private sessions: Map<string, Session> = new Map();
  private clientCapabilities: ClientCapabilitiesWithSession | undefined;
  private readonly logger = new DebugLogger('llxprt:zed-integration');
  private readonly lifecycle: SessionLifecycle;
  private readonly hostInputs: ZedHostInputs;
  private readonly ownedTrust: WorkspaceTrustLifecycle | undefined;
  private readonly hostTrust: WorkspaceTrustControlPort;
  constructor(
    private config: Config,
    private connection: acp.AgentSideConnection,
    private readonly application: AgentProfileApplication,
    readonly providerManager: RuntimeProviderManager,
    private readonly createSessionSettings: () => SettingsService,
    private readonly sessionFileLister: ChatSessionFileLister = nodeChatSessionFileLister,
    private readonly definitions?: ProfileDefinitionListing,
    hostTrust?: WorkspaceTrustControlPort,
    private readonly providerInputs: ZedSessionProviderInputs = {},
  ) {
    ({ trust: this.hostTrust, owned: this.ownedTrust } = resolveZedHostTrust(
      config,
      hostTrust,
    ));
    this.hostInputs = captureZedHostInputs(config);
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
    return initializeZedAgent(this.definitions);
  }
  listSessions(
    params: acp.ListSessionsRequest,
  ): Promise<acp.ListSessionsResponse> {
    return this.lifecycle.list(params);
  }
  authenticate({ methodId }: acp.AuthenticateRequest): Promise<void> {
    return authenticateZedAgent(this.definitions, methodId, this.application);
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
        files,
        disposeConfig,
      } = await this.buildSessionAgent(sessionId, cwd);
      let session: Session;
      try {
        await enableZedSessionRecording(agent, (error) =>
          this.logger.debug(
            () => `Recording failed for ${sessionId}: ${error}`,
          ),
        );
        session = await this.createSession(
          sessionId,
          agent,
          sessionConfig,
          terminals,
          disposeConfig,
          files,
        );
      } catch (error) {
        await agent.dispose().catch(() => undefined);
        await terminals?.settleAll().catch(() => undefined);
        await disposeConfig();
        throw error;
      }
      try {
        await session.sendAvailableCommands();
      } catch (error) {
        await session.dispose();
        throw error;
      }
      let configOptions: acp.NewSessionResponse['configOptions'];
      try {
        ({ configOptions } = await zedConfigOptionsForClient(
          this.clientCapabilities,
          projectZedModelReads(agent),
          projectZedOptionSettings(agent),
        ));
      } catch (error) {
        await session.dispose();
        throw error;
      }
      this.sessions.set(sessionId, session);
      return {
        sessionId,
        modes: buildSessionModes(agent.getApprovalMode()),
        ...(configOptions === undefined ? {} : { configOptions }),
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
  private createSession(
    id: string,
    agent: Agent,
    config: Config,
    terminals: TerminalManager | null,
    disposeConfig: () => Promise<void>,
    files: WorkspaceTextOperations,
  ) {
    return buildZedSession(
      agent,
      () =>
        new Session(
          id,
          projectZedSessionAgent(agent),
          projectZedSessionSettings(config, agent, files, agent.workspace),
          this.connection,
          this.supportsConfigOptions(),
          terminals,
          disposeConfig,
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
      try {
        return {
          modes: buildSessionModes(reattached.getApprovalMode()),
          ...(await zedSessionConfigOptions(
            this.clientCapabilities,
            reattached,
          )),
        };
      } catch (error) {
        await this.rollbackSession(sessionId, reattached);
        throw error;
      }
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
    try {
      await existing.replayLiveHistory();
      return existing;
    } catch (error) {
      await this.rollbackSession(sessionId, existing);
      throw error;
    }
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
      files,
      disposeConfig,
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
        projectZedSessionAgent(agent),
        projectZedSessionSettings(sessionConfig, agent, files, agent.workspace),
        this.connection,
        this.supportsConfigOptions(),
        terminals,
        disposeConfig,
      );
      return { session, history };
    } catch (error) {
      await agent.dispose().catch(() => undefined);
      await terminals?.settleAll().catch(() => undefined);
      await disposeConfig();
      this.logger.debug(() => `loadSession - build/resume failed: ${error}`);
      throw toLoadRequestError(sessionId, error);
    }
  }
  private async buildSessionAgent(
    sessionId: string,
    cwd: string | undefined,
  ): Promise<ZedSessionAgent> {
    return buildZedSessionAgent(
      this.config,
      this.hostInputs,
      this.connection,
      this.clientCapabilities,
      sessionId,
      cwd,
      this.logger,
      this.createSessionSettings(),
      this.hostTrust,
      this.providerInputs,
    );
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
    const results = await Promise.allSettled(
      sessions.map((session) => session.dispose()),
    );
    const trust = await Promise.allSettled([this.ownedTrust?.dispose()]);
    const failures = [...results, ...trust].flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'ACP workspace disposal failed');
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
  private readonly stopTodoUpdates: () => void;
  private readonly stopConfigUpdates: () => void;
  private readonly sessionInfo = new SessionTitleTracker();
  private readonly createdAt = new Date().toISOString();
  private readonly terminals: TerminalManager | null;

  constructor(
    private readonly id: string,
    private readonly agent: ZedSessionAgentPort,
    private readonly config: ZedSessionSettings,
    private readonly connection: acp.AgentSideConnection,
    configOptionsEnabled = false,
    terminals: TerminalManager | null = null,
    private readonly disposeConfig: () => Promise<void> = () =>
      Promise.resolve(),
  ) {
    this.terminals = terminals;
    this.pathResolver = new ZedPathResolver(this.config, (msg) =>
      this.debug(msg),
    );
    const recordedTitle = agent.session.getRecordingTitle();
    if (recordedTitle !== undefined) {
      this.sessionInfo.hydrateFromMetadata(recordedTitle);
    }
    this.stopTodoUpdates = subscribeSessionTodos(this.id, (todos) =>
      this.sendUpdate(buildZedPlanUpdate(todos)),
    );
    this.stopConfigUpdates = configOptionsEnabled
      ? observeZedConfigOptions(
          projectZedModelReads(this.agent),
          projectZedOptionSettings(this.config),
          (update) => this.sendUpdateStrict(update),
          (error) => this.logger.debug(() => `Config update failed: ${error}`),
        )
      : () => undefined;
  }
  setMode(modeId: acp.SessionModeId): acp.SetSessionModeResponse {
    this.agent.setApprovalMode(resolveZedMode(modeId));
    return {};
  }
  getApprovalMode(): ApprovalMode {
    return this.agent.getApprovalMode();
  }
  setConfigOption(configId: string, value: string) {
    return setZedConfigOption(
      projectZedModelSelection(this.agent),
      projectZedOptionSettings(this.config),
      configId,
      value,
    );
  }
  getConfigOptions = () =>
    buildZedConfigOptions(
      projectZedModelReads(this.agent),
      projectZedOptionSettings(this.config),
    );
  getLifecycleInfo(): LifecycleSession {
    return presentLifecycleSession(
      this.id,
      this.config.getProjectRoot(),
      this.createdAt,
      this.sessionInfo,
    );
  }
  async cancelPendingPrompt(): Promise<void> {
    this.settleActiveConfirmation();
    this.pendingPrompt?.abort();
    this.pendingPrompt = null;
    await this.terminals
      ?.settleAll()
      .catch((e: unknown) =>
        this.logger.debug(() => `Terminal settleAll failed: ${e}`),
      );
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
    try {
      await this.agent.session.recordRecordingTitle(eligibility.title ?? null);
    } catch (error) {
      this.logger.debug(() => `Session metadata recording failed: ${error}`);
    }
    try {
      const commandResult = await tryHandleZedCommand(
        params.prompt,
        projectZedCommandAgent(this.agent),
        (update) => this.sendUpdateStrict(update),
      );
      if (commandResult !== null) {
        return commandResult.response;
      }
      const pendingSend = new AbortController();
      this.pendingPrompt = pendingSend;
      this.promptGeneration += 1;
      const promptGeneration = this.promptGeneration;
      const promptId = randomUUID();
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
      agent: {
        stream: (input, options) => this.agent.stream(input, options),
        tools: { get: (name) => this.agent.tools.get(name) },
      },
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

  private async sendUsageUpdate(
    usage: Extract<AgentEvent, { type: 'usage' }>['usage'],
  ): Promise<void> {
    // The public agent wire keeps Gemini-named usage fields (carve-out from
    // the internal neutral rename, #2627); map them to the neutral vocabulary
    // at this boundary.
    const update = buildUsageUpdate(
      {
        totalTokenCount: usage.totalTokenCount,
        outputTokenCount: usage.candidatesTokenCount,
      },
      resolveZedContextWindowSize(this.config, () =>
        this.agent.getProviderContextLimit(),
      ),
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
  private sendUpdateStrict(update: acp.SessionUpdate): Promise<void> {
    return sendZedSessionUpdate(this.connection, this.id, update, this.logger);
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
  async streamHistory(items: readonly IContent[]): Promise<void> {
    await streamZedHistory(this.id, items, (update) =>
      this.sendUpdateStrict(update),
    );
    this.sessionInfo.hydrateFromHistory(items);
  }
  async replayLiveHistory(): Promise<void> {
    await this.streamHistory(
      await readAgentHistoryForReplay(this.agent, this.id),
    );
  }
  async dispose(): Promise<void> {
    return disposeZedSession(
      () => {
        this.stopTodoUpdates();
        this.stopConfigUpdates();
        this.settleActiveConfirmation();
      },
      this.terminals,
      this.logger,
      () => {
        this.pendingPrompt?.abort();
        this.pendingPrompt = null;
      },
      this.agent,
      this.disposeConfig,
    );
  }
}
