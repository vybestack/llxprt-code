## Task 06 – Cherry-pick Model Param & TODO Fixes

### Scope
Cherry-pick these upstream commits:

1. `765be4b61` – `Fix: propagate model params and headers (closes #294)`
2. `6170da2a5` – `Fix todo_pause preserving todo dialog #277`

### Key Files to Watch
- `packages/cli/src/ui/commands/chatCommand.ts` (model param propagation)
- Provider configuration utilities (headers, model selection)
- `/todo_pause` command implementation and any shared dialog state management

### Acceptance Notes
- Merge model param propagation carefully with our provider bootstrap changes so overrides still work.
- Ensure `/todo_pause` dialog fix does not regress any agentic auto-mode behaviour.
- Re-run affected command tests after applying the commits.
