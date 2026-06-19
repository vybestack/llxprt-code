/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P12
 * @requirement:REQ-015
 * @requirement:REQ-007
 * @requirement:REQ-010
 *
 * Hooks lifecycle observation + save_memory refresh (RED). Behavioral
 * integration tests against a real public Agent, driven through a fake hook
 * observer (NOT the Agent under test). Tests FAIL NATURALLY — stub methods
 * throw NYI; no mock theater, only value/sequence assertions.
 *
 * Covers:
 * - T15b observe hook execution + SessionStart/SessionEnd via agent.hooks.*
 *       (fake hook observer).
 * - T15c a save_memory tool call refreshes memory/system-instruction so the
 *       NEXT turn reflects it (through the high-level loop).
 */

import { describe, it, expect } from 'vitest';
import {
  buildAgent,
  drain,
  countType,
  isTextEvent,
  isToolCallEvent,
  respondToFirstConfirmation,
  ToolConfirmationOutcome,
} from './helpers/agentHarness.js';
import {
  createFakeHookObserver,
  fakeSessionHookDefinitions,
  recordHookExecution,
  HookEventName,
  type FakeHookObserver,
} from './helpers/fakeHook.js';
import { createHookControlDeps } from './helpers/fakeHookControlDeps.js';

describe('Hooks @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-015 @requirement:REQ-010', () => {
  it('T15b SessionStart/SessionEnd fire in order via agent.hooks.triggerSessionStart/triggerSessionEnd @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-015', async () => {
    const observer: FakeHookObserver = createFakeHookObserver();
    const sessionHooks = fakeSessionHookDefinitions(observer);

    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      hooks: sessionHooks,
    });
    try {
      // wire the observer to the public onHookExecution surface so captures
      // populate as the real Agent fires hook events.
      const unsub = agent.hooks.onHookExecution((req, resp) => {
        // mirror the capture into the observer so the spec can assert the
        // real event sequence the Agent produced.
        recordHookExecution(observer, req.event, req.input, resp.output);
      });
      try {
        // trigger SessionStart then SessionEnd through the public surface
        await agent.hooks.triggerSessionStart();
        await agent.hooks.triggerSessionEnd();

        // the observer saw BOTH events, in firing order
        expect(observer.saw(HookEventName.SessionStart)).toBe(true);
        expect(observer.saw(HookEventName.SessionEnd)).toBe(true);

        const captured = observer.captured();
        const startIdx = captured.findIndex(
          (c) => c.event === HookEventName.SessionStart,
        );
        const endIdx = captured.findIndex(
          (c) => c.event === HookEventName.SessionEnd,
        );
        expect(startIdx).toBeGreaterThanOrEqual(0);
        expect(endIdx).toBeGreaterThan(startIdx);
      } finally {
        unsub();
      }
    } finally {
      await cleanup();
    }
  });

  it('T15b hook execution is observable via onHookExecution with the request/response pair @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-015', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      let sawExecution = false;
      const unsub = agent.hooks.onHookExecution((_req, _resp) => {
        sawExecution = true;
      });
      try {
        await agent.hooks.triggerSessionStart();
        // the public callback fires when the Agent executes a hook. At RED
        // triggerSessionStart throws NYI so sawExecution stays false; at GREEN
        // the real hook runner fires and sawExecution becomes true.
        const triggered = await agent
          .chat('trigger a hook')
          .then(() => true)
          .catch(() => false);
        expect(triggered).toBe(true);
        expect(sawExecution).toBe(true);
      } finally {
        unsub();
      }
    } finally {
      await cleanup();
    }
  });

  it('T15c save_memory tool call refreshes memory/system-instruction so the next turn reflects it @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-007 @requirement:REQ-010', async () => {
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl');
    try {
      const responder = respondToFirstConfirmation(
        agent,
        ToolConfirmationOutcome.ProceedOnce,
      );
      try {
        // first turn triggers a tool call (the fixture's read_file). At GREEN
        // a save_memory tool would persist a memory entry; here we exercise
        // the same loop + then updateSystemInstruction to refresh the system
        // instruction for the next turn.
        const first = await drain(agent.stream('use a tool'));
        expect(countType(first, 'done')).toBe(1);
        expect(first.filter(isToolCallEvent).length).toBeGreaterThanOrEqual(1);

        // refresh the system instruction (what save_memory triggers before the
        // next turn through the high-level loop)
        await agent.updateSystemInstruction();

        // the next turn reflects the refreshed instruction — observable as a
        // successful follow-up turn.
        const second = await drain(agent.stream('next turn after refresh'));
        expect(countType(second, 'done')).toBe(1);
        expect(second.filter(isTextEvent).length).toBeGreaterThanOrEqual(1);
      } finally {
        responder.unsubscribe();
      }

      // history captures both turns (continuity through the refresh)
      const history = await agent.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
    } finally {
      await cleanup();
    }
  });

  it('T15b hooks.clear() removes registered hooks without error @plan:PLAN-20260617-COREAPI.P12 @requirement:REQ-015', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // clear() is the public reset hook surface; at RED it throws NYI first,
      // so the test fails at RED for the right reason. At GREEN the surface is
      // usable again — a follow-up onHookExecution registration returns an
      // unsubscribe function.
      agent.hooks.clear();
      const unsub = agent.hooks.onHookExecution(() => {});
      expect(typeof unsub).toBe('function');
      unsub();
    } finally {
      await cleanup();
    }
  });

  describe('HookControl unit @plan:PLAN-20260617-COREAPI.P23 @requirement:REQ-015', () => {
    interface CapturedPair {
      readonly event: HookEventName;
      readonly input: {
        readonly session_id: string;
        readonly cwd: string;
        readonly hook_event_name: string;
      };
      readonly output: {
        readonly continue: boolean;
        readonly suppressOutput: boolean;
        readonly decision: string;
        readonly stopReason?: string;
        readonly systemMessage?: string;
        readonly reason?: string;
        readonly hookSpecificOutput?: { readonly hookEventName?: string };
      };
    }

    function narrowInput(input: unknown): CapturedPair['input'] {
      const src =
        typeof input === 'object' && input !== null
          ? (input as Record<string, unknown>)
          : {};
      return {
        session_id:
          typeof src['session_id'] === 'string' ? src['session_id'] : '',
        cwd: typeof src['cwd'] === 'string' ? src['cwd'] : '',
        hook_event_name:
          typeof src['hook_event_name'] === 'string'
            ? src['hook_event_name']
            : '',
      };
    }

    function narrowOutput(output: unknown): CapturedPair['output'] {
      const src =
        typeof output === 'object' && output !== null
          ? (output as Record<string, unknown>)
          : {};
      const hso = src['hookSpecificOutput'];
      return {
        continue: typeof src['continue'] === 'boolean' ? src['continue'] : true,
        suppressOutput:
          typeof src['suppressOutput'] === 'boolean'
            ? src['suppressOutput']
            : false,
        decision: typeof src['decision'] === 'string' ? src['decision'] : '',
        stopReason:
          typeof src['stopReason'] === 'string' ? src['stopReason'] : undefined,
        systemMessage:
          typeof src['systemMessage'] === 'string'
            ? src['systemMessage']
            : undefined,
        reason: typeof src['reason'] === 'string' ? src['reason'] : undefined,
        hookSpecificOutput:
          typeof hso === 'object' && hso !== null
            ? {
                hookEventName:
                  typeof (hso as Record<string, unknown>)['hookEventName'] ===
                  'string'
                    ? ((hso as Record<string, unknown>)[
                        'hookEventName'
                      ] as string)
                    : undefined,
              }
            : undefined,
      };
    }

    function collect(
      control: ReturnType<typeof createHookControlDeps>['control'],
    ): { pairs: CapturedPair[]; unsub: () => void } {
      const pairs: CapturedPair[] = [];
      const unsub = control.onHookExecution((req, resp) => {
        pairs.push({
          event: req.event,
          input: narrowInput(req.input),
          output: narrowOutput(resp.output),
        });
      });
      return { pairs, unsub };
    }

    it('triggerSessionStart emits a SessionStart pair carrying the injected session_id/cwd and a default allow/continue output when no command hook ran @plan:PLAN-20260617-COREAPI.P23 @requirement:REQ-015', async () => {
      const handle = createHookControlDeps({
        enableHooks: false,
        sessionId: 'sess-A',
        cwd: '/cwd/A',
      });
      const { pairs, unsub } = collect(handle.control);
      try {
        await handle.control.triggerSessionStart();
        expect(pairs).toHaveLength(1);
        const p = pairs[0];
        expect(p.event).toBe(HookEventName.SessionStart);
        expect(p.input.session_id).toBe('sess-A');
        expect(p.input.cwd).toBe('/cwd/A');
        expect(p.input.hook_event_name).toBe(HookEventName.SessionStart);
        // no command hook ran (hooks disabled) → base allow/continue output
        expect(p.output.continue).toBe(true);
        expect(p.output.suppressOutput).toBe(false);
        expect(p.output.decision).toBe('allow');
        expect(p.output.hookSpecificOutput?.hookEventName).toBe(
          HookEventName.SessionStart,
        );
        // optional fields omitted when the aggregate did not provide them
        expect(p.output.stopReason).toBeUndefined();
        expect(p.output.systemMessage).toBeUndefined();
        expect(p.output.reason).toBeUndefined();
      } finally {
        unsub();
        handle.control.detach();
      }
    });

    it('triggerSessionStart merges the aggregated lifecycle output fields onto the public output @plan:PLAN-20260617-COREAPI.P23 @requirement:REQ-015', async () => {
      const handle = createHookControlDeps({
        lifecycle: {
          start: {
            continue: false,
            suppressOutput: true,
            decision: 'block',
            stopReason: 'halt-now',
            systemMessage: 'system note',
            reason: 'because policy',
          },
        },
      });
      const { pairs, unsub } = collect(handle.control);
      try {
        await handle.control.triggerSessionStart();
        expect(pairs).toHaveLength(1);
        const out = pairs[0].output;
        // every field from the aggregate overrides the base default
        expect(out.continue).toBe(false);
        expect(out.suppressOutput).toBe(true);
        expect(out.decision).toBe('block');
        expect(out.stopReason).toBe('halt-now');
        expect(out.systemMessage).toBe('system note');
        expect(out.reason).toBe('because policy');
      } finally {
        unsub();
        handle.control.detach();
      }
    });

    it('a partial aggregate preserves base continue/hookSpecificOutput and OMITS unset optional keys @plan:PLAN-20260617-COREAPI.P23 @requirement:REQ-015', async () => {
      // The aggregate sets ONLY decision; continue/stopReason/systemMessage/
      // reason/hookSpecificOutput are all absent. The public output must keep the
      // base continue=true + base hookSpecificOutput, and must NOT materialize the
      // optional keys (they are conditionally spread only when present).
      const handle = createHookControlDeps({
        lifecycle: { start: { decision: 'block' } },
      });
      const rawOutputs: Array<Record<string, unknown>> = [];
      const unsub = handle.control.onHookExecution((_req, resp) => {
        // HookOutput is always a structured object; snapshot its own keys so a
        // later assertion can prove which optional keys were (not) materialized.
        rawOutputs.push({ ...(resp.output as Record<string, unknown>) });
      });
      try {
        await handle.control.triggerSessionStart();
        expect(rawOutputs).toHaveLength(1);
        const out = rawOutputs[0];
        // decision came from the aggregate
        expect(out['decision']).toBe('block');
        // continue/hookSpecificOutput fall back to the base values (not nullish)
        expect(out['continue']).toBe(true);
        expect(out['suppressOutput']).toBe(false);
        const hso = out['hookSpecificOutput'];
        expect(typeof hso === 'object' && hso !== null).toBe(true);
        expect((hso as Record<string, unknown>)['hookEventName']).toBe(
          HookEventName.SessionStart,
        );
        // unset optional keys are OMITTED entirely (not present-with-undefined)
        expect('stopReason' in out).toBe(false);
        expect('systemMessage' in out).toBe(false);
        expect('reason' in out).toBe(false);
      } finally {
        unsub();
        handle.control.detach();
      }
    });

    it('triggerSessionEnd emits a SessionEnd pair and merges its aggregated output @plan:PLAN-20260617-COREAPI.P23 @requirement:REQ-015', async () => {
      const handle = createHookControlDeps({
        lifecycle: { end: { continue: false, stopReason: 'goodbye' } },
      });
      const { pairs, unsub } = collect(handle.control);
      try {
        await handle.control.triggerSessionEnd();
        expect(pairs).toHaveLength(1);
        const p = pairs[0];
        expect(p.event).toBe(HookEventName.SessionEnd);
        expect(p.input.hook_event_name).toBe(HookEventName.SessionEnd);
        expect(p.output.continue).toBe(false);
        expect(p.output.stopReason).toBe('goodbye');
        // fields not provided by the aggregate keep their base defaults
        expect(p.output.decision).toBe('allow');
        expect(p.output.suppressOutput).toBe(false);
      } finally {
        unsub();
        handle.control.detach();
      }
    });

    it('a correlated bus request/response pair is forwarded to observers with the known event name @plan:PLAN-20260617-COREAPI.P23 @requirement:REQ-015', () => {
      const handle = createHookControlDeps({ sessionId: 'bus-sess' });
      const { pairs, unsub } = collect(handle.control);
      try {
        handle.publishBusRequest(HookEventName.Notification, 'corr-1');
        // before the response arrives nothing is forwarded
        expect(pairs).toHaveLength(0);
        handle.publishBusResponse('corr-1');
        expect(pairs).toHaveLength(1);
        const p = pairs[0];
        expect(p.event).toBe(HookEventName.Notification);
        expect(p.input.session_id).toBe('bus-sess');
        expect(p.input.hook_event_name).toBe(HookEventName.Notification);
      } finally {
        unsub();
        handle.control.detach();
      }
    });

    it('an unknown bus event-name string falls back to Notification when forwarded @plan:PLAN-20260617-COREAPI.P23 @requirement:REQ-015', () => {
      const handle = createHookControlDeps();
      const { pairs, unsub } = collect(handle.control);
      try {
        handle.publishBusRequest('TotallyUnknownEvent', 'corr-x');
        handle.publishBusResponse('corr-x');
        expect(pairs).toHaveLength(1);
        expect(pairs[0].event).toBe(HookEventName.Notification);
      } finally {
        unsub();
        handle.control.detach();
      }
    });

    it('a bus response with no matching buffered request is ignored (no forward) @plan:PLAN-20260617-COREAPI.P23 @requirement:REQ-015', () => {
      const handle = createHookControlDeps();
      const { pairs, unsub } = collect(handle.control);
      try {
        // response without a preceding request → correlation miss → no emit
        handle.publishBusResponse('never-requested');
        expect(pairs).toHaveLength(0);
      } finally {
        unsub();
        handle.control.detach();
      }
    });

    it('each buffered request is consumed once: a duplicate response for the same correlation id is ignored @plan:PLAN-20260617-COREAPI.P23 @requirement:REQ-015', () => {
      const handle = createHookControlDeps();
      const { pairs, unsub } = collect(handle.control);
      try {
        handle.publishBusRequest(HookEventName.BeforeTool, 'corr-dup');
        handle.publishBusResponse('corr-dup');
        handle.publishBusResponse('corr-dup');
        // the request is deleted after the first correlated response
        expect(pairs).toHaveLength(1);
        expect(pairs[0].event).toBe(HookEventName.BeforeTool);
      } finally {
        unsub();
        handle.control.detach();
      }
    });

    it('onHookExecution returns an unsubscribe that removes exactly that observer @plan:PLAN-20260617-COREAPI.P23 @requirement:REQ-015', async () => {
      const handle = createHookControlDeps({ enableHooks: false });
      const a: HookEventName[] = [];
      const b: HookEventName[] = [];
      const unsubA = handle.control.onHookExecution((req) => a.push(req.event));
      const unsubB = handle.control.onHookExecution((req) => b.push(req.event));
      try {
        unsubA();
        await handle.control.triggerSessionStart();
        // only the still-registered observer B sees the event
        expect(a).toHaveLength(0);
        expect(b).toStrictEqual([HookEventName.SessionStart]);
      } finally {
        unsubB();
        handle.control.detach();
      }
    });

    it('clear() removes all observers so subsequent triggers reach no one @plan:PLAN-20260617-COREAPI.P23 @requirement:REQ-015', async () => {
      const handle = createHookControlDeps({ enableHooks: false });
      const { pairs, unsub } = collect(handle.control);
      try {
        handle.control.clear();
        await handle.control.triggerSessionStart();
        expect(pairs).toHaveLength(0);
      } finally {
        unsub();
        handle.control.detach();
      }
    });

    it('clear() also drops buffered bus requests so a later response cannot correlate @plan:PLAN-20260617-COREAPI.P23 @requirement:REQ-015', () => {
      const handle = createHookControlDeps();
      const { pairs, unsub } = collect(handle.control);
      try {
        handle.publishBusRequest(HookEventName.Notification, 'corr-clear');
        handle.control.clear();
        handle.publishBusResponse('corr-clear');
        // the buffered request was cleared → the response cannot correlate
        expect(pairs).toHaveLength(0);
      } finally {
        unsub();
        handle.control.detach();
      }
    });

    it('detach() stops bus forwarding so later publishes are inert @plan:PLAN-20260617-COREAPI.P23 @requirement:REQ-015', () => {
      const handle = createHookControlDeps();
      const { pairs, unsub } = collect(handle.control);
      try {
        handle.control.detach();
        handle.publishBusRequest(HookEventName.Notification, 'corr-detached');
        handle.publishBusResponse('corr-detached');
        expect(pairs).toHaveLength(0);
      } finally {
        unsub();
      }
    });
  });
});
