import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { createSessionSettingsFixture } from '../api/__tests__/helpers/session-settings-fixture.js';
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
import {
  SessionSchedulerOwner,
  type OwnedScheduler,
  type SchedulerLease,
} from './sessionSchedulerOwner.js';

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
  type ToolResult,
  type ToolCallConfirmationDetails,
} from '@vybestack/llxprt-code-tools';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const request = {
  callId: 'call',
  name: 'record',
  args: {},
  isClientInitiated: false,
  prompt_id: 'prompt',
};

function boundary(events: string[], failures = false): OwnedScheduler {
  return {
    schedule: async (_request, signal) => {
      signal.throwIfAborted();
      events.push('scheduled');
    },
    cancelAll: () => {
      events.push('cancel');
      if (failures) throw new Error('cancel failed');
    },
    dispose: async () => {
      events.push('closed');
      if (failures) throw new Error('close failed');
    },
  };
}

describe('SessionSchedulerOwner shutdown boundaries', () => {
  it('joins a rejected in-flight schedule and reports it after closing', async () => {
    const events: string[] = [];
    const started = deferred<void>();
    const cancelled = deferred<void>();
    const work = deferred<void>();
    const owner = new SessionSchedulerOwner(
      'label',
      () => ({
        schedule: async () => {
          started.resolve();
          await work.promise;
        },
        cancelAll: () => {
          events.push('cancel');
          cancelled.resolve();
        },
        dispose: () => {
          events.push('closed');
        },
      }),
      async () => {
        events.push('joined');
      },
    );
    const lease = owner.acquire();
    const execution = lease.schedule(request).catch((error: unknown) => error);
    await started.promise;
    const disposal = owner.dispose().catch((error: unknown) => error);
    await cancelled.promise;
    work.reject(new Error('execution failed'));
    expect(await execution).toStrictEqual(new Error('execution failed'));
    const failure = await disposal;
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError))
      throw new Error('Expected aggregate failure');
    expect(failure.errors).toStrictEqual([new Error('execution failed')]);
    expect(events).toStrictEqual(['cancel', 'joined', 'closed']);
  });

  it('keeps a pending second lease alive when the first is released', async () => {
    const events: string[] = [];
    const creation = deferred<OwnedScheduler>();
    const owner = new SessionSchedulerOwner(
      'label',
      () => creation.promise,
      async () => {
        events.push('joined');
      },
    );
    const first = owner.acquire();
    const second = owner.acquire();
    const rejected = first.ready.catch((error: unknown) => error);
    await first.release();
    creation.resolve(boundary(events));
    await second.schedule(request);
    expect(await rejected).toStrictEqual(new Error('Scheduler lease released'));
    expect(events).toStrictEqual(['scheduled']);
    await owner.dispose();
  });

  it('joins shutdown after rejected creation and never retries a disposed owner', async () => {
    const events: string[] = [];
    const creation = deferred<OwnedScheduler>();
    const owner = new SessionSchedulerOwner(
      'label',
      () => creation.promise,
      async () => {
        events.push('joined');
      },
    );
    const lease = owner.acquire();
    const ready = lease.ready.catch((error: unknown) => error);
    const disposal = owner.dispose().catch((error: unknown) => error);
    creation.reject(new Error('initialization failed'));
    expect(await ready).toStrictEqual(new Error('initialization failed'));
    expect(lease.release()).toBe(owner.dispose());
    expect(await disposal).toBeInstanceOf(AggregateError);
    expect(events).toStrictEqual(['joined']);
    expect(() => owner.acquire()).toThrow('disposed');
  });

  it('waits for the asynchronous disposer and shares last-release completion', async () => {
    const events: string[] = [];
    const closing = deferred<void>();
    const closed = deferred<void>();
    const owner = new SessionSchedulerOwner(
      'label',
      () => ({
        ...boundary(events),
        dispose: async () => {
          closing.resolve();
          await closed.promise;
          events.push('closed');
        },
      }),
      async () => {},
    );
    const lease = owner.acquire();
    await lease.ready;
    const release = lease.release();
    expect(lease.release()).toBe(release);
    expect(owner.dispose()).toBe(release);
    await closing.promise;
    expect(events).toStrictEqual(['cancel']);
    closed.resolve();
    await release;
    expect(events).toStrictEqual(['cancel', 'closed']);
  });

  it('rejects caller-aborted execution without disposing the shared owner', async () => {
    const events: string[] = [];
    const owner = new SessionSchedulerOwner(
      'label',
      () => boundary(events),
      async () => {},
    );
    const lease = owner.acquire();
    const controller = new AbortController();
    controller.abort(new Error('caller stopped'));
    await expect(lease.schedule(request, controller.signal)).rejects.toThrow(
      'caller stopped',
    );
    await lease.schedule(request);
    expect(events).toStrictEqual(['scheduled']);
    await owner.dispose();
  });
});

describe('SessionSchedulerOwner lifecycle', () => {
  it('joins creation for two leases and closes only after the last idempotent release', async () => {
    const events: string[] = [];
    const creation = deferred<OwnedScheduler>();
    const owner = new SessionSchedulerOwner(
      'same-label',
      () => {
        events.push('create');
        return creation.promise;
      },
      async () => {
        events.push('joined');
      },
    );
    const a = owner.acquire();
    const b = owner.acquire();
    creation.resolve(boundary(events));
    await Promise.all([a.ready, b.ready]);
    await a.release();
    await a.release();
    await b.schedule(request);
    expect(events).toStrictEqual(['create', 'scheduled']);
    await b.release();
    expect(events).toStrictEqual([
      'create',
      'scheduled',
      'cancel',
      'joined',
      'closed',
    ]);
    await expect(a.schedule(request)).rejects.toThrow('released');
    await owner.dispose();
  });

  it('does not publish late construction after last release and permits a fresh lifetime', async () => {
    const events: string[] = [];
    const creation = deferred<OwnedScheduler>();
    let first = true;
    const owner = new SessionSchedulerOwner(
      'label',
      () => {
        if (first) {
          first = false;
          return creation.promise;
        }
        return boundary(events);
      },
      async () => {
        events.push('joined');
      },
    );
    const lease = owner.acquire();
    const ready = lease.ready.catch((error: unknown) => error);
    const release = lease.release();
    expect(owner.acquire.bind(owner)).toThrow('closing');
    creation.resolve(boundary(events));
    await release;
    expect(await ready).toStrictEqual(new Error('Scheduler lease released'));
    const next = owner.acquire();
    await next.schedule(request);
    await next.release();
    expect(events).toStrictEqual([
      'cancel',
      'joined',
      'closed',
      'scheduled',
      'cancel',
      'joined',
      'closed',
    ]);
    await owner.dispose();
  });

  it('shares concurrent disposal, joins late creation, and refuses new admission', async () => {
    const events: string[] = [];
    const creation = deferred<OwnedScheduler>();
    const owner = new SessionSchedulerOwner(
      'label',
      () => creation.promise,
      async () => {
        events.push('joined');
      },
    );
    const lease = owner.acquire();
    const ready = lease.ready.catch((error: unknown) => error);
    const disposal = owner.dispose();
    expect(owner.dispose()).toBe(disposal);
    expect(() => owner.acquire()).toThrow('disposed');
    let finished = false;
    void disposal.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    creation.resolve(boundary(events));
    await Promise.all([disposal, lease.release()]);
    expect(await ready).toStrictEqual(
      new Error('Scheduler owner label disposed'),
    );
    expect(events).toStrictEqual(['cancel', 'joined', 'closed']);
    expect(owner.dispose()).toBe(disposal);
  });

  it('retries failure-atomic construction without old leases releasing the retry', async () => {
    const events: string[] = [];
    let attempt = 0;
    const owner = new SessionSchedulerOwner(
      'label',
      async () => {
        attempt++;
        if (attempt === 1) {
          events.push('partial-resource-cleaned');
          throw new Error('initialization failed');
        }
        return boundary(events);
      },
      async () => {
        events.push('joined');
      },
    );
    const failed = owner.acquire();
    await expect(failed.ready).rejects.toThrow('initialization failed');
    const retry = owner.acquire();
    await retry.ready;
    await failed.release();
    await retry.schedule(request);
    await owner.dispose();
    expect(events).toStrictEqual([
      'partial-resource-cleaned',
      'scheduled',
      'cancel',
      'joined',
      'closed',
    ]);
  });

  it('aborts, waits scheduling and detached tool work, then closes even if cleanup fails', async () => {
    const events: string[] = [];
    const started = deferred<void>();
    const stopped = deferred<void>();
    const scheduleFinished = deferred<void>();
    const cancelled = deferred<void>();
    const owner = new SessionSchedulerOwner(
      'label',
      () => ({
        ...boundary(events, true),
        cancelAll: () => {
          events.push('cancel');
          cancelled.resolve();
          throw new Error('cancel failed');
        },
        schedule: async (_request, signal) => {
          signal.addEventListener(
            'abort',
            () => {
              events.push('abort');
            },
            { once: true },
          );
          started.resolve();
          await scheduleFinished.promise;
          events.push('schedule-finished');
        },
      }),
      async () => {
        events.push('joining');
        await stopped.promise;
        events.push('tool-stopped');
        throw new Error('join failed');
      },
    );
    const lease = owner.acquire();
    const execution = lease.schedule(request);
    await started.promise;
    const disposal = owner.dispose();
    const failure = disposal.catch((error: unknown) => error);
    await cancelled.promise;
    scheduleFinished.resolve();
    await execution;
    await Promise.resolve();
    expect(events).not.toContain('closed');
    stopped.resolve();
    const error = await failure;
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError))
      throw new Error('Expected aggregate failure');
    expect(error.errors.map((item: Error) => item.message)).toStrictEqual([
      'cancel failed',
      'join failed',
      'close failed',
    ]);
    expect(events).toStrictEqual([
      'abort',
      'cancel',
      'schedule-finished',
      'joining',
      'tool-stopped',
      'closed',
    ]);
    expect(owner.dispose()).toBe(disposal);
  });
});

class ExternalInvocation extends BaseToolInvocation<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    params: Record<string, unknown>,
    private readonly run: (signal: AbortSignal) => Promise<ToolResult>,
  ) {
    super(params);
  }
  getDescription(): string {
    return 'External effect';
  }
  override async shouldConfirmExecute(): Promise<ToolCallConfirmationDetails> {
    return {
      type: 'info',
      title: 'External effect',
      prompt: 'Run effect',
      onConfirm: async () => {},
    };
  }
  execute(signal: AbortSignal): Promise<ToolResult> {
    return this.run(signal);
  }
}

class ExternalTool extends BaseDeclarativeTool<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    private readonly run: (signal: AbortSignal) => Promise<ToolResult>,
  ) {
    super('record', 'Record', 'External effect', Kind.Other, {
      type: 'object',
      properties: {},
    });
  }
  protected createInvocation(
    params: Record<string, unknown>,
  ): ExternalInvocation {
    return new ExternalInvocation(params, this.run);
  }
}

async function withRealOwners(
  run: (
    make: (name: string, deny?: boolean, block?: boolean) => Promise<RealOwner>,
  ) => Promise<void>,
): Promise<void> {
  const logRoot = join(tmpdir(), 'llxprt-session-scheduler-owner');
  await mkdir(logRoot, { recursive: true });
  const root = await mkdtemp(resolve(logRoot, 'fixture-'));
  const keys = [
    'LLXPRT_CONFIG_HOME',
    'LLXPRT_DATA_HOME',
    'LLXPRT_CACHE_HOME',
    'LLXPRT_LOG_HOME',
  ];
  const previous: Array<[string, string | undefined]> = keys.map((key) => [
    key,
    process.env[key],
  ]);
  const restoreEnvironment = (): void => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  for (const key of keys) process.env[key] = root;
  const cleanup: Array<() => Promise<void>> = [];
  try {
    await run(async (name, deny = false, block = false) => {
      const config = new Config({
        sessionId: 'identical-session-label',
        targetDir: root,
        cwd: root,
        debugMode: false,
        model: 'unused',
        interactive: true,
        trustedFolder: true,
        coreTools: [],
        telemetry: { enabled: false },
      });
      const configPolicy = new RuntimePolicyOwner(config);
      cleanup.push(() => config.dispose());
      cleanup.push(async () => configPolicy.dispose());
      const bus = configPolicy.session.messageBus;
      const infrastructure = testConfigInitialization(
        config,
        bus,
        configPolicy,
        createTestFilesystem(config),
      );
      await config.initialize(infrastructure);
      const catalog = infrastructure.toolCatalog;
      configPolicy.session.confirmation.addRule({
        toolName: 'record',
        decision: deny ? PolicyDecision.DENY : PolicyDecision.ASK_USER,
        priority: 10000,
      });
      const events: string[] = [];
      const completions: CompletedToolCall[][] = [];
      let completion = deferred<void>();
      const started = deferred<void>();
      const stopped = deferred<void>();
      const aborted = deferred<void>();
      catalog.publication.registerTool(
        new ExternalTool((signal) => {
          const work = (async (): Promise<ToolResult> => {
            events.push(`${name}:start`);
            started.resolve();
            if (block) {
              signal.addEventListener(
                'abort',
                () => {
                  events.push(`${name}:abort`);
                  aborted.resolve();
                },
                { once: true },
              );
              await stopped.promise;
            }
            events.push(`${name}:effect`);
            return {
              llmContent: `${name}:output`,
              returnDisplay: `${name}:display`,
            };
          })();
          return work;
        }),
      );
      const unsubscribe = bus.subscribe<ToolConfirmationRequest>(
        MessageBusType.TOOL_CONFIRMATION_REQUEST,
        (message) => {
          events.push(`${name}:approval`);
          queueMicrotask(() =>
            bus.publish({
              type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
              correlationId: message.correlationId,
              outcome: ToolConfirmationOutcome.ProceedOnce,
            }),
          );
        },
      );
      cleanup.push(async () => {
        unsubscribe();
      });
      const settingsRoot = createSessionSettingsFixture(config);
      const schedulers: CoreToolScheduler[] = [];
      const owner = new SessionSchedulerOwner(
        'same-label',
        () => {
          const scheduler = new CoreToolScheduler({
            telemetry: RootTelemetry.prepare({
              enabled: false,
              sessionId: 'isolated-caller-fixture',
              maxBytes: 1024,
              maxFiles: 1,
            }),
            readExecutionPolicy: () =>
              settingsRoot.settingsOwner.readToolExecutionPolicy(),
            getToolGovernance: () =>
              settingsRoot.settingsOwner.readToolGovernance(
                config.getExcludeTools() ?? [],
              ),
            config,
            messageBus: bus,
            toolRegistry: catalog.selection,
            getPreferredEditor: () => undefined,
            onEditorClose: () => {},
            onAllToolCallsComplete: async (calls) => {
              completions.push(calls);
              completion.resolve();
              completion = deferred<void>();
            },
          });
          schedulers.push(scheduler);
          return scheduler;
        },
        async () => {
          await Promise.all(
            schedulers.map((scheduler) => scheduler.joinExecutions()),
          );
          events.push(`${name}:joined`);
        },
      );
      cleanup.push(async () => {
        stopped.resolve();
        await owner.dispose();
      });
      return {
        catalog: catalog.selection,
        owner,
        config,
        bus,
        events,
        completions,
        schedulers,
        started: started.promise,
        aborted: aborted.promise,
        stop: () => stopped.resolve(),
        schedule: async (lease, callId) => {
          const completed = completion.promise;
          await lease.schedule({ ...request, callId });
          await completed;
        },
      };
    });
  } finally {
    try {
      for (const dispose of cleanup.reverse()) await dispose();
    } finally {
      restoreEnvironment();
      await rm(root, { recursive: true, force: true });
    }
  }
}

interface RealOwner {
  catalog: import('@vybestack/llxprt-code-tools').ToolSelection;
  owner: SessionSchedulerOwner;
  config: Config;
  bus: MessageBus;
  events: string[];
  completions: CompletedToolCall[][];
  schedulers: CoreToolScheduler[];
  started: Promise<void>;
  aborted: Promise<void>;
  stop(): void;
  schedule(lease: SchedulerLease, callId: string): Promise<void>;
}

describe('SessionSchedulerOwner with real CoreToolScheduler', () => {
  it('isolates identical labels, fixed callbacks, policies, buses and external effects; leaves borrowed resources usable', async () => {
    await withRealOwners(async (make) => {
      const a = await make('A', true);
      const b = await make('B');
      const la = a.owner.acquire();
      const lb = b.owner.acquire();
      const lb2 = b.owner.acquire();
      await Promise.all([la.ready, lb.ready, lb2.ready]);
      expect(a.schedulers[0]).not.toBe(b.schedulers[0]);
      await a.schedule(la, 'call');
      await b.schedule(lb, 'call');
      expect(a.completions[0]?.[0]?.status).toBe('error');
      expect(b.completions[0]?.[0]?.status).toBe('success');
      expect(a.events).toStrictEqual([]);
      expect(b.events).toStrictEqual(['B:approval', 'B:start', 'B:effect']);
      await la.release();
      await lb.release();
      expect(
        a.bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE),
      ).toBe(0);
      expect(
        b.bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE),
      ).toBe(1);
      await b.schedule(lb2, 'second');
      await lb2.release();
      expect(b.completions).toHaveLength(2);
      expect(a.completions).toHaveLength(1);
      expect(
        b.bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE),
      ).toBe(0);
      const fresh = b.owner.acquire();
      await b.schedule(fresh, 'third');
      await fresh.release();
      expect(b.completions[2]?.[0]?.response.resultDisplay).toBe('B:display');
      expect(b.catalog.getTool('record')).toBeDefined();
      expect(b.schedulers).toHaveLength(2);
    });
  }, 30_000);

  it('does not finish disposal while an aborted real tool is still running', async () => {
    await withRealOwners(async (make) => {
      const a = await make('A', false, true);
      const lease = a.owner.acquire();
      const execution = lease.schedule(request);
      await a.started;
      let finished = false;
      const disposal = a.owner.dispose().then(() => {
        finished = true;
      });
      await a.aborted;
      await execution;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(finished).toBe(false);
      expect(
        a.bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE),
      ).toBe(1);
      a.stop();
      await disposal;
      expect(a.events).toStrictEqual([
        'A:approval',
        'A:start',
        'A:abort',
        'A:effect',
        'A:joined',
      ]);
      expect(
        a.bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE),
      ).toBe(0);
    });
  }, 30_000);
});
