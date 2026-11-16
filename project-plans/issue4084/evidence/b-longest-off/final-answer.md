Using TypeScript AST boundaries, I counted lines from each function-like implementation’s first line through its last, including blank and comment lines. I excluded tests and fixtures; constructors are included.

| Lines | Function | File |
|---:|---|---|
| 99 | `constructor` | `packages/agents/src/core/chatSession.ts:268–366` |
| 99 | `attemptExecutionOfScheduledCalls` | `packages/agents/src/core/coreToolScheduler.ts:710–808` |
| 97 | `recoverPendingBoundary` | `packages/agents/src/core/boundaryRecovery.ts:313–409` |
| 95 | `restoreHistory` | `packages/agents/src/core/client.ts:661–755` |
| 89 | `handleErrorEvent` | `packages/agents/src/core/MessageStreamTerminalHandler.ts:365–453` |
| 89 | `acquireFirstStreamEvent` | `packages/agents/src/core/turn.ts:749–837` |
| 87 | `run` | `packages/agents/src/core/turn.ts:625–711` |
| 86 | `_processStreamIteration` | `packages/agents/src/core/MessageStreamOrchestrator.ts:542–627` |
| 85 | `generateJson` | `packages/agents/src/core/clientLlmUtilities.ts:63–147` |
| 85 | `readStreamToCompletion` | `packages/agents/src/core/subagentNonInteractive.ts:316–400` |
