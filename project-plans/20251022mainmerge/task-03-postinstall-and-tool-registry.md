## Task 03 – Cherry-pick Postinstall & Tool Registry Fixes

### Scope
Cherry-pick these upstream commits:

1. `001a2ffe2` – `fix: ship postinstall script for npx installs (#258)`
2. `c9d8ad075` – `Fix tool registry races and prompt filtering (#224, #275)`
3. `e475f75ed` – `Fix --prompt-interactive initial submission (#292)`

### Key Files to Watch
- `package.json` / `scripts/postinstall` references
- `packages/cli/src/tools/tool-registry.ts` and related registries
- Prompt processing pipeline (`packages/cli/src/ui/commands/chatCommand.ts`, prompt services)
- Any new test coverage for tool registry or `--prompt-interactive`

### Acceptance Notes
- Ensure postinstall script changes don’t conflict with our stateless-provider setup steps.
- Tool registry race fixes must play nicely with subagent/provider tooling; reconcile any conflicting helper APIs.
- `--prompt-interactive` changes should coexist with our queueing updates from Task 02.
- Run relevant CLI integration tests after applying the commits.

