# Pseudocode 005 — Interactive CLI discard handler

Plan ID: `PLAN-20260806-ISSUE3048`
Target files:
- `packages/cli/src/ui/hooks/agentStream/committedSegmentLedger.ts` (NEW)
- `packages/cli/src/ui/hooks/agentStream/contentEventProcessor.ts`
- `packages/cli/src/ui/hooks/agentStream/useStreamState.ts`
- `packages/cli/src/ui/hooks/agentStream/useStreamEventHandlers.ts`
- `packages/cli/src/ui/hooks/agentStream/useSubmitQuery.ts`
- `packages/cli/src/ui/hooks/agentStream/agentEventDispatcher.ts`
- `packages/cli/src/ui/hooks/useHistoryManager.ts`
- plumbing: `useAgentStream.ts`, `useAgentStreamOrchestration.ts`,
  `useAppInput.ts`, `useAppBootstrap.ts`, `AppContainerRuntime.tsx`

Requirements: REQ-3048-008, REQ-3048-009
Referenced by: plan phases **P10** (pending state) and **P12** (retraction)

---

## Interface contracts

```ts
// NEW value object — mirrors PendingResponseBuffer's ownership model
class CommittedSegmentLedger {
  begin(): void;                 // new assistant message starts
  record(id: number): void;      // a stable prefix was committed to history
  drain(): readonly number[];    // take + clear (used by the discard)
  get ids(): readonly number[];  // read-only view for assertions
}

// CHANGED — history manager gains retraction
interface UseHistoryManagerReturn {
  removeItems: (ids: readonly number[]) => void;
}

// CHANGED — ContentEventDeps gains the ledger (required, not optional)
interface ContentEventDeps {
  committedSegments: CommittedSegmentLedger;
}

// NEW — the handler the dispatcher calls
handleStreamAttemptDiscarded(): void

// CHANGED — dispatcher deps
interface AgentEventDeps {
  handleStreamAttemptDiscarded: () => void;
}
```

## Integration points (line by line)

```
Line 520: deps.committedSegments.begin()
          - called from ensureAiPendingItem, i.e. exactly when a NEW assistant
            message's pending item is created. That is the message lifecycle
            boundary; it guarantees the ledger never holds ids belonging to a
            previous assistant message or a previous turn.
Line 545: deps.committedSegments.record(id)
          - addItem's return value; today it is discarded at
            contentEventProcessor.ts:99 (inside applySplitResult, which starts
            at line 86).
Line 610: deps.removeItems(deps.committedSegments.drain())
          - retraction is drain-then-remove so a second retry cannot re-remove
            ids that were already retracted.
Line 604: DO NOT call flushPendingHistoryItem
          - flushing commits the abandoned text. The whole point is to drop it.
Line 606: only drop 'gemini' / 'gemini_content' pending items
          - a 'tool_group' pending item belongs to the scheduler, not to the
            model attempt (spec §6 row 21/24).
```

## Anti-pattern warnings

```
DO NOT: make removeItems or committedSegments optional with a no-op default.
        A missing wire must fail typecheck, not silently skip the discard
        (spec AD-8).
DO NOT: widen AgentEventDeps with raw pendingResponse / removeItems. The
        established pattern is a named handler from useStreamEventHandlers
        spread into the deps (useSubmitQuery.ts:296-316); follow it.
DO NOT: clear turnCancelledRef, loopDetectedRef, the submission queue,
        setIsResponding, or the tool-call display. A retry is not a terminal
        event; the turn is still running.
DO NOT: call clearItems(). It wipes the whole transcript and starts a new
        ConversationContext.
```

---

## Numbered pseudocode

### 500 — CommittedSegmentLedger (new file)

```
500: CLASS CommittedSegmentLedger
501:   PRIVATE recorded = []
502:   METHOD begin()
503:     SET recorded = []          // new assistant message; drop stale ids
504:   METHOD record(id)
505:     APPEND id TO recorded
506:   METHOD drain()
507:     SET taken = recorded
508:     SET recorded = []
509:     RETURN taken
510:   GETTER ids
511:     RETURN recorded (read-only)
512: END CLASS
```

### 520 — contentEventProcessor: record what was committed

```
520: FUNCTION ensureAiPendingItem(..., committedSegments, ...)
521:   IF pendingHistoryItemRef.current IS NOT 'gemini' AND NOT 'gemini_content'
522:     IF pendingHistoryItemRef.current EXISTS
523:       CALL flushPendingHistoryItem(userMessageTimestamp)
524:     CALL committedSegments.begin()     // NEW: a new assistant message starts
525:     CALL setPendingHistoryItem({ type: 'gemini', text: '', ... })
526: END FUNCTION

540: FUNCTION applySplitResult(beforeText, pendingType, ..., committedSegments, ...)
541:   IF beforeText IS NON-EMPTY
542:     SET id = addItem({ type: pendingType, text: beforeText, ... },
543:                      userMessageTimestamp)
544:     // NEW: remember the id so a discard can retract exactly this segment
545:     CALL committedSegments.record(id)
546:     SET thinkingBlocksRef.current = []
547:   CALL setPendingHistoryItem(afterItem)
548:   RETURN afterItem.text
549: END FUNCTION
```

### 560 — useHistoryManager: retraction

```
560: FUNCTION removeHistoryItems(previous, ids, limits)
561:   IF ids IS EMPTY THEN RETURN previous
562:   SET removal = new Set(ids)
563:   SET entries = previous.entries FILTERED WHERE entry.item.id NOT IN removal
564:   IF entries.length EQUALS previous.entries.length THEN RETURN previous
565:   SET totalBytes = SUM of entry.bytes OVER entries
566:   RETURN trimHistoryState({ entries, totalBytes }, limits)
567: END FUNCTION

570: IN useHistory():
571:   SET removeItems = useCallback((ids) =>
572:         setState(previous => removeHistoryItems(previous, ids, limits)),
573:       [limits])
574:   ADD removeItems TO the returned object AND to its useMemo dependency list
575:   ADD removeItems TO UseHistoryManagerReturn
```

### 600 — the discard handler (useStreamEventHandlers)

```
600: FUNCTION useStreamAttemptDiscardedHandler(deps)
601:   RETURN useCallback(() => {
602:     // 1. Pending, uncommitted assistant render state (REQ-3048-008)
603:     SET pending = deps.pendingHistoryItemRef.current
604:     // NOTE: deliberately NOT flushPendingHistoryItem — that would commit it
605:     IF pending EXISTS AND (pending.type IS 'gemini' OR 'gemini_content')
606:       CALL deps.setPendingHistoryItem(null)
607:     CALL deps.pendingResponse.reset()
608:     // 2. Stable prefixes this attempt already committed (REQ-3048-009)
609:     SET retracted = deps.committedSegments.drain()
610:     IF retracted IS NON-EMPTY THEN CALL deps.removeItems(retracted)
611:     // 3. Thinking state produced by the abandoned attempt
612:     SET deps.thinkingBlocksRef.current = []
613:     CALL deps.setThought(null)
614:   }, [ ...stable deps... ])
615: END FUNCTION
```

### 630 — dispatcher wiring

```
630: IN dispatchAgentEvent(event, deps, agentMessageBuffer, userMessageTimestamp)
631:   CASE 'retry':
632:     CALL deps.handleStreamAttemptDiscarded()
633:     // The agent message buffer is the dispatcher's own accumulator; the
634:     // discard is expressed by returning the empty string (REQ-3048-008).
635:     RETURN { agentMessageBuffer: '' }
636:   // 'tool-call' | 'tool-result' | 'tool-confirmation' | 'tool-status' |
637:   // 'invalid-stream' | 'notice' keep the existing no-op group; 'retry' is
638:   // removed from it.
```

### 650 — plumbing (mechanical, typecheck-enforced)

```
650: useHistory()                    -> add removeItems to the return
651: useAppBootstrap                 -> destructure + return removeItems
652: AppContainerRuntime.buildInputParams -> removeItems: b.removeItems
653: AppInputParams                  -> removeItems: AppBootstrapResult['removeItems']
654: useAgentStream(...)             -> new required parameter `removeItems`
655:                                    inserted immediately after `addItem`
656: AgentStreamOrchestrationDeps    -> removeItems
657: useStreamState(addItem, runtime)-> also construct and expose
658:                                    committedSegments (same useMemo lifetime
659:                                    as pendingResponse)
660: useSubmitQuery deps             -> removeItems + committedSegments
661: StreamEventHandlerDeps          -> removeItems + committedSegments
662: useProcessAgentEvent handlers Pick -> add 'handleStreamAttemptDiscarded'
663: useAgentStream.subagent.spec.tsx  -> 4 call sites gain the new argument.
664:   This is a MECHANICAL argument update at existing call sites forced by the
665:   signature change: no assertion, no framework and no semantics change, and
666:   the file continues to run under Bun via the vitest shim preload. No new
667:   Vitest suite is created.
```
