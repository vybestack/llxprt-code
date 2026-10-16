/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  Config,
  MessageBus,
  WorkspaceTrustControlPort,
} from '@vybestack/llxprt-code-core';
import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import {
  readHookDefinitions,
  hookSessionRuntime,
} from '@vybestack/llxprt-code-core/hooks/hook-configuration.js';

export class SessionHookComposition {
  private root: SessionHookOwner | undefined;
  private releaseReload: (() => void) | undefined;
  private closing: Promise<void> | undefined;

  constructor(
    private readonly config: Config,
    private readonly readTelemetry: () => RootTelemetry,
    private readonly readBus: () => MessageBus,
    private readonly readTrust: () => WorkspaceTrustControlPort | undefined,
    private readonly bindReload: (
      reload: () => Promise<void>,
    ) => (() => void) | undefined,
  ) {}

  isComposed(): boolean {
    return this.root !== undefined;
  }

  get operations(): SessionHookOwner {
    if (this.root === undefined)
      throw new Error('Missing session hook composition');
    return this.root;
  }

  bind(
    supplied?: SessionHookOwner,
    bus: MessageBus = this.readBus(),
    trust: WorkspaceTrustControlPort | undefined = this.readTrust(),
  ): void {
    if (this.root !== undefined)
      throw new Error('Session hooks are already composed');
    if (supplied !== undefined) {
      supplied.assertMessageBus(bus);
      this.root = supplied.fork();
    } else {
      if (trust === undefined)
        throw new Error('Hooks require explicit workspace trust composition');
      this.root = new SessionHookOwner(
        readHookDefinitions(this.config),
        hookSessionRuntime(this.config, trust, this.readTelemetry()),
        this.config.getEnableHooks(),
        bus,
      );
    }
    this.releaseReload = this.bindReload(() =>
      this.operations.reloadDefinitions(),
    );
  }

  closeAdmission(): void {
    const release = this.releaseReload;
    this.releaseReload = undefined;
    const failures: unknown[] = [];
    try {
      release?.();
    } catch (error) {
      failures.push(error);
    }
    try {
      this.root?.closeAdmission();
    } catch (error) {
      failures.push(error);
    }
    this.raiseFailures(failures);
  }

  dispose(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    const failures: unknown[] = [];
    try {
      this.closeAdmission();
    } catch (error) {
      failures.push(error);
    }
    this.closing = this.releaseRoot(failures);
    return this.closing;
  }

  private async releaseRoot(failures: unknown[]): Promise<void> {
    try {
      await this.root?.dispose();
    } catch (error) {
      failures.push(error);
    }
    this.raiseFailures(failures);
  }

  private raiseFailures(failures: readonly unknown[]): void {
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        'Session hook composition release failed',
      );
  }
}
