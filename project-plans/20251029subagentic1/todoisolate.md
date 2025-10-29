# PLAN-20251029-TODOISOLATE

## Objective
Prepare todo list services so each agent (primary or subagent) maintains independent task lists. Introduce agent-scoped namespaces without changing current behaviour (primary agent remains default). Subagents will later supply their agent id to keep todos separate.

## Preconditions
- AgentId plumbing defined (PLAN-20251029-AGENTID).
- Existing todo services/tests passing.

## Plan (Test-First)

### P01 – Test Inventory
- Review coverage for `TodoWrite`, `TodoRead`, reminder services, and persistence layers.
- Determine how to mock/spy on new namespace behaviour.

### P02 – Red Tests: Service Layer
- Add failing tests to `todo-*` unit suites verifying:
  - Todo service accepts optional `agentId`/namespace parameter.
  - Without parameter, defaults to primary namespace.
  - Separate namespaces do not mix tasks.

### P03 – Red Tests: CLI / Reminder Integration
- Extend CLI command tests or reminder service tests to expect agent-aware APIs.
- Ensure reminder escalation logic remains per-agent.

### P04 – Implementation (Green)
- Update todo storage, formatter, and service APIs to include namespace keying.
- Maintain backward compatibility by defaulting to primary agent id.
- Propagate agent id through helper utilities (e.g., `TodoReminderService`).

### P05 – Verification
- Run todo-related unit tests, then full test suite/lint/typecheck.
- Manual CLI sanity check: create/read todos – behaviour unchanged.

### P06 – Documentation
- Update developer docs describing todo storage, noting agent-aware capability.
- Capture migration notes for future subagent integration work.

## Success Criteria
- Tests confirm isolated todo namespaces.
- Primary agent behaviour unchanged.
- Subagents can later supply their own agent ids without further structural changes.
