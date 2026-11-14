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
import type { SubscribeModelChanges } from '@vybestack/llxprt-code-core/utils/events.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  requestToolConfirmation,
  type PermissionRoundTripResult,
} from './zed-tool-handler.js';
import type { TerminalManager } from './zed-terminal-manager.js';
import { disposeZedSession } from './zed-session-agent.js';
import { deliverHistoryUpdates } from './zed-session-replay.js';
import { readAgentHistoryForReplay } from './zed-session-loader.js';

import type { LifecycleSession } from './zed-session-pagination.js';
import {
  buildAvailableCommandsUpdate,
  createZedCommandExecutor,
} from './zed-command-registry.js';
import { tryHandleZedCommand } from './zed-prompt-command.js';
import {
  buildZedConfigOptions,
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

export interface SessionPorts {
  readonly id: string;
  readonly streamTurn: Agent['stream'];
  readonly readModel: Agent['getModel'];
  readonly selectModel: Agent['setModel'];
  readonly listModels: Agent['listAvailableModels'];
  readonly readContextLimit: Agent['getProviderContextLimit'];
  readonly readApprovalMode: Agent['getApprovalMode'];
  readonly writeApprovalMode: Agent['setApprovalMode'];
  readonly readHistory: Agent['streamHistory'];
  readonly compressHistory: Agent['compress'];
  readonly retireAgent: Agent['dispose'];
  readonly lookupTool: Agent['tools']['get'];
  readonly listTools: Agent['tools']['list'];
  readonly replyConfirmation: Agent['tools']['respondToConfirmation'];
  readonly readTitle: Agent['session']['getRecordingTitle'];
  readonly writeTitle: Agent['session']['recordRecordingTitle'];
  readonly readMemoryFiles: Agent['memory']['getFilePaths'];
  readonly listProfiles: Agent['profiles']['list'];
  readonly listTasks: Agent['tasks']['list'];
  readonly readProjectRoot: () => string;
  readonly readMaxTurns: () => number;
  readonly readDebugMode: () => boolean;
  readonly readFiltering: ConstructorParameters<typeof ZedPathResolver>[0];
  readonly readTargetDir: ConstructorParameters<typeof ZedPathResolver>[1];
  readonly readRecursiveSearch: ConstructorParameters<
    typeof ZedPathResolver
  >[2];
  readonly readTextFile: ConstructorParameters<typeof ZedPathResolver>[3];
  readonly shouldIgnoreFile: ConstructorParameters<typeof ZedPathResolver>[4];
  readonly readIgnorePatterns: ConstructorParameters<typeof ZedPathResolver>[5];
  readonly readSetting: Agent['getEphemeralSetting'];
  readonly writeSetting: Agent['setEphemeralSetting'];
  readonly subscribeModelChanges: SubscribeModelChanges;
  readonly connection: Pick<
    acp.AgentSideConnection,
    'sessionUpdate' | 'requestPermission'
  >;
  readonly configOptionsEnabled: boolean;
  readonly terminals: TerminalManager | null;
}

export class Session {
  private pendingPrompt: AbortController | null = null;
  private closing: Promise<void> | undefined;
  private readonly acceptedWork = new Set<Promise<void>>();
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

  private readonly executeCommand: ReturnType<typeof createZedCommandExecutor>;
  constructor(private readonly ports: SessionPorts) {
    const {
      readModel,
      compressHistory,
      listTools,
      readMemoryFiles,
      listProfiles,
      listTasks,
      readFiltering,
      readTargetDir,
      readRecursiveSearch,
      readTextFile,
      shouldIgnoreFile,
      readIgnorePatterns,
      subscribeModelChanges,
      configOptionsEnabled,
    } = ports;
    this.executeCommand = createZedCommandExecutor(
      compressHistory,
      readModel,
      listTools,
      readMemoryFiles,
      listProfiles,
      listTasks,
    );
    this.pathResolver = new ZedPathResolver(
      readFiltering,
      readTargetDir,
      readRecursiveSearch,
      readTextFile,
      shouldIgnoreFile,
      readIgnorePatterns,
      (msg) => this.debug(msg),
    );
    const recordedTitle = this.ports.readTitle();
    if (recordedTitle !== undefined) {
      this.sessionInfo.hydrateFromMetadata(recordedTitle);
    }
    this.stopTodoUpdates = subscribeSessionTodos(this.ports.id, (todos) =>
      this.sendUpdate(buildZedPlanUpdate(todos)),
    );
    this.stopConfigUpdates = configOptionsEnabled
      ? observeZedConfigOptions(
          this.ports.readModel,
          this.ports.listModels,
          this.ports.readSetting,
          (update) => this.sendUpdateStrict(update),
          (error) => this.logger.debug(() => `Config update failed: ${error}`),
          subscribeModelChanges,
          (refresh) => this.joinWork(refresh),
        )
      : () => undefined;
  }
  setMode(modeId: acp.SessionModeId): acp.SetSessionModeResponse {
    this.assertOpen();
    this.ports.writeApprovalMode(resolveZedMode(modeId));
    return {};
  }
  getApprovalMode(): ApprovalMode {
    return this.ports.readApprovalMode();
  }
  setConfigOption(configId: string, value: string) {
    return this.admitWork(() =>
      setZedConfigOption(
        this.ports.readModel,
        this.ports.listModels,
        this.ports.selectModel,
        this.ports.readSetting,
        this.ports.writeSetting,
        configId,
        value,
      ),
    );
  }
  getConfigOptions = () =>
    this.admitWork(() =>
      buildZedConfigOptions(
        this.ports.readModel,
        this.ports.listModels,
        this.ports.readSetting,
      ),
    );
  getLifecycleInfo(): LifecycleSession {
    return presentLifecycleSession(
      this.ports.id,
      this.ports.readProjectRoot(),
      this.createdAt,
      this.sessionInfo,
    );
  }
  cancelPendingPrompt(): Promise<void> {
    return this.admitWork(async () => {
      this.settleActiveConfirmation();
      this.pendingPrompt?.abort();
      this.pendingPrompt = null;
      await this.ports.terminals?.settleAll();
    });
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
      this.ports.replyConfirmation(
        confirmationId,
        ToolConfirmationOutcome.Cancel,
      );
    } catch (error) {
      debugLogger.error('Failed to cancel active tool confirmation:', error);
    } finally {
      state.cancelWaiter();
    }
  }
  prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    return this.admitWork(() => this.runPrompt(params));
  }
  private async runPrompt(
    params: acp.PromptRequest,
  ): Promise<acp.PromptResponse> {
    this.assertOpen();
    await this.cancelPendingPrompt();
    this.assertOpen();
    const eligibility = this.sessionInfo.consumeTitleEligibility(params.prompt);
    try {
      await this.ports.writeTitle(eligibility.title ?? null);
    } catch (error) {
      this.logger.debug(() => `Session metadata recording failed: ${error}`);
    }
    this.assertOpen();
    try {
      const commandResult = await tryHandleZedCommand(
        params.prompt,
        this.executeCommand,
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
        emojiFilterMode: (this.ports.readSetting('emojifilter') ??
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
      streamTurn: this.ports.streamTurn,
      lookupTool: this.ports.lookupTool,
      terminals: this.ports.terminals,
      sendUpdate: (update) => this.sendUpdate(update),
      sendUsage: (usage) => this.sendUsageUpdate(usage),
      handleConfirmation: (confirmation) =>
        this.handleToolConfirmation(
          confirmation,
          promptGeneration,
          pendingSend,
        ),
      isPromptStale: (gen, send) => this.isPromptStale(gen, send),
      maxTurns: this.ports.readMaxTurns(),
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
      resolveZedContextWindowSize(
        this.ports.readModel,
        this.ports.readSetting,
        this.ports.readContextLimit,
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
          this.ports.id,
          event.confirmation.toolCallId,
          event.confirmation.name,
          event.confirmation.details,
          this.ports.connection,
          this.ports.lookupTool(event.confirmation.name)?.kind,
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
      this.ports.replyConfirmation(
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
    return this.joinWork(() =>
      sendZedSessionUpdate(
        this.ports.connection,
        this.ports.id,
        update,
        this.logger,
      ),
    );
  }
  sendAvailableCommands(): Promise<void> {
    return this.admitWork(() =>
      this.sendUpdateStrict(buildAvailableCommandsUpdate()),
    );
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
    if (this.ports.readDebugMode()) debugLogger.warn(msg);
  }
  streamHistory(
    items: AsyncIterable<IContent> | Iterable<IContent>,
  ): Promise<void> {
    return this.admitWork(() => this.replayHistory(items));
  }
  private async replayHistory(
    items: AsyncIterable<IContent> | Iterable<IContent>,
  ): Promise<void> {
    await deliverHistoryUpdates(
      items,
      this.sessionInfo,
      this.ports.id,
      (update) => this.sendUpdateStrict(update),
    );
  }
  replayLiveHistory(): Promise<void> {
    return this.admitWork(async () => {
      await this.replayHistory(
        readAgentHistoryForReplay(this.ports.readHistory, this.ports.id),
      );
    });
  }
  private assertOpen(): void {
    if (this.closing !== undefined) throw new Error('ACP session is disposed');
  }
  private async admitWork<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen();
    return this.joinWork(operation);
  }
  private async joinWork<T>(operation: () => Promise<T>): Promise<T> {
    let complete!: () => void;
    const completed = new Promise<void>((resolve) => {
      complete = resolve;
    });
    this.acceptedWork.add(completed);
    try {
      return await operation();
    } finally {
      this.acceptedWork.delete(completed);
      complete();
    }
  }
  private detachObservers(): void {
    const failures: unknown[] = [];
    for (const stop of [
      this.stopTodoUpdates,
      this.stopConfigUpdates,
      () => this.settleActiveConfirmation(),
    ]) {
      try {
        stop();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, 'ACP session observer release failed');
  }
  dispose(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    let complete!: () => void;
    let fail!: (reason: unknown) => void;
    this.closing = new Promise<void>((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
    const accepted = [...this.acceptedWork];
    const release = disposeZedSession(
      () => this.detachObservers(),
      this.ports.terminals,
      this.logger,
      () => {
        this.pendingPrompt?.abort();
        this.pendingPrompt = null;
      },
      this.ports.retireAgent,
    );
    void Promise.allSettled([release, ...accepted]).then(([result]) => {
      if (result.status === 'rejected') fail(result.reason);
      else complete();
    });
    return this.closing;
  }
}
