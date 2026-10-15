/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type FilterConfiguration,
  type IContent,
  type ApprovalMode,
} from '@vybestack/llxprt-code-core';
import type { Agent, AgentEvent } from '@vybestack/llxprt-code-agents';
import { debugLogger, DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type * as acp from '@agentclientprotocol/sdk';
import { randomUUID } from 'crypto';
import {
  resolveZedMode,
  subscribeSessionTodos,
  buildUsageUpdate,
  sendZedSessionUpdate,
  resolveZedContextWindowSize,
} from './zed-helpers.js';
import { ZedPathResolver } from './zed-path-resolver.js';
import { type ZedSessionSettings } from './zed-session-ports.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  requestToolConfirmation,
  type PermissionRoundTripResult,
} from './zed-tool-handler.js';
import type { TerminalManager } from './zed-terminal-manager.js';
import { disposeZedSession } from './zed-session-agent.js';
import { streamZedHistory } from './zed-session-loader.js';
import { readAgentHistoryForReplay } from './zed-session-loader.js';

import type { LifecycleSession } from './zed-session-pagination.js';
import { buildAvailableCommandsUpdate } from './zed-command-registry.js';
import { tryHandleZedCommand } from './zed-prompt-command.js';
import {
  buildZedConfigOptions,
  projectZedOptionSettings,
  observeZedConfigOptions,
  setZedConfigOption,
} from './zed-config-options.js';

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
    private readonly streamTurn: Agent['stream'],
    private readonly readModel: Agent['getModel'],
    private readonly selectModel: Agent['setModel'],
    private readonly listModels: Agent['listAvailableModels'],
    private readonly readContextLimit: Agent['getProviderContextLimit'],
    private readonly readApprovalMode: Agent['getApprovalMode'],
    private readonly writeApprovalMode: Agent['setApprovalMode'],
    private readonly readHistory: Agent['getHistory'],
    private readonly compressHistory: Agent['compress'],
    private readonly retireAgent: Agent['dispose'],
    private readonly lookupTool: Agent['tools']['get'],
    private readonly listTools: Agent['tools']['list'],
    private readonly replyConfirmation: Agent['tools']['respondToConfirmation'],
    private readonly readTitle: Agent['session']['getRecordingTitle'],
    private readonly writeTitle: Agent['session']['recordRecordingTitle'],
    private readonly readMemoryFiles: Agent['memory']['getFilePaths'],
    private readonly listProfiles: Agent['profiles']['list'],
    private readonly listTasks: Agent['tasks']['list'],
    private readonly config: ZedSessionSettings,
    private readonly connection: Pick<
      acp.AgentSideConnection,
      'sessionUpdate' | 'requestPermission'
    >,
    configOptionsEnabled = false,
    terminals: TerminalManager | null = null,
    private readonly disposeConfig: () => Promise<void> = () =>
      Promise.resolve(),
  ) {
    this.terminals = terminals;
    this.pathResolver = new ZedPathResolver(this.config, (msg) =>
      this.debug(msg),
    );
    const recordedTitle = this.readTitle();
    if (recordedTitle !== undefined) {
      this.sessionInfo.hydrateFromMetadata(recordedTitle);
    }
    this.stopTodoUpdates = subscribeSessionTodos(this.id, (todos) =>
      this.sendUpdate(buildZedPlanUpdate(todos)),
    );
    this.stopConfigUpdates = configOptionsEnabled
      ? observeZedConfigOptions(
          this.modelReads(),
          projectZedOptionSettings(this.config),
          (update) => this.sendUpdateStrict(update),
          (error) => this.logger.debug(() => `Config update failed: ${error}`),
          this.config.subscribeModelChanges,
        )
      : () => undefined;
  }
  private modelReads() {
    return { getModel: this.readModel, listAvailableModels: this.listModels };
  }
  setMode(modeId: acp.SessionModeId): acp.SetSessionModeResponse {
    this.writeApprovalMode(resolveZedMode(modeId));
    return {};
  }
  getApprovalMode(): ApprovalMode {
    return this.readApprovalMode();
  }
  setConfigOption(configId: string, value: string) {
    return setZedConfigOption(
      { ...this.modelReads(), setModel: this.selectModel },
      projectZedOptionSettings(this.config),
      configId,
      value,
    );
  }
  getConfigOptions = () =>
    buildZedConfigOptions(
      this.modelReads(),
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
      this.replyConfirmation(confirmationId, ToolConfirmationOutcome.Cancel);
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
      await this.writeTitle(eligibility.title ?? null);
    } catch (error) {
      this.logger.debug(() => `Session metadata recording failed: ${error}`);
    }
    try {
      const commandResult = await tryHandleZedCommand(
        params.prompt,
        {
          compress: this.compressHistory,
          getModel: this.readModel,
          tools: { list: this.listTools },
          memory: { getFilePaths: this.readMemoryFiles },
          profiles: { list: this.listProfiles },
          tasks: { list: this.listTasks },
        },
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
        stream: (input, options) => this.streamTurn(input, options),
        tools: { get: (name) => this.lookupTool(name) },
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
      resolveZedContextWindowSize(this.config, () => this.readContextLimit()),
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
          this.lookupTool(event.confirmation.name)?.kind,
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
      this.replyConfirmation(
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
      await readAgentHistoryForReplay(this.readHistory, this.id),
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
      this.retireAgent,
      this.disposeConfig,
    );
  }
}
