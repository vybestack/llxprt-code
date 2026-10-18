/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  writeFile,
  readFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Config } from '@vybestack/llxprt-code-core';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  ToolRegistry,
  type ToolContext,
  type ToolResult,
  type IToolMessageBus,
} from '@vybestack/llxprt-code-tools';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { createAgent } from '../createAgent.js';
import type { Agent } from '../agent.js';
import {
  SessionExecutionOwner,
  type SessionExecution,
} from '../../session/session-execution-owner.js';
import {
  MessageBus,
  MessageBusType,
  type MessageBusMessage,
} from '@vybestack/llxprt-code-policy';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-core';
import { AgentEventType } from '../../core/turn.js';
import { CoreToolScheduler } from '../../core/coreToolScheduler.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

class WriteModeInvocation extends BaseToolInvocation<
  Record<string, unknown>,
  ToolResult
> {
  constructor(
    private readonly file: string,
    private readonly readMode: () => boolean | undefined,
    bus: IToolMessageBus,
  ) {
    super({}, bus);
  }
  getDescription(): string {
    return 'Write actual tool execution mode';
  }
  async execute(): Promise<ToolResult> {
    await writeFile(
      this.file,
      JSON.stringify({ interactive: this.readMode() }),
    );
    return { llmContent: 'mode recorded', returnDisplay: 'mode recorded' };
  }
}
class WriteModeTool extends BaseDeclarativeTool<
  Record<string, unknown>,
  ToolResult
> {
  context: ToolContext | undefined;
  constructor(
    private readonly file: string,
    bus: IToolMessageBus,
  ) {
    super(
      'mode_probe',
      'mode_probe',
      'Record execution mode',
      Kind.Other,
      { type: 'object', properties: {} },
      false,
      false,
      bus,
    );
  }
  protected createInvocation(): WriteModeInvocation {
    return new WriteModeInvocation(
      this.file,
      () => this.context?.interactiveMode,
      this.requireMessageBus(),
    );
  }
}

class GenerationBus extends MessageBus {
  readonly released: number[] = [];
  private next = 0;
  releaseFailure: 'none' | 'error' = 'none';
  readonly failure = new Error('actual approval subscription release failed');
  override subscribe<T extends MessageBusMessage>(
    type: MessageBusType,
    listener: (event: T) => void,
  ): () => void {
    const release = super.subscribe(type, listener);
    if (type !== MessageBusType.TOOL_CONFIRMATION_REQUEST) return release;
    const id = this.next++;
    return () => {
      release();
      this.released.push(id);
      if (this.releaseFailure === 'error') throw this.failure;
    };
  }
}

describe('privately owned execution rebuild @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001 @requirement:REQ-007', () => {
  const credentials = useOwnedCredentials();
  const cleanup: Array<() => void | Promise<void>> = [];
  let directory: string;
  let config: Config;
  let tools: ToolRegistry;
  let execution: SessionExecutionOwner;
  let bus: GenerationBus;
  let selectedClient: AgentClientContract;
  beforeEach(async () => {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), 'real-loop-binding-')),
    );
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const oldReplay = process.env.LLXPRT_FAKE_RESPONSES;
    const oldPrompts = process.env.LLXPRT_PROMPTS_DIR;
    cleanup.push(() => {
      if (oldReplay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = oldReplay;
      if (oldPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
      else process.env.LLXPRT_PROMPTS_DIR = oldPrompts;
    });
    const replay = join(directory, 'responses.jsonl');
    await writeFile(
      replay,
      [
        JSON.stringify({
          chunks: [
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: 'mode-call',
                  name: 'mode_probe',
                  parameters: {},
                },
              ],
            },
          ],
        }),
        JSON.stringify({
          chunks: [
            {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'after physical mode write' }],
            },
          ],
        }),
      ].join('\n') + '\n',
    );
    process.env.LLXPRT_FAKE_RESPONSES = replay;
    process.env.LLXPRT_PROMPTS_DIR = join(directory, 'prompts');
    await mkdir(join(directory, 'prompts', 'core'), { recursive: true });
    await writeFile(
      join(directory, 'prompts', 'core', 'default.md'),
      'Exercise real loop binding.',
    );
    configureWorkspace(false);
    selectedClient = (await acquireAgent()).agentClient;
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
      throw new AggregateError(failures, 'Real loop fixture cleanup failed');
  });
  function configureWorkspace(interactive: boolean): void {
    const selected = new Config({
      sessionId: 'same-loop-label',
      cwd: directory,
      targetDir: directory,
      provider: 'fake',
      model: 'fake-model',
      interactive,
      debugMode: false,
      telemetry: { enabled: false },
    });
    cleanup.push(() => selected.dispose());
    config = selected;
    const selectedPolicy = new RuntimePolicyOwner(selected);
    cleanup.push(() => selectedPolicy.dispose());
    const store = new SettingsService();
    const owner = new SessionSettingsOwner(store);
    cleanup.push(() => owner.dispose());
    owner.bindTelemetry(selected);
    bus = new GenerationBus();
    tools = new ToolRegistry({}, bus, assembleTaskSchemaPolicy(store));
    tools.registerTool(
      new WriteModeTool(join(directory, 'actual-mode.json'), bus),
    );
    execution = new SessionExecutionOwner(
      config,
      owner,
      bus,
      tools,
      () => owner.readToolGovernance([]),
      selectedPolicy.trust,
      (options) => new CoreToolScheduler(options),
      async () => ({ outcome: ToolConfirmationOutcome.Cancel }),
      undefined,
    );
    const acquired = execution;
    cleanup.push(() => acquired.dispose());
  }
  async function acquireAgent(): Promise<Agent> {
    const agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      sessionId: 'same-loop-label',
      workingDir: directory,
      credentialAuthority: credentials().authority,
      harness: { includeProcessCwd: false },
    });
    cleanup.push(() => agent.dispose());
    return agent;
  }
  function rebuild(): SessionExecution {
    return execution.rebuild(selectedClient);
  }
  async function pause(
    actual: SessionExecution,
  ): Promise<ReturnType<SessionExecution['run']>> {
    const iterator = actual.run(
      'Observe actual generation',
      new AbortController().signal,
    );
    cleanup.push(async () => {
      await iterator.return(undefined);
    });
    for (;;) {
      const next = await iterator.next();
      if (next.done === true)
        throw new Error('Generation ended before real content');
      if (next.value.kind === 'stream' && next.value.event.type === 'content')
        return iterator;
    }
  }

  it('initial build binds the actual current client and admits real execution without premature subscription release @requirement:REQ-001', async () => {
    const client = selectedClient;
    const actual = rebuild();
    expect(execution.isCurrent(actual)).toBe(true);
    expect(execution.resolve(client)).toStrictEqual({ execution: actual });
    expect(bus.released).toStrictEqual([]);
    expect((await client.getHistory()).length).toBe(0);
    await runMode(actual);
    expect((await client.getHistory()).length).toBeGreaterThan(0);
    expect(bus.released).toStrictEqual([0]);
  });

  it('rebuild retires the prior actual generation and binds the new client while leaving borrowed clients live @requirement:REQ-007', async () => {
    const firstClient = selectedClient;
    const first = rebuild();
    const paused = await pause(first);
    selectedClient = (await acquireAgent()).agentClient;
    const second = rebuild();
    expect(execution.isCurrent(first)).toBe(false);
    expect(execution.isCurrent(second)).toBe(true);
    expect(second).not.toBe(first);
    expect(() => first.injectSteer('retired input')).toThrow(
      'Agent loop is retired',
    );
    expect(bus.released).toStrictEqual([0]);
    await paused.return(undefined);
    expect(bus.released).toStrictEqual([0]);
    const before = (await firstClient.getHistory()).length;
    await runMode(second);
    const historyDelta = (await firstClient.getHistory()).length - before;
    expect(historyDelta).toBe(0);
    expect((await selectedClient.getHistory()).length).toBeGreaterThan(0);
  });

  it('releases every actual prior generation subscription exactly once, including deferred prior retirement @requirement:REQ-007', async () => {
    const first = rebuild();
    const firstPaused = await pause(first);
    const replacement = execution.prepare((await acquireAgent()).agentClient);
    const second = replacement.publish();
    const secondPaused = await pause(second);
    const final = execution.prepare((await acquireAgent()).agentClient);
    const current = final.publish();
    expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(2);
    replacement.retire();
    final.retire();
    expect(bus.released).toStrictEqual([0, 1]);
    expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(0);
    replacement.retire();
    final.retire();
    await firstPaused.return(undefined);
    await secondPaused.return(undefined);
    expect(bus.released).toStrictEqual([0, 1]);
    expect(execution.isCurrent(current)).toBe(true);
  });

  it('throwing real unsubscribers do not prevent other generation release and replacement is already published @requirement:REQ-007', async () => {
    const first = rebuild();
    await pause(first);
    const one = execution.prepare((await acquireAgent()).agentClient);
    await pause(one.publish());
    const two = execution.prepare((await acquireAgent()).agentClient);
    const current = two.publish();
    bus.releaseFailure = 'error';
    const failures: unknown[] = [];
    for (const prior of [one, two]) {
      try {
        prior.retire();
      } catch (error) {
        failures.push(error);
      }
    }
    expect(failures).toHaveLength(2);
    expect(
      failures.every(
        (error) =>
          error instanceof AggregateError &&
          error.errors.length === 1 &&
          error.errors[0] === bus.failure,
      ),
    ).toBe(true);
    expect(bus.released).toStrictEqual([0, 1]);
    expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(0);
    expect(execution.isCurrent(current)).toBe(true);
    expect(execution.isCurrent(first)).toBe(false);
    one.retire();
    two.retire();
    expect(bus.released).toStrictEqual([0, 1]);
    bus.releaseFailure = 'none';
  });

  it('initial construction does not retire an unrelated existing real subscription @requirement:REQ-007', async () => {
    const unrelated = bus.subscribe(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      () => {},
    );
    const actual = rebuild();
    expect(bus.released).toStrictEqual([]);
    expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(1);
    expect(execution.isCurrent(actual)).toBe(true);
    await execution.dispose();
    expect(bus.released).toStrictEqual([]);
    expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(1);
    unrelated();
    expect(bus.released).toStrictEqual([0]);
  });

  it('rebuild without an accepted old run closes old admission and admits the replacement without a run-controller injection @requirement:REQ-007', async () => {
    const first = rebuild();
    selectedClient = (await acquireAgent()).agentClient;
    const second = rebuild();
    expect(execution.isCurrent(first)).toBe(false);
    expect(execution.isCurrent(second)).toBe(true);
    expect(second).not.toBe(first);
    expect(bus.released).toStrictEqual([]);
    await expect(
      first.run('late old run', new AbortController().signal).next(),
    ).rejects.toThrow('Agent loop is retired');
    await runMode(second);
    expect(bus.released).toStrictEqual([0]);
  });

  it('rebuild without recorded actual subscriptions leaves borrowed bus and new generation usable @requirement:REQ-007', async () => {
    const first = rebuild();
    expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(0);
    selectedClient = (await acquireAgent()).agentClient;
    const second = rebuild();
    expect(second).not.toBe(first);
    expect(execution.resolve(selectedClient)).toStrictEqual({
      execution: second,
    });
    expect(bus.released).toStrictEqual([]);
    await runMode(second);
    expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(0);
  });

  it('captures interactive=true in the actual loop and physical tool write @requirement:REQ-007', async () => {
    configureWorkspace(true);
    const actual = rebuild();
    expect(execution.isCurrent(actual)).toBe(true);
    await runMode(actual);
    expect(
      JSON.parse(await readFile(join(directory, 'actual-mode.json'), 'utf8')),
    ).toStrictEqual({ interactive: true });
  });

  it('captures interactive=false in the actual loop and physical tool write @requirement:REQ-007', async () => {
    configureWorkspace(false);
    const actual = rebuild();
    expect(execution.isCurrent(actual)).toBe(true);
    await runMode(actual);
    expect(
      JSON.parse(await readFile(join(directory, 'actual-mode.json'), 'utf8')),
    ).toStrictEqual({ interactive: false });
  });

  it('initial binding actually executes through the supplied client rather than a second client @requirement:REQ-007', async () => {
    const client = selectedClient;
    const peer = (await acquireAgent()).agentClient;
    const actual = rebuild();
    expect(execution.resolve(client)).toStrictEqual({ execution: actual });
    await runMode(actual);
    expect((await client.getHistory()).length).toBeGreaterThan(0);
    expect((await peer.getHistory()).length).toBe(0);
    expect(execution.isCurrent(actual)).toBe(true);
  });

  it('new binding sends actual work to the newly supplied client without mutating the old client history @requirement:REQ-007', async () => {
    const first = selectedClient;
    const previous = rebuild();
    selectedClient = (await acquireAgent()).agentClient;
    const current = rebuild();
    expect(execution.isCurrent(previous)).toBe(false);
    expect(execution.resolve(selectedClient)).toStrictEqual({
      execution: current,
    });
    expect((await first.getHistory()).length).toBe(0);
    await runMode(current);
    expect((await first.getHistory()).length).toBe(0);
    expect((await selectedClient.getHistory()).length).toBeGreaterThan(0);
  });

  async function runMode(actual: SessionExecution): Promise<void> {
    const events = [];
    for await (const event of actual.run(
      'Record physical tool mode',
      new AbortController().signal,
    ))
      events.push(event);
    expect(events.some((event) => event.kind === 'stream')).toBe(true);
    expect(
      events.some(
        (event) =>
          event.kind === 'stream' && event.event.type === AgentEventType.Error,
      ),
    ).toBe(false);
  }
});
