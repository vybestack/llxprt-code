import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { createSessionSettingsFixture } from './helpers/session-settings-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createTestFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';

import { testConfigInitialization } from '@vybestack/llxprt-code-test-utils/core/config.js';

import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  MessageBusType,
  type ToolConfirmationRequest,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import { PolicyDecision } from '@vybestack/llxprt-code-policy';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  ToolConfirmationOutcome,
  type ToolCallConfirmationDetails,
  type ToolResult,
} from '@vybestack/llxprt-code-tools';
import { assembleSchedulerOwner } from '../../session/assembleSchedulerOwner.js';
import type { SchedulerLease } from '../../session/sessionSchedulerOwner.js';

interface RecordParams {
  invocation: string;
}

interface SchedulerOwner {
  readonly registry: import('@vybestack/llxprt-code-tools').ToolSelection;
  config: Config;
  bus: MessageBus;
  scheduler: SchedulerLease;
  release(): Promise<void>;
  schedule(invocation: string): Promise<CompletedToolCall[]>;
  completions: CompletedToolCall[][];
  effects(): readonly string[];
  approvals(): readonly string[];
  listeners(): number;
}

class RecordInvocation extends BaseToolInvocation<RecordParams, ToolResult> {
  constructor(
    params: RecordParams,
    private readonly externalWrite: (invocation: string) => ToolResult,
  ) {
    super(params);
  }

  getDescription(): string {
    return `Write external record ${this.params.invocation}`;
  }

  override async shouldConfirmExecute(): Promise<ToolCallConfirmationDetails> {
    return {
      type: 'info',
      title: 'Write record',
      prompt: this.getDescription(),
      onConfirm: async () => {},
    };
  }

  async execute(): Promise<ToolResult> {
    return this.externalWrite(this.params.invocation);
  }
}

class RecordTool extends BaseDeclarativeTool<RecordParams, ToolResult> {
  constructor(
    private readonly externalWrite: (invocation: string) => ToolResult,
  ) {
    super('owner_record', 'Owner record', 'Write external record', Kind.Other, {
      type: 'object',
      properties: { invocation: { type: 'string' } },
      required: ['invocation'],
    });
  }

  protected createInvocation(params: RecordParams): RecordInvocation {
    return new RecordInvocation(params, this.externalWrite);
  }
}

async function exerciseCollision(sameKey: boolean): Promise<void> {
  const logRoot = join(tmpdir(), 'llxprt-scheduler-collision');
  await mkdir(logRoot, { recursive: true });
  const root = await mkdtemp(resolve(logRoot, 'fixture-'));
  const previous = new Map(
    [
      'LLXPRT_CONFIG_HOME',
      'LLXPRT_DATA_HOME',
      'LLXPRT_CACHE_HOME',
      'LLXPRT_LOG_HOME',
    ].map((key) => [key, process.env[key]]),
  );
  for (const key of previous.keys()) process.env[key] = root;
  const configs: Config[] = [];
  const cleanup: Array<() => void | Promise<void>> = [];
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('Scheduler completion timed out')),
    20_000,
  );
  const label = `scheduler-owner-${randomUUID()}`;

  async function owner(name: string, key: string): Promise<SchedulerOwner> {
    const config = new Config({
      sessionId: label,
      targetDir: root,
      cwd: root,
      debugMode: false,
      model: 'unused-no-model-request',
      interactive: true,
      trustedFolder: true,
      coreTools: [],
      telemetry: { enabled: false },
    });
    const configPolicy = new RuntimePolicyOwner(config);
    configs.push(config);
    cleanup.push(() => configPolicy.dispose());
    const bus = configPolicy.session.messageBus;
    const infrastructure = testConfigInitialization(
      config,
      bus,
      configPolicy,
      createTestFilesystem(config),
    );
    await config.initialize(infrastructure);
    const registry = infrastructure.toolCatalog;
    configPolicy.session.confirmation.addRule({
      toolName: 'owner_record',
      decision: PolicyDecision.ASK_USER,
      priority: 10000,
    });
    if (name === 'B') {
      configPolicy.session.confirmation.addRule({
        toolName: 'owner_record',
        argsPattern: /forbidden/,
        decision: PolicyDecision.DENY,
        priority: 10001,
      });
    }
    let effects: readonly string[] = [];
    let approvals: readonly string[] = [];
    const completions: CompletedToolCall[][] = [];
    let deliver = (_calls: CompletedToolCall[]): void => {};
    registry.publication.registerTool(
      new RecordTool((invocation) => {
        effects = [...effects, invocation];
        return {
          llmContent: `${name}-output:${invocation}`,
          returnDisplay: `${name} external record`,
        };
      }),
    );
    cleanup.push(
      bus.subscribe<ToolConfirmationRequest>(
        MessageBusType.TOOL_CONFIRMATION_REQUEST,
        (request) => {
          approvals = [...approvals, request.toolCall.id ?? 'missing-call-id'];
          queueMicrotask(() =>
            bus.publish({
              type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
              correlationId: request.correlationId,
              outcome: ToolConfirmationOutcome.ProceedOnce,
            }),
          );
        },
      ),
    );
    const { settingsOwner } = createSessionSettingsFixture(config);
    const lifetime = assembleSchedulerOwner(key, {
      telemetry: RootTelemetry.prepare({
        enabled: false,
        sessionId: 'isolated-caller-fixture',
        maxBytes: 1024,
        maxFiles: 1,
      }),
      config,
      readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
      messageBus: bus,
      toolRegistry: registry.selection,
      toolContextInteractiveMode: true,
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
      onAllToolCallsComplete: async (calls) => {
        completions.push(calls);
        deliver(calls);
      },
    });
    const scheduler = lifetime.acquire();
    await scheduler.ready;
    const release = (): Promise<void> => scheduler.release();
    cleanup.push(release);

    async function schedule(invocation: string): Promise<CompletedToolCall[]> {
      const signal = controller.signal;
      signal.throwIfAborted();
      let unsubscribe = (): void => {};
      const result = new Promise<CompletedToolCall[]>((resolve, reject) => {
        deliver = resolve;
        const abort = (): void => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        unsubscribe = (): void => signal.removeEventListener('abort', abort);
      });
      try {
        const request = scheduler.schedule(
          {
            callId: invocation,
            name: 'owner_record',
            args: { invocation },
            isClientInitiated: false,
            prompt_id: `${invocation}-prompt`,
            agentId: name,
          },
          signal,
        );
        const [, calls] = await Promise.all([request, result]);
        return calls;
      } finally {
        unsubscribe();
      }
    }

    return {
      config,
      registry: registry.selection,
      bus,
      scheduler,
      release,
      schedule,
      completions,
      effects: () => effects,
      approvals: () => approvals,
      listeners: () =>
        bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE),
    };
  }

  try {
    const a = await owner('A', label);
    const b = await owner('B', sameKey ? label : `${label}-distinct-key`);
    expect(a.config.getSessionId()).toBe(b.config.getSessionId());
    expect(a.registry).not.toBe(b.registry);
    expect(a.bus).not.toBe(b.bus);
    const first = await b.schedule('B-unique-invocation');
    const ownedListeners = [a.listeners(), b.listeners()];
    await a.release();
    const survivingListeners = [a.listeners(), b.listeners()];
    const second = await b.schedule('B-after-A-release');
    const denied = await b.schedule('B-forbidden');
    await b.release();

    expect({
      effectsA: a.effects(),
      effectsB: b.effects(),
      approvalsA: a.approvals(),
      approvalsB: b.approvals(),
      callbacksA: a.completions.length,
      callbacksB: b.completions.length,
      statuses: [...first, ...second, ...denied].map((call) => call.status),
      outputs: [...first, ...second].map((call) => call.response.resultDisplay),
      ownedListeners,
      survivingListeners,
      releasedListeners: [a.listeners(), b.listeners()],
    }).toStrictEqual({
      effectsA: [],
      effectsB: ['B-unique-invocation', 'B-after-A-release'],
      approvalsA: [],
      approvalsB: ['B-unique-invocation', 'B-after-A-release'],
      callbacksA: 0,
      callbacksB: 3,
      statuses: ['success', 'success', 'error'],
      outputs: ['B external record', 'B external record'],
      ownedListeners: [1, 1],
      survivingListeners: [0, 1],
      releasedListeners: [0, 0],
    });
    expect(JSON.stringify(first)).toContain('B-output:B-unique-invocation');
    expect(JSON.stringify(second)).toContain('B-output:B-after-A-release');
  } finally {
    controller.abort();
    clearTimeout(timeout);
    for (const release of cleanup.reverse()) await release();
    for (const config of configs.reverse()) await config.dispose();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}

describe('Exact scheduler-key ownership (#2616/#2615)', () => {
  it('uses B tools, policy and bus with distinct keys and survives A release', async () => {
    expect(await exerciseCollision(false)).toBeUndefined();
  }, 30_000);

  it('uses B tools, policy and bus with identical keys and independent owner lifetimes', async () => {
    expect(await exerciseCollision(true)).toBeUndefined();
  }, 30_000);
});
