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
  type Todo,
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
import {
  loadProfileByName,
  setCliRuntimeContext,
} from '@vybestack/llxprt-code-providers/runtime.js';
import { runExitCleanup } from '../utils/cleanup.js';
import { AcpFileSystemService } from './fileSystemService.js';
import {
  parseZedAuthMethodId,
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
import {
  createSessionScopedConfig,
  resolveSessionTargetDir,
} from './zed-session-config.js';

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
  /**
   * Per-sessionId serialization of in-flight loadSession calls (FINDING F5).
   * Two concurrent session/load calls for the SAME id must not both build agents
   * and race to install (the later install would overwrite the earlier, orphaning
   * its recording lock). Each load chains after any in-flight load for the same
   * id; distinct ids stay fully parallel. The entry is cleared in finally only
   * when it is still the same promise (a later chained load may have replaced it).
   */
  private loadSessionQueues: Map<string, Promise<acp.LoadSessionResponse>> =
    new Map();
  private clientCapabilities: acp.ClientCapabilities | undefined;
  private logger: DebugLogger;

  private readonly sessionFileLister: ChatSessionFileLister;

  constructor(
    private config: Config,
    _settings: LoadedSettings,
    private connection: acp.AgentSideConnection,
    sessionFileLister: ChatSessionFileLister = nodeChatSessionFileLister,
  ) {
    this.logger = new DebugLogger('llxprt:zed-integration');
    this.sessionFileLister = sessionFileLister;
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
        loadSession: true,
        promptCapabilities: {
          image: true,
          audio: true,
          embeddedContext: true,
        },
      },
    };
  }

  async authenticate({ methodId }: acp.AuthenticateRequest): Promise<void> {
    const profileManager = this.config.getProfileManager();
    const availableProfiles = profileManager
      ? await profileManager.listProfiles()
      : [];
    const profileName = parseZedAuthMethodId(methodId, availableProfiles);

    await loadProfileByName(profileName);
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
      await this.enableRecording(agent, sessionId);

      const session = await this.buildSessionForAgent(
        sessionId,
        agent,
        sessionConfig,
      );
      this.sessions.set(sessionId, session);

      return {
        sessionId,
        modes: buildSessionModes(agent.getApprovalMode()),
      };
    } catch (error) {
      this.logger.debug(() => `ERROR in newSession: ${error}`);
      throw error;
    }
  }

  private async buildSessionForAgent(
    sessionId: string,
    agent: Agent,
    sessionConfig: Config,
  ): Promise<Session> {
    try {
      return new Session(sessionId, agent, sessionConfig, this.connection);
    } catch (error) {
      try {
        await agent.dispose();
      } catch (disposeError) {
        this.logger.debug(
          () =>
            `newSession - dispose after Session ctor failure also failed (original error rethrown): ${disposeError}`,
        );
      }
      throw error;
    }
  }

  async loadSession(
    params: acp.LoadSessionRequest,
  ): Promise<acp.LoadSessionResponse> {
    const { sessionId } = params;
    const prior = this.loadSessionQueues.get(sessionId);
    const run = (prior ?? Promise.resolve()).then(
      () => this.performLoadSession(params),
      () => this.performLoadSession(params),
    );
    this.loadSessionQueues.set(sessionId, run);
    try {
      return await run;
    } finally {
      // Clear the queue entry only if it is still THIS load (a later chained
      // same-id load may have replaced it); deleting unconditionally could drop
      // a newer in-flight load's entry.
      if (this.loadSessionQueues.get(sessionId) === run) {
        this.loadSessionQueues.delete(sessionId);
      }
    }
  }

  /**
   * Performs a single (already-serialized, see {@link loadSession}) session/load.
   *
   * Decision: if a live same-id session exists AND no recording file exists on
   * disk for it, RE-ATTACH the live session (an unprompted session has no
   * recording — the file materializes on first content — so a disk resume would
   * both fail and needlessly destroy the healthy live session). Otherwise fall
   * back to the disk path: dispose any prior same-id Session to release its
   * on-disk lock, then build + resume + install the replacement and stream the
   * restored transcript.
   */
  private async performLoadSession(
    params: acp.LoadSessionRequest,
  ): Promise<acp.LoadSessionResponse> {
    const { sessionId } = params;
    this.logger.debug(() => `loadSession - loading session ${sessionId}`);

    const reattached = await this.tryReattachLiveSession(sessionId);
    if (reattached !== null) {
      return { modes: buildSessionModes(reattached.getApprovalMode()) };
    }

    await this.disposePriorSession(sessionId);
    const session = await this.installResumedSession(sessionId, params.cwd);
    return { modes: buildSessionModes(session.getApprovalMode()) };
  }

  /**
   * RE-ATTACH decision + replay (#1604). Returns the live same-id Session (after
   * replaying its in-memory history) when one exists AND has no on-disk recording
   * yet (an unprompted session, whose JSONL file has not materialized) — a disk
   * resume would both fail and needlessly destroy the healthy live session, so we
   * keep it and replay instead. Returns null (so the caller takes the disk-resume
   * path) when there is no live session OR a recording file already exists. For a
   * fresh unprompted session the in-memory history is empty, so ZERO replay
   * updates are sent. A replay failure is propagated (already wrapped as a precise
   * RequestError by Session.streamHistory) WITHOUT disposing the session — it was
   * healthy and the client can retry — the re-attach cleanup contract (no destroy
   * on failure), distinct from the disk path's destroy-on-failure.
   */
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

  /**
   * Disposes + drops any prior same-id Session FIRST so it releases the on-disk
   * session lock the replacement resume needs, and so a later failure cannot
   * leave a stale/half-disposed entry in this.sessions.
   */
  private async disposePriorSession(sessionId: string): Promise<void> {
    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) {
      this.sessions.delete(sessionId);
      await existing.dispose();
    }
  }

  /**
   * Builds + resumes the replacement Session, installs it in this.sessions, then
   * replays the restored transcript to the client BEFORE returning. Install
   * order is failure-safe (FINDING A): the map entry is added only after a
   * successful build/resume, and if the strict history replay fails (a
   * dead/failing transport, see Session.streamHistory) the entry is removed and
   * the Session disposed (releasing the recording lock) before the precise
   * RequestError is rethrown — so a failed load never leaves a stale entry or a
   * leaked lock, and a later retry for the same id can cleanly load again.
   */
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
      // FINDING F13: guard the cleanup dispose so a dispose failure does not
      // mask the ORIGINAL replay error. The replay error is the actionable one
      // the client must see; a dispose failure is logged and swallowed, and the
      // original error is rethrown.
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

  /**
   * Builds the replacement Agent for a loadSession and resumes its recorded
   * history. Everything AFTER fromConfig runs under a guard that disposes the
   * fresh agent before rethrowing (FINDING E), so neither a resume rejection nor
   * a throw while constructing the Session (after resume already adopted the
   * recording + lock) can leak the lock/recording. A resume rejection is mapped
   * to a precise ACP RequestError (see resumeAgentHistory / classifyResumeFailure:
   * not-found-but-file-present becomes internalError, genuine missing becomes
   * resourceNotFound); any other post-fromConfig throw is wrapped as internalError
   * (an already-constructed RequestError passes through unchanged). Extracted from
   * loadSession so the orchestration stays within the lint complexity/line budgets.
   */
  private async buildAndResumeSession(
    sessionId: string,
    cwd: string | undefined,
  ): Promise<{ session: Session; history: readonly IContent[] }> {
    const { agent, config: sessionConfig } = await this.buildSessionAgent(
      sessionId,
      cwd,
    );
    try {
      // FINDING C1: pass the SAME injected lister the re-attach probe uses so
      // BOTH on-disk session-file probes (re-attach + corrupt-vs-missing resume)
      // read through one injectable seam rather than one hardcoding readdir.
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
      );
      return { session, history };
    } catch (error) {
      await agent.dispose().catch(() => undefined);
      this.logger.debug(() => `loadSession - build/resume failed: ${error}`);
      throw toLoadRequestError(sessionId, error);
    }
  }

  /**
   * Shared per-session Agent construction used by BOTH newSession and
   * loadSession: builds the session-scoped Config proxy (with an
   * AcpFileSystemService when the client advertises fs capabilities) rooted at
   * the resolved target dir, then creates the Agent-API agent bound to that
   * Config and session id. Extracted to avoid duplicating the setup across the
   * two entry points.
   */
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

  private async enableRecording(
    agent: Agent,
    sessionId: string,
  ): Promise<void> {
    try {
      await agent.session.setRecording({ enabled: true });
    } catch (error) {
      this.logger.debug(
        () => `enableRecording failed for session ${sessionId}: ${error}`,
      );
    }
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

  async disposeAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.map((session) => session.dispose()));
  }
}

export class Session {
  private pendingPrompt: AbortController | null = null;
  private emojiFilter: EmojiFilter;
  private logger: DebugLogger;
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

  constructor(
    private readonly id: string,
    private readonly agent: Agent,
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
      if (state.settled) {
        continue;
      }
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
    if (state === undefined) {
      return;
    }
    this.activeConfirmations.delete(confirmationId);
    if (state.settled) {
      return;
    }
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

      const batcher = new StreamBatcher(this.emojiFilter, (u) =>
        this.sendUpdate(u),
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
        // Flush any buffered chunks, THEN dispose so the batch timer is cleared
        // on completion/abort and no delayed flush fires after the turn ends
        // (FINDING F9). The batcher is per-prompt, so disposing here bounds its
        // timer to the prompt lifecycle. dispose() runs even when flush()
        // rejects (e.g. a dead transport) — otherwise the pending timer would
        // leak past the turn.
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
    this.logger.debug(() => 'sendUpdate: delivered');
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

  /** Replays resumed history as ordered, strictly delivered ACP updates. */
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

  /** Replays a live session whose recording has not materialized yet. */
  async replayLiveHistory(): Promise<void> {
    await this.streamHistory(
      await readAgentHistoryForReplay(this.agent, this.id),
    );
  }

  async dispose(): Promise<void> {
    try {
      todoEvents.offTodoUpdated(this.todoListener);
      this.settleActiveConfirmation();
      this.pendingPrompt?.abort();
      this.pendingPrompt = null;
    } finally {
      try {
        await this.agent.dispose();
      } catch (error) {
        debugLogger.error('Failed to dispose Zed session agent:', error);
      }
    }
  }
}
