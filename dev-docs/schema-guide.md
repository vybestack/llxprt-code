<!-- @plan:PLAN-20251013-AUTOCOMPLETE.P12 @requirement:REQ-006 -->

# Slash Command Schema Guide

This note distils the schema migration work completed in
`PLAN-20250214-AUTOCOMPLETE` so future CLI commands can plug into the shared
resolver without resurrecting manual completion code.

## Core Concepts

- **Schema-first** – every slash command argument flow is described by
  `CommandArgumentSchema` nodes (`literal` or `value`).
- **Resolver** – `createCompletionHandler(schema)` tokenises the current input
  and returns `{ suggestions, hint, position }`.
- **UI Contract** – `useSlashCompletion` now relies exclusively on schemas;
  commands must supply them to keep autocomplete working.

## Authoring Workflow

1. Define schema nodes adjacent to the command (`packages/cli/src/ui/commands`).
2. Replace any `completion` function with a `schema` property.
3. Provide `description` strings for hints, and async `completer` functions when
   suggestions depend on services (profiles, MCP servers, etc.).
4. Update Vitest suites to assert resolver output via `createCompletionHandler`.

### Reference Implementations

- `/set`: `packages/cli/src/ui/commands/setCommand.ts`
- `/subagent save`: `packages/cli/src/ui/commands/subagentCommand.ts`
- `/restore`: `packages/cli/src/ui/commands/restoreCommand.ts`
- MCP prompts: `packages/cli/src/services/McpPromptLoader.ts`

## Testing Expectations

- Unit tests should cover literal/value traversal and async completers.
- Keep property-based and mutation coverage thresholds aligned with
  plan phases (≥30% property coverage, ≥70% mutation score).
- Suggested commands:
  - `npm run lint`
  - `npm run typecheck`
  - `npx vitest run path/to/your/new/tests`

## Migration Checklist

- [ ] Schema defined and wired into the command.
- [ ] Legacy `completion` removed.
- [ ] Tests updated (unit + integration).
- [ ] Documentation updated (schema authoring guide and this file).
- [ ] `.completed` phase note recorded with verification commands.

Following this template keeps the CLI on a single autocomplete system and
prevents backslides into bespoke manual handlers.
