/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { act } from 'react';
import { renderHook, cleanup } from '../../__tests__/render.js';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import {
  type CompletedToolCall,
  type ToolCallRequestInfo,
  type IContent,
  PolicyDecision,
} from '@vybestack/llxprt-code-core';
import { buildCliStyleConfig } from '../../../../agents/src/api/__tests__/helpers/buildCliStyleConfig.js';
import { FakeProvider } from '../../../../providers/src/fake/FakeProvider.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { useAgentEventStream } from './agentStream/useAgentEventStream.js';
import {
  useScheduler,
  type SchedulerRefs,
} from '../../runtime/interactiveToolScheduler.js';
import { useReactToolScheduler } from './useReactToolScheduler.js';

function gate() {
  let release = (): void => {
    throw new Error('Uninitialized gate');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('Agent-owned CLI client tools', () => {
  const noop = (): void => {};
  const built: Array<Awaited<ReturnType<typeof buildCliStyleConfig>>> = [];
  const agents: Agent[] = [];
  const releases: Array<() => void> = [];
  const previousFake = process.env.LLXPRT_FAKE_RESPONSES;
  afterEach(async () => {
    cleanup();
    releases.splice(0).forEach((release) => release());
    await Promise.all(agents.splice(0).map((agent) => agent.dispose()));
    for (const owner of built.splice(0)) {
      await owner.config.dispose();
      await owner.cleanup();
    }
    if (previousFake === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousFake;
  });

  async function owner(
    name: string,
    decision = PolicyDecision.ALLOW,
    awaitReady = true,
  ) {
    const config = await buildCliStyleConfig('plain-text.jsonl', {
      sessionId: 'client-tool-equal-label',
      folderTrust: true,
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    built.push(config);
    config.policyOwner.session.confirmation.addRule({
      toolName: 'external_record',
      decision,
      priority: 1000,
    });
    const entered = gate();
    const finish = gate();
    releases.push(finish.release);
    const effects: string[] = [];
    const record = new MockTool({
      name: 'external_record',
      shouldConfirmExecute: async () => ({
        type: 'info',
        title: name,
        prompt: name,
        onConfirm: async () => {},
      }),
      execute: async () => {
        effects.push(name);
        entered.release();
        await finish.promise;
        return {
          llmContent: `${name} result`,
          returnDisplay: `${name} display`,
        };
      },
    });
    const agent = await fromConfig({
      settingsService: config.settingsService,
      prepareSessionTools: (_config, _bus, tools) => tools.registerTool(record),
      agentClient: config.agentClient,
      providerManager: config.providerManager,
      config: config.config,
      messageBus: config.messageBus,
      mcpRuntime: config.mcpRuntime,
    });
    agents.push(agent);
    await agent.agentClient.startChat();
    const runtime = {
      scheduler: {},
      session: { getSessionId: () => config.config.getSessionId() },
      agent,
    };
    const completed: CompletedToolCall[][] = [];
    const hook = renderHook(() =>
      useReactToolScheduler(
        (_id, calls) => {
          completed.push(calls);
        },
        runtime,
        noop,
        () => undefined,
        noop,
      ),
    );
    if (awaitReady)
      await waitFor(() => expect(hook.result.current[5]).toBe(true));
    else hook.unmount();
    return {
      ...config,
      agent,
      hook,
      entered,
      finish,
      effects,
      completed,
      record,
    };
  }

  function request(callId: string): ToolCallRequestInfo {
    return {
      callId,
      name: 'external_record',
      args: {},
      isClientInitiated: true,
      prompt_id: callId,
    };
  }

  it('executes client requests once through each real Agent and keeps the equal-label survivor alive', async () => {
    const a = await owner('alpha');
    const b = await owner('beta');
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = a.hook.result.current[1](
        request('a'),
        new AbortController().signal,
      );
      second = b.hook.result.current[1](
        request('b'),
        new AbortController().signal,
      );
    });
    await Promise.all([a.entered.promise, b.entered.promise]);
    expect(a.effects).toStrictEqual(['alpha']);
    expect(b.effects).toStrictEqual(['beta']);
    await waitFor(() =>
      expect(
        a.hook.result.current[0].map((call) => call.request.callId),
      ).toStrictEqual(['a']),
    );
    expect(
      b.hook.result.current[0].map((call) => call.request.callId),
    ).toStrictEqual(['b']);
    a.hook.unmount();
    let disposed = false;
    const disposal = a.agent.dispose().then(() => {
      disposed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(disposed).toBe(false);
    a.finish.release();
    await disposal;
    await first;
    b.finish.release();
    await act(async () => {
      await second;
    });
    expect(
      b.completed.flat().map((call) => [call.request.callId, call.status]),
    ).toStrictEqual([['b', 'success']]);
    await act(async () => {
      await b.hook.result.current[1](
        request('b2'),
        new AbortController().signal,
      );
    });
    expect(b.effects).toStrictEqual(['beta', 'beta']);
    expect(b.completed.flat().map((call) => call.request.callId)).toStrictEqual(
      ['b', 'b2'],
    );
  }, 30_000);

  it('keeps execution completion fixed when rendering observers detach during work', async () => {
    const a = await owner('alpha');
    const completed: CompletedToolCall[][] = [];
    const channel = a.agent.tools.openClientChannel((calls) => {
      completed.push(calls);
    });
    const displayed: CompletedToolCall[][] = [];
    const detach = channel.subscribe({
      onAllToolCallsComplete: (calls) => {
        displayed.push(calls);
      },
    });
    const scheduled = channel.schedule(
      request('stable'),
      new AbortController().signal,
    );
    await a.entered.promise;
    detach();
    a.finish.release();
    await scheduled;
    expect(completed.flat().map((call) => call.request.callId)).toStrictEqual([
      'stable',
    ]);
    expect(displayed).toStrictEqual([]);
    const responses = (await a.agent.getHistory())
      .flatMap((message) => message.blocks)
      .filter((block) => block.type === 'tool_response');
    expect(responses.map((response) => response.callId)).toStrictEqual([
      'stable',
    ]);
    await channel.release();
  }, 30_000);

  it('releases a channel before asynchronous creation without affecting its same-label peer', async () => {
    const a = await owner('alpha');
    const b = await owner('beta');
    const channel = a.agent.tools.openClientChannel();
    const ready = channel.ready.catch((error: unknown) => error);
    await channel.release();
    expect(await ready).toBeInstanceOf(Error);
    b.finish.release();
    await act(async () => {
      await b.hook.result.current[1](
        request('survivor'),
        new AbortController().signal,
      );
    });
    expect(b.effects).toStrictEqual(['beta']);
    expect(a.effects).toStrictEqual([]);
  }, 30_000);

  it('keeps policy denial local to its Agent', async () => {
    const a = await owner('denied', PolicyDecision.DENY);
    const b = await owner('allowed');
    b.finish.release();
    await act(async () => {
      await a.hook.result.current[1](
        request('denied'),
        new AbortController().signal,
      );
      await b.hook.result.current[1](
        request('allowed'),
        new AbortController().signal,
      );
    });
    expect(a.effects).toStrictEqual([]);
    expect(a.completed.flat().map((call) => call.status)).toStrictEqual([
      'error',
    ]);
    expect(b.effects).toStrictEqual(['allowed']);
    expect(b.completed.flat().map((call) => call.status)).toStrictEqual([
      'success',
    ]);
  }, 30_000);

  it('routes equal-call-id confirmations to their own bus', async () => {
    const a = await owner('alpha', PolicyDecision.ASK_USER);
    const b = await owner('beta', PolicyDecision.ASK_USER);
    act(() => {
      void a.hook.result.current[1](
        request('same-id'),
        new AbortController().signal,
      );
      void b.hook.result.current[1](
        request('same-id'),
        new AbortController().signal,
      );
    });
    await waitFor(() => {
      expect(a.hook.result.current[0][0]?.status).toBe('awaiting_approval');
      expect(b.hook.result.current[0][0]?.status).toBe('awaiting_approval');
    });
    const approval = a.hook.result.current[0][0];
    if (
      approval.status !== 'awaiting_approval' ||
      !('onConfirm' in approval.confirmationDetails)
    )
      throw new Error('Missing confirmation');
    const approve = approval.confirmationDetails.onConfirm;
    a.finish.release();
    await act(async () => {
      await approve(ToolConfirmationOutcome.ProceedOnce);
    });
    await waitFor(() => expect(a.completed).toHaveLength(1));
    expect(a.effects).toStrictEqual(['alpha']);
    expect(b.effects).toStrictEqual([]);
    expect(b.hook.result.current[0][0]?.status).toBe('awaiting_approval');
    const denial = b.hook.result.current[0][0];
    if (
      denial.status !== 'awaiting_approval' ||
      !('onConfirm' in denial.confirmationDetails)
    )
      throw new Error('Missing second confirmation');
    const deny = denial.confirmationDetails.onConfirm;
    await act(async () => {
      await deny(ToolConfirmationOutcome.Cancel);
    });
    await waitFor(() => expect(b.completed).toHaveLength(1));
    expect(b.completed[0]?.[0]?.status).toBe('cancelled');
  }, 30_000);

  it('joins an in-flight completion callback after observers detach', async () => {
    const a = await owner('alpha');
    const entered = gate();
    const finish = gate();
    releases.push(finish.release);
    const completed: string[] = [];
    const channel = a.agent.tools.openClientChannel(async (calls) => {
      completed.push(...calls.map((call) => call.request.callId));
      entered.release();
      await finish.promise;
    });
    const scheduled = channel.schedule(
      request('callback'),
      new AbortController().signal,
    );
    await a.entered.promise;
    a.finish.release();
    await entered.promise;
    let released = false;
    const release = channel.release().then(() => {
      released = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(released).toBe(false);
    finish.release();
    await Promise.all([release, scheduled]);
    expect(completed).toStrictEqual(['callback']);
  }, 30_000);

  it('unmounts a UI tree during channel creation without cancelling the other tree', async () => {
    const b = await owner('beta');
    const a = await owner('alpha', PolicyDecision.ALLOW, false);
    a.hook.unmount();
    await a.agent.dispose();
    b.finish.release();
    await act(async () => {
      await b.hook.result.current[1](
        request('after-unmount'),
        new AbortController().signal,
      );
    });
    expect(a.effects).toStrictEqual([]);
    expect(b.effects).toStrictEqual(['beta']);
    expect(b.completed.flat().map((call) => call.request.callId)).toStrictEqual(
      ['after-unmount'],
    );
  }, 30_000);

  it('renders real model tools without rescheduling them through the client channel', async () => {
    const a = await owner('model');
    let provider: unknown = a.agent.providerManager.getProviderByName('fake');
    while (
      typeof provider === 'object' &&
      provider !== null &&
      'wrappedProvider' in provider
    )
      provider = provider.wrappedProvider;
    if (!(provider instanceof FakeProvider))
      throw new Error('Expected external fake provider');
    let turns = 0;
    const model = spyOn(provider, 'generateChatCompletion').mockImplementation(
      async function* (): AsyncIterableIterator<IContent> {
        turns++;
        yield turns === 1
          ? {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: 'model-call',
                  name: 'external_record',
                  parameters: {},
                },
              ],
            }
          : { speaker: 'ai', blocks: [{ type: 'text', text: 'Finished' }] };
      },
    );
    const display: unknown[] = [];
    const stream = renderHook(() =>
      useAgentEventStream({
        agent: a.agent,
        addItem: (item) => {
          display.push(item);
          return display.length;
        },
        processAgentEventRef: { current: null },
        flushPendingHistoryItem: noop,
        clearPendingHistoryItem: noop,
        performMemoryRefresh: async () => {},
        onToolCallsUpdate: a.hook.result.current[6],
        outputUpdateHandler: a.hook.result.current[7],
      }),
    );
    try {
      const running = stream.result.current.runStream(
        'Read the external record',
        new AbortController().signal,
        'model-prompt',
      );
      await a.entered.promise;
      await waitFor(() =>
        expect(a.hook.result.current[0][0]?.request.callId).toBe('model-call'),
      );
      a.finish.release();
      await act(async () => {
        await running;
      });
      expect(a.effects).toStrictEqual(['model']);
      expect(a.completed).toStrictEqual([]);
      expect(JSON.stringify(display)).toContain('model-call');
      expect(turns).toBe(2);
    } finally {
      model.mockRestore();
      stream.unmount();
    }
  }, 30_000);
  it('detaches rendering while joining a pending renderer callback', async () => {
    const a = await owner('alpha');
    const entered = gate();
    const finish = gate();
    releases.push(finish.release);
    const updates: string[][] = [];
    const refs: SchedulerRefs = {
      updateToolCallOutput: noop,
      replaceToolCallsForScheduler: (_id, calls) => {
        updates.push(calls.map((call) => call.request.callId));
      },
      onCompleteRef: {
        current: async () => {
          entered.release();
          await finish.promise;
        },
      },
      getPreferredEditorRef: { current: () => undefined },
      onEditorOpenRef: { current: noop },
      onEditorCloseRef: { current: noop },
      setLastToolOutputTime: noop,
    };
    const id = Symbol('pending-renderer');
    const pending = { current: [] };
    const renderer = renderHook(() => useScheduler(a.agent, id, refs, pending));
    await waitFor(() => expect(renderer.result.current).not.toBeNull());
    const handle = renderer.result.current;
    if (handle === null) throw new Error('Missing client channel');
    const scheduled = handle.schedule(
      request('pending-renderer'),
      new AbortController().signal,
    );
    await a.entered.promise;
    a.finish.release();
    await entered.promise;
    renderer.unmount();
    const before = [...updates];
    let disposed = false;
    const disposal = a.agent.dispose().then(() => {
      disposed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(disposed).toBe(false);
    finish.release();
    await Promise.all([disposal, scheduled]);
    expect(updates).toStrictEqual(before);
  }, 30_000);

  it('cancels only its client channel and leaves borrowed Config and bus reusable', async () => {
    const a = await owner('alpha');
    const b = await owner('beta');
    const first = a.hook.result.current[1](
      request('cancelled'),
      new AbortController().signal,
    );
    await a.entered.promise;
    act(() => a.hook.result.current[3]());
    await waitFor(() =>
      expect(a.completed.flat().map((call) => call.status)).toStrictEqual([
        'cancelled',
      ]),
    );
    a.finish.release();
    await first;
    await a.agent.dispose();
    const adopted = await fromConfig({
      settingsService: a.settingsService,
      prepareSessionTools: (_config, _bus, tools) =>
        tools.registerTool(a.record),
      agentClient: a.agentClient,
      providerManager: a.providerManager,
      config: a.config,
      messageBus: a.messageBus,
      mcpRuntime: a.mcpRuntime,
    });
    agents.push(adopted);
    const completed: CompletedToolCall[][] = [];
    const channel = adopted.tools.openClientChannel((calls) => {
      completed.push(calls);
    });
    await channel.schedule(
      request('borrowed-resources'),
      new AbortController().signal,
    );
    expect(completed.flat().map((call) => call.status)).toStrictEqual([
      'success',
    ]);
    expect(a.effects).toStrictEqual(['alpha', 'alpha']);
    b.finish.release();
    await act(async () => {
      await b.hook.result.current[1](
        request('peer'),
        new AbortController().signal,
      );
    });
    expect(b.completed.flat().map((call) => call.request.callId)).toStrictEqual(
      ['peer'],
    );
    await channel.release();
  }, 30_000);
});
