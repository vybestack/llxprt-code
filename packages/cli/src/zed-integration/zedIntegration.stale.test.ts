/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type * as acp from '@agentclientprotocol/sdk';
import type { AgentEvent, Agent } from '@vybestack/llxprt-code-agents';
import {
  ToolConfirmationOutcome,
  type ToolConfirmationPayload,
} from '@vybestack/llxprt-code-tools';
import type { ApprovalMode, Config } from '@vybestack/llxprt-code-core';

import { Session } from './zedIntegration.js';

type ConfirmationCapture = {
  confirmationId: string;
  decision: ToolConfirmationOutcome;
  payload?: ToolConfirmationPayload;
  requiresUserConfirmation?: boolean;
};

function buildScriptedAgent(nextEvents: () => readonly AgentEvent[]): {
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

function buildFakeAgent(events: readonly AgentEvent[]): {
  agent: Agent;
  confirmations: ConfirmationCapture[];
} {
  return buildScriptedAgent(() => events);
}

class RecordingConnection {
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
  private gatedDeferred: {
    resolve: (o: acp.RequestPermissionOutcome) => void;
    promise: Promise<acp.RequestPermissionOutcome>;
  } | null = null;
  private gatedArrived: (() => void) | null = null;

  setPermissionOutcome(outcome: acp.RequestPermissionOutcome): void {
    this.permissionOutcome = outcome;
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

  sessionUpdate = vi.fn(
    async (params: acp.SessionNotification): Promise<void> => {
      this.messages.push({ kind: 'sessionUpdate', update: params.update });
    },
  );

  requestPermission = vi.fn(
    async (
      params: acp.RequestPermissionRequest,
    ): Promise<acp.RequestPermissionResponse> => {
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
}

function buildMinimalConfig(): Config {
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

function createSession(
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

async function runPrompt(session: Session): Promise<acp.PromptResponse> {
  return session.prompt({
    sessionId: 'test-session-id',
    prompt: [{ type: 'text', text: 'hello' }],
  });
}

function editConfirmation(
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

describe('Zed Session.prompt (Agent API) - stale prompt terminal events', () => {
  it('returns cancelled (not an error) when a superseded prompt ends with done:error', async () => {
    const toolCallId = 'stale-error-tool';
    let promptCount = 0;
    const { agent } = buildScriptedAgent(() => {
      promptCount += 1;
      return promptCount === 1
        ? [
            {
              type: 'tool-call',
              call: { id: toolCallId, name: 'edit', args: {} },
            },
            editConfirmation('conf-stale-error', toolCallId),
            { type: 'done', reason: 'error' },
          ]
        : [
            { type: 'text', text: 'second' },
            { type: 'done', reason: 'stop' },
          ];
    });
    const connection = new RecordingConnection();
    const gate = connection.armPermissionGate();
    const session = createSession(agent, connection);

    const firstPrompt = runPrompt(session);
    await gate.arrived;
    const secondPrompt = runPrompt(session);
    const firstResponse = await firstPrompt;
    const secondResponse = await secondPrompt;

    expect(firstResponse.stopReason).toBe('cancelled');
    expect(secondResponse.stopReason).toBe('end_turn');
  });

  it('returns cancelled (not an error) when a cancelled prompt ends with done:hook-stopped', async () => {
    const toolCallId = 'stale-hook-tool';
    const { agent } = buildScriptedAgent(() => [
      { type: 'tool-call', call: { id: toolCallId, name: 'edit', args: {} } },
      editConfirmation('conf-stale-hook', toolCallId),
      { type: 'done', reason: 'hook-stopped' },
    ]);
    const connection = new RecordingConnection();
    const gate = connection.armPermissionGate();
    const session = createSession(agent, connection);

    const firstPrompt = runPrompt(session);
    await gate.arrived;
    await session.cancelPendingPrompt();
    const response = await firstPrompt;
    gate.settle({
      outcome: 'selected',
      optionId: ToolConfirmationOutcome.ProceedOnce,
    });
    await Promise.resolve();

    expect(response.stopReason).toBe('cancelled');
  });
});

describe('Zed Session.prompt (Agent API) - terminal tool-status without tool-result', () => {
  it.each([
    ['success', 'completed'],
    ['error', 'failed'],
    ['cancelled', 'failed'],
  ] as const)(
    'maps tool-status %s to %s even without a tool-result',
    async (status, expected) => {
      const toolCallId = `status-only-${status}`;
      const { agent } = buildFakeAgent([
        {
          type: 'tool-call',
          call: { id: toolCallId, name: 'run_shell_command', args: {} },
        },
        {
          type: 'tool-status',
          update: {
            id: toolCallId,
            name: 'run_shell_command',
            status,
            output: status === 'success' ? 'done' : undefined,
          },
        },
        { type: 'done', reason: 'stop' },
      ]);
      const connection = new RecordingConnection();
      const session = createSession(agent, connection);

      await runPrompt(session);

      const updates = connection.onlySessionUpdates();
      expect((updates[1] as { status: string }).status).toBe(expected);
    },
  );
});
