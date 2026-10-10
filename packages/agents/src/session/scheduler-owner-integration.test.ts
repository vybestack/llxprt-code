import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { describe, expect, it } from 'bun:test';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { ToolContext } from '@vybestack/llxprt-code-tools/types/tool-context.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import type { CoreToolSchedulerOptions } from '../core/coreToolScheduler.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import {
  createAllowPolicyEngine,
  createTestConfig,
} from '../core/agenticLoop/__tests__/agenticLoop-test-helpers.js';
import { executeToolCall } from '../core/nonInteractiveToolExecutor.js';
import {
  assembleSchedulerOwner,
  bindSchedulerOwner,
} from './assembleSchedulerOwner.js';
import type { SchedulerLease } from './sessionSchedulerOwner.js';

class ContextEffectTool extends MockTool {
  context: ToolContext | undefined = undefined;

  constructor(effects: ToolContext[]) {
    super({ name: 'effect' });
    this.executeFn.mockImplementation(async () => {
      if (!this.context) throw new Error('Missing tool context');
      effects.push({ ...this.context });
      return {
        llmContent: 'effect complete',
        returnDisplay: 'effect complete',
      };
    });
  }
}

const request = {
  callId: 'same-call',
  name: 'effect',
  args: {},
  agentId: 'worker',
  prompt_id: 'prompt',
  isClientInitiated: false,
};

function fixture(interactive: boolean): {
  config: ReturnType<typeof createTestConfig>['config'];
  settingsOwner: ReturnType<typeof createTestConfig>['settingsOwner'];
  bus: MessageBus;
  effects: ToolContext[];
  registry: ToolRegistry;
} {
  const effects: ToolContext[] = [];
  const policy = createAllowPolicyEngine();
  const bus = new MessageBus(policy, false);
  const registry = new ToolRegistry(
    {},
    bus,
    assembleTaskSchemaPolicy({
      get: () => undefined,
      getAllGlobalSettings: () => ({}),
    }),
  );
  registry.registerTool(new ContextEffectTool(effects));
  return {
    effects,
    registry,
    bus,
    ...createTestConfig({
      messageBus: bus,
      policyEngine: policy,
      toolRegistry: registry,
      interactive,
    }),
  };
}

function callbacks(): {
  completed: Promise<CompletedToolCall[]>;
  onAllToolCallsComplete(calls: CompletedToolCall[]): Promise<void>;
  getPreferredEditor(): undefined;
  onEditorClose(): void;
} {
  let resolve!: (calls: CompletedToolCall[]) => void;
  return {
    completed: new Promise((done) => {
      resolve = done;
    }),
    onAllToolCallsComplete: async (calls) => {
      resolve(calls);
    },
    getPreferredEditor: () => undefined,
    onEditorClose: () => {},
  };
}

async function execute(
  lease: SchedulerLease,
  completion: Promise<CompletedToolCall[]>,
): Promise<void> {
  await lease.schedule(request);
  expect((await completion)[0]?.status).toBe('success');
}

describe('Agent-owned scheduler integration', () => {
  it('captures the bus, registry and interactive mode before lazy construction', async () => {
    const a = fixture(false);
    const b = fixture(true);
    const completion = callbacks();
    const options: CoreToolSchedulerOptions = {
      telemetry: RootTelemetry.prepare({
        enabled: false,
        sessionId: 'isolated-caller-fixture',
        maxBytes: 1024,
        maxFiles: 1,
      }),
      readExecutionPolicy: () => a.settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        a.settingsOwner.readToolGovernance(a.config.getExcludeTools() ?? []),
      config: a.config,
      messageBus: a.bus,
      toolRegistry: a.registry,
      toolContextInteractiveMode: false,
      ...completion,
    };
    const owner = assembleSchedulerOwner(a.config.getSessionId(), options);
    options.messageBus = b.bus;
    options.toolRegistry = b.registry;
    options.toolContextInteractiveMode = true;
    const lease = owner.acquire();
    try {
      await lease.ready;
      expect(
        a.bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE),
      ).toBe(1);
      expect(
        b.bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE),
      ).toBe(0);
      await execute(lease, completion.completed);
      expect(a.effects).toStrictEqual([
        {
          sessionId: a.config.getSessionId(),
          agentId: 'worker',
          interactiveMode: false,
        },
      ]);
      expect(b.effects).toHaveLength(0);
    } finally {
      await lease.release();
    }
    expect(a.bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE)).toBe(
      0,
    );
    expect(a.registry.getTool('effect')).toBeDefined();
  });

  it('keeps same-label owners independent and leaves the surviving runtime usable', async () => {
    const a = fixture(false);
    const b = fixture(true);
    expect(a.config.getSessionId()).toBe(b.config.getSessionId());
    const ca = callbacks();
    const cb = callbacks();
    const oa = bindSchedulerOwner(
      a.config,
      a.bus,
      false,
      a.registry,
      (options) => new CoreToolScheduler(options),
      () => a.settingsOwner.readToolExecutionPolicy(),
      () =>
        a.settingsOwner.readToolGovernance(a.config.getExcludeTools() ?? []),
      undefined,
      RootTelemetry.prepare({
        enabled: false,
        sessionId: 'isolated-caller-fixture',
        maxBytes: 1024,
        maxFiles: 1,
      }),
    )(ca);
    const ob = bindSchedulerOwner(
      b.config,
      b.bus,
      true,
      b.registry,
      (options) => new CoreToolScheduler(options),
      () => b.settingsOwner.readToolExecutionPolicy(),
      () =>
        b.settingsOwner.readToolGovernance(b.config.getExcludeTools() ?? []),
      undefined,
      RootTelemetry.prepare({
        enabled: false,
        sessionId: 'isolated-caller-fixture',
        maxBytes: 1024,
        maxFiles: 1,
      }),
    )(cb);
    const la = oa.acquire();
    const lb = ob.acquire();
    try {
      await Promise.all([la.ready, lb.ready]);
      await execute(la, ca.completed);
      await oa.dispose();
      expect(
        a.bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE),
      ).toBe(0);
      expect(
        b.bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE),
      ).toBe(1);
      await execute(lb, cb.completed);
      expect(a.effects).toHaveLength(1);
      expect(b.effects).toHaveLength(1);
      expect(a.effects[0]?.interactiveMode).toBe(false);
      expect(b.effects[0]?.interactiveMode).toBe(true);
    } finally {
      await Promise.all([oa.dispose(), ob.dispose()]);
    }
  });

  it('waits for aborted noninteractive external work before returning a result', async () => {
    const a = fixture(false);
    let entered!: () => void;
    let stop!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const external = new Promise<void>((resolve) => {
      stop = resolve;
    });
    const effects: string[] = [];
    const delayed = new MockTool({
      name: 'delayed',
      execute: async (_params, signal) => {
        entered();
        signal.addEventListener(
          'abort',
          () => {
            effects.push('abort');
          },
          { once: true },
        );
        await external;
        effects.push('joined');
        return { llmContent: 'finished', returnDisplay: 'finished' };
      },
    });
    a.registry.registerTool(delayed);
    const controller = new AbortController();
    let returned = false;
    const result = executeToolCall(
      bindSchedulerOwner(
        a.config,
        a.bus,
        false,
        a.registry,
        (options) => new CoreToolScheduler(options),
        () => a.settingsOwner.readToolExecutionPolicy(),
        () =>
          a.settingsOwner.readToolGovernance(a.config.getExcludeTools() ?? []),
        undefined,
        RootTelemetry.prepare({
          enabled: false,
          sessionId: 'isolated-caller-fixture',
          maxBytes: 1024,
          maxFiles: 1,
        }),
      ),
      { ...request, name: 'delayed' },
      controller.signal,
    ).then((completed) => {
      returned = true;
      return completed;
    });
    try {
      await started;
      controller.abort();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(returned).toBe(false);
      expect(effects).toStrictEqual(['abort']);
      expect(
        a.bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE),
      ).toBe(1);
      stop();
      expect((await result).status).toBe('cancelled');
      expect(effects).toStrictEqual(['abort', 'joined']);
      expect(
        a.bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE),
      ).toBe(0);
    } finally {
      stop();
      await result;
    }
  });

  it('honors an empty child whitelist instead of the foreground allowed tools', async () => {
    const a = fixture(false);
    const completion = callbacks();
    a.settingsOwner.setAllowedTools(['effect']);
    const child = fixture(false);
    child.settingsOwner.setAllowedTools([]);
    const owner = assembleSchedulerOwner('child', {
      telemetry: RootTelemetry.prepare({
        enabled: false,
        sessionId: 'isolated-caller-fixture',
        maxBytes: 1024,
        maxFiles: 1,
      }),
      readExecutionPolicy: () => a.settingsOwner.readToolExecutionPolicy(),
      config: a.config,
      messageBus: a.bus,
      toolRegistry: a.registry,
      toolContextInteractiveMode: false,
      getToolGovernance: () =>
        child.settingsOwner.readToolGovernance(
          child.config.getExcludeTools() ?? [],
        ),
      ...completion,
    });
    const lease = owner.acquire();
    try {
      await lease.schedule(request);
      expect((await completion.completed)[0]?.status).toBe('error');
      expect(a.effects).toHaveLength(0);
    } finally {
      await lease.release();
    }
  });

  it('cannot release a replacement lifetime through a stale lease', async () => {
    const a = fixture(false);
    const completed: CompletedToolCall[][] = [];
    const owner = bindSchedulerOwner(
      a.config,
      a.bus,
      false,
      a.registry,
      (options) => new CoreToolScheduler(options),
      () => a.settingsOwner.readToolExecutionPolicy(),
      () =>
        a.settingsOwner.readToolGovernance(a.config.getExcludeTools() ?? []),
      undefined,
      RootTelemetry.prepare({
        enabled: false,
        sessionId: 'isolated-caller-fixture',
        maxBytes: 1024,
        maxFiles: 1,
      }),
    )({
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
      onAllToolCallsComplete: async (calls) => {
        completed.push(calls);
      },
    });
    const stale = owner.acquire();
    await stale.ready;
    await stale.release();
    const replacement = owner.acquire();
    try {
      await replacement.ready;
      await stale.release();
      await expect(stale.schedule(request)).rejects.toThrow('released');
      await replacement.schedule(request);
      expect(a.effects).toHaveLength(1);
      expect(completed[0]?.[0]?.status).toBe('success');
      expect(
        a.bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE),
      ).toBe(1);
    } finally {
      await replacement.release();
    }
    expect(a.bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE)).toBe(
      0,
    );
  });
});
