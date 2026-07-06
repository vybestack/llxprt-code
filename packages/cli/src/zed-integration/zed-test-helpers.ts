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

export function buildScriptedAgent(nextEvents: () => readonly AgentEvent[]): {
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

export function buildFakeAgent(events: readonly AgentEvent[]): {
  agent: Agent;
  confirmations: ConfirmationCapture[];
} {
  return buildScriptedAgent(() => events);
}

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

  onlySessionUpdates(): acp.SessionUpdate[] {
    return this.messages
      .filter((m) => m.kind === 'sessionUpdate')
      .map((m) => (m as { update: acp.SessionUpdate }).update);
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
    getFileService: () => ({ shouldIgnoreFile: () => false }),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getEnableRecursiveFileSearch: () => false,
    getFileSystemService: () => ({ readTextFile: async () => '' }),
    getMaxSessionTurns: () => 50,
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
