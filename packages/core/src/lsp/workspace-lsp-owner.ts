/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LspServiceClient } from '@vybestack/llxprt-code-ide-integration';
import type {
  LspConfig,
  ServerStatus,
  Diagnostic,
} from '@vybestack/llxprt-code-ide-integration';
import type {
  ILspService,
  McpToolPublication,
} from '@vybestack/llxprt-code-tools';
import type { McpApprovalPolicy } from '@vybestack/llxprt-code-mcp';
import {
  initializeLsp,
  cleanupLspMcpResources,
  shutdownLsp,
  type LspState,
} from '../config/lspIntegration.js';

type Registration = Pick<
  McpToolPublication,
  'registerTool' | 'sortTools' | 'removeMcpToolsByServer'
>;
export interface WorkspaceLspInspection {
  read(): Promise<{
    readonly configured: LspConfig | undefined;
    readonly alive: boolean;
    readonly reason: string | undefined;
    readonly statuses: readonly ServerStatus[];
  }>;
}

export class WorkspaceLspOwner {
  private readonly state: LspState;
  private initialization: Promise<void> | undefined;
  private disposal: Promise<void> | undefined;
  private registration: Registration | undefined;
  private registrationRelease: Promise<void> | undefined;
  private stopped = false;
  private readonly diagnosticCache = new Map<string, Diagnostic[]>();
  private readonly work = new Set<Promise<unknown>>();
  private unavailableCleanup: Promise<void> | undefined;
  private unavailableFailures: unknown[] = [];
  private unsubscribe: (() => void) | undefined;
  readonly diagnostics: ILspService;
  readonly inspection: WorkspaceLspInspection;

  constructor(
    configuration: LspConfig | undefined,
    private readonly workspaceRoot: string,
    private readonly trusted: () => boolean,
    service?: LspServiceClient,
    private readonly serviceOwnership: 'runtime' | 'caller' = service ===
    undefined
      ? 'runtime'
      : 'caller',
  ) {
    this.state = {
      lspConfig:
        configuration === undefined
          ? undefined
          : structuredClone(configuration),
      lspServiceClient: service,
    };
    this.diagnostics = {
      getDiagnostics: (file) => {
        this.assertActive();
        return structuredClone(this.diagnosticCache.get(file) ?? []);
      },
      waitForDiagnostics: async (file, timeout) =>
        this.checkFile(file, timeout),
      getLspConfig: () => {
        this.assertActive();
        return this.configuration();
      },
    };
    this.inspection = { read: () => this.readInspection() };
  }

  initialize(
    registration: Registration,
    approvalPolicy: McpApprovalPolicy,
  ): Promise<void> {
    this.assertActive();
    if (this.state.lspConfig === undefined) {
      this.initialization ??= Promise.resolve();
      return this.initialization;
    }
    if (this.registration !== undefined && this.registration !== registration)
      throw new Error('LSP owner requires its original tool registration port');
    if (this.initialization !== undefined) return this.initialization;
    this.registration = registration;
    this.initialization = this.start(registration, approvalPolicy);
    return this.initialization;
  }

  private async start(
    registration: Registration,
    approval: McpApprovalPolicy,
  ): Promise<void> {
    if (this.state.lspConfig === undefined) return;
    this.state.lspServiceClient ??= new LspServiceClient(
      this.state.lspConfig,
      this.workspaceRoot,
    );
    this.unsubscribe = this.state.lspServiceClient.onUnavailable(() => {
      this.diagnosticCache.clear();
      try {
        registration.removeMcpToolsByServer('lsp-navigation');
      } catch (error) {
        this.unavailableFailures.push(error);
      }
      this.unavailableCleanup ??= this.closeUnavailableNavigation(registration);
      void this.unavailableCleanup.catch(() => undefined);
    });
    try {
      await initializeLsp(
        this.state,
        {
          registration,
          getTargetDir: () => this.workspaceRoot,
          isTrustedFolder: () => this.trusted(),
          assertActive: () => this.assertActive(),
          assertInvocation: () => this.assertNavigationActive(),
          acceptInvocation: (operation) => this.accept(operation),
        },
        approval,
      );
    } catch (error) {
      try {
        await shutdownLsp(
          this.state,
          registration,
          this.serviceOwnership === 'runtime',
        );
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'LSP activation cleanup failed',
        );
      }
      throw error;
    }
  }

  private async closeUnavailableNavigation(
    registration: Registration,
  ): Promise<void> {
    await Promise.allSettled([this.initialization, ...this.work]);
    await cleanupLspMcpResources(this.state, registration);
  }

  private configuration(): LspConfig | undefined {
    return this.state.lspConfig === undefined
      ? undefined
      : structuredClone(this.state.lspConfig);
  }

  private assertActive(): void {
    if (this.stopped) throw new Error('Workspace LSP owner is stopped');
  }

  private assertNavigationActive(): void {
    this.assertActive();
    if (this.state.lspServiceClient?.isAlive() !== true)
      throw new Error('Workspace LSP service is unavailable');
    if (!this.trusted())
      throw new Error('Workspace LSP navigation requires trust');
  }

  private checkFile(file: string, timeout: number): Promise<Diagnostic[]> {
    this.assertActive();
    const service = this.state.lspServiceClient;
    const operation = (async (): Promise<Diagnostic[]> => {
      if (service?.isAlive() !== true) return [];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const diagnostics = await service.checkFile(file, controller.signal);
        if (service.isAlive())
          this.diagnosticCache.set(file, structuredClone(diagnostics));
        return diagnostics;
      } finally {
        clearTimeout(timer);
      }
    })();
    return this.accept(operation);
  }

  private async readInspection(): Promise<
    Awaited<ReturnType<WorkspaceLspInspection['read']>>
  > {
    this.assertActive();
    const service = this.state.lspServiceClient;
    return this.accept(
      (async () => ({
        configured: this.configuration(),
        alive: service?.isAlive() === true,
        reason: service?.getUnavailableReason(),
        statuses: service === undefined ? [] : await service.status(),
      }))(),
    );
  }

  private accept<T>(operation: Promise<T>): Promise<T> {
    this.work.add(operation);
    void operation
      .finally(() => this.work.delete(operation))
      .catch(() => undefined);
    return operation;
  }

  releaseToolRegistration(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal;
    if (this.registrationRelease !== undefined) return this.registrationRelease;
    const registration = this.registration;
    if (registration === undefined) return Promise.resolve();
    this.registration = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.registrationRelease = this.releaseNavigation(registration);
    return this.registrationRelease;
  }

  private async releaseNavigation(registration: Registration): Promise<void> {
    const failures: unknown[] = [];
    const joined = await Promise.allSettled([
      this.initialization,
      ...this.work,
      this.unavailableCleanup,
    ]);
    for (const result of joined)
      if (result.status === 'rejected') failures.push(result.reason);
    try {
      await cleanupLspMcpResources(this.state, registration);
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Workspace LSP publication release failed',
      );
  }

  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal;
    this.stopped = true;
    const failures: unknown[] = [];
    try {
      this.registration?.removeMcpToolsByServer('lsp-navigation');
    } catch (error) {
      failures.push(error);
    }
    this.unsubscribe?.();
    this.disposal = this.close(failures);
    return this.disposal;
  }

  private async close(failures: unknown[]): Promise<void> {
    const joined = await Promise.allSettled([
      this.initialization,
      ...this.work,
      this.unavailableCleanup,
      this.registrationRelease,
    ]);
    for (const result of joined)
      if (result.status === 'rejected') failures.push(result.reason);
    if (this.registration !== undefined) {
      try {
        await shutdownLsp(
          this.state,
          this.registration,
          this.serviceOwnership === 'runtime',
        );
      } catch (error) {
        failures.push(error);
      }
    } else if (this.serviceOwnership === 'runtime') {
      try {
        await this.state.lspServiceClient?.shutdown();
      } catch (error) {
        failures.push(error);
      }
      this.state.lspServiceClient = undefined;
    }
    failures.push(...this.unavailableFailures);
    if (failures.length > 0)
      throw new AggregateError(failures, 'Workspace LSP disposal failed');
  }
}
