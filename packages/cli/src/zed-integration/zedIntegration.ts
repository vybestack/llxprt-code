/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  clearCachedCredentialFile,
  getErrorStatus,
  todoEvents,
  DEFAULT_AGENT_ID,
  isWithinRoot,
  debugLogger,
  createInkStdio,
  type ContractPart,
  type Config,
  DebugLogger,
  EmojiFilter,
  type FilterConfiguration,
  type TodoUpdateEvent,
  type Todo,
  type ApprovalMode,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import * as acp from '@agentclientprotocol/sdk';
import {
  fromConfig,
  type Agent,
  type AgentEvent,
  type DoneReason,
  type ThoughtSummary,
} from '@vybestack/llxprt-code-agents';
import { Readable, Writable } from 'node:stream';
import * as path from 'node:path';
import { type LoadedSettings } from '../config/settings.js';
import { randomUUID } from 'crypto';
import {
  getActiveProfileName,
  loadProfileByName,
  setCliRuntimeContext,
} from '@vybestack/llxprt-code-providers/runtime.js';
import { runExitCleanup } from '../utils/cleanup.js';
import { AcpFileSystemService } from './fileSystemService.js';
import { parseZedAuthMethodId, buildAvailableModes } from './zed-helpers.js';
import { ZedPathResolver } from './zed-path-resolver.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  emitToolCallStart,
  emitToolStatus,
  emitToolResult,
  requestToolConfirmation,
  type PermissionRoundTripResult,
} from './zed-tool-handler.js';

export { parseZedAuthMethodId } from './zed-helpers.js';

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

  // Deliberate foreground hand-off: the Zed integration replaces the CLI
  // bootstrap runtime as the process default. allowDefaultHandoff opts past the
  // write-once guard for this one intentional transition (issue #2300).
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

function resolveSessionTargetDir(
  config: Config,
  cwd: string | undefined,
): string {
  if (cwd === undefined || cwd.trim().length === 0) {
    return config.getTargetDir();
  }
  const candidate = path.isAbsolute(cwd)
    ? cwd
    : path.resolve(config.getTargetDir(), cwd);
  return isWithinRoot(candidate, config.getTargetDir())
    ? candidate
    : config.getTargetDir();
}

export function createSessionScopedConfig(
  config: Config,
  initialFileSystemService: ReturnType<Config['getFileSystemService']>,
  targetDir: string = config.getTargetDir(),
): Config {
  let fileSystemService = initialFileSystemService;
  let providerManager: RuntimeProviderManager | undefined =
    config.getProviderManager();
  return new Proxy(config, {
    get(target, property, receiver) {
      if (property === 'getFileSystemService') {
        return () => fileSystemService;
      }
      if (property === 'setFileSystemService') {
        return (nextFileSystemService: typeof fileSystemService) => {
          fileSystemService = nextFileSystemService;
        };
      }
      if (property === 'getProviderManager') {
        return () => providerManager;
      }
      if (property === 'setProviderManager') {
        return (nextProviderManager: RuntimeProviderManager) => {
          providerManager = nextProviderManager;
        };
      }
      if (property === 'getProjectRoot') {
        return () => targetDir;
      }
      if (property === 'getTargetDir') {
        return () => targetDir;
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

export class ZedAgent {
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
  }

  async newSession({
    cwd,
    mcpServers: _mcpServers,
  }: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    try {
      const sessionId = randomUUID();
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

      this.logger.debug(() => `newSession - creating session ${sessionId}`);

      const agent = await fromConfig({
        config: sessionConfig,
        sessionId,
      });

      const session = new Session(
        sessionId,
        agent,
        sessionConfig,
        this.connection,
      );
      this.sessions.set(sessionId, session);

      return {
        sessionId,
        modes: {
          availableModes: buildAvailableModes(),
          currentModeId: agent.getApprovalMode(),
        },
      };
    } catch (error) {
      this.logger.debug(() => `ERROR in newSession: ${error}`);
      throw error;
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

function mapDoneReasonToStopReason(reason: DoneReason): acp.StopReason {
  switch (reason) {
    case 'stop':
    case 'loop-detected':
      return 'end_turn';
    case 'aborted':
      return 'cancelled';
    case 'max-turns':
      return 'max_turn_requests';
    case 'context-overflow':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    case 'error':
    case 'hook-stopped':
      throw new Error(`Agent stopped with terminal reason: ${reason}`);
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
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
        await batcher.flush();
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
        const thoughtText = this.extractThoughtText(event.thought);
        if (thoughtText.length > 0) {
          batcher.append(thoughtText, true);
        }
        return null;
      }
      case 'tool-call':
        await batcher.flush();
        await emitToolCallStart(event.call, (u) => this.sendUpdate(u));
        return null;
      case 'tool-status':
        await batcher.flush();
        await emitToolStatus(event.update, (u) => this.sendUpdate(u));
        return null;
      case 'tool-result':
        await batcher.flush();
        await emitToolResult(event.result, (u) => this.sendUpdate(u));
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
        throw this.translateErrorEvent(event);
      case 'idle-timeout':
        await batcher.flush();
        throw this.translateIdleTimeout(event);
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
        // The agent detects a tool-call loop. Map to end_turn so the client
        // sees a clean turn end rather than an indefinite hang.
        await batcher.flush();
        return 'end_turn';
      case 'notice':
        // Informational notices have no direct ACP SessionUpdate; surface as
        // an agent message so the user sees them.
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
        // These variants have no faithful ACP translation: usage is mapped
        // separately, compression/model-info/citation are metadata, retry is
        // an internal agent detail, and context-warning is advisory. They are
        // intentionally consumed without surfacing to ACP.
        return null;
      default: {
        // Exhaustiveness guard: any future AgentEvent variant added to the
        // union without an explicit case above will fail to type-check here.
        const exhaustive: never = event;
        throw new Error(`Unhandled agent event: ${String(exhaustive)}`);
      }
    }
  }

  private async sendUsageUpdate(
    usage: Extract<AgentEvent, { type: 'usage' }>['usage'],
  ): Promise<void> {
    const outputTokens = usage.candidatesTokenCount ?? 0;
    const size = usage.totalTokenCount ?? outputTokens;
    if (size === 0 && outputTokens === 0) {
      return;
    }
    await this.sendUpdate({
      sessionUpdate: 'usage_update',
      used: size,
      size,
    });
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

  private extractThoughtText(thought: ThoughtSummary): string {
    const parts = [thought.subject, thought.description].filter(
      (v) => v.length > 0,
    );
    return parts.join(parts.length > 1 ? ' ' : '');
  }

  private translateErrorEvent(
    event: Extract<AgentEvent, { type: 'error' }>,
  ): Error {
    const error = new Error(event.error.message);
    if (event.error.status !== undefined) {
      Object.assign(error, { status: event.error.status });
    }
    return error;
  }

  private translateIdleTimeout(
    event: Extract<AgentEvent, { type: 'idle-timeout' }>,
  ): Error {
    return new Error(event.error.message);
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

const BATCH_INTERVAL_MS = 100;

class StreamBatcher {
  private pendingChunks: Array<{ kind: 'text' | 'thought'; text: string }> = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private flushChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly emojiFilter: EmojiFilter,
    private readonly sendUpdate: (update: acp.SessionUpdate) => Promise<void>,
  ) {}

  append(text: string, isThought: boolean): void {
    const filterResult = isThought
      ? this.emojiFilter.filterText(text)
      : this.emojiFilter.filterStreamChunk(text);
    if (filterResult.blocked) {
      const pending = this.flushChain
        .then(() => this.doFlush())
        .then(() =>
          this.sendUpdate({
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: '[Error: Response blocked due to emoji detection]',
            },
          }),
        );
      this.flushChain = pending.catch(() => undefined);
      return;
    }
    const filteredText =
      typeof filterResult.filtered === 'string' ? filterResult.filtered : '';
    if (filteredText.length === 0) {
      return;
    }
    this.appendPendingChunk(isThought ? 'thought' : 'text', filteredText);
    this.batchTimer ??= setTimeout(() => {
      this.batchTimer = null;
      void this.flush();
    }, BATCH_INTERVAL_MS);
  }

  async flush(): Promise<void> {
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    const pending = this.flushChain
      .then(() => this.doFlush())
      .then(() => this.flushEmojiBuffer());
    this.flushChain = pending.catch(() => undefined);
    await pending;
  }

  private async flushEmojiBuffer(): Promise<void> {
    const remaining = this.emojiFilter.flushBuffer();
    if (remaining.length === 0) {
      return;
    }
    this.appendPendingChunk('text', remaining);
    await this.doFlush();
  }

  private appendPendingChunk(kind: 'text' | 'thought', text: string): void {
    const lastChunk = this.pendingChunks.at(-1);
    if (lastChunk?.kind === kind) {
      lastChunk.text += text;
      return;
    }
    this.pendingChunks.push({ kind, text });
  }

  private async doFlush(): Promise<void> {
    const chunks = this.pendingChunks;
    this.pendingChunks = [];
    for (const chunk of chunks) {
      await this.sendUpdate({
        sessionUpdate:
          chunk.kind === 'thought'
            ? 'agent_thought_chunk'
            : 'agent_message_chunk',
        content: { type: 'text', text: chunk.text },
      });
    }
  }
}
