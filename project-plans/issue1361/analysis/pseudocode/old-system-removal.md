# Pseudocode: Remove Old Persistence System (Issue #1368)

## Interface Contracts

```typescript
// This is a REMOVAL phase — no new interfaces.
// All references to the old system must be identified and removed.
```

## Files to Remove

```
10: DELETE packages/core/src/storage/SessionPersistenceService.ts
11: DELETE packages/core/src/storage/SessionPersistenceService.test.ts
12: // chatRecordingService was never created in this branch (no file found)
13: // but remove any stub references in geminiChat.ts
```

## Types to Remove

```
20: // From packages/core/src/storage/SessionPersistenceService.ts:
21: REMOVE interface PersistedToolCall
22: REMOVE interface PersistedUIHistoryItem
23: REMOVE interface PersistedSession
24: REMOVE class SessionPersistenceService
25: REMOVE const PERSISTED_SESSION_PREFIX
26:
27: // From packages/core/src/storage/sessionTypes.ts:
28: EVALUATE: SESSION_FILE_PREFIX — keep only if referenced by new system
29: EVALUATE: ConversationRecord — remove if only used by old system
30: EVALUATE: BaseMessageRecord — remove if only used by old system
```

## Exports to Remove from core/index.ts

```
35: // From packages/core/src/index.ts (current lines ~417-421):
36: REMOVE: SessionPersistenceService export
37: REMOVE: type PersistedSession export
38: REMOVE: type PersistedUIHistoryItem export
39: REMOVE: type PersistedToolCall export
40:
41: // ADD (if not already exported by earlier phases):
42: ADD: SessionRecordingService export
43: ADD: ReplayEngine exports
44: ADD: SessionDiscovery exports
45: ADD: SessionLockManager exports
46: ADD: All new type exports
```

## Code to Remove from AppContainer.tsx

```
50: // packages/cli/src/ui/AppContainer.tsx:
51: REMOVE: import { SessionPersistenceService } from core (line ~79)
52: REMOVE: restoredSession prop from AppContainerProps (line ~157)
53: REMOVE: restoredSession destructuring from props (line ~205)
54: REMOVE: sessionRestoredRef (line ~525)
55: REMOVE: coreHistoryRestoredRef (line ~526)
56: REMOVE: validateUIHistory function (lines ~585-604)
57: REMOVE: session restoration useEffect (lines ~607-698)
58: REMOVE: core history restoration useEffect (lines ~704-755)
59: REMOVE: SessionPersistenceService instantiation (line ~2061)
60: REMOVE: VALID_HISTORY_TYPES set (if exists and unused)
61:
62: // KEEP: convertToUIHistory function (used by new resume flow)
```

## Code to Remove from gemini.tsx

```
70: // packages/cli/src/gemini.tsx:
71: REMOVE: SessionPersistenceService import (line ~74)
72: REMOVE: PersistedSession type import
73: REMOVE: restoredSession variable declaration (line ~250)
74: REMOVE: if (config.isContinueSession()) block with loadMostRecent (lines ~253-265)
75: REMOVE: restoredSession prop passing to AppContainer/startInteractiveUI (line ~322)
76:
77: // These should already be replaced by resume flow (#1365) by this point
```

## Code to Remove from geminiChat.ts

```
80: // packages/core/src/core/geminiChat.ts:
81: REMOVE: ChatRecordingService stub/reference (line ~2276 area)
82: // This is a no-op stub — safe to remove entirely
```

## Code to Remove from useHistoryManager.ts

```
85: // packages/cli/src/ui/hooks/useHistoryManager.ts:
86: CHECK: Any ChatRecordingService imports or references
87: REMOVE: If found (from WIP cherry-pick)
```

## Code to Remove from client.ts

```
90: // packages/core/src/core/client.ts:
91: CHECK: Any ChatRecordingService imports or references
92: REMOVE: If found (getChatRecordingService, initializeChatRecording)
```

## Verification

```
100: // After all removals:
101: RUN: npm run typecheck  // No dangling references
102: RUN: npm run build      // Build succeeds
103: RUN: npm run test       // All tests pass
104: RUN: npm run lint       // No lint errors
105:
106: // Verify no remaining references:
107: GREP: "SessionPersistenceService" across entire codebase
108: GREP: "PersistedSession" across entire codebase
109: GREP: "PersistedUIHistoryItem" across entire codebase
110: GREP: "PersistedToolCall" across entire codebase
111: GREP: "ChatRecordingService" across entire codebase (expect zero)
112: GREP: "loadMostRecent" across entire codebase
113: GREP: "restoredSession" across entire codebase
114: GREP: "sessionRestoredRef\|coreHistoryRestoredRef" across entire codebase
115:
116: // Verify new system still works:
117: RUN: node scripts/start.js --profile-load synthetic "write me a haiku"
118: // Should start and record session (check chatsDir for .jsonl file)
```
