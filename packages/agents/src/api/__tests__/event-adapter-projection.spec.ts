/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P14
 * @requirement:REQ-003
 *
 * Targeted projection behavior for the event adapter (mapLoopStream /
 * mapStreamEvent). Drives synthetic AgenticLoopEvent streams through the REAL
 * adapter and asserts the exact projected field values on the public
 * AgentEvents — tool-result isError discrimination, tool-status liveOutput /
 * agentId surfacing, awaiting_approval status filtering, and confirmation
 * correlationId fallback. Fast value/sequence assertions only (no mock
 * theater).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  runAdapterStatic,
  loopToolsComplete,
  loopToolsCompleteError,
  loopToolsCompleteCancelled,
  loopToolUpdate,
  loopToolUpdateLiveOutput,
  loopToolUpdateExecutingNoLiveOutput,
  loopToolUpdateScheduledWithLiveOutput,
  loopToolUpdateNoAgentId,
  loopToolOutput,
  loopAwaitingApproval,
  loopAwaitingApprovalCorrelated,
  loopAwaitingApprovalMixed,
  streamToolCallResponse,
  streamToolCallConfirmationCorrelated,
  streamStopped,
  streamBlocked,
  streamContent,
  streamFinished,
  wrapStream,
  loopStream,
  isToolResultEvent,
  isToolStatusEvent,
  isToolConfirmationEvent,
  isDoneEvent,
  isTextEvent,
  isHookBlockedEvent,
} from './helpers/eventHarness.js';

describe('Event adapter projection @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', () => {
  // ─── tool-result isError discrimination ───────────────────────────────────

  it('tools_complete success → tool-result isError false with name + output @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      loopToolsComplete('c-ok', 'search', 'found it'),
    ]);
    const results = events.filter(isToolResultEvent);
    expect(results).toHaveLength(1);
    expect(results[0].result.id).toBe('c-ok');
    expect(results[0].result.name).toBe('search');
    expect(results[0].result.isError).toBe(false);
  });

  it('tools_complete error → tool-result isError true @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      loopToolsCompleteError('c-err', 'search'),
    ]);
    const results = events.filter(isToolResultEvent);
    expect(results).toHaveLength(1);
    expect(results[0].result.id).toBe('c-err');
    expect(results[0].result.isError).toBe(true);
  });

  it('tools_complete cancelled by user (Cancel outcome) → tool-result isError true @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      loopToolsCompleteCancelled('c-cancel', 'search', true),
    ]);
    const results = events.filter(isToolResultEvent);
    expect(results).toHaveLength(1);
    expect(results[0].result.isError).toBe(true);
  });

  it('tools_complete cancelled NOT by user (non-Cancel outcome) → tool-result isError false @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      loopToolsCompleteCancelled('c-cancel2', 'search', false),
    ]);
    const results = events.filter(isToolResultEvent);
    expect(results).toHaveLength(1);
    expect(results[0].result.isError).toBe(false);
  });

  // ─── raw a2a ToolCallResponse isError discrimination ──────────────────────

  it('raw ToolCallResponse without error → tool-result isError false, empty name @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      wrapStream(streamToolCallResponse('r-ok', [{ text: 'data' }])),
    ]);
    const results = events.filter(isToolResultEvent);
    expect(results).toHaveLength(1);
    expect(results[0].result.id).toBe('r-ok');
    expect(results[0].result.name).toBe('');
    expect(results[0].result.isError).toBe(false);
  });

  it('raw ToolCallResponse WITH error → tool-result isError true @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      wrapStream(
        streamToolCallResponse('r-err', [{ text: 'failed' }], {
          error: new Error('tool blew up'),
        }),
      ),
    ]);
    const results = events.filter(isToolResultEvent);
    expect(results).toHaveLength(1);
    expect(results[0].result.id).toBe('r-err');
    expect(results[0].result.isError).toBe(true);
  });

  // ─── tool-status: status mapping, liveOutput, agentId ─────────────────────

  it('tool_update awaiting_approval status maps to hyphenated awaiting-approval @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      loopToolUpdate('u-await', 'search', 'awaiting_approval'),
    ]);
    const status = events.filter(isToolStatusEvent);
    expect(status).toHaveLength(1);
    expect(status[0].update.status).toBe('awaiting-approval');
  });

  it('tool_update scheduled status passes through unchanged @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      loopToolUpdate('u-sched', 'search', 'scheduled'),
    ]);
    const status = events.filter(isToolStatusEvent);
    expect(status).toHaveLength(1);
    expect(status[0].update.status).toBe('scheduled');
  });

  it('executing tool_update with liveOutput surfaces output by value @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      loopToolUpdateLiveOutput('u-live', 'search', 'streaming chunk'),
    ]);
    const status = events.filter(isToolStatusEvent);
    expect(status).toHaveLength(1);
    expect(status[0].update.output).toBe('streaming chunk');
  });

  it('scheduled tool_update WITHOUT liveOutput omits the output field @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      loopToolUpdate('u-noout', 'search', 'scheduled'),
    ]);
    const status = events.filter(isToolStatusEvent);
    expect(status).toHaveLength(1);
    expect('output' in status[0].update).toBe(false);
  });

  it('EXECUTING tool_update with NO liveOutput property omits output (presence guard, not status alone) @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      loopToolUpdateExecutingNoLiveOutput('u-exec-bare', 'search'),
    ]);
    const status = events.filter(isToolStatusEvent);
    expect(status).toHaveLength(1);
    expect(status[0].update.status).toBe('executing');
    expect('output' in status[0].update).toBe(false);
  });

  it('SCHEDULED tool_update that carries liveOutput still omits output (status guard, not presence alone) @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      loopToolUpdateScheduledWithLiveOutput('u-sched-live', 'search', 'leaked'),
    ]);
    const status = events.filter(isToolStatusEvent);
    expect(status).toHaveLength(1);
    expect(status[0].update.status).toBe('scheduled');
    expect('output' in status[0].update).toBe(false);
  });

  it('tool_update with agentId surfaces it; without agentId omits the field @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const withAgent = await runAdapterStatic([
      loopToolUpdate('u-agent', 'search', 'scheduled'),
    ]);
    const withStatus = withAgent.filter(isToolStatusEvent);
    expect(withStatus).toHaveLength(1);
    expect(withStatus[0].update.agentId).toBeDefined();

    const noAgent = await runAdapterStatic([
      loopToolUpdateNoAgentId('u-noagent', 'search'),
    ]);
    const noStatus = noAgent.filter(isToolStatusEvent);
    expect(noStatus).toHaveLength(1);
    expect('agentId' in noStatus[0].update).toBe(false);
  });

  it('tool_output chunk → tool-status executing, empty name, output echoes chunk @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      loopToolOutput('o-1', 'partial text'),
    ]);
    const status = events.filter(isToolStatusEvent);
    expect(status).toHaveLength(1);
    expect(status[0].update.id).toBe('o-1');
    expect(status[0].update.name).toBe('');
    expect(status[0].update.status).toBe('executing');
    expect(status[0].update.output).toBe('partial text');
  });

  // ─── confirmation correlationId fallback ──────────────────────────────────

  it('awaiting_approval without correlationId → confirmationId falls back to callId @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      loopAwaitingApproval('a-1', 'shell'),
    ]);
    const conf = events.filter(isToolConfirmationEvent);
    expect(conf).toHaveLength(1);
    expect(conf[0].confirmation.confirmationId).toBe('a-1');
    expect(conf[0].confirmation.toolCallId).toBe('a-1');
    expect(conf[0].confirmation.name).toBe('shell');
  });

  it('awaiting_approval WITH correlationId → confirmationId uses correlationId, toolCallId stays callId @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      loopAwaitingApprovalCorrelated('a-call', 'shell', 'corr-99'),
    ]);
    const conf = events.filter(isToolConfirmationEvent);
    expect(conf).toHaveLength(1);
    expect(conf[0].confirmation.confirmationId).toBe('corr-99');
    expect(conf[0].confirmation.toolCallId).toBe('a-call');
  });

  it('awaiting_approval skips non-awaiting tool calls, projecting only the awaiting one @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      loopAwaitingApprovalMixed('keep', 'skip', 'shell'),
    ]);
    const conf = events.filter(isToolConfirmationEvent);
    expect(conf).toHaveLength(1);
    expect(conf[0].confirmation.toolCallId).toBe('keep');
  });

  it('raw a2a confirmation WITH correlationId → confirmationId uses correlationId @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      wrapStream(
        streamToolCallConfirmationCorrelated('rc-call', 'shell', 'rc-corr'),
      ),
    ]);
    const conf = events.filter(isToolConfirmationEvent);
    expect(conf).toHaveLength(1);
    expect(conf[0].confirmation.confirmationId).toBe('rc-corr');
    expect(conf[0].confirmation.toolCallId).toBe('rc-call');
  });

  // ─── content projection (value-bearing text) ──────────────────────────────

  it('Content stream event projects to a text event carrying the exact string @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic(loopStream(streamContent('hello-α')));
    const text = events.filter(isTextEvent);
    expect(text).toHaveLength(1);
    expect(text[0].text).toBe('hello-α');
  });

  // ─── stop-info optional-field omission ────────────────────────────────────

  it('AgentExecutionStopped without systemMessage/contextCleared omits BOTH optional keys on stop @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic(loopStream(streamStopped('bare')));
    const done = events.filter(isDoneEvent);
    expect(done).toHaveLength(1);
    const stop = done[0].stop;
    expect(stop).toBeDefined();
    expect(stop?.reason).toBe('bare');
    expect('systemMessage' in (stop ?? {})).toBe(false);
    expect('contextCleared' in (stop ?? {})).toBe(false);
  });

  it('AgentExecutionStopped WITH systemMessage but WITHOUT contextCleared surfaces only systemMessage @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic(
      loopStream(streamStopped('partial', 'a system note')),
    );
    const done = events.filter(isDoneEvent);
    expect(done).toHaveLength(1);
    const stop = done[0].stop;
    expect(stop?.systemMessage).toBe('a system note');
    expect('contextCleared' in (stop ?? {})).toBe(false);
  });

  it('AgentExecutionBlocked without systemMessage omits the systemMessage key on the blocked info @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic(
      loopStream(streamBlocked('bare-block')),
    );
    const blocked = events.filter(isHookBlockedEvent);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].info.reason).toBe('bare-block');
    expect('systemMessage' in blocked[0].info).toBe(false);
  });

  // ─── loop-end done synthesis vs self-emitted done ─────────────────────────

  it('Finished stream event self-emits exactly one done{stop} with the finished payload; no duplicate loop-end done @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic(loopStream(streamFinished()));
    const done = events.filter(isDoneEvent);
    expect(done).toHaveLength(1);
    expect(done[0].reason).toBe('stop');
    expect(done[0].finished).toBeDefined();
  });

  it('Content followed by Finished yields the text then exactly one done (single terminal, not two) @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic(
      loopStream(streamContent('partial'), streamFinished()),
    );
    expect(events.filter(isTextEvent)).toHaveLength(1);
    expect(events.filter(isDoneEvent)).toHaveLength(1);
    expect(events[events.length - 1].type).toBe('done');
  });

  it('a content-only stream (no terminal event) still synthesizes exactly one loop-end done{stop} @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic(
      loopStream(streamContent('only text')),
    );
    const done = events.filter(isDoneEvent);
    expect(done).toHaveLength(1);
    expect(done[0].reason).toBe('stop');
    expect(events[events.length - 1].type).toBe('done');
  });

  // ─── property-based invariants ───────────────────────────────────────────

  it('property: tools_complete projects tool-result.isError matching the success/error discriminant for any boolean @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (isError) => {
        // Choose the REAL builder by the generated discriminant: an errored
        // completion must project isError true, a successful one false.
        const loopEvent = isError
          ? loopToolsCompleteError('c-prop', 'search')
          : loopToolsComplete('c-prop', 'search', 'found it');
        const events = await runAdapterStatic([loopEvent]);
        const results = events.filter(isToolResultEvent);
        expect(results).toHaveLength(1);
        expect(results[0].result.isError).toBe(isError);
      }),
    );
  });

  it('property: a stream of N Content events projects to N text events preserving order and exact values @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string(), { minLength: 0, maxLength: 5 }),
        async (strings) => {
          const events = await runAdapterStatic(
            loopStream(...strings.map((s) => streamContent(s))),
          );
          const projected = events.filter(isTextEvent).map((e) => e.text);
          // Order- and value-preserving: the projected text sequence equals
          // the generated input sequence exactly.
          expect(projected).toStrictEqual(strings);
        },
      ),
    );
  });
});
