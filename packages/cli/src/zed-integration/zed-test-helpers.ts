/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, type Mock } from 'vitest';
import type * as acp from '@agentclientprotocol/sdk';
import type { AgentEvent, Agent } from '@vybestack/llxprt-code-agents';
import {
  ToolConfirmationOutcome,
  type ToolConfirmationPayload,
} from '@vybestack/llxprt-code-tools';
import type { ApprovalMode, Config } from '@vybestack/llxprt-code-core';

import { Session } from './zedIntegration.js';

export type ConfirmationCapture = {
  confirmationId: string;
  decision: ToolConfirmationOutcome;
  payload?: ToolConfirmationPayload;
  requiresUserConfirmation?: boolean;
};

export function buildScriptedAgent(
  nextEvents: () => readonly AgentEvent[],
  toolKinds: Readonly<Record<string, string>> = {},
): {
  agent: Agent;
  confirmations: ConfirmationCapture[];
} {
  const confirmations: ConfirmationCapture[] = [];
  const agent = {
    async *stream(_input: unknown, _opts?: unknown): AsyncIterable<AgentEvent> {
      for (const e of nextEvents()) {
        yield e;
      }
    },
    getApprovalMode: (): ApprovalMode => 'default' as ApprovalMode,
    setApprovalMode: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    tools: {
      get: (name: string) =>
        Object.hasOwn(toolKinds, name) ? { kind: toolKinds[name] } : undefined,
      respondToConfirmation: (
        confirmationId: string,
        decision: ToolConfirmationOutcome,
        payload?: ToolConfirmationPayload,
        requiresUserConfirmation?: boolean,
      ) => {
        confirmations.push({
          confirmationId,
          decision,
          ...(payload === undefined ? {} : { payload }),
          ...(requiresUserConfirmation === undefined
            ? {}
            : { requiresUserConfirmation }),
        });
      },
      onConfirmationRequest: () => () => {},
      onToolUpdate: () => () => {},
      setEditorCallbacks: () => {},
      setEnabled: vi.fn().mockResolvedValue(undefined),
      list: () => [],
      keys: {},
    },
  } as unknown as Agent;
  return { agent, confirmations };
}

/**
 * Like {@link buildScriptedAgent} but the stream blocks after yielding all
 * events until the abort signal fires.  Used to test cancel/dispose while a
 * prompt turn is still in-flight.
 */
export function buildBlockingScriptedAgent(
  nextEvents: () => readonly AgentEvent[],
  toolKinds: Readonly<Record<string, string>> = {},
): {
  agent: Agent;
  confirmations: ConfirmationCapture[];
} {
  const confirmations: ConfirmationCapture[] = [];
  const agent = {
    async *stream(_input: unknown, opts?: unknown): AsyncIterable<AgentEvent> {
      for (const e of nextEvents()) {
        yield e;
      }
      const signal = (opts as { signal?: AbortSignal } | undefined)?.signal;
      if (signal !== undefined && !signal.aborted) {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      }
    },
    getApprovalMode: (): ApprovalMode => 'default' as ApprovalMode,
    setApprovalMode: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    tools: {
      get: (name: string) =>
        Object.hasOwn(toolKinds, name) ? { kind: toolKinds[name] } : undefined,
      respondToConfirmation: (
        confirmationId: string,
        decision: ToolConfirmationOutcome,
        payload?: ToolConfirmationPayload,
        requiresUserConfirmation?: boolean,
      ) => {
        confirmations.push({
          confirmationId,
          decision,
          ...(payload === undefined ? {} : { payload }),
          ...(requiresUserConfirmation === undefined
            ? {}
            : { requiresUserConfirmation }),
        });
      },
      onConfirmationRequest: () => () => {},
      onToolUpdate: () => () => {},
      setEditorCallbacks: () => {},
      setEnabled: vi.fn().mockResolvedValue(undefined),
      list: () => [],
      keys: {},
    },
  } as unknown as Agent;
  return { agent, confirmations };
}

export function buildFakeAgent(
  events: readonly AgentEvent[],
  toolKinds: Readonly<Record<string, string>> = {},
): {
  agent: Agent;
  confirmations: ConfirmationCapture[];
} {
  return buildScriptedAgent(() => events, toolKinds);
}

export function buildBlockingFakeAgent(
  events: readonly AgentEvent[],
  toolKinds: Readonly<Record<string, string>> = {},
): {
  agent: Agent;
  confirmations: ConfirmationCapture[];
} {
  return buildBlockingScriptedAgent(() => events, toolKinds);
}

export type FakeTerminalHandle = Pick<
  acp.TerminalHandle,
  'id' | 'currentOutput' | 'waitForExit' | 'kill' | 'release'
>;

export class RecordingConnection {
  readonly messages: Array<
    | { kind: 'sessionUpdate'; update: acp.SessionUpdate }
    | {
        kind: 'requestPermission';
        request: acp.RequestPermissionRequest;
        outcome: acp.RequestPermissionOutcome;
      }
  > = [];
  private permissionOutcome: acp.RequestPermissionOutcome = {
    outcome: 'selected',
    optionId: ToolConfirmationOutcome.ProceedOnce,
  };
  private permissionRejection: Error | null = null;
  private sessionUpdateFailAfter: number | null = null;
  private sessionUpdateError: Error | null = null;
  private sessionUpdateCalls = 0;

  // --- Terminal test-double state ---

  readonly createTerminalCalls: Array<{
    command: string;
    cwd?: string | null;
    sessionId: string;
    args?: string[];
    env?: Array<{ name: string; value: string }>;
    outputByteLimit?: number | null;
  }> = [];

  killCalls = 0;
  releaseCalls = 0;

  private terminalOutput = '';
  private terminalExitDelayed = false;
  private terminalExitResolvers = new Map<string, Array<() => void>>();
  private terminalCreationWaiters = new Set<() => void>();

  setTerminalOutput(output: string): void {
    this.terminalOutput = output;
  }

  delayTerminalExit(): void {
    this.terminalExitDelayed = true;
  }

  resolveDelayedTerminalExit(terminalId?: string): void {
    if (terminalId !== undefined) {
      const resolvers = this.terminalExitResolvers.get(terminalId);
      if (resolvers !== undefined) {
        this.terminalExitResolvers.delete(terminalId);
        for (const fn of resolvers) {
          fn();
        }
      }
      if (this.terminalExitResolvers.size === 0) {
        this.terminalExitDelayed = false;
      }
      return;
    }
    for (const resolvers of this.terminalExitResolvers.values()) {
      for (const fn of resolvers) {
        fn();
      }
    }
    this.terminalExitResolvers.clear();
    this.terminalExitDelayed = false;
  }

  waitForTerminalProcessCreated(): Promise<void> {
    if (this.createTerminalCalls.length > 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const waiter = (): void => {
        this.terminalCreationWaiters.delete(waiter);
        resolve();
      };
      this.terminalCreationWaiters.add(waiter);
    });
  }

  /**
   * Resolves once at least one terminal content update (tool_call_update with
   * a `terminal` content block) has been recorded — i.e., the Session has
   * created and registered a terminal.
   */
  waitForTerminalCreated(timeoutMs = 5000): Promise<void> {
    if (this.hasTerminalContentUpdate()) return Promise.resolve();
    const deadline = Date.now() + timeoutMs;
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = (): void => {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      };
      const check = (): void => {
        if (this.hasTerminalContentUpdate()) {
          cleanup();
          resolve();
        } else if (Date.now() >= deadline) {
          cleanup();
          reject(new Error('waitForTerminalCreated timed out'));
        } else {
          timer = setTimeout(check, 5);
        }
      };
      timer = setTimeout(check, 5);
    });
  }

  private hasTerminalContentUpdate(): boolean {
    return this.messages.some(
      (m) =>
        m.kind === 'sessionUpdate' &&
        m.update.sessionUpdate === 'tool_call_update' &&
        (m.update.content ?? []).some((c) => c.type === 'terminal'),
    );
  }

  /**
   * Arms sessionUpdate to REJECT starting with the (0-based) `afterCount`-th
   * call: the first `afterCount` notifications are still recorded/delivered
   * normally, then every subsequent call throws `error`. Used to simulate a
   * dead/failing transport mid history-replay (issue #1604 FINDING A) so strict
   * streamHistory delivery and loadSession cleanup can be asserted. `afterCount:
   * 0` fails the very first update.
   */
  failSessionUpdateAfter(afterCount: number, error: Error): void {
    this.sessionUpdateFailAfter = afterCount;
    this.sessionUpdateError = error;
  }

  /**
   * Disarms {@link failSessionUpdateAfter} and resets the call counter so a
   * SUBSEQUENT operation on the same connection delivers normally — used to
   * simulate a transport that has recovered before a retry load (issue #1604
   * FINDING A partial-failure test).
   */
  clearSessionUpdateFailure(): void {
    this.sessionUpdateFailAfter = null;
    this.sessionUpdateError = null;
    this.sessionUpdateCalls = 0;
  }

  clearSessionInfoUpdates(): void {
    const retained = this.messages.filter(
      (message) =>
        message.kind !== 'sessionUpdate' ||
        message.update.sessionUpdate !== 'session_info_update',
    );
    this.messages.splice(0, this.messages.length, ...retained);
  }

  private gatedDeferred: {
    resolve: (o: acp.RequestPermissionOutcome) => void;
    promise: Promise<acp.RequestPermissionOutcome>;
  } | null = null;
  private gatedArrived: (() => void) | null = null;

  setPermissionOutcome(outcome: acp.RequestPermissionOutcome): void {
    this.permissionOutcome = outcome;
  }

  rejectPermission(error: Error): void {
    this.permissionRejection = error;
  }

  armPermissionGate(): {
    arrived: Promise<void>;
    settle: (o: acp.RequestPermissionOutcome) => void;
  } {
    let resolveArrived!: () => void;
    const arrived = new Promise<void>((r) => {
      resolveArrived = r;
    });
    let resolvePermission!: (o: acp.RequestPermissionOutcome) => void;
    const promise = new Promise<acp.RequestPermissionOutcome>((r) => {
      resolvePermission = r;
    });
    this.gatedDeferred = { resolve: resolvePermission, promise };
    this.gatedArrived = resolveArrived;
    return {
      arrived,
      settle: (o: acp.RequestPermissionOutcome) => {
        const d = this.gatedDeferred;
        this.gatedDeferred = null;
        this.gatedArrived = null;
        d?.resolve(o);
      },
    };
  }

  sessionUpdate: Mock = vi.fn(
    async (params: acp.SessionNotification): Promise<void> => {
      if (
        this.sessionUpdateFailAfter !== null &&
        this.sessionUpdateCalls >= this.sessionUpdateFailAfter
      ) {
        this.sessionUpdateCalls++;
        throw (
          this.sessionUpdateError ??
          new Error('sessionUpdate transport failure')
        );
      }
      this.sessionUpdateCalls++;
      this.messages.push({ kind: 'sessionUpdate', update: params.update });
    },
  );

  requestPermission: Mock = vi.fn(
    async (
      params: acp.RequestPermissionRequest,
    ): Promise<acp.RequestPermissionResponse> => {
      if (this.permissionRejection !== null) {
        throw this.permissionRejection;
      }
      if (this.gatedDeferred !== null) {
        this.messages.push({
          kind: 'requestPermission',
          request: params,
          outcome: {
            outcome: 'selected',
            optionId: ToolConfirmationOutcome.Cancel,
          },
        });
        const arrivedFn = this.gatedArrived;
        this.gatedArrived = null;
        arrivedFn?.();
        const outcome = await this.gatedDeferred.promise;
        this.gatedDeferred = null;
        return { outcome };
      }
      this.messages.push({
        kind: 'requestPermission',
        request: params,
        outcome: this.permissionOutcome,
      });
      return { outcome: this.permissionOutcome };
    },
  );

  createTerminal: Mock = vi.fn(
    async (params: acp.CreateTerminalRequest): Promise<FakeTerminalHandle> => {
      const call = {
        command: params.command,
        cwd: params.cwd,
        sessionId: params.sessionId,
        ...(params.args !== undefined ? { args: params.args } : {}),
        ...(params.env !== undefined ? { env: params.env } : {}),
        ...(params.outputByteLimit !== undefined
          ? { outputByteLimit: params.outputByteLimit }
          : {}),
      };
      this.createTerminalCalls.push(call);
      for (const resolve of this.terminalCreationWaiters) {
        resolve();
      }
      const terminalId = `terminal-${this.createTerminalCalls.length}`;
      return this.buildFakeTerminalHandle(terminalId);
    },
  );

  private buildFakeTerminalHandle(terminalId: string): FakeTerminalHandle {
    const handle = {
      id: terminalId,
      currentOutput: vi.fn(async () => ({
        output: this.terminalOutput,
        exitStatus: null,
        truncated: false,
      })),
      waitForExit: vi.fn(async () => {
        if (this.terminalExitDelayed) {
          await new Promise<void>((resolve) => {
            const existing = this.terminalExitResolvers.get(terminalId);
            if (existing !== undefined) {
              existing.push(resolve);
            } else {
              this.terminalExitResolvers.set(terminalId, [resolve]);
            }
          });
        }
        return { exitCode: 0, signal: null };
      }),
      kill: vi.fn(async () => {
        this.killCalls += 1;
        this.resolveDelayedTerminalExit(terminalId);
        return {};
      }),
      release: vi.fn(async () => {
        this.releaseCalls += 1;
        this.resolveDelayedTerminalExit(terminalId);
        return {};
      }),
    };
    return handle;
  }

  /**
   * Returns content-focused session updates, excluding infrastructure
   * notifications (`available_commands_update` and `session_info_update`).
   * Use {@link sessionInfoUpdates} for title/updatedAt assertions and
   * {@link availableCommandUpdates} for command-registry assertions.
   */
  onlySessionUpdates(): acp.SessionUpdate[] {
    return this.messages
      .filter((m) => m.kind === 'sessionUpdate')
      .map((m) => (m as { update: acp.SessionUpdate }).update)
      .filter(
        (update) =>
          update.sessionUpdate !== 'available_commands_update' &&
          update.sessionUpdate !== 'session_info_update',
      );
  }

  sessionInfoUpdates(): Array<
    Extract<acp.SessionUpdate, { sessionUpdate: 'session_info_update' }>
  > {
    return this.messages
      .filter((m) => m.kind === 'sessionUpdate')
      .map((m) => (m as { update: acp.SessionUpdate }).update)
      .filter(
        (
          update,
        ): update is Extract<
          acp.SessionUpdate,
          { sessionUpdate: 'session_info_update' }
        > => update.sessionUpdate === 'session_info_update',
      );
  }

  availableCommandUpdates(): acp.AvailableCommandsUpdate[] {
    return this.messages
      .filter((m) => m.kind === 'sessionUpdate')
      .map((m) => (m as { update: acp.SessionUpdate }).update)
      .filter(
        (
          update,
        ): update is acp.AvailableCommandsUpdate & {
          sessionUpdate: 'available_commands_update';
        } => update.sessionUpdate === 'available_commands_update',
      );
  }

  sessionUpdateKinds(): string[] {
    return this.onlySessionUpdates().map((u) => u.sessionUpdate);
  }
}

export function buildMinimalConfig(): Config {
  return {
    getEphemeralSetting: () => undefined,
    getDebugMode: () => false,
    getApprovalMode: () => 'default' as ApprovalMode,
    setApprovalMode: () => {},
    getTargetDir: () => '/project',
    getProjectRoot: () => '/project',
    getFileService: () => ({ shouldIgnoreFile: () => false }),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getEnableRecursiveFileSearch: () => false,
    getFileSystemService: () => ({ readTextFile: async () => '' }),
    getMaxSessionTurns: () => 50,
    // usage_update path (issue #1607): sendUsageUpdate resolves the context
    // window via getTokenLimitForConfiguredContext(model, config).
    getModel: () => 'test-model',
    getContentGeneratorConfig: () => undefined,
    getSessionRecordingService: () => undefined,
  } as unknown as Config;
}

export function createSession(
  agent: Agent,
  connection: RecordingConnection,
  config: Config = buildMinimalConfig(),
): Session {
  return new Session(
    'test-session-id',
    agent,
    config,
    connection as unknown as acp.AgentSideConnection,
  );
}

export async function runPrompt(session: Session): Promise<acp.PromptResponse> {
  return session.prompt({
    sessionId: 'test-session-id',
    prompt: [{ type: 'text', text: 'hello' }],
  });
}

export function editConfirmation(
  confirmationId: string,
  toolCallId: string,
): Extract<AgentEvent, { type: 'tool-confirmation' }> {
  return {
    type: 'tool-confirmation',
    confirmation: {
      confirmationId,
      toolCallId,
      name: 'edit',
      details: {
        type: 'edit',
        title: 'Edit file',
        fileName: '/project/file.txt',
        filePath: '/project/file.txt',
        fileDiff: 'diff',
        originalContent: 'old',
        newContent: 'new',
        onConfirm: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
}
