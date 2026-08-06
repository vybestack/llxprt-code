# Pseudocode 006 — Non-interactive CLI discard

Plan ID: `PLAN-20260806-ISSUE3048`
Target file: `packages/cli/src/nonInteractiveCliSupport.ts`
Requirement: REQ-3048-010
Referenced by: plan phase **P14**

---

## Interface contracts

```ts
// INPUTS
//   AgentEvent stream (public API), StreamState, StreamConsumerContext
interface StreamState {
  thoughtBuffer: ThoughtBuffer;
  responseText: string;      // accumulated ONLY in --output-format json mode
  quietTextBuffer: string;   // accumulated ONLY in --quiet mode
  pendingDone: Extract<AgentEvent, { type: 'done' }> | null;
}
// OUTPUTS
//   finalizeStream emits exactly one of responseText / quietTextBuffer
// DEPENDENCIES
//   context.emojiFilter (real EmojiFilter; holds a partial stream chunk)
//   context.streamFormatter (real StreamJsonFormatter or null)
```

## Integration points (line by line)

```
Line 706: context.emojiFilter?.flushBuffer()
          - flushBuffer() DRAINS the filter's held-back partial chunk and
            returns it. The return value is deliberately discarded here: that
            fragment belongs to the abandoned attempt. Without this, the
            fragment reappears via flushEmojiBuffer() at finalizeStream.
Line 700: quiet mode is handled by handleQuietEvent FIRST
          - handleQuietEvent returns false for 'retry' today, so the event
            falls through to dispatchAgentEvent. Reset both buffers in the one
            'retry' case rather than adding a second branch in handleQuietEvent.
```

## Anti-pattern warnings

```
DO NOT: attempt to un-write plain stdout or already-emitted stream-json deltas.
        They are gone; the limitation is documented in spec §8. Emitting a
        compensating "ignore the previous text" event is a protocol change and
        is out of scope.
DO NOT: reset state.pendingDone — a retry cannot follow a done for the same
        turn, and clearing it would mask an ordering bug.
DO NOT: swallow a throw from flushBuffer(). Fail fast.
```

---

## Numbered pseudocode

```
700: FUNCTION dispatchAgentEvent(event, state, context, writeProfileName,
701:                             includeThinking)
702:   IF context.quiet AND handleQuietEvent(event, state) THEN RETURN
703:   SWITCH event.type
704:     ... unchanged cases ...
705:     CASE 'retry':                       // NEW (REQ-3048-010)
706:       CALL context.emojiFilter?.flushBuffer()   // drain and DISCARD
707:       SET state.responseText = ''
708:       SET state.quietTextBuffer = ''
709:       SET state.thoughtBuffer = []
710:       RETURN
711:     ... unchanged default ...
712: END FUNCTION
```

## Observable consequences

| Mode | Before | After |
|------|--------|-------|
| `--output-format json` | result text = `'abandoned' + 'kept'` | result text = `'kept'` |
| `--quiet` | emitted text = `'abandonedkept'` | emitted text = `'kept'` |
| plain stdout | `abandoned` already printed, then `kept` | unchanged (documented limitation) |
| `--output-format stream-json` | both deltas already emitted | unchanged (documented limitation) |
| thinking output | abandoned thoughts flushed with the answer | abandoned thoughts dropped |
