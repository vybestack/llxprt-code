# Pseudocode: AppContainer Integration (AppContainer.tsx)

## Interface Contracts

```typescript
// NEW imports needed:
import { useMcpStatus } from './hooks/useMcpStatus.js';
import { useMessageQueue } from './hooks/useMessageQueue.js';
import { isSlashCommand } from './utils/commandUtils.js';
import { coreEvents, CoreEvent } from '@vybestack/llxprt-code-core';

// useMcpStatus return type:
interface UseMcpStatusReturn {
  discoveryState: MCPDiscoveryState;
  mcpServerCount: number;
  isMcpReady: boolean;
}

// useMessageQueue return type:
interface UseMessageQueueReturn {
  messageQueue: string[];
  addMessage: (message: string) => void;
}

// EXISTING dependencies in AppContainer:
//   config: Config — passed as prop or from context
//   submitQuery: (query: string) => void — from useGeminiStream
//   streamingState: StreamingState — from useGeminiStream
//   inputHistoryStore — for addInput (up-arrow recall)
```

## Pseudocode

```
01: // === ADD HOOK CALLS inside AppContainer function body ===
02:
03: // After existing useGeminiStream call:
04: CALL const { isMcpReady } = useMcpStatus(config)
05:
06: // After useMcpStatus call:
07: CALL const { messageQueue, addMessage } = useMessageQueue({
08:   isConfigInitialized: true,   // currently hardcoded true (line 1391)
09:   streamingState,              // from useGeminiStream
10:   submitQuery,                 // from useGeminiStream
11:   isMcpReady,                  // from useMcpStatus
12: })
13:
14: // === TRACK first-queue info message per discovery cycle ===
15: STATE hasShownMcpQueueMessage = useRef<boolean>(false)
16:
17: // Reset the info message flag when discovery state changes to IN_PROGRESS
18: useEffect(() => {
19:   IF discoveryState === MCPDiscoveryState.IN_PROGRESS:
20:     SET hasShownMcpQueueMessage.current = false
21: }, [discoveryState])
22: // NOTE: discoveryState comes from useMcpStatus — may need to destructure more
23:
24: // === MODIFY handleFinalSubmit ===
25: FUNCTION handleFinalSubmit(submittedValue: string):
26:   LET trimmedValue = submittedValue.trim()
27:   IF trimmedValue is empty: RETURN
28:
29:   // Track input history BEFORE queue/direct decision
30:   // This preserves up-arrow recall regardless of path
31:   CALL inputHistoryStore.addInput(trimmedValue)
32:
33:   // Decision point: slash command vs prompt
34:   IF isSlashCommand(trimmedValue):
35:     // Slash commands always execute immediately — bypass queue
36:     CALL submitQuery(trimmedValue)
37:     RETURN
38:
39:   // Non-slash prompt: check gates
40:   IF isMcpReady AND streamingState === StreamingState.Idle:
41:     // All gates open — submit directly (normal fast path)
42:     CALL submitQuery(trimmedValue)
43:   ELSE:
44:     // Gate closed — queue the prompt
45:     // Show info message on first queue entry per discovery cycle
46:     IF NOT hasShownMcpQueueMessage.current AND NOT isMcpReady:
47:       CALL coreEvents.emitFeedback('info',
48:         'Waiting for MCP servers to initialize... Slash commands are still available. Your prompt has been queued and will be submitted automatically.'
49:       )
50:       SET hasShownMcpQueueMessage.current = true
51:     CALL addMessage(trimmedValue)
52:
53: // === DEPENDENCY ARRAY for handleFinalSubmit useCallback ===
54:   DEPS: [submitQuery, addMessage, isMcpReady, streamingState, inputHistoryStore]
55:   // Note: hasShownMcpQueueMessage is a ref, not in deps
```

## Integration Points

```
Line 04: useMcpStatus(config) — config must be the Config instance
         - In AppContainer, config comes from props or context
         - Verify the exact variable name used in AppContainer for Config

Lines 07-12: useMessageQueue receives all four gate parameters
         - isConfigInitialized is currently hardcoded true in AppContainer (line 1391)
         - streamingState and submitQuery come from useGeminiStream destructuring
         - isMcpReady comes from useMcpStatus

Lines 14-21: Info message tracking uses useRef (not useState) to avoid re-renders
         - Resets when discoveryState transitions to IN_PROGRESS (new cycle)
         - hasShownMcpQueueMessage.current is set in handleFinalSubmit (sync, no re-render)

Lines 24-54: handleFinalSubmit replaces the current simple implementation
         - CURRENT: submitQuery(trimmedValue) directly (line 1577)
         - NEW: slash check → gate check → direct submit or queue
         - inputHistoryStore.addInput MUST happen before the queue/direct branch

Line 34: isSlashCommand from packages/cli/src/ui/utils/commandUtils.ts
         - Already used elsewhere in the codebase (UserMessage, SuggestionsDisplay)
         - May need to add import to AppContainer if not already present

Lines 40-42: Fast path when ready — identical to current behavior
         - No queue involved, submitQuery called directly
         - This is the common case (no MCP servers, or MCP already ready)
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Queue slash commands (they must bypass the queue entirely)
[OK] DO: Check isSlashCommand BEFORE the queue/direct decision

[ERROR] DO NOT: Call addInput only on the direct path (loses history for queued prompts)
[OK] DO: Call addInput BEFORE the queue/direct branch

[ERROR] DO NOT: Show the info message on every queued prompt (spams the user)
[OK] DO: Show once per discovery cycle using a ref flag

[ERROR] DO NOT: Use useState for hasShownMcpQueueMessage (causes unnecessary re-renders)
[OK] DO: Use useRef — it's read/written synchronously in handleFinalSubmit

[ERROR] DO NOT: Forget to add isMcpReady to handleFinalSubmit's useCallback dependency array
[OK] DO: Include all variables read inside the callback in the dependency array

[ERROR] DO NOT: Gate on streaming state inside handleFinalSubmit for non-MCP reasons
[OK] DO: Only use streaming state as a gate for queue flush (via useMessageQueue)
         The handleFinalSubmit gate is for the MCP-not-ready case specifically
```
