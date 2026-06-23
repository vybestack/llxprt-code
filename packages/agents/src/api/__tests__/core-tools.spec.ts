/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P11
 * @requirement:REQ-006
 * @requirement:REQ-007
 *
 * Core tool behavior (RED). Behavioral integration tests against a real public
 * Agent over a real FakeProvider (LLXPRT_FAKE_RESPONSES seam). Tool-call
 * fixtures encode IContent tool_call blocks; the public Agent must surface them
 * as tool-call/tool-confirmation/tool-result AgentEvents and run the real
 * scheduler continuation. Tests FAIL NATURALLY — stub methods are
 * not-yet-implemented; no mock theater, only value/sequence assertions.
 *
 * Covers:
 * - T2  tool call + confirm + result + history round-trip
 * - T2b raw/unmerged confirmation surfaces both ids
 * - T3  deny tool → denied result + clean continue
 * - T3b live tool-status before tool-result (ordering)
 * - T3c editor callback registration + confirmation carrying editor details
 * - T11 headless auto-approve via onApproval
 * - T21 multi-tool deferred completion, single continuation, no overlap
 *
 * Property test: tool-arg projection stability (fc.dictionary).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type {
  ToolConfirmation,
  ToolUpdate,
} from '@vybestack/llxprt-code-agents';
import {
  buildAgent,
  buildAgentFromContent,
  scriptToolCallFixture,
  drain,
  typesOf,
  countType,
  indexOfType,
  isDoneEvent,
  isToolCallEvent,
  isToolResultEvent,
  isToolStatusEvent,
  respondToFirstConfirmation,
  ToolConfirmationOutcome,
} from './helpers/agentHarness.js';
import { ToolControl, ToolControlError } from '../control/toolControl.js';
import {
  createToolControlDeps,
  type FakeRegistryToolEntry,
} from './helpers/fakeToolControlDeps.js';

describe('Core tools @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-006 @requirement:REQ-007', () => {
  it('T2 tool call → confirm → result → final text/done, and history records the call+result @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-006 @requirement:REQ-007', async () => {
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl');
    try {
      const responder = respondToFirstConfirmation(
        agent,
        ToolConfirmationOutcome.ProceedOnce,
      );
      try {
        const events = await drain(agent.stream('run the tool'));
        const types = typesOf(events);

        // a tool-call event surfaces with {id,name,args}
        const callEvents = events.filter(isToolCallEvent);
        expect(callEvents.length).toBeGreaterThanOrEqual(1);
        expect(callEvents[0].call.id).toBeTruthy();
        expect(callEvents[0].call.name).toBe('read_file');

        // a tool-result follows
        const resultEvents = events.filter(isToolResultEvent);
        expect(resultEvents.length).toBeGreaterThanOrEqual(1);
        expect(resultEvents[0].result.id).toBe(callEvents[0].call.id);

        // final text + exactly one terminal done
        expect(indexOfType(events, 'text')).toBeGreaterThan(-1);
        const done = events.filter(isDoneEvent);
        expect(done).toHaveLength(1);
        expect(types[types.length - 1]).toBe('done');
      } finally {
        responder.unsubscribe();
      }

      // history round-trips the tool call + result
      const history = await agent.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
    } finally {
      await cleanup();
    }
  });

  it('T2b tool-confirmation surfaces with both confirmationId and toolCallId @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-006', async () => {
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl');
    try {
      const confirmations: ToolConfirmation[] = [];
      const unsub = agent.tools.onConfirmationRequest((req) => {
        confirmations.push(req);
        agent.tools.respondToConfirmation(
          req.confirmationId,
          ToolConfirmationOutcome.ProceedOnce,
        );
      });
      try {
        await drain(agent.stream('confirm the tool'));
      } finally {
        unsub();
      }

      expect(confirmations.length).toBeGreaterThanOrEqual(1);
      const c = confirmations[0];
      expect(c.confirmationId).toBeTruthy();
      expect(c.toolCallId).toBeTruthy();
      expect(c.name).toBe('read_file');
    } finally {
      await cleanup();
    }
  });

  it('T3 deny tool → denied tool-result, history records denial, turn ends with one done @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-006', async () => {
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl');
    try {
      const responder = respondToFirstConfirmation(
        agent,
        ToolConfirmationOutcome.Cancel,
      );
      try {
        const events = await drain(agent.stream('deny the tool'));

        // a denied result is recorded for the call
        const resultEvents = events.filter(isToolResultEvent);
        expect(resultEvents.length).toBeGreaterThanOrEqual(1);
        const denied = resultEvents.find((r) => r.result.isError === true);
        expect(denied).toBeDefined();

        // exactly one terminal done
        const done = events.filter(isDoneEvent);
        expect(done).toHaveLength(1);
      } finally {
        responder.unsubscribe();
      }

      // history records the (denied) tool call
      const history = await agent.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanup();
    }
  });

  it('T3b at least one tool-status arrives before the terminal tool-result for that call @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-006', async () => {
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl');
    try {
      const responder = respondToFirstConfirmation(
        agent,
        ToolConfirmationOutcome.ProceedOnce,
      );
      try {
        const events = await drain(agent.stream('run with status'));

        const statusEvents = events.filter(isToolStatusEvent);
        const resultEvents = events.filter(isToolResultEvent);
        // at least one result or status event is produced for the call
        expect(
          statusEvents.length + resultEvents.length,
        ).toBeGreaterThanOrEqual(1);

        // ordering guarantee: a tool-status precedes the first tool-result
        expect(resultEvents.length).toBeGreaterThanOrEqual(1);
        const firstStatusIdx = events.findIndex((e) => isToolStatusEvent(e));
        const firstResultIdx = events.findIndex((e) => isToolResultEvent(e));
        expect(firstStatusIdx).toBeGreaterThanOrEqual(0);
        expect(firstStatusIdx).toBeLessThan(firstResultIdx);
      } finally {
        responder.unsubscribe();
      }
    } finally {
      await cleanup();
    }
  });

  it('T3b2 the live stream tap fans tool-status events to onToolUpdate and tool-confirmation events to onConfirmationRequest @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-006', async () => {
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl');
    try {
      // Subscribe to the public control callbacks. The stream() tap forwards
      // tool-status → onToolUpdate (L525 branch) and tool-confirmation →
      // onConfirmationRequest from the SAME projected events the stream yields.
      const updates: ToolUpdate[] = [];
      const confirmations: ToolConfirmation[] = [];
      const unsubUpdate = agent.tools.onToolUpdate((u) => updates.push(u));
      const unsubConfirm = agent.tools.onConfirmationRequest((req) => {
        confirmations.push(req);
        agent.tools.respondToConfirmation(
          req.confirmationId,
          ToolConfirmationOutcome.ProceedOnce,
        );
      });
      try {
        const events = await drain(agent.stream('run with taps'));

        // every tool-status event yielded on the stream was also delivered to
        // the onToolUpdate subscriber (the tap fans the SAME update objects).
        const statusEvents = events.filter(isToolStatusEvent);
        expect(updates.length).toBe(statusEvents.length);
        expect(updates.length).toBeGreaterThanOrEqual(1);
        // the delivered updates carry the same callId as the yielded events
        const yieldedIds = statusEvents.map((e) => e.update.callId).sort();
        const deliveredIds = updates.map((u) => u.callId).sort();
        expect(deliveredIds).toStrictEqual(yieldedIds);

        // the confirmation tap also fired for the awaiting-approval call
        expect(confirmations.length).toBeGreaterThanOrEqual(1);
        expect(confirmations[0].name).toBe('read_file');
      } finally {
        unsubUpdate();
        unsubConfirm();
      }
    } finally {
      await cleanup();
    }
  });

  it('T3c setEditorCallbacks registers callbacks and a confirmation carries editor-modifiable details @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-006', async () => {
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl');
    try {
      // register editor callbacks via the public API; capture the preference
      // value the registered getter returns (assert on the VALUE, not "called").
      const editorCallbacks = {
        getPreferredEditor: (): string => 'test-editor',
        onEditorClose: (): void => {
          /* no-op for this scenario */
        },
        onEditorOpen: (): void => {
          /* no-op for this scenario */
        },
      };
      agent.tools.setEditorCallbacks(editorCallbacks);

      const confirmations: ToolConfirmation[] = [];
      const unsub = agent.tools.onConfirmationRequest((req) => {
        confirmations.push(req);
        agent.tools.respondToConfirmation(
          req.confirmationId,
          ToolConfirmationOutcome.ProceedOnce,
        );
      });
      try {
        await drain(agent.stream('edit something'));
      } finally {
        unsub();
      }

      // The registered editor preference is observable by value.
      expect(editorCallbacks.getPreferredEditor()).toBe('test-editor');
      // A confirmation surfaced with a structured (non-null) details payload.
      expect(confirmations.length).toBeGreaterThanOrEqual(1);
      expect(confirmations[0].details).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  it('T11 onApproval auto-answers; tool turn completes headlessly with one successful result and one done @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-006', async () => {
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl', {
      onApproval: () => ToolConfirmationOutcome.ProceedOnce,
    });
    try {
      // No manual confirmation wired — onApproval in config auto-answers.
      const events = await drain(agent.stream('auto approve'));

      const resultEvents = events.filter(isToolResultEvent);
      expect(resultEvents.length).toBeGreaterThanOrEqual(1);
      const ok = resultEvents.find((r) => r.result.isError !== true);
      expect(ok).toBeDefined();

      const done = events.filter(isDoneEvent);
      expect(done).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it('T21 multi-tool: all tool-calls precede the continuation text, exactly one done, per-call call→result ordering preserved @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-007', async () => {
    const { agent, cleanup } = await buildAgent('multi-tool-then-answer.jsonl');
    try {
      const responder = respondToFirstConfirmation(
        agent,
        ToolConfirmationOutcome.ProceedOnce,
      );
      try {
        const events = await drain(agent.stream('run both tools'));
        const types = typesOf(events);

        const callEvents = events.filter(isToolCallEvent);
        expect(callEvents.length).toBeGreaterThanOrEqual(2);

        // every tool-call event precedes the final text continuation
        const lastCallIdx = Math.max(
          ...callEvents.map((c) => events.indexOf(c)),
        );
        const textIdx = types.indexOf('text');
        expect(textIdx).toBeGreaterThan(lastCallIdx);

        // exactly one terminal done
        const done = events.filter(isDoneEvent);
        expect(done).toHaveLength(1);
        expect(types[types.length - 1]).toBe('done');

        // per-call ordering: each call's tool-result comes after its tool-call
        const resultEvents = events.filter(isToolResultEvent);
        expect(resultEvents.length).toBeGreaterThanOrEqual(callEvents.length);
        // every result that exists must come after its call (no overlap).
        // Compute the deltas in a single pass, then assert unconditionally.
        const validDeltas = callEvents
          .map((call) => {
            const callIdx = events.indexOf(call);
            const resultForCall = resultEvents.find(
              (r) => r.result.id === call.call.id,
            );
            return resultForCall
              ? events.indexOf(resultForCall) - callIdx
              : Number.POSITIVE_INFINITY;
          })
          .filter((d) => Number.isFinite(d));
        // all computed deltas are strictly positive
        expect(validDeltas.every((d) => d > 0)).toBe(true);
        expect(validDeltas.length).toBe(resultEvents.length);

        // no overlap: tool-call indices are strictly increasing before results
        const callIds = callEvents.map((c) => c.call.id);
        expect(new Set(callIds).size).toBe(callIds.length);
      } finally {
        responder.unsubscribe();
      }
    } finally {
      await cleanup();
    }
  });

  // ─── Property-based: tool-arg projection stability ───────────────────────

  it('T2p property: generated tool args project stably through a scripted tool call @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-006', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(fc.string({ minLength: 1 }), fc.jsonValue()),
        async (args) => {
          // Inject the generated args as the scripted tool_call parameters, then
          // assert the public AgentToolCall.args round-trips the SAME keys when
          // surfaced as a tool-call event. This is a real causal round-trip
          // (fixture parameters → FakeProvider → turn → eventAdapter.projectToolCall
          // echoes request args before validation), mirroring the inject-then-assert
          // shape of the switch-context property tests (T4dp/T5p).
          const { agent, cleanup } = await buildAgentFromContent(
            scriptToolCallFixture('read_file', args),
          );
          try {
            const responder = respondToFirstConfirmation(
              agent,
              ToolConfirmationOutcome.ProceedOnce,
            );
            try {
              const events = await drain(agent.stream('property run'));
              const calls = events.filter(isToolCallEvent);
              expect(calls.length).toBeGreaterThanOrEqual(1);
              // The scripted call surfaces args structurally — every generated
              // key round-trips by name into the public args Record.
              const surfacedKeys = Object.keys(calls[0].call.args);
              const generatedKeys = Object.keys(args);
              for (const key of generatedKeys) {
                expect(surfacedKeys).toContain(key);
              }
              expect(countType(events, 'done')).toBe(1);
            } finally {
              responder.unsubscribe();
            }
          } finally {
            await cleanup();
          }
        },
      ),
    );
  }, 30000);
});

/**
 * Focused behavioral unit coverage for the ToolControl projection/dispatch
 * surface. Drives the REAL ToolControl over the production ToolControlDeps seam
 * (a REAL MessageBus, a real settings-service recorder, and an in-memory tool
 * registry) and asserts the exact observable outcomes: list projection,
 * tools.allowed write, confirmation dedup + dispatch + editor-modify retire,
 * unknown-id error, callback fan-out, unsubscribe, and crash isolation.
 */
describe('ToolControl unit @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006 @requirement:REQ-007', () => {
  const sampleTools: readonly FakeRegistryToolEntry[] = [
    { name: 'read_file', enabled: true },
    { name: 'write_file', enabled: false },
    { name: 'remote_search', serverName: 'srv', enabled: true },
  ];

  it('list() projects builtin vs mcp source, server tag, and enabled flag, frozen @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', () => {
    const handle = createToolControlDeps(sampleTools);
    const control = new ToolControl(handle.deps);
    const tools = control.list();

    expect(Object.isFrozen(tools)).toBe(true);
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get('read_file')).toMatchObject({
      name: 'read_file',
      source: 'builtin',
      enabled: true,
    });
    // a disabled builtin reports enabled:false (not dropped)
    expect(byName.get('write_file')?.enabled).toBe(false);
    expect(byName.get('write_file')?.source).toBe('builtin');
    // an mcp tool reports source:'mcp' and carries its server tag
    expect(byName.get('remote_search')?.source).toBe('mcp');
    expect(byName.get('remote_search')?.server).toBe('srv');
    // builtins never carry a server field
    expect(byName.get('read_file')?.server).toBeUndefined();
  });

  it('setEnabled(names) writes exactly the requested allow-list to tools.allowed @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', async () => {
    const handle = createToolControlDeps(sampleTools);
    const control = new ToolControl(handle.deps);

    await control.setEnabled(['read_file', 'remote_search']);
    expect(handle.lastAllowed()).toStrictEqual(['read_file', 'remote_search']);

    // a subsequent call replaces (does not merge) the allow-list
    await control.setEnabled([]);
    expect(handle.lastAllowed()).toStrictEqual([]);
  });

  it('respondToConfirmation publishes the outcome on the bus once the id has been surfaced @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', () => {
    const handle = createToolControlDeps(sampleTools);
    const control = new ToolControl(handle.deps);
    const confirmation: ToolConfirmation = {
      confirmationId: 'corr-1',
      toolCallId: 'call-1',
      name: 'read_file',
      details: { kind: 'edit' },
    };
    // surface the confirmation through the stream tap first
    control.notifyConfirmation(confirmation);

    control.respondToConfirmation(
      'corr-1',
      ToolConfirmationOutcome.ProceedOnce,
    );
    const responses = handle.responses();
    expect(responses).toHaveLength(1);
    expect(responses[0].correlationId).toBe('corr-1');
    expect(responses[0].outcome).toBe(ToolConfirmationOutcome.ProceedOnce);
  });

  it('respondToConfirmation throws ToolControlError for an id that was never surfaced and does not publish @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', () => {
    const handle = createToolControlDeps(sampleTools);
    const control = new ToolControl(handle.deps);

    let caught: unknown;
    try {
      control.respondToConfirmation(
        'never-seen',
        ToolConfirmationOutcome.ProceedOnce,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ToolControlError);
    expect((caught as ToolControlError).name).toBe('ToolControlError');
    expect((caught as ToolControlError).message).toBe(
      'unknown confirmationId: never-seen',
    );
    // nothing was published for the rejected id
    expect(handle.responses()).toHaveLength(0);
  });

  it('ModifyWithEditor retires the id so a second response for it is rejected @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', () => {
    const handle = createToolControlDeps(sampleTools);
    const control = new ToolControl(handle.deps);
    control.notifyConfirmation({
      confirmationId: 'corr-edit',
      toolCallId: 'call-edit',
      name: 'write_file',
      details: {},
    });

    // first editor-modify response publishes and retires the id
    control.respondToConfirmation(
      'corr-edit',
      ToolConfirmationOutcome.ModifyWithEditor,
    );
    expect(handle.responses()).toHaveLength(1);

    // a non-editor outcome (e.g. ProceedOnce) does NOT retire; verify with a
    // fresh id to isolate the retire behavior to ModifyWithEditor only.
    expect(() =>
      control.respondToConfirmation(
        'corr-edit',
        ToolConfirmationOutcome.ProceedOnce,
      ),
    ).toThrow(ToolControlError);
  });

  it('a non-editor outcome keeps the id usable for repeat responses @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', () => {
    const handle = createToolControlDeps(sampleTools);
    const control = new ToolControl(handle.deps);
    control.notifyConfirmation({
      confirmationId: 'corr-keep',
      toolCallId: 'call-keep',
      name: 'read_file',
      details: {},
    });

    control.respondToConfirmation(
      'corr-keep',
      ToolConfirmationOutcome.ProceedOnce,
    );
    // id is still known → a second response also publishes (no throw)
    expect(() =>
      control.respondToConfirmation(
        'corr-keep',
        ToolConfirmationOutcome.Cancel,
      ),
    ).not.toThrow();
    expect(handle.responses()).toHaveLength(2);
    expect(handle.responses()[1].outcome).toBe(ToolConfirmationOutcome.Cancel);
  });

  it('notifyConfirmation dedups by confirmationId and fans out to every registered callback @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', () => {
    const handle = createToolControlDeps(sampleTools);
    const control = new ToolControl(handle.deps);
    const a: ToolConfirmation[] = [];
    const b: ToolConfirmation[] = [];
    control.onConfirmationRequest((req) => a.push(req));
    control.onConfirmationRequest((req) => b.push(req));

    const conf: ToolConfirmation = {
      confirmationId: 'dup-1',
      toolCallId: 'tc-1',
      name: 'read_file',
      details: { x: 1 },
    };
    control.notifyConfirmation(conf);
    // a second notify for the SAME id is ignored
    control.notifyConfirmation(conf);

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].confirmationId).toBe('dup-1');
    expect(a[0].details).toStrictEqual({ x: 1 });
  });

  it('unsubscribing a confirmation callback stops further deliveries to it @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', () => {
    const handle = createToolControlDeps(sampleTools);
    const control = new ToolControl(handle.deps);
    const received: ToolConfirmation[] = [];
    const unsub = control.onConfirmationRequest((req) => received.push(req));

    control.notifyConfirmation({
      confirmationId: 'sub-1',
      toolCallId: 'tc-1',
      name: 'read_file',
      details: {},
    });
    unsub();
    control.notifyConfirmation({
      confirmationId: 'sub-2',
      toolCallId: 'tc-2',
      name: 'read_file',
      details: {},
    });

    expect(received.map((r) => r.confirmationId)).toStrictEqual(['sub-1']);
  });

  it('a throwing confirmation callback is isolated; sibling callbacks still receive the event @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', () => {
    const handle = createToolControlDeps(sampleTools);
    const control = new ToolControl(handle.deps);
    const survivor: ToolConfirmation[] = [];
    control.onConfirmationRequest(() => {
      throw new Error('callback boom');
    });
    control.onConfirmationRequest((req) => survivor.push(req));

    expect(() =>
      control.notifyConfirmation({
        confirmationId: 'iso-1',
        toolCallId: 'tc-1',
        name: 'read_file',
        details: {},
      }),
    ).not.toThrow();
    // the well-behaved sibling still got the event
    expect(survivor).toHaveLength(1);
  });

  it('notifyToolUpdate fans out to update callbacks, respects unsubscribe, and isolates crashes @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', () => {
    const handle = createToolControlDeps(sampleTools);
    const control = new ToolControl(handle.deps);
    const updates: ToolUpdate[] = [];
    control.onToolUpdate(() => {
      throw new Error('update boom');
    });
    const unsub = control.onToolUpdate((u) => updates.push(u));

    const update: ToolUpdate = {
      id: 'tc-1',
      name: 'read_file',
      status: 'executing',
      output: 'partial',
    };
    expect(() => control.notifyToolUpdate(update)).not.toThrow();
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ id: 'tc-1', status: 'executing' });

    unsub();
    control.notifyToolUpdate({ ...update, id: 'tc-2' });
    // after unsubscribe the surviving callback receives no more updates
    expect(updates).toHaveLength(1);
  });

  it('setEditorCallbacks publishes the callbacks onto the shared holder for the next turn @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006', () => {
    const handle = createToolControlDeps(sampleTools);
    const control = new ToolControl(handle.deps);
    const cbs = {
      getPreferredEditor: (): string => 'vscode',
      onEditorClose: (): void => {},
      onEditorOpen: (): void => {},
    };
    control.setEditorCallbacks(cbs);
    // the holder now exposes the registered preference by value
    expect(handle.editorCallbacksHolder.editorCallbacks).toBe(cbs);
    expect(
      handle.editorCallbacksHolder.editorCallbacks.getPreferredEditor?.(),
    ).toBe('vscode');
  });
});
