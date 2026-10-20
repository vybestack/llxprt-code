import { createClientToolChannel } from './clientToolChannel.js';
import type { EditorCallbacks } from '../api/config-types.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { PreparedProfileFacade } from '../api/profileApplicationAssembly.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  Config,
  WorkspaceTrustControlPort,
} from '@vybestack/llxprt-code-core';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import type {
  ToolSelection,
  ToolGovernance,
} from '@vybestack/llxprt-code-tools';
import { AgenticLoop } from '../core/agenticLoop/AgenticLoop.js';
import type {
  AgenticLoopOptions,
  ApprovalHandler,
} from '../core/agenticLoop/types.js';
import { TurnToolExecutionOwner } from './turn-tool-execution-owner.js';
import { bindTurnModel } from './bind-turn-model.js';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';
import {
  bindSchedulerOwner,
  type SchedulerConstruction,
} from './assembleSchedulerOwner.js';

export interface SessionExecution {
  run(...args: Parameters<AgenticLoop['run']>): ReturnType<AgenticLoop['run']>;
  injectSteer(text: string): void;
}

export class SessionExecutionOwner {
  private currentClient: AgentClientContract | undefined;
  private currentLoop: AgenticLoop | undefined;
  private currentExecution: SessionExecution | undefined;
  private currentController: AbortController | undefined;
  private readonly accepted = new Set<ReturnType<AgenticLoop['run']>>();
  private readonly cancellation = new Set<AbortController>();
  private closing: Promise<void> | undefined;
  private closed = false;

  constructor(
    private readonly config: Config,
    private readonly settings: SessionSettingsOwner,
    private readonly messageBus: MessageBus,
    private readonly selection: ToolSelection,
    private readonly readGovernance: () => ToolGovernance,
    private readonly trust: Pick<WorkspaceTrustControlPort, 'isTrustedFolder'>,
    private readonly scheduler: SchedulerConstruction | undefined,
    private readonly approval: ApprovalHandler | undefined,
    private readonly display: AgenticLoopOptions['displayCallbacks'],
  ) {}

  openClientToolChannel(
    readEditor: () => EditorCallbacks,
    onComplete: (calls: CompletedToolCall[]) => void | Promise<void>,
  ): ReturnType<typeof createClientToolChannel> {
    this.assertOpen();
    return createClientToolChannel(
      this.config,
      this.messageBus,
      readEditor,
      onComplete,
      this.selection,
      this.scheduler,
      () => this.settings.readToolExecutionPolicy(),
      this.readGovernance,
      () =>
        this.trust.isTrustedFolder()
          ? this.config.getApprovalMode()
          : ApprovalMode.DEFAULT,
      this.settings.telemetry,
    );
  }

  initialize(client: AgentClientContract): SessionExecution {
    if (this.currentExecution !== undefined)
      throw new Error('Session execution is already initialized');
    return this.rebuild(client);
  }

  rebuild(client: AgentClientContract): SessionExecution {
    const prepared = this.prepare(client);
    const execution = prepared.publish();
    prepared.retire();
    return execution;
  }

  prepare(client: AgentClientContract): {
    publish(): SessionExecution;
    retire(): void;
  } {
    this.assertOpen();
    const priorController = this.currentController;
    const priorLoop = this.currentLoop;
    const controller = new AbortController();
    const loop = this.construct(client);
    const execution: SessionExecution = {
      run: (...args) => this.runCaptured(loop, controller, ...args),
      injectSteer: (text) => {
        this.assertOpen();
        loop.injectSteer(text);
      },
    };
    let published = false;
    let retired = false;
    return {
      publish: () => {
        this.assertOpen();
        if (!published) {
          published = true;
          this.currentClient = client;
          this.currentLoop = loop;
          this.currentController = controller;
          this.currentExecution = execution;
        }
        return execution;
      },
      retire: () => {
        if (retired) return;
        retired = true;
        const failures: unknown[] = [];
        try {
          priorController?.abort();
        } catch (error) {
          failures.push(error);
        }
        try {
          priorLoop?.retire();
        } catch (error) {
          failures.push(error);
        }
        if (failures.length > 0)
          throw new AggregateError(failures, 'Prior loop retirement failed');
      },
    };
  }

  async prepareProfile(
    client: AgentClientContract,
    initializeHistory: boolean,
    signal: AbortSignal,
    prepareHistoryCommit: (() => Promise<() => void>) | undefined,
    publishClient: (() => void) | undefined,
    retireClient: (() => Promise<void>) | undefined,
    discardClient: (() => Promise<void>) | undefined,
    retirePrior: (release: () => Promise<void>) => Promise<void>,
  ): Promise<PreparedProfileFacade> {
    try {
      signal.throwIfAborted();
      if (initializeHistory) {
        const history = await client.getHistory();
        signal.throwIfAborted();
        await client.startChat(history.length > 0 ? history : undefined);
      }
      signal.throwIfAborted();
      const loop = this.prepare(client);
      const commitHistory = await prepareHistoryCommit?.();
      signal.throwIfAborted();
      return {
        publish: () => {
          commitHistory?.();
          publishClient?.();
          loop.publish();
        },
        retire: () =>
          retirePrior(async () => {
            const failures: unknown[] = [];
            try {
              loop.retire();
            } catch (error) {
              failures.push(error);
            }
            try {
              await retireClient?.();
            } catch (error) {
              failures.push(error);
            }
            if (failures.length > 0)
              throw new AggregateError(
                failures,
                'Profile replacement retirement failed',
              );
          }),
        discard: async () => {
          await discardClient?.();
        },
      };
    } catch (error) {
      try {
        await discardClient?.();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Profile preparation failed and candidate cleanup was incomplete',
        );
      }
      throw error;
    }
  }

  resolve(
    client: AgentClientContract,
  ):
    | { execution: SessionExecution; error?: undefined }
    | { execution?: undefined; error: { message: string } } {
    try {
      this.assertOpen();
      if (this.currentExecution !== undefined && this.currentClient !== client)
        this.rebuild(client);
    } catch (error) {
      return {
        error: {
          message: `Agent loop initialization failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
    return this.currentExecution === undefined
      ? { error: { message: 'Agent loop is not initialized' } }
      : { execution: this.currentExecution };
  }

  isCurrent(execution: SessionExecution | undefined): boolean {
    return execution !== undefined && execution === this.currentExecution;
  }

  closeAdmission(): void {
    this.closed = true;
  }

  abort(): void {
    const failures: unknown[] = [];
    for (const controller of [this.currentController, ...this.cancellation]) {
      try {
        controller?.abort();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        'Session execution cancellation failed',
      );
  }

  dispose(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closeAdmission();
    let resolve = (): void => {};
    let reject = (_error: unknown): void => {};
    this.closing = new Promise<void>((accept, fail) => {
      resolve = accept;
      reject = fail;
    });
    const failures: unknown[] = [];
    try {
      this.abort();
    } catch (error) {
      failures.push(error);
    }
    try {
      this.currentLoop?.retire();
    } catch (error) {
      failures.push(error);
    }
    void Promise.allSettled(
      [...this.accepted].map((stream) => stream.return(undefined)),
    ).then((results) => {
      for (const result of results)
        if (result.status === 'rejected') failures.push(result.reason);
      if (failures.length > 0)
        reject(
          new AggregateError(failures, 'Session execution cleanup failed'),
        );
      else resolve();
    });
    return this.closing;
  }

  private async *runCaptured(
    loop: AgenticLoop,
    controller: AbortController,
    ...[input, signal, ...rest]: Parameters<AgenticLoop['run']>
  ): ReturnType<AgenticLoop['run']> {
    this.assertOpen();
    const cancellation = new AbortController();
    const stream = loop.run(
      input,
      AbortSignal.any([signal, controller.signal, cancellation.signal]),
      ...rest,
    );
    this.cancellation.add(cancellation);
    this.accepted.add(stream);
    try {
      yield* stream;
    } finally {
      this.accepted.delete(stream);
      this.cancellation.delete(cancellation);
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Session execution is closed');
  }

  private construct(client: AgentClientContract): AgenticLoop {
    const interactiveMode = this.config.isInteractive();
    return new AgenticLoop({
      ...bindTurnModel(client),
      config: this.config,
      tools: new TurnToolExecutionOwner(
        this.messageBus,
        this.approval,
        bindSchedulerOwner(
          this.config,
          this.messageBus,
          interactiveMode,
          this.selection,
          this.scheduler ?? ((options) => new CoreToolScheduler(options)),
          () => this.settings.readToolExecutionPolicy(),
          this.readGovernance,
          () =>
            this.trust.isTrustedFolder()
              ? this.config.getApprovalMode()
              : ApprovalMode.DEFAULT,
          this.settings.telemetry,
        ),
      ),
      displayCallbacks: this.display,
      interactiveMode,
    });
  }
}
