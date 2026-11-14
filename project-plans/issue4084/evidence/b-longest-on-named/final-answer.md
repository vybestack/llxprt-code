Using TypeScript AST line spans, the 10 longest **named production functions and methods** in `packages/agents/src/core` are:

| # | Function | File | Lines |
|---:|---|---|---:|
| 1 | `attemptExecutionOfScheduledCalls` | `packages/agents/src/core/coreToolScheduler.ts` | 99 |
| 2 | `recoverPendingBoundary` | `packages/agents/src/core/boundaryRecovery.ts` | 97 |
| 3 | `restoreHistory` | `packages/agents/src/core/client.ts` | 95 |
| 4 | `handleErrorEvent` | `packages/agents/src/core/MessageStreamTerminalHandler.ts` | 89 |
| 5 | `acquireFirstStreamEvent` | `packages/agents/src/core/turn.ts` | 89 |
| 6 | `run` | `packages/agents/src/core/turn.ts` | 87 |
| 7 | `_processStreamIteration` | `packages/agents/src/core/MessageStreamOrchestrator.ts` | 86 |
| 8 | `generateJson` | `packages/agents/src/core/clientLlmUtilities.ts` | 85 |
| 9 | `readStreamToCompletion` | `packages/agents/src/core/subagentNonInteractive.ts` | 85 |
| 10 | `processFunctionCalls` | `packages/agents/src/core/subagentToolProcessing.ts` | 85 |

Test and declaration files were excluded. Length is the inclusive source-line span of each function-like AST node.
