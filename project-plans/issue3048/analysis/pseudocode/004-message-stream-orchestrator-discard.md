# Pseudocode 004 — MessageStreamOrchestrator per-attempt discard

Plan ID: `PLAN-20260806-ISSUE3048`
Target file: `packages/agents/src/core/MessageStreamOrchestrator.ts`
Requirement: REQ-3048-007
Referenced by: plan phase **P08**

---

## Interface contracts

```ts
// INPUTS
//   ServerAgentStreamEvent stream from turn.run(iterRequest, signal)
//   StreamContext ctx (mutable: ctx.responseChunks)
//   hadToolCallsPrior: boolean  — carried in from earlier loop iterations
// OUTPUTS
//   IterationResult { earlyReturn, hadToolCallsThisTurn, hadThinking,
//                     hadContent, deferredEvents, outcome }
// DEPENDENCIES (real, never stubbed)
//   loopDetector.addAndCheck, todoContinuationService, agentHookManager
```

## Integration points (line by line)

```
Line 415: ctx.responseChunks.length = 0
          - ctx is shared with MessageStreamTerminalHandler.fireAfterHook and
            MessageStreamOrchestrator._fireAfterHook, both of which read
            ctx.responseChunks.join(''). Truncate in place; do not reassign.
Line 417: hadToolCallsThisTurn = hadToolCallsPrior
          - reset to the value carried IN, not to false: tool calls from an
            EARLIER loop iteration are not part of the abandoned attempt.
Line 419: deferredEvents.length = 0
          - shouldDeferStreamEvent defers Finished and Citation; an abandoned
            attempt can have deferred a Citation.
```

## Anti-pattern warnings

```
DO NOT: reset finishedOutcome — an abandoned attempt throws before Finished, so
        a non-undefined value there would indicate a different bug and must not
        be masked.
DO NOT: call loopDetector.reset(promptId) — it also resets turn tracking
        (turnsInCurrentPrompt), which would defeat maxTurnsPerPrompt. See
        spec §6 row 16 for why content tracking is deliberately left alone.
DO NOT: let this method exceed max-lines-per-function: 80. It measures 68
        effective lines today; the discard block is extracted to a module-level
        helper so the growth is +1 call line, not +6 inline lines.
```

---

## Numbered pseudocode

```
400: // NEW module-level helper (keeps _processStreamIteration under 80 lines)
401: FUNCTION discardAbandonedAttempt(ctx, state, hadToolCallsPrior, deferredEvents)
402:   // Every per-attempt accumulator owned by this loop. See spec §6 rows
403:   // 10, 11, 12 for the audit that produced exactly this set.
404:   SET ctx.responseChunks.length = 0
405:   SET state.hadThinking = false
406:   SET state.hadContent = false
407:   SET state.hadToolCallsThisTurn = hadToolCallsPrior
408:   SET deferredEvents.length = 0
409: END FUNCTION

410: METHOD _processStreamIteration(iterRequest, signal, turn, ctx,
411:                                hadToolCallsPrior, initialRequest)
412:   ... unchanged prologue (loopDetector.turnStarted, early return) ...
413:   SET state = { hadThinking: false, hadContent: false,
414:                 hadToolCallsThisTurn: hadToolCallsPrior }
415:   SET deferredEvents = []
416:   SET finishedOutcome = undefined
417:   FOR AWAIT event IN turn.run(iterRequest, signal)
418:     IF loopDetector.addAndCheck(event) THEN ... unchanged early return ...
419:     CALL todoContinuationService.recordModelActivity(event)
420:     // ---- NEW (REQ-3048-007) ----------------------------------------
421:     IF event.type IS AgentEventType.Retry
422:       CALL discardAbandonedAttempt(ctx, state, hadToolCallsPrior, deferredEvents)
423:       YIELD event                       // consumers still need the signal
424:       CALL updateTelemetryTokenCount()
425:       CONTINUE
426:     // ---- unchanged classification ----------------------------------
427:     IF event.type IS ToolCallRequest THEN state.hadToolCallsThisTurn = true
428:     IF event.type IS Thought         THEN state.hadThinking = true
429:     IF event.type IS Content         THEN state.hadContent = true
430:     IF event.type IS Finished AND event.value.outcome
431:       SET finishedOutcome = event.value.outcome
432:     CALL _handleTodoToolCall(event, todoContinuationService)
433:     IF event.type IS Content AND event.value
434:       APPEND event.value TO ctx.responseChunks
435:     IF todoContinuationService.shouldDeferStreamEvent(event)
436:       APPEND event TO deferredEvents
437:     ELSE
438:       YIELD event
439:     CALL updateTelemetryTokenCount()
440:     SET terminalResult = YIELD* handleTerminalEvent(deps, event, signal, ctx,
441:            deferredEvents, state, initialRequest)
442:     IF terminalResult THEN RETURN terminalResult
443:   RETURN { earlyReturn: false, ...state, deferredEvents, outcome: finishedOutcome }
444: END METHOD
```

## Refactor note (mechanical, behaviour-preserving)

Lines 413 and 427-429 replace three separate `let` locals (`hadThinking`,
`hadContent`, `hadToolCallsThisTurn`) with one mutable `state` record so the
discard helper can reset them by reference. This is the minimum restructuring
needed; the values, their initial state and every read site keep identical
semantics, and lines 440-443 pass `state` where they previously passed an object
literal built from the same three values.
