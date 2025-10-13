# Specification: Autocomplete Schema & Hint System

<!-- @plan:PLAN-20251013-AUTOCOMPLETE.P00 @requirement:REQ-001 @requirement:REQ-002 @requirement:REQ-003 @requirement:REQ-004 @requirement:REQ-005 @requirement:REQ-006 -->

Plan ID: `PLAN-20251013-AUTOCOMPLETE`
Generated: 2025-10-13
Total Phases: 24

## Problem Statement

The CLI’s slash-command autocomplete logic is scattered across individual command files, leading to inconsistent user experience and heavy duplication. Multi-step commands provide no inline guidance about required arguments, forcing users to guess the order and meaning of inputs. `/subagent save`, in particular, requires entering name, profile, mode, and prompt with zero context. The lack of a unified system makes additions like `/set` and `/profile` difficult to maintain.

## Goals (Requirements)

| Requirement | Description |
|-------------|-------------|
| REQ-001 | Define a schema data model that describes positional arguments, literals, nested flows, and hints. |
| REQ-002 | Implement a shared resolver that walks the schema, tokenizes user input, and returns suggestions plus contextual hints. |
| REQ-003 | Update the slash command UI to display the active argument hint above the suggestion list. |
| REQ-004 | Replace `/subagent` command completion with the schema-driven system (fully removing legacy logic). |
| REQ-005 | Provide comprehensive automated tests (unit + integration) covering schema resolution, hint rendering, and `/subagent` behavior, including property-based and mutation testing thresholds. |
| REQ-006 | Document migration steps and execute the `/set` command migration within this plan (no opt-in/parallel versions). |

## Integration Analysis (MANDATORY)

### Existing Code That Will Use This Feature
- `packages/cli/src/ui/hooks/useSlashCompletion.tsx` – must be rewritten to delegate argument completion entirely to the schema resolver.
- `packages/cli/src/ui/commands/subagentCommand.ts` – must declare the new schema and remove bespoke completion logic.
- `packages/cli/src/ui/commands/setCommand.ts` – migrated to schema in later phases (as per REQ-006).
- `packages/cli/src/ui/components/SuggestionsDisplay.tsx` – must render hint text supplied by the resolver.

### Existing Code To Be Replaced/Removed
- Current argument completion branch in `useSlashCompletion.tsx` (lines handling token splitting and manual suggestion lists).
- Per-command completion functions in `/subagent`, `/set`, and any direct references to old completion helpers.
- Any residual helper utilities tied to the old completion path.

### User Access Points
- CLI `/subagent save` – users see contextual hints and schema-driven suggestions.
- CLI `/set` – once migrated, provides hints for nested argument flows.
- All future slash commands will consume the schema system; no new custom completion entry points allowed.

### Migration Requirements
- `/subagent` completion fully transitioned by Phase 08.
- `/set` completion migrated in Phase 11 (newly added to satisfy REQ-006).
- Old completion utilities deleted in Phase 12.
- Documentation describing schema authoring published in Phase 13.

## Non-Goals / Out of Scope
- `/chat` and `/mcp` keep their custom behavior until dedicated follow-up plan; they are explicitly excluded here but must not maintain duplicate completion paths once migrated in future work.
- No terminal UI redesign beyond adding a single hint line above existing suggestions.

## Success Criteria
- `/subagent save` and `/set` operate solely via the schema resolver with hints and suggestions verified by tests.
- Mutation testing >= 80% on schema resolver and integration logic.
- Property-based tests comprise >= 30% of total tests introduced.
- Legacy completion code removed; no parallel implementations remain.
