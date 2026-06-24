<!-- @plan:PLAN-20260617-COREAPI.P02 @requirement:REQ-003 -->
# Pseudocode: AgentEvent mapping/adapter (the top correctness risk)

Plan ID: PLAN-20260617-COREAPI
Phase: P02 (finalized)
Component: `packages/agents/src/api/eventAdapter.ts`
Requirements: REQ-003 (typed stream + 21-variant mapping + exactly-one-`done`)

---

## Interface Contracts

```typescript
// INPUTS:
//   AgenticLoopEvent stream — VERIFIED real union (agents/src/core/agenticLoop/types.ts):
//     | { kind: 'stream';            event: ServerGeminiStreamEvent }   # NOTE field is `event`, NOT `value`
//     | { kind: 'tool_update';       toolCalls: ToolCall[] }
//     | { kind: 'tool_output';       callId: string; chunk: string }
//     | { kind: 'tools_complete';    completed: CompletedToolCall[] }
//     | { kind: 'awaiting_approval'; toolCalls: ToolCall[] }
//   where kind:'stream' carries a ServerGeminiStreamEvent (GeminiEventType union) on `.event`,
//   and the INNER ServerGeminiStreamEvent itself uses `.value` for its payload.
//   EXCEPTION (turn.ts:274-286): AgentExecutionStopped and AgentExecutionBlocked carry FLAT
//   fields (reason/systemMessage?/contextCleared?) with NO `.value` wrapper — read the event
//   directly (lines 240-241). All other value-bearing variants DO use `.value`.
interface AdapterInput { loopEvents: AsyncIterable<AgenticLoopEvent> }

// OUTPUTS:
type AdapterOutput = AsyncIterable<AgentEvent>      // AgentEventSchema; ends with exactly one `done`

// DEPENDENCIES (pure projectors — exact input types pinned to real code):
interface Dependencies {
  projectToolCall:    (info: ToolCallRequestInfo)  => AgentToolCall        // from inner stream ToolCallRequest.value
  projectToolResult:  (x: ToolCallResponseInfo | CompletedToolCall) => AgentToolResult
                                                                           // inner stream ToolCallResponse.value OR loop tools_complete entry
  projectToolUpdate:  (tc: ToolCall)               => ToolUpdate          // loop tool_update entry (status/name/id)
  projectToolOutput:  (callId: string, chunk: string) => ToolUpdate       // loop tool_output (incremental)
  projectConfirmation:(tc: ToolCall)               => ToolConfirmation    // loop awaiting_approval entry
                       | (raw: ServerToolCallConfirmationDetails) => ToolConfirmation  // raw a2a stream path (line 216)
}
```

## Integration Points

```
Line 30: consume AgenticLoopEvent (agents) - the loop is the boundary that decides terminal `done`
Line 33: kind:'stream' -> map inner ServerGeminiStreamEvent (ev.event) via mapStreamEvent (the 21-variant table)
Line 200: loop ends -> ensureDone synthesizes `done` if none was emitted (R-DONE)
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT emit `done` at an inner tool-call stream end   [OK] only at AgenticLoop.run boundary
[ERROR] DO NOT emit more than one `done`                      [OK] track emittedDone; ensure exactly one
[ERROR] DO NOT leak ToolCallRequestInfo/ResponseInfo          [OK] project to AgentToolCall/Result
[ERROR] DO NOT fold AgentExecutionBlocked into done           [OK] it is NON-terminal hook-blocked
[ERROR] DO NOT assume Finished exists                         [OK] synthesize done for no-Finished paths
```

## Numbered Pseudocode

```
10: METHOD mapLoopStream(loopEvents)
11:   state = { emittedDone: false, lastFinished: null, lastStop: null,
12:             pendingDoneReason: null, sawActivity: false }
13:
30:   FOR AWAIT ev IN loopEvents
30a:    # sawActivity gates the loop-end `done` synthesis (line 201). Any consumed
30b:    # loop event counts as turn activity EXCEPT a standalone stream-wrapped
30c:    # AgentExecutionBlocked (non-terminal hook-block), which must NOT by itself
30d:    # fabricate a terminal `done`. Per-event granularity: a Blocked followed by
30e:    # real content still synthesizes one `done`.
30f:    IF NOT (ev.kind == 'stream' AND ev.event.type == AgentExecutionBlocked)
30g:      state.sawActivity = true
31:     SWITCH ev.kind
32:       CASE 'stream':                                  # ev = { kind:'stream', event: ServerGeminiStreamEvent }
33:         FOR pub IN mapStreamEvent(ev.event, state)    # VERIFIED: outer field is `ev.event` (NOT ev.value)
34:           IF pub.type == 'done'
35:             state.emittedDone = true
36:           YIELD pub
37:       CASE 'tool_update':                             # ev = { kind:'tool_update', toolCalls: ToolCall[] }
38:         FOR tc IN ev.toolCalls
39:           YIELD { type: 'tool-status', update: projectToolUpdate(tc) }
40:       CASE 'tool_output':                             # ev = { kind:'tool_output', callId, chunk }
41:         YIELD { type: 'tool-status',
42:                 update: projectToolOutput(ev.callId, ev.chunk) }   # incremental output keyed by callId
43:       CASE 'tools_complete':                          # ev = { kind:'tools_complete', completed: CompletedToolCall[] }
44:         FOR ct IN ev.completed
45:           YIELD { type: 'tool-result', result: projectToolResult(ct) }   # surface each completed tool result
46:       CASE 'awaiting_approval':                       # ev = { kind:'awaiting_approval', toolCalls: ToolCall[] }
47:         FOR tc IN ev.toolCalls
48:           YIELD { type: 'tool-confirmation', confirmation: projectConfirmation(tc) }
49:     END SWITCH
50:   END FOR
51:
200:  # ---- loop ended: guarantee exactly one terminal done ----
201:  IF NOT state.emittedDone AND (state.sawActivity OR state.pendingDoneReason != null)
202:    reason = state.pendingDoneReason OR 'stop'
203:    YIELD { type: 'done', reason: reason,
204:            finished: state.lastFinished, stop: state.lastStop }
204a:  # NOTE: a stream consisting ONLY of a non-terminal AgentExecutionBlocked
204b:  # (sawActivity=false, pendingDoneReason=null) yields NO done — verified by
204c:  # the P10 "AgentExecutionBlocked → hook-blocked (NON-terminal)" row asserting
204d:  # doneEvents.length == 0. The real-abort row (Content seen, no Finished) has
204e:  # sawActivity=true → exactly one synthesized done{stop}.
205: END METHOD
206:
210: METHOD mapStreamEvent(e, state)            # the 21-variant table
211:   SWITCH e.type                            # GeminiEventType
212:     CASE Content:                 YIELD { type:'text', text: e.value }            # string
213:     CASE Thought:                 YIELD { type:'thinking', thought: e.value }     # ThoughtSummary
214:     CASE ToolCallRequest:         YIELD { type:'tool-call', call: projectToolCall(e.value) }
215:     CASE ToolCallResponse:        YIELD { type:'tool-result', result: projectToolResult(e.value) }
216:     CASE ToolCallConfirmation:    YIELD { type:'tool-confirmation', confirmation: projectConfirmation(e.value) } # raw a2a path
217:     CASE UsageMetadata:           YIELD { type:'usage', usage: e.value }
218:     CASE ModelInfo:               YIELD { type:'model-info', info: e.value }
219:     CASE SystemNotice:            YIELD { type:'notice', message: e.value }       # string
220:     CASE ChatCompressed:          YIELD { type:'compression', info: e.value }     # ChatCompressionInfo|null
221:     CASE Citation:                YIELD { type:'citation', citation: e.value }    # string
222:     CASE Retry:                   YIELD { type:'retry' }                          # no payload
223:     CASE InvalidStream:           YIELD { type:'invalid-stream' }                 # no payload; terminal-or-intermediate per runtime
224:     CASE ContextWindowWillOverflow:
225:                                   YIELD { type:'context-warning',
226:                                           estimatedRequestTokenCount: e.value.estimatedRequestTokenCount,
227:                                           remainingTokenCount: e.value.remainingTokenCount }
228:                                   state.pendingDoneReason = 'context-overflow'    # terminal path: no Finished
229:     CASE LoopDetected:            YIELD { type:'loop-detected' }                  # informational
230:                                   state.pendingDoneReason = 'loop-detected'
231:     CASE MaxSessionTurns:         state.pendingDoneReason = 'max-turns'           # no public info event; no Finished
232:     CASE StreamIdleTimeout:       YIELD { type:'idle-timeout', error: e.value.error }
233:                                   state.pendingDoneReason = 'error'               # terminal; line 200 emits one done
236:     CASE Error:                   YIELD { type:'error', error: e.value.error }
237:                                   state.pendingDoneReason = 'error'
238:     CASE UserCancelled:           # turn-level abort
239:                                   YIELD makeDone(state, 'aborted'); state.emittedDone = true
240:     CASE AgentExecutionBlocked:   YIELD { type:'hook-blocked', info: toStopInfo(e) }  # NON-terminal; turn continues. FLAT event (turn.ts:281-286): reason/systemMessage?/contextCleared? — NO .value wrapper
241:     CASE AgentExecutionStopped:   state.lastStop = toStopInfo(e)                      # FLAT event (turn.ts:274-279): reason/systemMessage?/contextCleared? — NO .value wrapper
242:                                   YIELD makeDone(state, 'hook-stopped'); state.emittedDone = true  # terminal
243:     CASE Finished:                state.lastFinished = e.value
244:                                   YIELD makeDone(state, mapFinishReason(e.value.reason)); state.emittedDone = true
245:   END SWITCH
246: END METHOD
247:
250: METHOD makeDone(state, reason)
251:   RETURN { type:'done', reason: reason, finished: state.lastFinished, stop: state.lastStop }
252: END METHOD
```

## Terminal-vs-intermediate decision table (asserted by T16)
| GeminiEventType | Public | Terminal? | done synthesized? |
|---|---|---|---|
| Content | text | no | - |
| Thought | thinking | no | - |
| ToolCallRequest | tool-call | no | - |
| ToolCallResponse | tool-result | no | - |
| ToolCallConfirmation | tool-confirmation | no | - |
| UsageMetadata | usage | no | - |
| ModelInfo | model-info | no | - |
| SystemNotice | notice | no | - |
| ChatCompressed | compression | no | - |
| Citation | citation | no | - |
| Retry | retry | no | - |
| InvalidStream | invalid-stream | runtime-dependent | at loop end if terminal |
| ContextWindowWillOverflow | context-warning | terminal (no Finished) | YES (context-overflow) |
| LoopDetected | loop-detected (info) | terminal | YES (loop-detected) |
| MaxSessionTurns | (none) | terminal (no Finished) | YES (max-turns) |
| StreamIdleTimeout | idle-timeout | terminal | YES (error/idle) |
| Error | error | terminal (BeforeAgent block: no Finished) | YES (error) |
| UserCancelled | (none) | terminal | done{aborted} |
| AgentExecutionBlocked | hook-blocked | NO (continues) | - |
| AgentExecutionStopped | (none) | terminal | done{hook-stopped} |
| Finished | (none) | terminal | done{mapped reason} |

## Notes for impl phase
- Lines 232-233: idle-timeout emits the informational `idle-timeout` event and sets
  `pendingDoneReason`; line 200 synthesizes the single terminal `done`. Do not emit a
  second done from inside the case.
- `pendingDoneReason` carries the synthesized reason for any no-Finished terminal path.
- **toStopInfo contract (pinned — DEFECT 1 fix):** `toStopInfo(e)` reads the FLAT fields
  of `ServerGeminiAgentExecutionStoppedEvent` / `ServerGeminiAgentExecutionBlockedEvent`
  directly off the event — `e.reason` / `e.systemMessage?` / `e.contextCleared?`
  (turn.ts:274-286). These two variants have NO `.value` wrapper (unlike
  Content/Thought/ToolCall*/UsageMetadata/ModelInfo/SystemNotice/ChatCompressed/
  Citation/ContextWindowWillOverflow/StreamIdleTimeout/Error/Finished, which all DO carry
  a `value:` field). Passing `e.value` here yields `undefined` and silently drops
  reason/systemMessage/contextCleared — defeating AgentStopInfo and the hook-stopped
  `stop` payload. Lines 240-241 pass `e`, NOT `e.value`.
