## Task 01 – Cherry-pick CLI Rendering & Output Fixes

### Scope
Cherry-pick the following upstream commits onto the current branch:

1. `40e634a02` – `fix(cli): Replace polling with event-driven resize handling and debounce`
2. `58dd8f217` – `Fix shell tool output handling for issue #273`
3. `e9229b51f` – `Optimize tool output limiter token handling`
4. `475fa44f2` – `Fix read-many-files gitignore handling (#274)`
5. `e5e4025be` – `Fix pending token compression precheck (#286)`

### Key Files to Watch
- `packages/cli/src/hooks/useTerminalSize.ts`
- `packages/cli/src/commands/shellCommand.ts` (and related shell output utilities)
- `packages/cli/src/utils/toolOutputLimiter.ts`
- `packages/cli/src/services/readManyFiles.ts`
- `packages/cli/src/services/todo-continuation/todoContinuationService.ts`

### Acceptance Notes
- Ensure the event-driven resize hook does not conflict with any agentic runtime behaviour.
- Verify shell output handling still cooperates with our subagent/agentic logging.
- Tool output limiter & compression fixes must coexist with our stateless-provider bootstrap logic; confirm no regressions in tool streaming.
- After applying the commits, run focused tests for the touched areas (e.g., shell command tests, read-many-files integration).

