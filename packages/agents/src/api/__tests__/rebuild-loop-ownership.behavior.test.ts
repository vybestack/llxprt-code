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
import { createLoopHolder, rebuildLoop } from '../loop/rebuildLoop.js';
import { AgenticLoop } from '../../core/agenticLoop/AgenticLoop.js';
import { CoreToolScheduler } from '../../core/coreToolScheduler.js';
import { bindSchedulerOwner } from '../../session/assembleSchedulerOwner.js';
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

describe('rebuildLoop @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001 @requirement:REQ-007', () => {
  const credentials = useOwnedCredentials();
  const cleanup: Array<() => void | Promise<void>> = [];
  let directory: string;
  let config: Config;
  let policy: RuntimePolicyOwner;
  let settingsOwner: SessionSettingsOwner;
  let tools: ToolRegistry;
  let holder: ReturnType<typeof createLoopHolder>;
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
    holder = createLoopHolder();
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
    policy = selectedPolicy;
    const store = new SettingsService();
    const owner = new SessionSettingsOwner(store);
    cleanup.push(() => owner.dispose());
    settingsOwner = owner;
    owner.bindTelemetry(selected);
    tools = new ToolRegistry(
      {},
      selectedPolicy.session.messageBus,
      assembleTaskSchemaPolicy(store),
    );
    tools.registerTool(
      new WriteModeTool(
        join(directory, 'actual-mode.json'),
        selectedPolicy.session.messageBus,
      ),
    );
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
  function construct(client: AgentClientContract): AgenticLoop {
    const interactiveMode = config.isInteractive();
    return new AgenticLoop({
      agentClient: client,
      config,
      messageBus: policy.session.messageBus,
      interactiveMode,
      createSchedulerOwner: bindSchedulerOwner(
        config,
        policy.session.messageBus,
        interactiveMode,
        tools,
        (options) => new CoreToolScheduler(options),
        () => settingsOwner.readToolExecutionPolicy(),
        () => settingsOwner.readToolGovernance([]),
        () => config.getApprovalMode(),
        settingsOwner.telemetry,
      ),
    });
  }
  function rebuild(): AgenticLoop {
    return rebuildLoop(holder, () => selectedClient, construct);
  }

  it('initial build constructs a loop bound to the current client and arms a fresh run controller @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001', async () => {
    const client = selectedClient;
    const loop = rebuild();
    expect(loop).toBeInstanceOf(AgenticLoop);
    expect(holder.boundClient).toBe(client);
    expect(holder.current).toBe(loop);
    expect(holder.activeRunController).toBeDefined();
    expect(holder.activeRunController?.signal.aborted).toBe(false);
    expect(holder.subscriptions).toBeUndefined();
  });

  it('rebuild aborts the prior run controller and rebinds to the NEW client @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-007', async () => {
    const first = rebuild();
    const priorController = new AbortController();
    holder.activeRunController = priorController;
    expect(priorController).toBeDefined();
    expect(priorController.signal.aborted).toBe(false);
    const secondClient = (await acquireAgent()).agentClient;
    selectedClient = secondClient;
    const secondLoop = rebuild();
    expect(priorController.signal.aborted).toBe(true);
    expect(holder.activeRunController).not.toBe(priorController);
    expect(holder.activeRunController.signal.aborted).toBe(false);
    expect(secondLoop).not.toBe(first);
    expect(holder.boundClient).toBe(secondClient);
    expect(holder.current).toBe(secondLoop);
  });

  it('rebuild unsubscribes every prior recorded subscription exactly once @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-007', async () => {
    rebuild();
    const order: string[] = [];
    holder.subscriptions = [() => order.push('a'), () => order.push('b')];
    selectedClient = (await acquireAgent()).agentClient;
    rebuild();
    expect(order).toStrictEqual(['a', 'b']);
    expect(holder.subscriptions).toBeUndefined();
    rebuild();
    expect(order).toStrictEqual(['a', 'b']);
  });

  it('a throwing unsubscribe reports cleanup failure after publishing the replacement @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-007', async () => {
    const priorLoop = rebuild();
    const order: string[] = [];
    const primary = new Error('boom');
    holder.subscriptions = [
      () => {
        throw primary;
      },
      () => order.push('after-throw'),
    ];
    selectedClient = (await acquireAgent()).agentClient;
    expect(() => rebuild()).toThrow(AggregateError);
    expect(order).toStrictEqual(['after-throw']);
    expect(holder.current).not.toBe(priorLoop);
    expect(holder.boundClient).toBe(selectedClient);
    expect(holder.current).toBeInstanceOf(AgenticLoop);
    expect(holder.subscriptions).toBeUndefined();
  });

  it('initial build (no prior loop) SKIPS teardown \u2014 does not touch pre-seeded subscriptions @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-007', async () => {
    const order: string[] = [];
    holder.subscriptions = [() => order.push('should-not-run')];
    const loop = rebuild();
    expect(order).toStrictEqual([]);
    expect(loop).toBeInstanceOf(AgenticLoop);
    expect(holder.activeRunController?.signal.aborted).toBe(false);
  });

  it('rebuild with a prior loop but no armed controller tears down safely (optional abort) @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-007', async () => {
    const previous = rebuild();
    Object.assign(holder, { activeRunController: undefined });
    expect(holder.activeRunController).toBeUndefined();
    expect(holder.current).toBeDefined();
    selectedClient = (await acquireAgent()).agentClient;
    const secondLoop = rebuild();
    expect(holder.current).toBe(secondLoop);
    expect(secondLoop).not.toBe(previous);
    expect(holder.activeRunController).toBeDefined();
    expect(holder.activeRunController?.signal.aborted).toBe(false);
  });

  it('rebuild with no recorded subscriptions tears down cleanly (no-op unsubscribe path) @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-007', async () => {
    const previous = rebuild();
    expect(holder.subscriptions).toBeUndefined();
    selectedClient = (await acquireAgent()).agentClient;
    const secondLoop = rebuild();
    expect(secondLoop).not.toBe(previous);
    expect(holder.current).toBe(secondLoop);
  });

  it('threads interactiveMode from config.isInteractive() into the constructed loop (true) @requirement:REQ-007', async () => {
    configureWorkspace(true);
    const loop = rebuild();
    expect(loop).toBeInstanceOf(AgenticLoop);
    await runMode(loop);
    expect(
      JSON.parse(await readFile(join(directory, 'actual-mode.json'), 'utf8')),
    ).toStrictEqual({ interactive: true });
  });

  it('threads interactiveMode from config.isInteractive() into the constructed loop (false when non-interactive) @requirement:REQ-007', async () => {
    configureWorkspace(false);
    const loop = rebuild();
    expect(loop).toBeInstanceOf(AgenticLoop);
    await runMode(loop);
    expect(
      JSON.parse(await readFile(join(directory, 'actual-mode.json'), 'utf8')),
    ).toStrictEqual({ interactive: false });
  });

  it('records the bound client in holder.boundClient on initial build @requirement:REQ-007', async () => {
    const client = selectedClient;
    rebuild();
    expect(holder.boundClient).toBe(client);
  });

  it('updates holder.boundClient to the NEW client on rebuild @requirement:REQ-007', async () => {
    const first = selectedClient;
    rebuild();
    expect(holder.boundClient).toBe(first);
    const second = (await acquireAgent()).agentClient;
    selectedClient = second;
    rebuild();
    expect(holder.boundClient).toBe(second);
  });

  async function runMode(loop: AgenticLoop): Promise<void> {
    const controller = holder.activeRunController;
    if (controller === undefined)
      throw new Error('Missing real run controller');
    const events = [];
    for await (const event of loop.run(
      'Record physical tool mode',
      controller.signal,
    ))
      events.push(event);
    expect(events.some((event) => event.kind === 'stream')).toBe(true);
  }
});
