/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { HookSystem } from './hookSystem.js';
import type {
  HookDefinitionConfiguration,
  HookSessionRuntime,
} from './hook-configuration.js';
import type { HookExecutionOwner } from './hookEventHandler.js';
import type { SessionEndReason } from './types.js';
import type { AggregatedHookResult } from './hookAggregator.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';

export interface HookStatus {
  readonly name: string;
  readonly eventName: string;
  readonly enabled: boolean;
  readonly source: string;
}

export class SessionHookOwner {
  private system: HookSystem | undefined;
  private closing: Promise<void> | undefined;
  private finalSession: Promise<AggregatedHookResult | undefined> | undefined;
  private readonly accepted = new Set<Promise<unknown>>();
  private readonly cancellation = new AbortController();
  private disabledNames: readonly string[];

  constructor(
    private readonly readDefinitions: () => HookDefinitionConfiguration,
    private readonly session: HookSessionRuntime,
    private readonly enabled: boolean,
    private readonly messageBus: MessageBus,
    private readonly parent?: SessionHookOwner,
  ) {
    this.disabledNames = [...readDefinitions().disabledHooks];
  }

  private admissionSignal(): AbortSignal {
    return this.parent === undefined
      ? this.cancellation.signal
      : AbortSignal.any([
          this.cancellation.signal,
          this.parent.admissionSignal(),
        ]);
  }

  private assertAdmission(): void {
    this.admissionSignal().throwIfAborted();
  }

  fork(): SessionHookOwner {
    this.assertAdmission();
    return new SessionHookOwner(
      this.readDefinitions,
      this.session,
      this.enabled,
      this.messageBus,
      this,
    );
  }

  execution(
    identity: Pick<
      HookExecutionOwner,
      'sessionId' | 'transcriptPath' | 'signal'
    >,
  ): HookExecutionOwner {
    return {
      ...identity,
      signal: AbortSignal.any([
        this.admissionSignal(),
        ...(identity.signal === undefined ? [] : [identity.signal]),
      ]),
      beforeTool: (name, input, context, signal) =>
        this.run(identity, signal, (system, owner) =>
          system.fireBeforeToolEvent(name, input, context, owner),
        ),
      afterTool: (name, input, response, context, signal) =>
        this.run(identity, signal, (system, owner) =>
          system.fireAfterToolEvent(name, input, response, context, owner),
        ),
      beforeModel: (request, signal) =>
        this.run(identity, signal, (system, owner) =>
          system.fireBeforeModelEvent(request, owner),
        ),
      afterModel: (request, response, signal) =>
        this.run(identity, signal, (system, owner) =>
          system.fireAfterModelEvent(request, response, owner),
        ),
      beforeToolSelection: (request, signal) =>
        this.run(identity, signal, (system, owner) =>
          system.fireBeforeToolSelectionEvent(request, owner),
        ),
      beforeAgent: (prompt, signal) =>
        this.run(identity, signal, (system, owner) =>
          system.fireBeforeAgentEvent({ prompt }, owner),
        ),
      afterAgent: (prompt, response, stop, signal) =>
        this.run(identity, signal, (system, owner) =>
          system.fireAfterAgentEvent(
            { prompt, prompt_response: response, stop_hook_active: stop },
            owner,
          ),
        ),
      sessionStart: (source, signal) =>
        this.run(identity, signal, (system, owner) =>
          system.fireSessionStartEvent({ source }, owner),
        ),
      sessionEnd: (reason, signal) =>
        this.run(identity, signal, (system, owner) =>
          system.fireSessionEndEvent({ reason }, owner),
        ),
      preCompress: (trigger, signal) =>
        this.run(identity, signal, (system, owner) =>
          system.firePreCompressEvent({ trigger }, owner),
        ),
      notification: (type, message, details, signal) =>
        this.run(identity, signal, (system, owner) =>
          system.fireNotificationEvent(type, message, details, owner),
        ),
    };
  }

  reloadDefinitions(): Promise<void> {
    if (this.cancellation.signal.aborted)
      return Promise.reject(this.cancellation.signal.reason);
    return (
      this.parent?.reloadDefinitions() ??
      this.system?.initialize(this.cancellation.signal) ??
      Promise.resolve()
    );
  }

  listHooks(): readonly HookStatus[] {
    if (this.parent !== undefined) return this.parent.listHooks();
    return (
      this.system?.getAllHooks().map((entry) =>
        Object.freeze({
          name:
            entry.config.name === undefined || entry.config.name === ''
              ? entry.config.command
              : entry.config.name,
          eventName: entry.eventName,
          enabled: entry.enabled,
          source: entry.source,
        }),
      ) ?? []
    );
  }

  getDisabledHooks(): readonly string[] {
    return this.parent?.getDisabledHooks() ?? [...this.disabledNames];
  }

  setDisabledHooks(names: readonly string[]): void {
    this.cancellation.signal.throwIfAborted();
    if (this.parent !== undefined) {
      this.parent.setDisabledHooks(names);
      return;
    }
    this.disabledNames = [...names];
    for (const entry of this.system?.getAllHooks() ?? []) {
      const name =
        entry.config.name === undefined || entry.config.name === ''
          ? entry.config.command
          : entry.config.name;
      this.system?.setHookEnabled(name, !this.disabledNames.includes(name));
    }
  }

  assertMessageBus(bus: MessageBus): void {
    if (bus !== this.messageBus)
      throw new Error('Hook ownership must retain its session MessageBus');
  }

  closeAdmission(): void {
    this.cancellation.abort(new Error('Session hook owner has been disposed.'));
  }

  finishSession(
    reason: SessionEndReason,
    identity: Pick<HookExecutionOwner, 'sessionId' | 'transcriptPath'>,
  ): Promise<AggregatedHookResult | undefined> {
    if (this.closing !== undefined)
      return Promise.reject(this.cancellation.signal.reason);
    const parentSignal = this.parent?.admissionSignal();
    if (parentSignal?.aborted === true)
      return Promise.reject(parentSignal.reason);
    this.closeAdmission();
    this.finalSession ??= this.fireFinalSession(reason, identity, [
      ...this.accepted,
    ]);
    return this.finalSession;
  }

  private async fireFinalSession(
    reason: SessionEndReason,
    identity: Pick<HookExecutionOwner, 'sessionId' | 'transcriptPath'>,
    accepted: ReadonlyArray<Promise<unknown>>,
  ): Promise<AggregatedHookResult | undefined> {
    await this.join(accepted, undefined);
    if (!this.enabled) return undefined;
    if (this.parent !== undefined)
      return this.parent.run(identity, undefined, (system, owner) =>
        system.fireSessionEndEvent({ reason }, owner),
      );
    const system = this.requireSystem();
    if (!system.isInitialized()) await system.initialize();
    return system.fireSessionEndEvent({ reason }, identity);
  }

  private requireSystem(): HookSystem {
    this.system ??= new HookSystem(
      () => ({ ...this.readDefinitions(), disabledHooks: this.disabledNames }),
      this.session,
      this.messageBus,
    );
    return this.system;
  }

  dispose(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closeAdmission();
    const final = this.finalSession;
    const graph =
      final === undefined
        ? this.system?.dispose()
        : (async (): Promise<void> => {
            const completed = await Promise.allSettled([final]);
            const retired = await Promise.allSettled([this.system?.dispose()]);
            const failures = [...completed, ...retired].flatMap((result) =>
              result.status === 'rejected' ? [result.reason] : [],
            );
            if (failures.length === 1) throw failures[0];
            if (failures.length > 1)
              throw new AggregateError(
                failures,
                'Final hook retirement failed',
              );
          })();
    this.closing = this.join([...this.accepted], graph);
    return this.closing;
  }

  private async join(
    accepted: ReadonlyArray<Promise<unknown>>,
    graph: Promise<void> | undefined,
  ): Promise<void> {
    const results = await Promise.allSettled([
      ...accepted,
      ...(graph === undefined ? [] : [graph]),
    ]);
    const failures = results.flatMap((result) =>
      result.status === 'rejected' &&
      result.reason !== this.cancellation.signal.reason
        ? [result.reason]
        : [],
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, 'Session hook shutdown failed');
  }

  private run<T>(
    identity: Pick<
      HookExecutionOwner,
      'sessionId' | 'transcriptPath' | 'signal'
    >,
    signal: AbortSignal | undefined,
    operation: (system: HookSystem, owner: HookExecutionOwner) => Promise<T>,
  ): Promise<T | undefined> {
    const admission = this.admissionSignal();
    if (admission.aborted) return Promise.reject(admission.reason);
    if (!this.enabled) return Promise.resolve(undefined);
    const joinedSignal = AbortSignal.any([
      this.cancellation.signal,
      ...(identity.signal === undefined ? [] : [identity.signal]),
      ...(signal === undefined ? [] : [signal]),
    ]);
    if (this.parent !== undefined) {
      const pending = this.parent.run(
        { ...identity, signal: joinedSignal },
        joinedSignal,
        operation,
      );
      this.accepted.add(pending);
      void pending.then(
        () => this.accepted.delete(pending),
        () => this.accepted.delete(pending),
      );
      return pending;
    }
    const system = this.requireSystem();
    const pending = (async (): Promise<T> => {
      joinedSignal.throwIfAborted();
      if (!system.isInitialized()) await system.initialize(joinedSignal);
      joinedSignal.throwIfAborted();
      return operation(system, { ...identity, signal: joinedSignal });
    })();
    this.accepted.add(pending);
    void pending.then(
      () => this.accepted.delete(pending),
      () => this.accepted.delete(pending),
    );
    return pending;
  }
}
