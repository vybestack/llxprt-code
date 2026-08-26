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

import { describe, it, expect } from 'bun:test';
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
  streamError,
  streamFinished,
  streamFinishedWithUsage,
  streamUserCancelled,
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
    const {
      done,
      stop,
      reasonObservation,
      agentExecutionStoppedWithoutSystemMessageContextClearedOmitsBOTHOptionalKeysOnStopObservation2,
      agentExecutionStoppedWithoutSystemMessageContextClearedOmitsBOTHOptionalKeysOnStopObservation3,
    } =
      await observeAgentExecutionStoppedWithoutSystemMessageContextClearedOmitsBOTHOptionalKeysOnStop();
    expect(done).toHaveLength(1);
    expect(stop).toBeDefined();
    expect(reasonObservation).toBe('bare');
    expect(
      agentExecutionStoppedWithoutSystemMessageContextClearedOmitsBOTHOptionalKeysOnStopObservation2,
    ).toBe(false);
    expect(
      agentExecutionStoppedWithoutSystemMessageContextClearedOmitsBOTHOptionalKeysOnStopObservation3,
    ).toBe(false);
  });

  const observeAgentExecutionStoppedWithoutSystemMessageContextClearedOmitsBOTHOptionalKeysOnStop =
    async () => {
      const events = await runAdapterStatic(loopStream(streamStopped('bare')));
      const done = events.filter(isDoneEvent);

      const stop = done[0].stop;

      const reasonObservation = stop?.reason;
      const agentExecutionStoppedWithoutSystemMessageContextClearedOmitsBOTHOptionalKeysOnStopObservation2 =
        'systemMessage' in (stop ?? {});
      const agentExecutionStoppedWithoutSystemMessageContextClearedOmitsBOTHOptionalKeysOnStopObservation3 =
        'contextCleared' in (stop ?? {});
      return {
        done,
        stop,
        reasonObservation,
        agentExecutionStoppedWithoutSystemMessageContextClearedOmitsBOTHOptionalKeysOnStopObservation2,
        agentExecutionStoppedWithoutSystemMessageContextClearedOmitsBOTHOptionalKeysOnStopObservation3,
      };
    };

  it('AgentExecutionStopped WITH systemMessage but WITHOUT contextCleared surfaces only systemMessage @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const {
      done,
      systemMessageObservation,
      agentExecutionStoppedWITHSystemMessageButWITHOUTContextClearedSurfacesOnlySystemMessageObservation2,
    } =
      await observeAgentExecutionStoppedWITHSystemMessageButWITHOUTContextClearedSurfacesOnlySystemMessage();
    expect(done).toHaveLength(1);
    expect(systemMessageObservation).toBe('a system note');
    expect(
      agentExecutionStoppedWITHSystemMessageButWITHOUTContextClearedSurfacesOnlySystemMessageObservation2,
    ).toBe(false);
  });

  const observeAgentExecutionStoppedWITHSystemMessageButWITHOUTContextClearedSurfacesOnlySystemMessage =
    async () => {
      const events = await runAdapterStatic(
        loopStream(streamStopped('partial', 'a system note')),
      );
      const done = events.filter(isDoneEvent);

      const stop = done[0].stop;

      const systemMessageObservation = stop?.systemMessage;
      const agentExecutionStoppedWITHSystemMessageButWITHOUTContextClearedSurfacesOnlySystemMessageObservation2 =
        'contextCleared' in (stop ?? {});
      return {
        done,
        systemMessageObservation,
        agentExecutionStoppedWITHSystemMessageButWITHOUTContextClearedSurfacesOnlySystemMessageObservation2,
      };
    };

  it('AgentExecutionBlocked without systemMessage omits the systemMessage key on the blocked info @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic(
      loopStream(streamBlocked('bare-block')),
    );
    const blocked = events.filter(isHookBlockedEvent);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].info.reason).toBe('bare-block');
    expect('systemMessage' in blocked[0].info).toBe(false);
  });

  // ─── loop-end done synthesis (the SOLE done emission point) ──────────────

  it('Finished stream event yields exactly one done{stop} carrying the finished payload @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
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

  // ─── done is terminal: never before a turn's tool activity (@issue:3087) ──
  //
  // A model iteration that requested tools emits its Finished (and, when the
  // AfterAgent hook clears context, its AgentExecutionStopped) BEFORE the loop
  // schedules those tools. The adapter must therefore defer every terminal
  // reason to loop end so the single public `done` is genuinely last.

  it('Finished on a tool-bearing iteration yields ONE done{stop} AFTER the tool events @issue:3087', async () => {
    const events = await runAdapterStatic([
      wrapStream(streamFinished()),
      loopToolUpdate('c-1', 'search', 'executing'),
      loopToolsComplete('c-1', 'search', 'found it'),
      wrapStream(streamFinished()),
    ]);
    const done = events.filter(isDoneEvent);
    expect(done).toHaveLength(1);
    expect(done[0].reason).toBe('stop');
    expect(events[events.length - 1].type).toBe('done');
    expect(events.indexOf(events.filter(isToolResultEvent)[0])).toBeLessThan(
      events.indexOf(done[0]),
    );
  });

  it('AgentExecutionStopped on a tool-bearing iteration yields ONE done{hook-stopped} AFTER the tool events, carrying stop @issue:3087', async () => {
    const events = await runAdapterStatic([
      wrapStream(streamFinished()),
      wrapStream(streamStopped('context cleared by hook')),
      loopToolUpdate('c-2', 'search', 'executing'),
      loopToolsComplete('c-2', 'search', 'found it'),
    ]);
    const done = events.filter(isDoneEvent);
    expect(done).toHaveLength(1);
    expect(done[0].reason).toBe('hook-stopped');
    expect(done[0].stop?.reason).toBe('context cleared by hook');
    expect(events[events.length - 1].type).toBe('done');
    expect(events.indexOf(events.filter(isToolResultEvent)[0])).toBeLessThan(
      events.indexOf(done[0]),
    );
  });

  it('UserCancelled followed by loop tool events yields ONE done{aborted} that is last @issue:3087', async () => {
    const events = await runAdapterStatic([
      wrapStream(streamUserCancelled()),
      loopToolUpdate('c-3', 'search', 'cancelled'),
      loopToolsCompleteCancelled('c-3', 'search', true),
    ]);
    const done = events.filter(isDoneEvent);
    expect(done).toHaveLength(1);
    expect(done[0].reason).toBe('aborted');
    expect(events[events.length - 1].type).toBe('done');
  });

  it('Error followed by a later Finished keeps the explicit done{error} @issue:3087', async () => {
    const events = await runAdapterStatic(
      loopStream(streamError({ message: 'boom' }), streamFinished()),
    );
    const done = events.filter(isDoneEvent);
    expect(done).toHaveLength(1);
    expect(done[0].reason).toBe('error');
    expect(events[events.length - 1].type).toBe('done');
  });

  it('AgentExecutionStopped followed by a later Finished keeps done{hook-stopped} @issue:3087', async () => {
    const events = await runAdapterStatic(
      loopStream(streamStopped('cleared'), streamFinished()),
    );
    const done = events.filter(isDoneEvent);
    expect(done).toHaveLength(1);
    expect(done[0].reason).toBe('hook-stopped');
    expect(done[0].stop?.reason).toBe('cleared');
  });

  it('an entirely empty loop stream emits NO events at all @issue:3087', async () => {
    const events = await runAdapterStatic([]);
    expect(events).toStrictEqual([]);
  });

  it('the terminal done keeps the last REPORTED usage when the final iteration reports none @issue:3087', async () => {
    // A provider reports usage only on the iterations whose terminal chunk
    // carries token counts. Collapsing to one done must not lose the counts a
    // consumer used to keep from an earlier per-iteration done.
    const events = await runAdapterStatic([
      wrapStream(
        streamFinishedWithUsage({
          promptTokens: 42,
          completionTokens: 8,
          totalTokens: 50,
        }),
      ),
      loopToolsComplete('c-usage', 'search', 'found it'),
      wrapStream(streamFinished()),
    ]);
    const done = events.filter(isDoneEvent);
    expect(done).toHaveLength(1);
    expect(done[0].finished?.usageMetadata).toStrictEqual({
      promptTokenCount: 42,
      candidatesTokenCount: 8,
      totalTokenCount: 50,
    });
  });

  it('a later Finished that DOES report usage overrides the earlier counts @issue:3087', async () => {
    const events = await runAdapterStatic([
      wrapStream(
        streamFinishedWithUsage({
          promptTokens: 42,
          completionTokens: 8,
          totalTokens: 50,
        }),
      ),
      loopToolsComplete('c-usage-2', 'search', 'found it'),
      wrapStream(
        streamFinishedWithUsage({
          promptTokens: 90,
          completionTokens: 10,
          totalTokens: 100,
        }),
      ),
    ]);
    const done = events.filter(isDoneEvent);
    expect(done).toHaveLength(1);
    expect(done[0].finished?.usageMetadata).toStrictEqual({
      promptTokenCount: 90,
      candidatesTokenCount: 10,
      totalTokenCount: 100,
    });
  });

  // ─── property-based invariants ───────────────────────────────────────────

  it('property: tools_complete projects tool-result.isError matching the success/error discriminant for any boolean @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-003', async () => {
    const {
      propertyToolsCompleteProjectsToolResultIsErrorMatchingTheSuccessErrorDiscriminantProperty,
      observations,
    } =
      await observePropertyToolsCompleteProjectsToolResultIsErrorMatchingTheSuccessErrorDiscriminant();
    await fc.assert(
      propertyToolsCompleteProjectsToolResultIsErrorMatchingTheSuccessErrorDiscriminantProperty,
    );
    expect(observations.map(({ resultCount }) => resultCount)).toStrictEqual(
      observations.map(() => 1),
    );
    expect(observations.map(({ actual }) => actual)).toStrictEqual(
      observations.map(({ expected }) => expected),
    );
  });

  const observePropertyToolsCompleteProjectsToolResultIsErrorMatchingTheSuccessErrorDiscriminant =
    async () => {
      const observations: Array<{
        resultCount: number;
        actual: boolean;
        expected: boolean;
      }> = [];
      const propertyToolsCompleteProjectsToolResultIsErrorMatchingTheSuccessErrorDiscriminantProperty =
        fc.asyncProperty(fc.boolean(), async (isError) => {
          // Choose the REAL builder by the generated discriminant: an errored
          // completion must project isError true, a successful one false.
          const loopEvent = isError
            ? loopToolsCompleteError('c-prop', 'search')
            : loopToolsComplete('c-prop', 'search', 'found it');
          const events = await runAdapterStatic([loopEvent]);
          const results = events.filter(isToolResultEvent);
          const actual = results[0]?.result.isError;
          observations.push({
            resultCount: results.length,
            actual: actual ?? !isError,
            expected: isError,
          });
          return results.length === 1 && actual === isError;
        });
      return {
        propertyToolsCompleteProjectsToolResultIsErrorMatchingTheSuccessErrorDiscriminantProperty,
        observations,
      };
    };

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
