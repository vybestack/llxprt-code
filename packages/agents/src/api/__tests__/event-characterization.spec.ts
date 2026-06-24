/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P10
 * @requirement:REQ-003
 *
 * T16 — Event-characterization suite (RED). Pins every internal event variant
 * to its public AgentEvent projection by VALUE per the P02 adapter table.
 * Each row names its source category so reviewers can detect impossible
 * fixtures. Tests FAIL NATURALLY because mapLoopStream is unimplemented (P14):
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import {
  runAdapterStatic,
  wrapStream,
  loopStream,
  streamContent,
  streamThought,
  streamCitation,
  streamUsage,
  streamModelInfo,
  streamNotice,
  streamCompressed,
  streamRetry,
  streamInvalid,
  streamIdleTimeout,
  streamError,
  streamLoopDetected,
  streamContextOverflow,
  streamMaxTurns,
  streamFinished,
  streamUserCancelled,
  streamToolCallRequest,
  streamToolCallResponse,
  streamToolCallConfirmation,
  buildExecuteConfirmationDetails,
  streamStopped,
  streamBlocked,
  loopToolsComplete,
  loopToolUpdate,
  loopToolOutput,
  fakeProviderContentLoopEvents,
  runRealLoopExecuteTool,
  runRealLoopAbort,
  isDoneEvent,
  isTextEvent,
  isThinkingEvent,
  isToolCallEvent,
  isToolResultEvent,
  isToolConfirmationEvent,
  isToolStatusEvent,
  isUsageEvent,
  isModelInfoEvent,
  isNoticeEvent,
  isCompressionEvent,
  isContextWarningEvent,
  isRetryEvent,
  isCitationEvent,
  isLoopDetectedEvent,
  isIdleTimeoutEvent,
  isInvalidStreamEvent,
  isHookBlockedEvent,
  isErrorEvent,
} from './helpers/eventHarness.js';
import { stripSandboxSegment } from './helpers/fixtureRoot.js';

const TESTS_DIR = stripSandboxSegment(
  fileURLToPath(new URL('.', import.meta.url)),
);
const FIXTURE_PATH = join(TESTS_DIR, 'fixtures', 'basic-text.jsonl');
const CWD = dirname(TESTS_DIR);

/** Extracts all done events from the projected output. */
function doneEvents(events: readonly AgentEvent[]): AgentEvent[] {
  return events.filter(isDoneEvent);
}

/** True when the projected output contains an event of the given type. */
function hasEventType(events: readonly AgentEvent[], type: string): boolean {
  return events.some((e) => e.type === type);
}

// ─── Source category: fake-provider ────────────────────────────────────────

describe('Event characterization — fake-provider @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', () => {
  it('Content → text [fake-provider] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const loopEvents = await fakeProviderContentLoopEvents(FIXTURE_PATH, CWD);
    const events = await runAdapterStatic(loopEvents);
    const textEvents = events.filter(isTextEvent);
    expect(textEvents.length).toBeGreaterThanOrEqual(1);
    expect(textEvents[0].text).toBe('hello from fake provider');
  });
});

// ─── Source category: adapter-characterization ─────────────────────────────
// Variants with no higher executable emission seam; driven via explicit
// ServerGeminiStreamEvent builders through the adapter iterable.

describe('Event characterization — adapter-characterization @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', () => {
  it('Thought → thinking [adapter-characterization] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const thought = {
      subject: 'planning',
      description: 'analyzing the request',
    };
    const events = await runAdapterStatic([wrapStream(streamThought(thought))]);
    const thinkingEvents = events.filter(isThinkingEvent);
    expect(thinkingEvents).toHaveLength(1);
    expect(thinkingEvents[0].thought.subject).toBe('planning');
    expect(thinkingEvents[0].thought.description).toBe('analyzing the request');
  });

  it('Citation → citation [adapter-characterization] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      wrapStream(streamCitation('source-ref-42')),
    ]);
    const citationEvents = events.filter(isCitationEvent);
    expect(citationEvents).toHaveLength(1);
    expect(citationEvents[0].citation).toBe('source-ref-42');
  });

  it('UsageMetadata → usage [adapter-characterization] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const usage = {
      promptTokenCount: 100,
      candidatesTokenCount: 50,
      totalTokenCount: 150,
      cachedContentTokenCount: 10,
    };
    const events = await runAdapterStatic([wrapStream(streamUsage(usage))]);
    const usageEvents = events.filter(isUsageEvent);
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0].usage.promptTokenCount).toBe(100);
    expect(usageEvents[0].usage.totalTokenCount).toBe(150);
  });

  it('ModelInfo → model-info [adapter-characterization] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const info = { model: 'gemini-test', providerName: 'test-provider' };
    const events = await runAdapterStatic([wrapStream(streamModelInfo(info))]);
    const modelInfoEvents = events.filter(isModelInfoEvent);
    expect(modelInfoEvents).toHaveLength(1);
    expect(modelInfoEvents[0].info.model).toBe('gemini-test');
  });

  it('SystemNotice → notice [adapter-characterization] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      wrapStream(streamNotice('system maintenance scheduled')),
    ]);
    const noticeEvents = events.filter(isNoticeEvent);
    expect(noticeEvents).toHaveLength(1);
    expect(noticeEvents[0].message).toBe('system maintenance scheduled');
  });

  it('ChatCompressed → compression [adapter-characterization] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const info = {
      originalTokenCount: 1000,
      newTokenCount: 500,
      compressionStatus: 1,
    };
    const events = await runAdapterStatic([wrapStream(streamCompressed(info))]);
    const compressionEvents = events.filter(isCompressionEvent);
    expect(compressionEvents).toHaveLength(1);
    expect(compressionEvents[0].info?.originalTokenCount).toBe(1000);
    expect(compressionEvents[0].info?.newTokenCount).toBe(500);
  });

  it('ChatCompressed null → compression(null) [adapter-characterization] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([wrapStream(streamCompressed(null))]);
    const compressionEvents = events.filter(isCompressionEvent);
    expect(compressionEvents).toHaveLength(1);
    expect(compressionEvents[0].info).toBeNull();
  });

  it('Retry → retry [adapter-characterization] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([wrapStream(streamRetry())]);
    expect(events.filter(isRetryEvent)).toHaveLength(1);
  });

  it('InvalidStream → invalid-stream [adapter-characterization] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([wrapStream(streamInvalid())]);
    expect(events.filter(isInvalidStreamEvent)).toHaveLength(1);
  });

  it('StreamIdleTimeout → idle-timeout THEN done{error} [adapter-characterization] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const error = { message: 'stream timed out', status: 504 };
    const events = await runAdapterStatic([
      wrapStream(streamIdleTimeout(error)),
    ]);
    const idleEvents = events.filter(isIdleTimeoutEvent);
    expect(idleEvents).toHaveLength(1);
    expect(idleEvents[0].error.message).toBe('stream timed out');
    const done = doneEvents(events);
    expect(done).toHaveLength(1);
    expect(done[0].reason).toBe('error');
  });

  it('Error → error THEN done{error} [adapter-characterization] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const error = { message: 'model failure', status: 500 };
    const events = await runAdapterStatic([wrapStream(streamError(error))]);
    const errorEvents = events.filter(isErrorEvent);
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].error.message).toBe('model failure');
    const done = doneEvents(events);
    expect(done).toHaveLength(1);
    expect(done[0].reason).toBe('error');
  });

  it('LoopDetected → loop-detected THEN done{loop-detected} [adapter-characterization] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([wrapStream(streamLoopDetected())]);
    expect(events.filter(isLoopDetectedEvent)).toHaveLength(1);
    const done = doneEvents(events);
    expect(done).toHaveLength(1);
    expect(done[0].reason).toBe('loop-detected');
  });

  it('Finished → done{stop} [adapter-characterization] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([wrapStream(streamFinished())]);
    const done = doneEvents(events);
    expect(done).toHaveLength(1);
    expect(done[0].reason).toBe('stop');
  });
});

// ─── Source category: scheduler ────────────────────────────────────────────
// Tool-execution continuation events from the real AgenticLoop scheduler
// path: ToolCallRequest/Response/Confirmation stream events and loop-native
// tool_update/tool_output/tools_complete/awaiting_approval kinds.

describe('Event characterization — scheduler @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', () => {
  it('ToolCallRequest → tool-call [scheduler] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      wrapStream(streamToolCallRequest('call-1', 'search', { query: 'test' })),
    ]);
    const callEvents = events.filter(isToolCallEvent);
    expect(callEvents).toHaveLength(1);
    expect(callEvents[0].call.id).toBe('call-1');
    expect(callEvents[0].call.name).toBe('search');
    expect(callEvents[0].call.args.query).toBe('test');
  });

  it('ToolCallResponse → tool-result [scheduler] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      wrapStream(streamToolCallResponse('call-1', [{ text: 'result-data' }])),
    ]);
    const resultEvents = events.filter(isToolResultEvent);
    expect(resultEvents).toHaveLength(1);
    expect(resultEvents[0].result.id).toBe('call-1');
  });

  it('ToolCallConfirmation → tool-confirmation [scheduler] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const request = {
      callId: 'call-conf',
      name: 'shell',
      args: { command: 'rm -rf /' },
      isClientInitiated: false,
      prompt_id: 'call-conf',
    };
    const events = await runAdapterStatic([
      wrapStream(
        streamToolCallConfirmation(
          request,
          buildExecuteConfirmationDetails('shell', 'rm -rf /'),
        ),
      ),
    ]);
    const confirmationEvents = events.filter(isToolConfirmationEvent);
    expect(confirmationEvents).toHaveLength(1);
    expect(confirmationEvents[0].confirmation.toolCallId).toBe('call-conf');
    expect(confirmationEvents[0].confirmation.name).toBe('shell');
  });

  it('loop-native tool_update → tool-status [scheduler] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      loopToolUpdate('call-2', 'search', 'scheduled'),
    ]);
    const statusEvents = events.filter(isToolStatusEvent);
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0].update.id).toBe('call-2');
    expect(statusEvents[0].update.name).toBe('search');
    expect(statusEvents[0].update.status).toBe('scheduled');
  });

  it('loop-native tool_output → tool-status [scheduler] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      loopToolOutput('call-3', 'partial output'),
    ]);
    const statusEvents = events.filter(isToolStatusEvent);
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0].update.id).toBe('call-3');
  });

  it('loop-native tools_complete → tool-result [scheduler] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      loopToolsComplete('call-4', 'search', 'found it'),
    ]);
    const resultEvents = events.filter(isToolResultEvent);
    expect(resultEvents).toHaveLength(1);
    expect(resultEvents[0].result.id).toBe('call-4');
    expect(resultEvents[0].result.name).toBe('search');
  });

  it('real AgenticLoop awaiting_approval → tool-confirmation [scheduler] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const loopEvents = await runRealLoopExecuteTool();
    const events = await runAdapterStatic(loopEvents);
    const confirmationEvents = events.filter(isToolConfirmationEvent);
    expect(confirmationEvents.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Source category: abort ────────────────────────────────────────────────

describe('Event characterization — abort @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', () => {
  it('UserCancelled → done{aborted} [abort] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([wrapStream(streamUserCancelled())]);
    const done = doneEvents(events);
    expect(done).toHaveLength(1);
    expect(done[0].reason).toBe('aborted');
  });

  it('real AbortSignal abort terminates the loop cleanly [abort] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const loopEvents = await runRealLoopAbort();
    const events = await runAdapterStatic(loopEvents);
    const done = doneEvents(events);
    expect(done).toHaveLength(1);
  });
});

// ─── Source category: hook ─────────────────────────────────────────────────

describe('Event characterization — hook @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', () => {
  it('AgentExecutionStopped → done{hook-stopped} [hook] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      wrapStream(streamStopped('policy_block', 'blocked by hook', true)),
    ]);
    const done = doneEvents(events);
    expect(done).toHaveLength(1);
    expect(done[0].reason).toBe('hook-stopped');
    expect(done[0].stop?.reason).toBe('policy_block');
    expect(done[0].stop?.systemMessage).toBe('blocked by hook');
    expect(done[0].stop?.contextCleared).toBe(true);
  });

  it('AgentExecutionBlocked → hook-blocked (NON-terminal) [hook] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      wrapStream(streamBlocked('rate_limit', 'slow down')),
    ]);
    const blockedEvents = events.filter(isHookBlockedEvent);
    expect(blockedEvents).toHaveLength(1);
    expect(blockedEvents[0].info.reason).toBe('rate_limit');
    expect(blockedEvents[0].info.systemMessage).toBe('slow down');
    expect(doneEvents(events)).toHaveLength(0);
  });
});

// ─── Source category: config/orchestrator ──────────────────────────────────

describe('Event characterization — config/orchestrator @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', () => {
  it('ContextWindowWillOverflow → context-warning THEN done{context-overflow} [config/orchestrator] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      wrapStream(streamContextOverflow(50000, 1000)),
    ]);
    const warningEvents = events.filter(isContextWarningEvent);
    expect(warningEvents).toHaveLength(1);
    expect(warningEvents[0].estimatedRequestTokenCount).toBe(50000);
    expect(warningEvents[0].remainingTokenCount).toBe(1000);
    const done = doneEvents(events);
    expect(done).toHaveLength(1);
    expect(done[0].reason).toBe('context-overflow');
  });

  it('MaxSessionTurns → done{max-turns} [config/orchestrator] @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([wrapStream(streamMaxTurns())]);
    const done = doneEvents(events);
    expect(done).toHaveLength(1);
    expect(done[0].reason).toBe('max-turns');
  });
});

// ─── Invariant / decision-table ────────────────────────────────────────────
// Asserts the exactly-one-done invariant for each terminal path and the
// terminal-vs-intermediate decision table from P02.

describe('Event characterization — invariant/decision-table @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', () => {
  it('Finished yields exactly one done with reason stop @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic(loopStream(streamFinished()));
    expect(doneEvents(events)).toHaveLength(1);
    expect(doneEvents(events)[0].reason).toBe('stop');
  });

  it('UserCancelled yields exactly one done with reason aborted @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic(loopStream(streamUserCancelled()));
    expect(doneEvents(events)).toHaveLength(1);
    expect(doneEvents(events)[0].reason).toBe('aborted');
  });

  it('MaxSessionTurns yields exactly one synthesized done with reason max-turns @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic(loopStream(streamMaxTurns()));
    expect(doneEvents(events)).toHaveLength(1);
    expect(doneEvents(events)[0].reason).toBe('max-turns');
  });

  it('ContextWindowWillOverflow yields exactly one synthesized done with reason context-overflow @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic(
      loopStream(streamContextOverflow(99999, 0)),
    );
    expect(doneEvents(events)).toHaveLength(1);
    expect(doneEvents(events)[0].reason).toBe('context-overflow');
  });

  it('LoopDetected yields informational loop-detected BEFORE exactly one done{loop-detected} @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic(loopStream(streamLoopDetected()));
    const loopEvents = events.filter(isLoopDetectedEvent);
    const done = doneEvents(events);
    expect(loopEvents).toHaveLength(1);
    expect(done).toHaveLength(1);
    expect(done[0].reason).toBe('loop-detected');
    const loopIdx = events.indexOf(loopEvents[0]);
    const doneIdx = events.indexOf(done[0]);
    expect(loopIdx).toBeLessThan(doneIdx);
  });

  it('StreamIdleTimeout yields idle-timeout THEN exactly one done{error} @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic(
      loopStream(streamIdleTimeout({ message: 'timeout' })),
    );
    const idle = events.filter(isIdleTimeoutEvent);
    const done = doneEvents(events);
    expect(idle).toHaveLength(1);
    expect(done).toHaveLength(1);
    expect(done[0].reason).toBe('error');
    expect(events.indexOf(idle[0])).toBeLessThan(events.indexOf(done[0]));
  });

  it('Error yields error THEN exactly one done{error} @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic(
      loopStream(streamError({ message: 'fail' })),
    );
    const err = events.filter(isErrorEvent);
    const done = doneEvents(events);
    expect(err).toHaveLength(1);
    expect(done).toHaveLength(1);
    expect(done[0].reason).toBe('error');
    expect(events.indexOf(err[0])).toBeLessThan(events.indexOf(done[0]));
  });

  it('AgentExecutionStopped yields exactly one done with reason hook-stopped @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic(
      loopStream(streamStopped('hook_reason')),
    );
    expect(doneEvents(events)).toHaveLength(1);
    expect(doneEvents(events)[0].reason).toBe('hook-stopped');
  });

  it('AgentExecutionBlocked is NON-terminal: yields hook-blocked, stream continues, single done only at loop end @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      wrapStream(streamBlocked('temp_block')),
      wrapStream(streamContent('after block')),
      wrapStream(streamFinished()),
    ]);
    const blocked = events.filter(isHookBlockedEvent);
    const textEvents = events.filter(isTextEvent);
    const done = doneEvents(events);
    expect(blocked).toHaveLength(1);
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].text).toBe('after block');
    expect(done).toHaveLength(1);
    expect(done[0].reason).toBe('stop');
    // blocked comes before text, text before done
    expect(events.indexOf(blocked[0])).toBeLessThan(
      events.indexOf(textEvents[0]),
    );
    expect(events.indexOf(textEvents[0])).toBeLessThan(events.indexOf(done[0]));
  });

  it('synthesized done cases end with done despite NO Finished input @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const maxTurnsEvents = await runAdapterStatic(loopStream(streamMaxTurns()));
    const ctxOverflowEvents = await runAdapterStatic(
      loopStream(streamContextOverflow(100, 5)),
    );
    const errorEvents = await runAdapterStatic(
      loopStream(streamError({ message: 'err' })),
    );
    expect(doneEvents(maxTurnsEvents)).toHaveLength(1);
    expect(doneEvents(ctxOverflowEvents)).toHaveLength(1);
    expect(doneEvents(errorEvents)).toHaveLength(1);
  });

  it('intermediate events do not emit done: Content/Thought/Retry @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    const events = await runAdapterStatic([
      wrapStream(streamContent('hello')),
      wrapStream(streamThought({ subject: 's', description: 'd' })),
      wrapStream(streamRetry()),
      wrapStream(streamFinished()),
    ]);
    const done = doneEvents(events);
    expect(done).toHaveLength(1);
    expect(hasEventType(events, 'text')).toBe(true);
    expect(hasEventType(events, 'thinking')).toBe(true);
    expect(hasEventType(events, 'retry')).toBe(true);
  });

  // ─── Property-based: terminal-done invariant over arbitrary streams ──────

  // Local alias for the stream-event shape the builders return, derived WITHOUT
  // a deep core import (the helpers re-export the values; we take the builder's
  // return type) so this consumer-facing spec stays within the P09 boundary.
  type StreamEvent = ReturnType<typeof streamContent>;

  /**
   * The complete set of public AgentEvent `type` discriminants the adapter is
   * permitted to emit. Any projected event whose type is not in this set means
   * mapLoopStream invented an unknown variant — a real projection-table bug.
   */
  const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set([
    'text',
    'thinking',
    'tool-call',
    'tool-result',
    'tool-confirmation',
    'tool-status',
    'usage',
    'model-info',
    'notice',
    'compression',
    'context-warning',
    'retry',
    'citation',
    'loop-detected',
    'idle-timeout',
    'invalid-stream',
    'hook-blocked',
    'error',
    'done',
  ]);

  it('T16p property: ANY arbitrary sequence of non-terminal stream events, then Finished, projects to exactly ONE done that is LAST, and every event has a known type @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    // Each label maps to a non-terminal stream builder. The adapter must NEVER
    // synthesize a `done` for any of these — only the trailing Finished does.
    // If a production line erroneously projected (say) Content or Notice to a
    // terminal `done`, this property fails: doneEvents would exceed 1 and/or
    // the last event would not be done for some generated permutation.
    const nonTerminalBuilders: Record<string, () => StreamEvent> = {
      content: () => streamContent('chunk'),
      thought: () =>
        streamThought({ subject: 'planning', description: 'analyzing' }),
      usage: () =>
        streamUsage({
          promptTokenCount: 1,
          candidatesTokenCount: 1,
          totalTokenCount: 2,
        }),
      notice: () => streamNotice('system notice'),
      citation: () => streamCitation('src-ref'),
      retry: () => streamRetry(),
    };
    const labels = Object.keys(nonTerminalBuilders);

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...labels), { maxLength: 12 }),
        async (sequence) => {
          // Drive the REAL eventAdapter (mapLoopStream) with the generated
          // intermediate sequence followed by a single terminal Finished.
          const streamEvents = [
            ...sequence.map((label) => nonTerminalBuilders[label]()),
            streamFinished(),
          ];
          const events = await runAdapterStatic(loopStream(...streamEvents));

          // INVARIANT 1: exactly one terminal done is synthesized, no matter
          // how many / which non-terminal events preceded it.
          const done = doneEvents(events);
          expect(done).toHaveLength(1);

          // INVARIANT 2: the done is the LAST projected event (terminal).
          expect(events[events.length - 1].type).toBe('done');
          expect(done[0].reason).toBe('stop');

          // INVARIANT 3: every projected event carries a KNOWN public type —
          // the adapter never leaks an unmapped/unknown variant.
          for (const e of events) {
            expect(KNOWN_EVENT_TYPES.has(e.type)).toBe(true);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('T16pb property: ANY terminating builder (UserCancelled/Error/MaxTurns/ContextOverflow/LoopDetected) projects to exactly ONE done with its EXPECTED reason as the LAST event @plan:PLAN-20260617-COREAPI.P10 @requirement:REQ-003', async () => {
    // Each terminating builder pairs with the done.reason the P02 adapter table
    // mandates. If a production line mapped (say) UserCancelled to 'error'
    // instead of 'aborted', this property fails for that generated case.
    const terminators: ReadonlyArray<{
      label: string;
      build: () => StreamEvent;
      reason: string;
    }> = [
      { label: 'finished', build: () => streamFinished(), reason: 'stop' },
      {
        label: 'userCancelled',
        build: () => streamUserCancelled(),
        reason: 'aborted',
      },
      {
        label: 'maxTurns',
        build: () => streamMaxTurns(),
        reason: 'max-turns',
      },
      {
        label: 'contextOverflow',
        build: () => streamContextOverflow(99999, 0),
        reason: 'context-overflow',
      },
      {
        label: 'loopDetected',
        build: () => streamLoopDetected(),
        reason: 'loop-detected',
      },
      {
        label: 'error',
        build: () => streamError({ message: 'boom' }),
        reason: 'error',
      },
    ];

    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...terminators), async (terminator) => {
        const events = await runAdapterStatic(loopStream(terminator.build()));
        const done = doneEvents(events);
        // exactly one done, it is last, and its reason is the mandated one
        expect(done).toHaveLength(1);
        expect(events[events.length - 1].type).toBe('done');
        expect(done[0].reason).toBe(terminator.reason);
      }),
    );
  });
});
