# Domain Analysis

<!-- @plan:PLAN-20251013-AUTOCOMPLETE.P01 @requirement:REQ-001 @requirement:REQ-002 @requirement:REQ-003 @requirement:REQ-004 @requirement:REQ-006 -->

## Current Completion Architecture
- `useSlashCompletion.tsx` couples command navigation and argument completion with manual token splitting.
- `/subagent` defines its own completion handler that only covers the first argument.
- `/set` implements three separate completion functions for different subcommands.
- No shared schema or hint mechanism.

## Pain Points
1. **Duplication**: Each command re-implements token parsing and suggestions.
2. **Poor UX**: Multi-argument commands lack runtime hints; users must remember argument order.
3. **Inflexibility**: Hard to extend or adjust completions because logic is scattered.
4. **Lack of Tests**: Existing completions lack comprehensive test coverage (no property/mutation testing).

## Integration Requirements (Derived from PLAN.md)
- `useSlashCompletion.tsx` must be rewritten to use schema resolver; old branch removed.
- `/subagent` and `/set` completions must be replaced with schema definitions.
- Suggestion display must render hints without breaking navigation.
- CLI workflows must be validated with integration tests, not just unit tests.

## Risks & Constraints
- Token parsing must handle quotes, escapes, trailing spaces.
- Resolver must avoid flicker when async completers resolve.
- Tests must satisfy property-based/mutation thresholds per dev-docs.
