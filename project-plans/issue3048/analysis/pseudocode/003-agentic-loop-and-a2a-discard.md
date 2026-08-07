# Pseudocode 003 — Abandoned tool-call discard (AgenticLoop + a2a executor)

Plan ID: `PLAN-20260806-ISSUE3048`
Target files:
- `packages/agents/src/core/agenticLoop/AgenticLoop.ts`
- `packages/a2a-server/src/agent/executor.ts`

Requirement: REQ-3048-006
Referenced by: plan phase **P06**

---

## Interface contracts

```ts
// INPUTS (both consumers)
//   AsyncIterable<ServerAgentStreamEvent> from agentClient.sendMessageStream /
//   task.acceptUserMessage
// OUTPUTS
//   AgenticLoop:   AsyncGenerator<AgenticLoopEvent, StreamCollectionResult>
//   a2a executor:  side effect — task.scheduleToolCalls(requests, signal)
// DEPENDENCIES (never stubbed in production)
//   ToolSchedulerContract via config.getOrCreateScheduler (AgenticLoop)
//   task.scheduleToolCalls (a2a)
```

## Integration points (line by line)

```
Line 210: YIELD { kind: 'stream', event }
          - the Retry event MUST still be forwarded to consumers BEFORE the
            local discard, because the CLI/ACP consumers use it as their own
            discard signal (spec §4 ordering guarantee).
Line 213: toolCallRequests.length = 0
          - in-place truncation, because the array is owned by the caller
            (runTurn passes it in by reference). Reassignment would silently
            leave the caller holding the abandoned list.
Line 215: CONTINUE
          - Retry must NOT set shouldScheduleTools = false. The turn is still
            alive; the replacement attempt schedules its own tools.
```

## Anti-pattern warnings

```
DO NOT: add Retry to isTerminalStreamOutcome. That would set
        shouldScheduleTools = false and end the turn — the exact bug #3048
        is fixing, just relocated.
DO NOT: reassign `toolCallRequests = []` (the caller keeps the old reference).
DO NOT: skip the a2a executor. AC4 is a system property; a2a is a second,
        independent scheduler over the same event stream.
DO NOT: reclassify AgentEventType.Retry in a2a task-support.ts — it stays an
        informational log-only event there; only the executor's collection
        changes.
```

---

## Numbered pseudocode — AgenticLoop.streamAndCollect

```
200: METHOD streamAndCollect(message, signal, promptId, toolCallRequests)
201:   SET stream = agentClient.sendMessageStream(message, signal, promptId)
202:   SET shouldScheduleTools = true
203:   FOR AWAIT event IN stream
204:     YIELD { kind: 'stream', event }          // forward FIRST, always
205:     IF event.type IS AgentEventType.ToolCallRequest
206:       APPEND event.value TO toolCallRequests
207:       CONTINUE
208:     // ---- NEW (REQ-3048-006) ----------------------------------------
209:     IF event.type IS AgentEventType.Retry
210:       // The attempt that produced these requests was abandoned. Drop them
211:       // in place; the replacement attempt emits its own ToolCallRequests.
212:       // The turn is NOT terminal, so shouldScheduleTools stays true.
213:       SET toolCallRequests.length = 0
214:       CONTINUE
215:     // ---- unchanged terminal handling -------------------------------
216:     IF isTerminalStreamOutcome(event.type)
217:       SET toolCallRequests.length = 0
218:       SET shouldScheduleTools = false
219:   RETURN { shouldScheduleTools }
220: END METHOD
```

Downstream (unchanged, recorded so the reviewer can trace the consequence):

```
230: METHOD runTurn(...)
231:   SET toolCallRequests = []
232:   SET streamResult = YIELD* streamAndCollect(..., toolCallRequests)
233:   IF signal.aborted OR NOT streamResult.shouldScheduleTools
234:     RETURN { continueLoop: false, ... }
235:   IF toolCallRequests IS EMPTY
236:     RETURN { continueLoop: false, allowSteerContinuation: true }
237:   // => a turn whose ONLY tool calls were abandoned reaches line 236 and
238:   //    finishes normally; the scheduler is never constructed (AC4).
239:   SET dedupedRequests = deduplicateToolCallRequests(toolCallRequests)
240:   ... schedule ...
```

---

## Numbered pseudocode — a2a executor `#processAgentTurnLoop`

```
300: WHILE agentTurnActive
301:   SET toolCallRequests = []
302:   FOR AWAIT event IN agentEvents
303:     IF abortSignal.aborted THEN THROW Error('Execution aborted')
304:     IF event.type IS AgentEventType.ToolCallRequest
305:       APPEND event.value TO toolCallRequests
306:       CONTINUE
307:     // ---- NEW (REQ-3048-006) ----------------------------------------
308:     IF event.type IS AgentEventType.Retry
309:       SET toolCallRequests.length = 0
310:       // fall through so task.acceptAgentMessage still logs the Retry via
311:       // the existing informational classification in task-support.ts
312:     AWAIT task.acceptAgentMessage(event)
313:   IF toolCallRequests IS NOT EMPTY
314:     AWAIT task.scheduleToolCalls(toolCallRequests, abortSignal)
315:   ... unchanged ...
```

Note on line 310-312: unlike `AgenticLoop`, the a2a loop forwards non-tool
events *after* the classification block, so the Retry branch clears and then
falls through to `acceptAgentMessage`. Keeping the existing logging path intact
is deliberate — `task-support.ts` already classifies `AgentEventType.Retry` as
`LOG_INFO_TYPES`, and that classification is not part of this change.
