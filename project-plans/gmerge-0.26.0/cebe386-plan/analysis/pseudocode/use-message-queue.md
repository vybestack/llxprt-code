# Pseudocode: useMessageQueue Hook (useMessageQueue.ts)

## Interface Contracts

```typescript
// INPUT: Gate parameters controlling when queue flushes
interface UseMessageQueueOptions {
  isConfigInitialized: boolean;
  streamingState: StreamingState;
  submitQuery: (query: string) => void;
  isMcpReady: boolean;
}

// OUTPUT: Queue state and add function
interface UseMessageQueueReturn {
  messageQueue: string[];
  addMessage: (message: string) => void;
}

// DEPENDENCIES (real):
//   StreamingState enum from ui/types.ts — StreamingState.Idle, Responding, WaitingForConfirmation
//   submitQuery from useGeminiStream — the actual submission function
```

## Pseudocode

```
01: FUNCTION useMessageQueue(options: UseMessageQueueOptions) -> UseMessageQueueReturn:
02:   DESTRUCTURE { isConfigInitialized, streamingState, submitQuery, isMcpReady } = options
03:
04: // === QUEUE STATE ===
05:   STATE messageQueue = useState<string[]>([])
06:
07: // === ADD MESSAGE (stable callback) ===
08:   DEFINE addMessage = useCallback((message: string) => {
09:     SET messageQueue = (prev) => [...prev, message]
10:   }, [])
11:
12: // === FLUSH EFFECT (one message per render cycle) ===
13:   useEffect(() => {
14:     // ALL gates must be open
15:     IF NOT isConfigInitialized: RETURN (no flush)
16:     IF streamingState !== StreamingState.Idle: RETURN (no flush)
17:     IF NOT isMcpReady: RETURN (no flush)
18:     IF messageQueue.length === 0: RETURN (nothing to flush)
19:
20:     // Dequeue first message (FIFO)
21:     LET [next, ...rest] = messageQueue
22:     SET messageQueue = rest
23:
24:     // Submit the dequeued message
25:     CALL submitQuery(next)
26:
27:     // After submitQuery, streamingState will transition away from Idle
28:     // This closes the gate, preventing the effect from re-running immediately
29:     // The next message flushes when streamingState returns to Idle
30:   }, [isConfigInitialized, streamingState, isMcpReady, messageQueue, submitQuery])
31:
32:   RETURN { messageQueue, addMessage }
```

## Integration Points

```
Lines 04-05: Queue is simple string[] state
         - Each entry is a raw user prompt (already trimmed by handleFinalSubmit)
         - No metadata needed — just the prompt text

Lines 08-10: addMessage is stable (empty dependency array)
         - Uses functional setState to avoid stale closure
         - Called from handleFinalSubmit when gates are closed

Lines 13-30: Flush effect runs when any dependency changes
         - Gate check order: config → streaming → MCP → queue length
         - Only the FIRST message is dequeued per cycle
         - submitQuery(next) starts streaming → streamingState leaves Idle
         - This naturally closes the gate for the next iteration
         - When streaming completes → streamingState = Idle → effect re-runs → next message

Line 21: Destructuring [next, ...rest] gives FIFO behavior
         - next = first element (oldest queued prompt)
         - rest = remaining elements
         - setState(rest) removes the flushed message
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Flush all messages at once (join('\n\n') or loop)
[OK] DO: Flush one message per render cycle to preserve turn boundaries

[ERROR] DO NOT: Include messageQueue.length in the gate check as a state variable
[OK] DO: Check messageQueue.length inside the effect (read from dependency)

[ERROR] DO NOT: Use setTimeout or requestAnimationFrame for delayed flush
[OK] DO: Rely on React's natural re-render cycle via state changes

[ERROR] DO NOT: Call submitQuery inside addMessage (bypasses gates)
[OK] DO: addMessage only adds to queue; flush effect handles submission

[ERROR] DO NOT: Forget submitQuery in the dependency array (stale reference)
[OK] DO: Include all gate values AND submitQuery in dependencies

[ERROR] DO NOT: Make addMessage depend on messageQueue (causes new reference each render)
[OK] DO: Use functional setState (prev => [...prev, message]) so addMessage is stable
```
