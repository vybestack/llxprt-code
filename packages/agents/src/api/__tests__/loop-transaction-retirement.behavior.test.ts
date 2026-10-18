import type { AgenticLoopEvent } from '../../core/agenticLoop/types.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  MessageBusType,
  type MessageBusMessage,
} from '@vybestack/llxprt-code-policy';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
} from 'bun:test';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Config, ToolConfirmationOutcome } from '@vybestack/llxprt-code-core';
import { AgentEventType } from '../../core/turn.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { Agent } from '../agent.js';
import { createAgent } from '../createAgent.js';
import { AgenticLoop } from '../../core/agenticLoop/AgenticLoop.js';
import { CoreToolScheduler } from '../../core/coreToolScheduler.js';
import { bindSchedulerOwner } from '../../session/assembleSchedulerOwner.js';
import { SessionExecutionOwner } from '../../session/session-execution-owner.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

describe('real loop replacement transaction retirement', () => {
  const credentials = useOwnedCredentials();
  const cleanup: Array<() => void | Promise<void>> = [];
  let agent: Agent;
  let config: Config;
  let policy: RuntimePolicyOwner;
  let settings: SessionSettingsOwner;
  let prompts: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    prompts = await mkdtemp(join(tmpdir(), 'loop-retirement-prompts-'));
    await mkdir(join(prompts, 'core'), { recursive: true });
    await writeFile(
      join(prompts, 'core', 'default.md'),
      'Real loop replacement test.',
    );
    process.env.LLXPRT_PROMPTS_DIR = prompts;
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(prompts, { recursive: true, force: true });
  });
  beforeEach(async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'loop-retirement-'));
    cleanup.push(() => rm(temporary, { recursive: true, force: true }));
    const directory = await realpath(temporary);
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    cleanup.push(() => {
      if (previousReplay === undefined)
        delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
    });
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
    );
    config = new Config({
      sessionId: 'loop-retirement',
      cwd: directory,
      targetDir: directory,
      model: 'fake-model',
      provider: 'fake',
      debugMode: false,
      telemetry: { enabled: false },
    });
    cleanup.push(() => config.dispose());
    policy = new RuntimePolicyOwner(config);
    cleanup.push(() => policy.dispose());
    settings = new SessionSettingsOwner(new SettingsService());
    cleanup.push(() => settings.dispose());
    settings.bindTelemetry(config);
    agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: directory,
      credentialAuthority: credentials().authority,
      harness: { includeProcessCwd: false },
    });
    cleanup.push(() => agent.dispose());
  });
  afterEach(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.splice(0).reverse()) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Loop transaction fixture cleanup failed',
      );
  });

  it.each(['subscribe', 'unsubscribe'])(
    'keeps a real loop reusable after actual approval %s faults and releases its live bus listener',
    async (stage) => {
      const failure = new Error(`approval ${stage} fault`);
      class FaultingBus extends MessageBus {
        private pending = true;
        override subscribe<T extends MessageBusMessage>(
          type: MessageBusType,
          handler: (message: T) => void,
        ): () => void {
          if (stage === 'subscribe' && this.pending) {
            this.pending = false;
            throw failure;
          }
          const unsubscribe = super.subscribe(type, handler);
          return () => {
            unsubscribe();
            if (stage === 'unsubscribe' && this.pending) {
              this.pending = false;
              throw failure;
            }
          };
        }
      }
      const bus = new FaultingBus();
      const loop = new AgenticLoop({
        agentClient: agent.agentClient,
        config,
        messageBus: bus,
        interactiveMode: false,
        approvalHandler: async () => ({
          outcome: ToolConfirmationOutcome.Cancel,
        }),
        createSchedulerOwner: bindSchedulerOwner(
          config,
          bus,
          false,
          agent.agentClient.tools,
          (options) => new CoreToolScheduler(options),
          () => settings.readToolExecutionPolicy(),
          () => settings.readToolGovernance([]),
          () => config.getApprovalMode(),
          settings.telemetry,
        ),
      });
      async function consume(): Promise<AgenticLoopEvent[]> {
        const events: AgenticLoopEvent[] = [];
        for await (const event of loop.run(
          'actual loop request',
          new AbortController().signal,
        ))
          events.push(event);
        return events;
      }
      await expect(consume()).rejects.toBe(failure);
      expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(
        0,
      );
      const events = await consume();
      expect(events.length).toBeGreaterThan(0);
      expect(
        events.some(
          (event) =>
            event.kind === 'stream' &&
            event.event.type === AgentEventType.Content,
        ),
      ).toBe(true);
      expect(
        events.some(
          (event) =>
            event.kind === 'stream' &&
            event.event.type === AgentEventType.Error,
        ),
      ).toBe(false);
      expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(
        0,
      );
    },
  );

  it.each(['undefined', 'repeated'])(
    'retains exact primary and approval-release failures in order, including %s leaves',
    async (kind) => {
      const cleanupFailure = new Error('actual bus release failure');
      const primary = kind === 'undefined' ? undefined : cleanupFailure;
      class ReleaseFaultBus extends MessageBus {
        override subscribe<T extends MessageBusMessage>(
          type: MessageBusType,
          handler: (message: T) => void,
        ): () => void {
          const release = super.subscribe(type, handler);
          return () => {
            release();
            throw cleanupFailure;
          };
        }
      }
      const bus = new ReleaseFaultBus();
      const loop = new AgenticLoop({
        agentClient: agent.agentClient,
        config: {
          getSessionId: () => {
            throw primary;
          },
          getModel: () => config.getModel(),
          getImagePayloadBudgetBytes: () => config.getImagePayloadBudgetBytes(),
        },
        messageBus: bus,
        approvalHandler: async () => ({
          outcome: ToolConfirmationOutcome.Cancel,
        }),
        createSchedulerOwner: bindSchedulerOwner(
          config,
          bus,
          false,
          agent.agentClient.tools,
          (options) => new CoreToolScheduler(options),
          () => settings.readToolExecutionPolicy(),
          () => settings.readToolGovernance([]),
          () => config.getApprovalMode(),
          settings.telemetry,
        ),
      });
      const result = await Promise.allSettled([
        loop
          .run(
            'execution with runtime read failure',
            new AbortController().signal,
          )
          .next(),
      ]);
      const settled = result[0];
      if (settled.status !== 'rejected')
        throw new Error('Missing actual loop failure');
      expect(settled.reason).toBeInstanceOf(AggregateError);
      if (!(settled.reason instanceof AggregateError)) throw settled.reason;
      expect(settled.reason.errors).toStrictEqual([primary, cleanupFailure]);
      expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(
        0,
      );
    },
  );

  it.each(['ordinary', 'undefined', 'error'])(
    'retires a paused actual generation approval subscription once, preserving replacement admission and %s release failures',
    async (mode) => {
      const failure =
        mode === 'undefined'
          ? undefined
          : new Error('actual bus release failed');
      class GenerationBus extends MessageBus {
        releases = 0;
        override subscribe<T extends MessageBusMessage>(
          type: MessageBusType,
          handler: (message: T) => void,
        ): () => void {
          const release = super.subscribe(type, handler);
          return () => {
            release();
            this.releases += 1;
            if (mode !== 'ordinary') throw failure;
          };
        }
      }
      const bus = new GenerationBus();
      const owner = new SessionExecutionOwner(
        config,
        settings,
        bus,
        agent.agentClient.tools,
        () => settings.readToolGovernance([]),
        policy.trust,
        undefined,
        async () => ({ outcome: ToolConfirmationOutcome.ProceedOnce }),
        undefined,
      );
      cleanup.push(() => owner.dispose());
      const previous = owner.initialize(agent.agentClient);
      const before = previous.run(
        'Hold the prior actual generation',
        new AbortController().signal,
      );
      cleanup.push(async () => {
        await before.return(undefined);
      });
      expect((await before.next()).done).toBe(false);
      expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(
        1,
      );
      const replacement = owner.prepare(agent.agentClient);
      const current = replacement.publish();
      expect(current).not.toBe(previous);
      expect(owner.isCurrent(current)).toBe(true);
      let caught: unknown;
      try {
        replacement.retire();
      } catch (error) {
        caught = error;
      }
      expect(caught instanceof AggregateError).toBe(mode !== 'ordinary');
      const causes =
        caught instanceof AggregateError ? caught.errors : undefined;
      expect(causes).toStrictEqual(mode === 'ordinary' ? undefined : [failure]);
      expect(causes === undefined ? caught : causes[0]).toBe(
        mode === 'ordinary' ? undefined : failure,
      );
      expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(
        0,
      );
      expect(bus.releases).toBe(1);
      expect(() => replacement.retire()).not.toThrow();
      expect(bus.releases).toBe(1);
      await expect(
        previous
          .run('Late retired generation', new AbortController().signal)
          .next(),
      ).rejects.toThrow('Agent loop is retired');
      expect(() => previous.injectSteer('Retired generation input')).toThrow(
        'Agent loop is retired',
      );
      const next = current.run(
        'Use the published replacement',
        new AbortController().signal,
      );
      expect((await next.next()).done).toBe(false);
      const repeatedPublications = new Set([current, replacement.publish()]);
      expect(repeatedPublications.size).toBe(1);
      await before.return(undefined);
      expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(
        1,
      );
      const finished = await Promise.allSettled([next.return(undefined)]);
      expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(
        0,
      );
      expect(bus.releases).toBe(2);
      expect(finished[0].status).toBe(
        mode === 'ordinary' ? 'fulfilled' : 'rejected',
      );
      expect(owner.isCurrent(current)).toBe(true);
    },
  );

  class FaultedSubscriptionBus extends MessageBus {
    readonly closed: number[] = [];
    private created = 0;
    constructor(private readonly reasons: readonly unknown[]) {
      super();
    }
    override subscribe<T extends MessageBusMessage>(
      type: MessageBusType,
      listener: (message: T) => void,
    ): () => void {
      const release = super.subscribe(type, listener);
      if (type !== MessageBusType.TOOL_CONFIRMATION_REQUEST) return release;
      const id = this.created++;
      return () => {
        release();
        this.closed.push(id);
        if (id < this.reasons.length) throw this.reasons[id];
      };
    }
  }
  async function pauseExecution(
    owner: SessionExecutionOwner,
  ): Promise<
    ReturnType<ReturnType<SessionExecutionOwner['initialize']>['run']>
  > {
    const actual = owner.resolve(agent.agentClient);
    if (actual.execution === undefined) throw new Error(actual.error.message);
    const stream = actual.execution.run(
      'Hold actual subscription',
      new AbortController().signal,
    );
    cleanup.push(async () => {
      await stream.return(undefined);
    });
    expect((await stream.next()).done).toBe(false);
    return stream;
  }

  it('publishes a real replacement before actual abort fault and still retires its real subscription with primary-first failures', async () => {
    const primary = new Error('actual abort delivery failed');
    const secondary = new Error('actual subscription release failed');
    const bus = new FaultedSubscriptionBus([secondary]);
    const owner = acquireExecution(bus);
    cleanup.push(() => owner.dispose());
    const previous = owner.initialize(agent.agentClient);
    const paused = await pauseExecution(owner);
    const replacement = owner.prepare(agent.agentClient);
    const current = replacement.publish();
    const abort = AbortController.prototype.abort;
    const physicallyAborted: boolean[] = [];
    const fault = spyOn(AbortController.prototype, 'abort').mockImplementation(
      function (this: AbortController, reason?: unknown): void {
        abort.call(this, reason);
        physicallyAborted.push(this.signal.aborted);
        throw primary;
      },
    );
    let failure: unknown;
    try {
      replacement.retire();
    } catch (error) {
      failure = error;
    } finally {
      fault.mockRestore();
    }
    expect(current).not.toBe(previous);
    expect(owner.isCurrent(current)).toBe(true);
    expect(owner.isCurrent(previous)).toBe(false);
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError))
      throw new Error('Missing actual retirement faults');
    expect(failure.errors).toStrictEqual([primary, secondary]);
    expect(physicallyAborted).toStrictEqual([true]);
    expect(bus.closed).toStrictEqual([0]);
    expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(0);
    expect(() => replacement.retire()).not.toThrow();
    await paused.return(undefined);
    expect(bus.closed).toStrictEqual([0]);
    expect(owner.isCurrent(current)).toBe(true);
    const results = [];
    for await (const event of current.run(
      'New generation survives old fault',
      new AbortController().signal,
    ))
      results.push(event);
    expect(
      results.some(
        (event) =>
          event.kind === 'stream' &&
          event.event.type === AgentEventType.Content,
      ),
    ).toBe(true);
    expect(
      results.some(
        (event) =>
          event.kind === 'stream' && event.event.type === AgentEventType.Error,
      ),
    ).toBe(false);
  });

  it('leaves the original actual generation and its real subscription runnable when actual replacement construction fails', async () => {
    const primary = new Error('replacement configuration acquisition failed');
    class FailingInteractiveConfig extends Config {
      fail = false;
      override isInteractive(): boolean {
        if (this.fail) throw primary;
        return super.isInteractive();
      }
    }
    const supplied = new FailingInteractiveConfig({
      sessionId: config.getSessionId(),
      cwd: config.getTargetDir(),
      targetDir: config.getTargetDir(),
      provider: 'fake',
      model: 'fake-model',
      debugMode: false,
      telemetry: { enabled: false },
    });
    cleanup.push(() => supplied.dispose());
    const bus = new FaultedSubscriptionBus([]);
    const owner = acquireExecution(bus, supplied);
    cleanup.push(() => owner.dispose());
    const previous = owner.initialize(agent.agentClient);
    const stream = await pauseExecution(owner);
    expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(1);
    supplied.fail = true;
    try {
      expect(() => owner.prepare(agent.agentClient)).toThrow(primary);
    } finally {
      supplied.fail = false;
    }
    expect(owner.isCurrent(previous)).toBe(true);
    expect(owner.resolve(agent.agentClient)).toStrictEqual({
      execution: previous,
    });
    expect(bus.closed).toStrictEqual([]);
    expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(1);
    const events = [];
    for await (const event of stream) events.push(event);
    expect(
      events.some(
        (event) =>
          event.kind === 'stream' &&
          event.event.type === AgentEventType.Content,
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.kind === 'stream' && event.event.type === AgentEventType.Error,
      ),
    ).toBe(false);
    expect(bus.closed).toStrictEqual([0]);
  });

  it('retains undefined and repeated actual subscription failures and does not reset generation work on repeated publication', async () => {
    const repeated = new Error('independent actual subscription failures');
    const reasons: readonly unknown[] = [undefined, repeated, repeated];
    const bus = new FaultedSubscriptionBus(reasons);
    const owner = acquireExecution(bus);
    cleanup.push(() => owner.dispose());
    owner.initialize(agent.agentClient);
    const prior = [];
    for (const _reason of reasons) {
      await pauseExecution(owner);
      const replacement = owner.prepare(agent.agentClient);
      replacement.publish();
      prior.push(replacement);
    }
    expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(3);
    const failures: unknown[] = [];
    for (const replacement of prior) {
      try {
        replacement.retire();
      } catch (error) {
        failures.push(error);
      }
    }
    expect(failures).toHaveLength(3);
    expect(
      failures.every(
        (error) => error instanceof AggregateError && error.errors.length === 1,
      ),
    ).toBe(true);
    expect(
      failures.map((error) =>
        error instanceof AggregateError ? error.errors[0] : error,
      ),
    ).toStrictEqual([...reasons]);
    expect(bus.closed).toStrictEqual([0, 1, 2]);
    for (const replacement of prior) replacement.retire();
    expect(bus.closed).toStrictEqual([0, 1, 2]);
    const latest = prior[prior.length - 1];
    const current = latest.publish();
    const stream = current.run(
      'Keep active work across repeated publication',
      new AbortController().signal,
    );
    expect((await stream.next()).done).toBe(false);
    const identities = new Set([current, latest.publish()]);
    expect(identities.size).toBe(1);
    expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(1);
    const next = owner.prepare(agent.agentClient);
    next.publish();
    next.retire();
    expect(bus.closed).toStrictEqual([0, 1, 2, 3]);
    await stream.return(undefined);
    expect(bus.closed).toStrictEqual([0, 1, 2, 3]);
  });
  function acquireExecution(
    bus: MessageBus = policy.session.messageBus,
    suppliedConfig: Config = config,
  ): SessionExecutionOwner {
    return new SessionExecutionOwner(
      suppliedConfig,
      settings,
      bus,
      agent.agentClient.tools,
      () => settings.readToolGovernance([]),
      policy.trust,
      undefined,
      bus instanceof FaultedSubscriptionBus
        ? async () => ({ outcome: ToolConfirmationOutcome.Cancel })
        : undefined,
      undefined,
    );
  }

  it('rejects delayed iteration of an admitted execution after closure without retiring the borrowed client', async () => {
    const owner = acquireExecution();
    const execution = owner.initialize(agent.agentClient);
    const iterator = execution.run(
      'Do not start a closed generation',
      new AbortController().signal,
    );
    owner.closeAdmission();
    try {
      await expect(iterator.next()).rejects.toThrow(
        'Session execution is closed',
      );
      expect(
        (await agent.chat('The borrowed client still runs')).text.length,
      ).toBeGreaterThan(0);
    } finally {
      await iterator.return(undefined);
    }
  });

  it('rejects steering through a captured execution after closure without modifying a live borrower', async () => {
    const owner = acquireExecution();
    const execution = owner.initialize(agent.agentClient);
    owner.closeAdmission();
    expect(() =>
      execution.injectSteer('Do not mutate a retired generation'),
    ).toThrow('Session execution is closed');
    expect(
      (await agent.chat('The independent borrower still runs')).text.length,
    ).toBeGreaterThan(0);
  });
  it.each(['current', 'published-before-retirement'])(
    'direct client-owner disposal aborts and joins its held %s real HTTP generation while the peer remains live',
    async (generation) => {
      let enter = (): void => {};
      let close = (): void => {};
      let release = (): void => {};
      let streamed = (): void => {};
      const streaming = new Promise<void>((resolve) => {
        streamed = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const disconnected = new Promise<void>((resolve) => {
        close = resolve;
      });
      const failures: unknown[] = [];
      const server = createServer((socket) => {
        let headers = '';
        let responded = false;
        socket.on('error', (error) => {
          if (!('code' in error) || error.code !== 'ECONNRESET')
            failures.push(error);
        });
        socket.on('data', (chunk) => {
          if (responded) return;
          headers += chunk.toString();
          if (!headers.includes('\r\n\r\n')) return;
          responded = true;
          if (headers.startsWith('GET ')) {
            socket.end(
              'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n' +
                JSON.stringify({ object: 'list', data: [] }),
            );
            return;
          }
          socket.once('close', close);
          socket.write(
            'HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n',
          );
          socket.write(
            `data: ${JSON.stringify({ id: 'held', object: 'chat.completion.chunk', created: 1, model: 'held-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'held HTTP body' }, finish_reason: null }] })}\n\n`,
          );
          release = () => {
            if (!socket.destroyed)
              socket.end(
                `data: ${JSON.stringify({ id: 'held', object: 'chat.completion.chunk', created: 1, model: 'held-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'released HTTP' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
              );
          };
          enter();
        });
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (address === null || typeof address === 'string')
        throw new Error('Missing HTTP address');
      const replay = process.env.LLXPRT_FAKE_RESPONSES;
      delete process.env.LLXPRT_FAKE_RESPONSES;
      let httpAgent: Agent | undefined;
      let executing: Promise<void> | undefined;
      let closing: Promise<void> | undefined;
      try {
        httpAgent = await createAgent({
          provider: 'openai',
          model: 'held-model',
          workingDir: config.getTargetDir(),
          credentialAuthority: credentials().authority,
          auth: {
            apiKey: 'local-only',
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
          },
          recording: { enabled: false },
          telemetry: { enabled: false },
          mcpEnabled: false,
          harness: { includeProcessCwd: false },
        });
        if (
          !('ownerClient' in httpAgent) ||
          !(httpAgent.ownerClient instanceof SessionClientOwner)
        )
          throw new Error('Missing actual session client owner');
        const owner = httpAgent.ownerClient;
        const selected = owner.resolveExecution();
        if (selected.loop === undefined)
          throw new Error(selected.error.message);
        const execution = selected.loop;
        executing = (async (): Promise<void> => {
          for await (const event of execution.run(
            'Hold the actual HTTP execution',
            new AbortController().signal,
          )) {
            if (
              event.kind === 'stream' &&
              event.event.type === AgentEventType.Content
            )
              streamed();
          }
        })();
        void executing.catch(() => undefined);
        await Promise.race([
          Promise.all([entered, streaming]),
          executing.then(() => {
            throw new Error('Execution ended before HTTP transport entry');
          }),
        ]);
        let priorRetirement: (() => Promise<void>) | undefined;
        if (generation === 'published-before-retirement') {
          const prepared = await owner.prepareProfileExecution(
            false,
            new AbortController().signal,
            async (releasePrior) => {
              priorRetirement = releasePrior;
            },
          );
          prepared.publish();
          await prepared.retire();
        }
        expect(owner.isCurrentExecution(execution)).toBe(
          generation === 'current',
        );
        closing = owner.dispose();
        void closing.catch(() => undefined);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const cancelled = await Promise.race([
          disconnected.then(() => true),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), 2000);
          }),
        ]);
        clearTimeout(timer);
        expect(cancelled).toBe(true);
        await Promise.allSettled([executing, closing]);
        await priorRetirement?.();
        await expect(
          execution
            .run('Do not restart retired work', new AbortController().signal)
            .next(),
        ).rejects.toThrow('Session execution is closed');
        if (replay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
        else process.env.LLXPRT_FAKE_RESPONSES = replay;
        expect(
          (await agent.chat('Independent peer still runs')).text.length,
        ).toBeGreaterThan(0);
      } catch (primary) {
        failures.push(primary);
      } finally {
        release();
        const results = await Promise.allSettled([
          executing,
          closing,
          Promise.resolve().then(() => httpAgent?.dispose()),
        ]);
        for (const result of results)
          if (result.status === 'rejected') failures.push(result.reason);
        const stopped = await Promise.allSettled([
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
        ]);
        for (const result of stopped)
          if (result.status === 'rejected') failures.push(result.reason);
        if (replay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
        else process.env.LLXPRT_FAKE_RESPONSES = replay;
      }
      if (failures.length > 0)
        throw new AggregateError(failures, 'HTTP execution and release failed');
    },
    30000,
  );
});
